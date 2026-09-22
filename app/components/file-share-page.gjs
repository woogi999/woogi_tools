import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import Peer from 'peerjs';
import QRCodeStyling from 'qr-code-styling';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import {
  generateRoomCode,
  buildShareUrl,
  roomCodeFromUrl,
  formatBytes,
} from '../utils/file-share';
import { directOrRelayedPeerOptions } from '../utils/ice';
import { openRelayLink } from '../utils/relay-link';
import { acceptPastedFiles } from '../utils/paste-files';
import { holdAwake, releaseAwake } from '../utils/keep-awake';

// Files are sliced and sent one piece at a time so neither side ever has to
// hold more than one piece of a large file in memory at once, and so the
// progress bar has something to move on for big files.
const CHUNK_SIZE = 4 * 1024 * 1024;

// Stop feeding the data channel once this much is queued, so a fast sender
// can't balloon memory on a slow connection.
const BUFFERED_AMOUNT_LIMIT = 16 * 1024 * 1024;

// How much of each queued file is read into memory before anyone has joined,
// so the first pieces are already in hand the moment a connection opens.
const WARM_BYTES = 32 * 1024 * 1024;

// After this long with nobody connected, explain what might be blocking it.
const SLOW_CONNECT_MS = 20000;

// WebRTC is given this long to introduce the two browsers directly before the
// relay is tried as well (utils/relay-link.js). Direct is worth waiting a few
// seconds for: it is faster and touches nothing in between. But on a network
// that blocks UDP, or between two strict NATs, waiting longer never helps --
// the direct attempt is not slow, it is impossible.
const RELAY_AFTER_MS = 8000;

// Chrome/Edge can stream straight to a file on disk; other browsers have to
// buffer the pieces and hand back a single Blob once the transfer finishes.
const SUPPORTS_FSA =
  typeof window !== 'undefined' &&
  typeof window.showSaveFilePicker === 'function';

const eq = (a, b) => a === b;
const progressWidth = (p) => htmlSafe(`width:${Math.round((p ?? 0) * 100)}%`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let nextId = 1;
const newTransfer = (patch) => ({ id: `t${nextId++}`, progress: 0, ...patch });

function* chunksOf(file) {
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  for (let i = 0; i < total; i++) {
    yield {
      index: i,
      total,
      blob: file.slice(
        i * CHUNK_SIZE,
        Math.min(file.size, (i + 1) * CHUNK_SIZE),
      ),
    };
  }
}

export default class FileSharePage extends Component {
  // While this is true, leaving the page floats the tool in a PiP window
  // instead of tearing it down, so the work carries on (see services/pip.js).
  get pipBusy() {
    return this.active;
  }

  get pipWarning() {
    return 'Close File Share? The transfer in progress will stop and the other side will be disconnected.';
  }
  @tracked shareCode = '';
  @tracked joinInput = '';
  @tracked joinError = '';
  @tracked active = false;
  @tracked peers = [];
  @tracked outgoing = [];
  @tracked incoming = [];
  @tracked dragging = false;
  @tracked slowToConnect = false;
  // True once the WebSocket fallback is carrying the transfer, so the page can
  // say so rather than claiming a direct connection it doesn't have.
  @tracked relayed = false;
  // Set when neither a direct connection nor the relay could be established,
  // so the hint can stop saying "still looking".
  @tracked relayFailed = false;

  peer = null;
  role = null; // 'host' | 'join'
  connections = new Map();
  slowTimer = null;
  relayTimer = null;
  relayAbort = null;
  relayConnection = null;
  relayPending = false;
  sending = false;

  // Keyed by transfer id: buffered chunks awaiting a save location, open
  // disk writers for in-progress streaming saves, and running byte totals.
  chunkBuffers = new Map();
  writers = new Map();
  bytesReceived = new Map();
  // Pieces read ahead of time, keyed by transfer id.
  warm = new Map();

  qrInstance = new QRCodeStyling({
    type: 'svg',
    width: 160,
    height: 160,
    margin: 8,
    dotsOptions: { type: 'rounded' },
  });

  constructor(owner, args) {
    super(owner, args);
    const codeFromLink = roomCodeFromUrl();
    if (codeFromLink) {
      this.joinInput = codeFromLink;
      this.joinShare(codeFromLink);
    }
    registerDestructor(this, () => {
      releaseAwake('file-share');
      this.peer?.destroy();
      clearTimeout(this.slowTimer);
      this.abandonRelay();
      for (const writer of this.writers.values())
        writer.abort().catch(() => {});
      for (const t of this.incoming)
        if (t.blobUrl) URL.revokeObjectURL(t.blobUrl);
    });
  }

  // ─── Share lifecycle ─────────────────────────────────────────────────

  get shareUrl() {
    return this.shareCode ? buildShareUrl(this.shareCode) : '';
  }

  get hasPeers() {
    return this.peers.length > 0;
  }

  get peerLabel() {
    if (!this.peers.length) return 'Waiting for someone to connect…';
    return this.peers.length === 1
      ? '1 person connected'
      : `${this.peers.length} people connected`;
  }

  // The person offering files: registers with the broker under the share
  // code itself, so anyone who enters that code can find and connect to them.
  hostShare() {
    if (this.peer || this.role) return;
    this.joinError = '';
    this.role = 'host';
    const code = generateRoomCode();
    this.shareCode = code;
    this.active = true;
    // A share must survive the tab going into the background: no sleeping,
    // no throttling, no being thrown away by the browser.
    holdAwake('file-share', 'File Share is still sending. Leave anyway?');
    this.armSlowTimer();
    this.openPeer(code, (peer) => {
      peer.on('connection', (conn) => this.attachConnection(conn));
    });
  }

  // The person receiving files: gets a random id from the broker, then opens
  // a connection to the host's id (the share code they were given).
  joinShare(code) {
    if (this.peer || this.role) return;
    this.joinError = '';
    this.role = 'join';
    this.shareCode = code;
    this.active = true;
    holdAwake('file-share', 'File Share is still receiving. Leave anyway?');
    this.armSlowTimer();
    this.openPeer(null, (peer) => {
      peer.on('open', () => {
        const conn = peer.connect(code, {
          reliable: true,
          serialization: 'binary',
        });
        this.attachConnection(conn);
      });
    });
  }

  // Files go straight between the two browsers where they can (fast, but each
  // side can see the other's IP address), and through a relay where they can't.
  openPeer(id, setup) {
    if (this.peer || this.isDestroying) return;
    const options = directOrRelayedPeerOptions();
    const peer = id ? new Peer(id, options) : new Peer(options);
    this.peer = peer;
    setup(peer);
    peer.on('error', (error) => this.handlePeerError(error));
  }

  armSlowTimer() {
    clearTimeout(this.slowTimer);
    this.slowTimer = setTimeout(() => {
      if (!this.peers.length) this.slowToConnect = true;
    }, SLOW_CONNECT_MS);
    clearTimeout(this.relayTimer);
    this.relayTimer = setTimeout(() => this.tryRelay(), RELAY_AFTER_MS);
  }

  // The fallback: both sides join a room named after the share code on this
  // site's own Worker, and their file pieces are forwarded over a WebSocket.
  // Whichever transport connects first wins and the other is dropped, so a
  // direct connection is still preferred whenever one is possible.
  async tryRelay() {
    // Both the timer and a WebRTC failure can ask for the relay; only the
    // first of them should open a socket.
    if (this.relayPending || !this.canStillRelay) return;
    this.relayPending = true;
    this.relayAbort = new AbortController();
    let connection;
    try {
      connection = await openRelayLink(this.shareCode, {
        signal: this.relayAbort.signal,
      });
    } catch {
      this.relayPending = false;
      // Neither transport worked. Say so rather than spinning for ever.
      if (this.canStillRelay) {
        this.slowToConnect = true;
        this.relayFailed = true;
      }
      return;
    }
    this.relayPending = false;
    // WebRTC got there while we were waiting, or the share was torn down.
    if (this.hasPeers || !this.active) {
      connection.close();
      return;
    }
    this.relayConnection = connection;
    connection.on('close', () => {
      if (this.relayConnection === connection) {
        this.relayConnection = null;
        this.relayed = false;
      }
    });
    this.relayed = true;
    this.attachConnection(connection);
  }

  // Called once a direct connection is up: the relay is no longer wanted.
  abandonRelay() {
    clearTimeout(this.relayTimer);
    this.relayTimer = null;
    this.relayAbort?.abort();
    this.relayAbort = null;
    this.relayConnection?.close();
    this.relayConnection = null;
    this.relayPending = false;
    this.relayed = false;
    this.relayFailed = false;
  }

  attachConnection(conn) {
    conn.on('open', () => {
      clearTimeout(this.slowTimer);
      this.slowToConnect = false;
      // A direct connection makes the relay redundant; tear it down before it
      // can carry a duplicate copy of the same file.
      if (conn !== this.relayConnection) {
        const relayed = this.relayConnection;
        this.abandonRelay();
        if (relayed) this.dropConnection(relayed.peer);
      }
      this.connections.set(conn.peer, conn);
      this.peers = [...this.connections.keys()];
      this.flushQueue();
    });
    conn.on('data', (message) => this.onMessage(conn.peer, message));
    conn.on('close', () => this.dropConnection(conn.peer));
    conn.on('error', () => this.dropConnection(conn.peer));
  }

  dropConnection(peerId) {
    this.connections.delete(peerId);
    this.peers = this.peers.filter((p) => p !== peerId);
  }

  handlePeerError(error) {
    if (this.hasPeers) return; // an already-connected share can ignore late/unrelated errors
    // A wrong or taken code is the person's problem to fix, and no relay can
    // help with it. Everything else is the network refusing WebRTC -- which is
    // exactly what the relay is for, so don't tear the share down over it.
    const fatal =
      error?.type === 'unavailable-id' || error?.type === 'peer-unavailable';
    if (!fatal && this.canStillRelay) {
      this.tryRelay();
      return;
    }
    if (error?.type === 'private-connection') this.joinError = error.message;
    else if (error?.type === 'unavailable-id')
      this.joinError = 'That code just got taken by someone else. Try again.';
    else if (error?.type === 'peer-unavailable')
      this.joinError = "That code doesn't look right. Check it and try again.";
    else
      this.joinError =
        "Couldn't reach the connection service. Check your connection and try again.";
    this.startOver();
  }

  // The relay is still worth trying while the share is up and nothing else
  // has connected -- including when it is already mid-attempt.
  get canStillRelay() {
    return this.active && !this.hasPeers && !this.relayConnection;
  }

  onMessage(peerId, message) {
    if (message?.kind === 'chunk')
      this.onChunkArrived(message.meta, peerId, message.data);
  }

  requestFile = (event) => {
    event.preventDefault();
    const code = this.joinInput.trim().toUpperCase();
    if (code) this.joinShare(code);
  };

  setJoinInput = (event) => (this.joinInput = event.target.value);

  startOver = () => {
    releaseAwake('file-share');
    this.warm.clear();
    this.peer?.destroy();
    clearTimeout(this.slowTimer);
    this.abandonRelay();
    this.slowToConnect = false;
    this.peer = null;
    this.role = null;
    this.connections.clear();
    this.active = false;
    this.shareCode = '';
    this.joinInput = '';
    this.peers = [];
    this.outgoing = [];
    for (const writer of this.writers.values()) writer.abort().catch(() => {});
    this.writers.clear();
    this.chunkBuffers.clear();
    this.bytesReceived.clear();
    for (const t of this.incoming)
      if (t.blobUrl) URL.revokeObjectURL(t.blobUrl);
    this.incoming = [];
  };

  renderQr = modifier((element, [url]) => {
    if (!url) return;
    element.replaceChildren();
    this.qrInstance.update({ data: url });
    this.qrInstance.append(element);
  });

  // ─── Receiving ───────────────────────────────────────────────────────

  updateIncoming(id, patch) {
    this.incoming = this.incoming.map((t) =>
      t.id === id ? { ...t, ...patch } : t,
    );
  }

  // Rows appear on the first chunk, not before.
  ensureIncoming({ id, name, size, type }, peerId) {
    if (this.incoming.some((t) => t.id === id)) return;
    this.incoming = [
      ...this.incoming,
      {
        id,
        name,
        size,
        type,
        peerId,
        progress: 0,
        status: 'receiving',
        hasWriter: false,
        savedToDisk: false,
        blobUrl: null,
      },
    ];
    this.chunkBuffers.set(id, []);
    this.bytesReceived.set(id, 0);
  }

  async onChunkArrived(metadata, peerId, data) {
    const { id, size, type, chunkIndex, totalChunks } = metadata;
    this.ensureIncoming(metadata, peerId);

    const writer = this.writers.get(id);
    if (writer) await writer.write(data);
    else this.chunkBuffers.get(id).push(data);

    this.bytesReceived.set(
      id,
      (this.bytesReceived.get(id) ?? 0) + data.byteLength,
    );

    if (chunkIndex < totalChunks - 1) {
      this.updateIncoming(id, {
        progress: Math.min(1, this.bytesReceived.get(id) / size),
      });
      return;
    }

    if (writer) {
      await writer.close();
      this.writers.delete(id);
      this.updateIncoming(id, {
        status: 'done',
        progress: 1,
        savedToDisk: true,
      });
    } else {
      const blob = new Blob(this.chunkBuffers.get(id), {
        type: type || 'application/octet-stream',
      });
      this.chunkBuffers.delete(id);
      this.updateIncoming(id, {
        status: 'done',
        progress: 1,
        blobUrl: URL.createObjectURL(blob),
      });
    }
  }

  saveAs = async (id) => {
    const entry = this.incoming.find((t) => t.id === id);
    if (!entry || !SUPPORTS_FSA) return;
    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: entry.name });
    } catch {
      return; // user cancelled the picker
    }
    const writable = await handle.createWritable();
    for (const chunk of this.chunkBuffers.get(id) ?? [])
      await writable.write(chunk);
    this.chunkBuffers.set(id, []);
    if (entry.status === 'done') {
      await writable.close();
      this.updateIncoming(id, { savedToDisk: true });
    } else {
      this.writers.set(id, writable);
      this.updateIncoming(id, { hasWriter: true });
    }
  };

  removeIncoming = (id) => {
    const t = this.incoming.find((t) => t.id === id);
    if (t?.blobUrl) URL.revokeObjectURL(t.blobUrl);
    this.chunkBuffers.delete(id);
    this.bytesReceived.delete(id);
    this.incoming = this.incoming.filter((t) => t.id !== id);
  };

  // ─── Sending ─────────────────────────────────────────────────────────

  addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    if (!this.active) this.hostShare();
    this.outgoing = [
      ...this.outgoing,
      ...files.map((file) =>
        newTransfer({
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          status: 'pending',
        }),
      ),
    ];
    if (this.hasPeers) this.flushQueue();
    else this.warmUp();
  }

  // Reads the first pieces of every waiting file while nobody is here yet,
  // so sending begins the instant someone joins rather than after the first
  // disk read. Files are only read, never sent, until there is a peer.
  async warmUp() {
    let budget =
      WARM_BYTES -
      [...this.warm.values()].reduce(
        (n, list) => n + list.reduce((m, c) => m + c.byteLength, 0),
        0,
      );
    for (const transfer of this.outgoing) {
      if (transfer.status !== 'pending' || this.warm.has(transfer.id)) continue;
      const pieces = [];
      this.warm.set(transfer.id, pieces);
      for (const { blob } of chunksOf(transfer.file)) {
        if (budget <= 0 || this.hasPeers) break;
        pieces.push(await blob.arrayBuffer());
        budget -= blob.size;
      }
    }
  }

  selectFiles = (event) => {
    this.addFiles(event.target.files);
    event.target.value = '';
  };

  dragOver = (event) => {
    event.preventDefault();
    this.dragging = event.type === 'dragover';
  };

  dropFiles = (event) => {
    event.preventDefault();
    this.dragging = false;
    this.addFiles(event.dataTransfer.files);
  };

  removeOutgoing = (id) =>
    (this.outgoing = this.outgoing.filter((t) => t.id !== id));

  updateOutgoing(id, patch) {
    this.outgoing = this.outgoing.map((t) =>
      t.id === id ? { ...t, ...patch } : t,
    );
  }

  // Sends to every connected peer (a host can be serving several people at
  // once), waiting out any connection whose send buffer is already full.
  async broadcast(message) {
    await Promise.all(
      [...this.connections.values()].map(async (conn) => {
        const channel = conn.dataChannel;
        // Wait on the channel's own "buffer has drained" event rather than a
        // timer: timers are slowed to a crawl in a background tab, the event
        // isn't. The timeout is only a safety net.
        while (channel && channel.bufferedAmount > BUFFERED_AMOUNT_LIMIT) {
          channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LIMIT / 2;
          await Promise.race([
            new Promise((resolve) =>
              channel.addEventListener('bufferedamountlow', resolve, {
                once: true,
              }),
            ),
            sleep(1000),
          ]);
        }
        conn.send(message);
      }),
    );
  }

  async flushQueue() {
    if (this.sending) return;
    this.sending = true;
    try {
      let pending;
      while ((pending = this.outgoing.find((t) => t.status === 'pending'))) {
        this.updateOutgoing(pending.id, { status: 'sending' });
        try {
          let sentBytes = 0;
          const warmed = this.warm.get(pending.id) ?? [];
          this.warm.delete(pending.id);
          for (const { index, total, blob } of chunksOf(pending.file)) {
            const data = warmed[index] ?? (await blob.arrayBuffer());
            warmed[index] = null;
            await this.broadcast({
              kind: 'chunk',
              meta: {
                id: pending.id,
                name: pending.name,
                size: pending.size,
                type: pending.type,
                chunkIndex: index,
                totalChunks: total,
              },
              data,
            });
            sentBytes += blob.size;
            this.updateOutgoing(pending.id, {
              progress: Math.min(1, sentBytes / pending.size),
            });
          }
          this.updateOutgoing(pending.id, { status: 'done', progress: 1 });
        } catch {
          this.updateOutgoing(pending.id, { status: 'error' });
        }
      }
    } finally {
      this.sending = false;
    }
  }

  pasteFiles = (files) => this.addFiles(files);

  <template>
    <ToolPage
      @route="file-share"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Drop a file, share the code, and it goes straight from your browser to theirs over an encrypted link. Nothing sits on a server."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <p class="fs-warning" role="note"><Icon
            @name="triangle-alert"
            @size={{15}}
          />
          <span><strong>Only share with people you trust.</strong>
            Files go directly between your devices for speed, so the other
            person's browser can see your IP address (roughly where you are and
            which network you're on). If the network won't allow a direct link,
            the files are passed along through this site instead, which hides
            your address but is slower. Nothing is stored either way.</span></p>
        {{#if this.active}}
          <div class="fs-frame pop-in">
            <div class="fs-room">
              <div class="fs-room-info">
                <div class="fs-code-block">
                  <span class="qr-label is-muted">Share Code</span>
                  <div class="fs-code-row">
                    <span class="fs-code">{{this.shareCode}}</span>
                    <CopyButton @value={{this.shareCode}} />
                  </div>
                </div>
                <div class="fs-code-block">
                  <span class="qr-label is-muted">Share Link</span>
                  <div class="fs-code-row">
                    <span class="fs-link">{{this.shareUrl}}</span>
                    <CopyButton @value={{this.shareUrl}} />
                  </div>
                </div>
                <p class="fs-status {{if this.hasPeers 'is-connected'}}">
                  <Icon
                    @name={{if this.hasPeers "users" "radio-tower"}}
                    @size={{14}}
                  />
                  {{this.peerLabel}}
                </p>
                {{#if this.relayed}}
                  <p class="tool-hint">This network wouldn't allow a direct
                    connection, so the files are going through this site
                    instead. Nothing is stored; the pieces are passed straight
                    along, but it may be slower than a direct transfer.</p>
                {{else if this.relayFailed}}
                  <p class="tool-hint">Couldn't connect, directly or through
                    this site. Check that both devices are online and that the
                    other one has the code entered, then try again.</p>
                {{else if this.slowToConnect}}
                  <p class="tool-hint">Still looking. Keep this tab open on both
                    devices, and make sure the other one has the code entered.</p>
                {{/if}}
                <button
                  type="button"
                  class="fs-reset"
                  {{on "click" this.startOver}}
                ><Icon @name="x" @size={{13}} /> Start Over</button>
              </div>
              <div class="fs-qr" {{this.renderQr this.shareUrl}}></div>
            </div>
          </div>

          <div class="fs-frame pop-in">
            <div class="fs-main">
              <div class="fs-side">
                <h3 class="qr-heading">Send Files</h3>
                <label
                  class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
                  {{on "dragover" this.dragOver}}
                  {{on "dragleave" this.dragOver}}
                  {{on "drop" this.dropFiles}}
                >
                  <Icon @name="upload" @size={{22}} />
                  <span>{{if
                      this.dragging
                      "Drop files here"
                      "Drop files, or click to browse"
                    }}</span>
                  <input
                    type="file"
                    multiple
                    class="sr-only"
                    {{on "change" this.selectFiles}}
                  />
                </label>
                <p class="tool-hint">Large files send in 4 MB pieces so your
                  browser never has to hold the whole thing in memory.</p>
                {{#if this.outgoing.length}}
                  <ul class="fs-list">
                    {{#each this.outgoing as |t|}}
                      <SendRow
                        @transfer={{t}}
                        @onRemove={{fn this.removeOutgoing t.id}}
                      />
                    {{/each}}
                  </ul>
                {{/if}}
              </div>
              <div class="fs-side">
                <h3 class="qr-heading">Received Files</h3>
                {{#unless SUPPORTS_FSA}}
                  <p class="tool-hint">Your browser will buffer incoming files
                    until they finish. Chrome or Edge can save straight to disk
                    as pieces arrive.</p>
                {{/unless}}
                {{#if this.incoming.length}}
                  <ul class="fs-list">
                    {{#each this.incoming as |t|}}
                      <ReceiveRow
                        @transfer={{t}}
                        @onSaveAs={{fn this.saveAs t.id}}
                        @onRemove={{fn this.removeIncoming t.id}}
                      />
                    {{/each}}
                  </ul>
                {{else}}
                  <p class="fs-empty">Files sent to you will appear here.</p>
                {{/if}}
              </div>
            </div>
          </div>
        {{else}}
          <div class="fs-frame pop-in">
            <div class="fs-start">
              <div class="fs-start-col">
                <h3 class="qr-heading">Share files</h3>
                <p class="tool-hint">Drop files below to get a code and link you
                  can send to someone.</p>
                <label
                  class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
                  {{on "dragover" this.dragOver}}
                  {{on "dragleave" this.dragOver}}
                  {{on "drop" this.dropFiles}}
                >
                  <Icon @name="upload" @size={{22}} />
                  <span>{{if
                      this.dragging
                      "Drop files here"
                      "Drop files, or click to browse"
                    }}</span>
                  <input
                    type="file"
                    multiple
                    class="sr-only"
                    {{on "change" this.selectFiles}}
                  />
                </label>
              </div>
              <div class="fs-start-col">
                <h3 class="qr-heading">Get a file</h3>
                <p class="tool-hint">Got a code from someone? Enter it below to
                  receive their files.</p>
                <form class="fs-join" {{on "submit" this.requestFile}}>
                  <input
                    type="text"
                    class="fs-code-input"
                    placeholder="Share code"
                    aria-label="Share code"
                    maxlength="8"
                    value={{this.joinInput}}
                    {{on "input" this.setJoinInput}}
                  />
                  <button type="submit" class="btn active">Get File</button>
                </form>
                {{#if this.joinError}}<p
                    class="tool-error"
                  >{{this.joinError}}</p>{{/if}}
              </div>
            </div>
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}

const SendRow = <template>
  <li class="fs-row">
    <Icon @name="file" @size={{16}} />
    <div class="fs-row-info">
      <span class="fs-row-name">{{@transfer.name}}</span>
      <span class="fs-row-size">{{formatBytes @transfer.size}}</span>
    </div>
    <div class="fs-row-status">
      {{#if (eq @transfer.status "pending")}}
        <span class="fs-tag">Queued</span>
      {{else if (eq @transfer.status "error")}}
        <span class="fs-tag is-error"><Icon @name="circle-alert" @size={{13}} />
          Failed</span>
      {{else if (eq @transfer.status "done")}}
        <span class="fs-tag is-done"><Icon @name="check" @size={{13}} />
          Sent</span>
      {{else}}
        <div class="fs-progress"><div
            class="fs-progress-bar"
            style={{progressWidth @transfer.progress}}
          ></div></div>
      {{/if}}
    </div>
    {{#if (eq @transfer.status "pending")}}
      <button
        type="button"
        class="fs-remove"
        aria-label="Remove {{@transfer.name}}"
        {{on "click" @onRemove}}
      ><Icon @name="x" @size={{13}} /></button>
    {{/if}}
  </li>
</template>;

const ReceiveRow = <template>
  <li class="fs-row">
    <Icon @name="file" @size={{16}} />
    <div class="fs-row-info">
      <span class="fs-row-name">{{@transfer.name}}</span>
      <span class="fs-row-size">{{formatBytes @transfer.size}}</span>
    </div>
    <div class="fs-row-status">
      {{#if @transfer.savedToDisk}}
        <span class="fs-tag is-done"><Icon @name="check" @size={{13}} />
          Saved</span>
      {{else if @transfer.blobUrl}}
        <a
          class="btn fs-save"
          href={{@transfer.blobUrl}}
          download={{@transfer.name}}
        ><Icon @name="download" @size={{13}} /> Save</a>
      {{else if (and SUPPORTS_FSA (not @transfer.hasWriter))}}
        {{! Still arriving: Chrome/Edge can start writing it straight to disk. }}
        <button type="button" class="btn fs-save" {{on "click" @onSaveAs}}><Icon
            @name="download"
            @size={{13}}
          />
          Save As…</button>
      {{else}}
        <div class="fs-progress"><div
            class="fs-progress-bar"
            style={{progressWidth @transfer.progress}}
          ></div></div>
      {{/if}}
    </div>
    {{#if (eq @transfer.status "done")}}
      <button
        type="button"
        class="fs-remove"
        aria-label="Remove {{@transfer.name}}"
        {{on "click" @onRemove}}
      ><Icon @name="x" @size={{13}} /></button>
    {{/if}}
  </li>
</template>;

function and(a, b) {
  return a && b;
}

function not(a) {
  return !a;
}
