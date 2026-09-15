import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import CopyButton from './copy-button';
import HoldConfirm from './hold-confirm';
import { generateRoomCode, formatBytes } from '../utils/file-share';
import { directPeerOptions } from '../utils/ice';
import { collectData, summarise, validateBackup, applyBackup } from '../utils/site-data';

// Moves this site's data from one device to another over a direct WebRTC
// link, like File Share. The sender opens a one-time code; the receiver opens
// the link (or types the code), sees what's coming, and has to confirm before
// anything on their device is replaced. Data is only sent after they accept,
// and only to the first device that connects.
//
// Wire: receiver 'hello' → sender 'offer' { summary } → receiver 'accept' | 'decline'
//       → sender 'data' { backup } → receiver 'done' | 'failed'.

const peerIdFor = (code) => `woogi-transfer-${code}`;
const CODE_PARAM = 'transfer';

export function transferCodeFromUrl() {
  const code = new URLSearchParams(window.location.search).get(CODE_PARAM);
  return code ? code.trim().toUpperCase().slice(0, 8) : null;
}

function transferUrl(code) {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set(CODE_PARAM, code);
  return url.toString();
}

export default class DataTransfer extends Component {
  // Sender: 'idle' | 'waiting' | 'offered' | 'sending' | 'sent' | 'declined'
  // Receiver: 'connecting' | 'reviewing' | 'applying' | 'done'
  @tracked stage = 'idle';
  @tracked role = null; // 'send' | 'receive'
  @tracked code = '';
  @tracked joinInput = '';
  @tracked error = '';
  @tracked summary = null;

  peer = null;
  conn = null;
  qr = null;

  constructor(owner, args) {
    super(owner, args);
    const code = transferCodeFromUrl();
    if (code) {
      this.joinInput = code;
      this.receive(code);
    }
    registerDestructor(this, () => this.stop());
  }

  get shareUrl() {
    return this.code ? transferUrl(this.code) : '';
  }

  get busy() {
    return this.stage !== 'idle';
  }

  get summaryText() {
    const s = this.summary;
    if (!s) return '';
    const parts = [`${s.notes} note${s.notes === 1 ? '' : 's'}`, `${s.avatars} saved avatar${s.avatars === 1 ? '' : 's'}`, `${s.favourites} favourite${s.favourites === 1 ? '' : 's'}`, `${s.keys} saved item${s.keys === 1 ? '' : 's'} in all (${formatBytes(s.bytes)})`];
    return parts.join(' · ');
  }

  async openPeer(id) {
    const { default: Peer } = await import('peerjs');
    if (this.isDestroying) return null;
    const options = directPeerOptions();
    const peer = id ? new Peer(id, options) : new Peer(options);
    this.peer = peer;
    peer.on('error', (error) => this.fail(error));
    return peer;
  }

  // ─── Sending ─────────────────────────────────────────────────────────

  send = async () => {
    this.stop();
    this.error = '';
    this.role = 'send';
    this.code = generateRoomCode();
    this.stage = 'waiting';
    const peer = await this.openPeer(peerIdFor(this.code));
    if (!peer) return;
    peer.on('connection', (conn) => {
      // One device only: anyone after the first is turned away.
      if (this.conn) {
        conn.on('open', () => conn.close());
        return;
      }
      this.conn = conn;
      conn.on('open', () => {
        this.stage = 'offered';
        conn.send({ t: 'offer', summary: summarise(collectData()) });
      });
      conn.on('data', (message) => this.fromReceiver(message));
      conn.on('close', () => {
        if (this.stage === 'offered' || this.stage === 'sending') this.fail({ message: 'The other device disconnected.' });
      });
    });
  };

  fromReceiver(message) {
    if (message?.t === 'accept' && this.stage === 'offered') {
      this.stage = 'sending';
      this.conn.send({ t: 'data', backup: collectData() });
    } else if (message?.t === 'decline') {
      this.stage = 'declined';
      this.closePeer();
    } else if (message?.t === 'done') {
      this.stage = 'sent';
      this.closePeer();
    } else if (message?.t === 'failed') {
      this.fail({ message: `The other device couldn’t save the data: ${String(message.reason ?? 'unknown error').slice(0, 120)}` });
    }
  }

  // ─── Receiving ───────────────────────────────────────────────────────

  setJoinInput = (event) => (this.joinInput = event.target.value);

  join = (event) => {
    event.preventDefault();
    const code = this.joinInput.trim().toUpperCase();
    if (code) this.receive(code);
  };

  async receive(code) {
    this.stop();
    this.error = '';
    this.role = 'receive';
    this.code = code;
    this.stage = 'connecting';
    const peer = await this.openPeer();
    if (!peer) return;
    peer.on('open', () => {
      const conn = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
      this.conn = conn;
      conn.on('data', (message) => this.fromSender(message));
      conn.on('close', () => {
        if (this.stage === 'connecting' || this.stage === 'reviewing' || this.stage === 'applying') this.fail({ message: 'The other device closed the transfer.' });
      });
    });
  }

  fromSender(message) {
    if (message?.t === 'offer' && this.stage === 'connecting') {
      const s = message.summary ?? {};
      this.summary = { keys: Number(s.keys) || 0, bytes: Number(s.bytes) || 0, notes: Number(s.notes) || 0, avatars: Number(s.avatars) || 0, favourites: Number(s.favourites) || 0, name: typeof s.name === 'string' ? s.name.slice(0, 20) : null };
      this.stage = 'reviewing';
    } else if (message?.t === 'data' && this.stage === 'applying') {
      try {
        applyBackup(validateBackup(message.backup));
        this.conn.send({ t: 'done' });
        this.stage = 'done';
        // Services read storage when the app starts, so start it again with the new data.
        setTimeout(() => {
          const url = new URL(window.location.href);
          url.searchParams.delete(CODE_PARAM);
          window.location.replace(url.toString());
        }, 1400);
      } catch (error) {
        this.conn.send({ t: 'failed', reason: error.message });
        this.fail(error);
      }
    }
  }

  accept = () => {
    if (this.stage !== 'reviewing') return;
    this.stage = 'applying';
    this.conn?.send({ t: 'accept' });
  };

  decline = () => {
    this.conn?.send({ t: 'decline' });
    setTimeout(() => this.reset(), 200);
  };

  // ─── Plumbing ────────────────────────────────────────────────────────

  fail(error) {
    if (this.stage === 'done' || this.stage === 'sent') return;
    if (error?.type === 'peer-unavailable') this.error = 'No transfer found with that code. Check it, and keep the sending device’s page open.';
    else if (error?.type === 'unavailable-id') this.error = 'That code just got taken. Try again.';
    else this.error = error?.message && !error.type ? error.message : 'Couldn’t connect. Check your connection and try again.';
    this.stage = 'idle';
    this.closePeer();
  }

  closePeer() {
    const peer = this.peer;
    this.peer = null;
    this.conn = null;
    // Let the last message go out first.
    setTimeout(() => peer?.destroy(), 300);
  }

  stop() {
    this.peer?.destroy();
    this.peer = null;
    this.conn = null;
  }

  reset = () => {
    this.stop();
    this.stage = 'idle';
    this.role = null;
    this.code = '';
    this.summary = null;
    const url = new URL(window.location.href);
    if (url.searchParams.has(CODE_PARAM)) {
      url.searchParams.delete(CODE_PARAM);
      window.history.replaceState(window.history.state, '', url.toString());
    }
  };

  renderQr = modifier((element, [url]) => {
    if (!url) return;
    let cancelled = false;
    import('qr-code-styling').then(({ default: QRCodeStyling }) => {
      if (cancelled) return;
      this.qr ??= new QRCodeStyling({ type: 'svg', width: 150, height: 150, margin: 6, dotsOptions: { type: 'rounded' } });
      element.replaceChildren();
      this.qr.update({ data: url });
      this.qr.append(element);
    });
    return () => (cancelled = true);
  });

  <template>
    <div class="data-transfer">
      <p class="fs-warning" role="note"><Icon @name="triangle-alert" @size={{15}} /> <span><strong>Only transfer between your own devices, or people you trust.</strong> The devices connect directly, so each can see the other’s IP address, and whoever opens the code first can receive your notes and settings.</span></p>

      {{#if (eq this.role "send")}}
        {{#if (eq this.stage "waiting")}}
          <div class="transfer-share">
            <div class="transfer-share-info">
              <div class="fs-code-block">
                <span class="qr-label is-muted">Transfer code</span>
                <div class="fs-code-row"><span class="fs-code">{{this.code}}</span><CopyButton @value={{this.code}} /></div>
              </div>
              <div class="fs-code-block">
                <span class="qr-label is-muted">Link for the other device</span>
                <div class="fs-code-row"><span class="fs-link">{{this.shareUrl}}</span><CopyButton @value={{this.shareUrl}} /></div>
              </div>
              <p class="fs-status"><Icon @name="radio-tower" @size={{14}} /> Waiting for the other device… Keep this page open.</p>
            </div>
            <div class="fs-qr" {{this.renderQr this.shareUrl}}></div>
          </div>
        {{else if (eq this.stage "offered")}}
          <p class="fs-status is-connected"><Icon @name="users" @size={{14}} /> Connected. Waiting for the other device to accept…</p>
        {{else if (eq this.stage "sending")}}
          <p class="fs-status is-connected"><Icon @name="send" @size={{14}} /> Sending your data…</p>
        {{else if (eq this.stage "sent")}}
          <p class="fs-status is-connected"><Icon @name="circle-check-big" @size={{14}} /> Done. Your data is on the other device now.</p>
        {{else if (eq this.stage "declined")}}
          <p class="tool-hint">The other device declined. Nothing was sent.</p>
        {{/if}}
        <button type="button" class="fs-reset" {{on "click" this.reset}}><Icon @name="x" @size={{13}} /> {{if (isFinished this.stage) "Close" "Cancel"}}</button>
      {{else if (eq this.role "receive")}}
        {{#if (eq this.stage "connecting")}}
          <p class="fs-status"><Icon @name="radio-tower" @size={{14}} /> Connecting to {{this.code}}…</p>
        {{else if (eq this.stage "applying")}}
          <p class="fs-status is-connected"><Icon @name="download" @size={{14}} /> Receiving and saving…</p>
        {{else if (eq this.stage "done")}}
          <p class="fs-status is-connected"><Icon @name="circle-check-big" @size={{14}} /> Data received. Reloading…</p>
        {{else if (eq this.stage "reviewing")}}
          <HoldConfirm @title="Replace this device’s data?" @message="Another device wants to send you its Woogi Tools data. Accepting replaces the notes, favourites, settings, avatars and game profile saved in this browser. This can’t be undone, so export a backup first if you want to keep anything." @confirmLabel="Hold to accept" @cancelLabel="Decline" @holdMs={{1500}} @onConfirm={{this.accept}} @onCancel={{this.decline}}>
            <p class="transfer-summary">{{#if this.summary.name}}<strong>{{this.summary.name}}</strong>: {{/if}}{{this.summaryText}}</p>
          </HoldConfirm>
        {{/if}}
        {{#unless (eq this.stage "done")}}
          <button type="button" class="fs-reset" {{on "click" this.reset}}><Icon @name="x" @size={{13}} /> Cancel</button>
        {{/unless}}
      {{else}}
        <div class="transfer-start">
          <div>
            <span class="qr-label">Send from this device</span>
            <p class="tool-hint">Get a one-time code and link, then open it on the other device.</p>
            <button type="button" class="btn math-use" {{on "click" this.send}}><Icon @name="send" @size={{13}} /> Send my data</button>
          </div>
          <form class="transfer-join" {{on "submit" this.join}}>
            <span class="qr-label">Receive on this device</span>
            <p class="tool-hint">Got a code from your other device? Enter it here.</p>
            <div class="fs-join">
              <input type="text" class="fs-code-input" placeholder="Transfer code" aria-label="Transfer code" maxlength="8" value={{this.joinInput}} {{on "input" this.setJoinInput}} />
              <button type="submit" class="btn">Receive</button>
            </div>
          </form>
        </div>
      {{/if}}
      {{#if this.error}}<p class="tool-error" role="alert">{{this.error}}</p>{{/if}}
    </div>
  </template>
}

function eq(a, b) {
  return a === b;
}

function isFinished(stage) {
  return stage === 'sent' || stage === 'declined';
}
