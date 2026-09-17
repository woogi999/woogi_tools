import { tracked } from '@glimmer/tracking';
import { putBlob, getBlob, heldBlobs } from './mesh-log';

// Sending files in Messages.
//
// A small file is carried in the log itself, so it is simply always there, on
// every device, for good. Anything bigger would make the log unusable (every
// device keeps the whole log, forever), so it goes device to device instead:
// the log gets an offer, which is a name, a size and a transfer id, and the
// bytes travel over the same encrypted connection the chat uses, in pieces,
// when somebody actually asks for them.
//
// Who can hand it over: anybody who has a copy, not only whoever sent it. A
// device keeps what it sends, and keeps what it receives up to KEEP_BYTES, so
// after a few people have opened a file there are several devices that can
// serve it. Past that size only the sender's copy is kept, and the file needs
// them (or whoever chose to keep it) online. A download asks everyone who is
// connected who has the file, and takes the first answer.
//
// Pieces are encrypted one by one with the chat's key and sent as raw bytes,
// so a file costs its own size on the wire rather than twice that. The name
// and size live in the log event, which is encrypted like everything else; a
// piece carries the transfer id in the clear inside the (already encrypted)
// data channel, which says nothing about what the file is.

// At or below this, a file rides along inside the log as a data URL.
export const INLINE_BYTES = 128 * 1024;
// The largest file that can be sent. Receiving one assembles it piece by
// piece into a Blob, which browsers back with disk rather than memory.
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
// A received file this size or smaller is kept, so this device can pass it on.
export const KEEP_BYTES = 64 * 1024 * 1024;

const CHUNK = 128 * 1024;
// Stop feeding the channel while this much is still queued.
const BUFFER_LIMIT = 4 * 1024 * 1024;
// How long to wait for somebody to say they have the file.
const OFFER_WAIT_MS = 8000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default class MeshFiles {
  // [{ tid, name, size, done, way: 'in' | 'out', state, error }], newest first.
  @tracked transfers = [];
  // Transfer ids this device can hand over, so a bubble can say so.
  @tracked held = new Set();

  // tid -> { blob } waiting to be sent, kept only as long as the page lives
  // for a file too big to store.
  pending = new Map();
  // tid -> { parts, size, name, type, chat, resolve } while receiving.
  incoming = new Map();
  // tid -> the promise resolver waiting for someone to say they have it.
  asking = new Map();
  // Files somebody asked for while nobody who had them was online, so the
  // download can start itself when one of them appears.
  wanted = new Map();

  constructor(mesh) {
    this.mesh = mesh;
    this.detach = mesh.addSignalHandler({
      onFileSignal: (chat, link, payload) => this.onSignal(chat, link, payload),
      onFilePart: (chat, link, message) => this.onPart(chat, link, message),
      onPeers: () => this.retryWanted(),
    });
    heldBlobs()
      .then((keys) => (this.held = keys))
      .catch(() => {});
  }

  destroy() {
    this.detach?.();
    this.pending.clear();
    this.incoming.clear();
  }

  has(tid) {
    return this.held.has(tid) || this.pending.has(tid);
  }

  transferFor(tid) {
    return this.transfers.find((t) => t.tid === tid) ?? null;
  }

  // ─── Sending ─────────────────────────────────────────────────────────

  // Returns the offer to put in the log, or throws with something worth
  // showing. The bytes themselves stay here until somebody asks.
  async offer(chatId, file) {
    if (file.size > MAX_FILE_BYTES)
      throw new Error(
        `${file.name} is ${formatBytes(file.size)}. Files up to ${formatBytes(MAX_FILE_BYTES)} can be sent.`,
      );
    const tid = crypto.randomUUID().replace(/-/g, '');
    const offer = {
      tid,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
    };
    if (file.size <= INLINE_BYTES) {
      offer.inline = await readAsDataUrl(file);
      return offer;
    }
    // Keep our own copy so this device can still hand the file over after a
    // refresh, not only while this page is open.
    try {
      await putBlob({ tid, chat: chatId, blob: file, ...offer });
      this.held = new Set([...this.held, tid]);
    } catch {
      // storage full or blocked: serve it from memory while the page lives
      this.pending.set(tid, { blob: file });
    }
    return offer;
  }

  async blobFor(tid) {
    const pending = this.pending.get(tid);
    if (pending) return pending.blob;
    const record = await getBlob(tid);
    return record?.blob ?? null;
  }

  // ─── Receiving ───────────────────────────────────────────────────────

  async download(chatId, offer) {
    if (this.transferFor(offer.tid)?.state === 'going') return;
    // Already here: hand it straight over.
    const mine = await this.blobFor(offer.tid);
    if (mine) {
      save(mine, offer.name);
      return;
    }
    this.track({
      tid: offer.tid,
      name: offer.name,
      size: offer.size,
      done: 0,
      way: 'in',
      state: 'asking',
      error: '',
    });
    const holder = await this.findHolder(chatId, offer.tid);
    if (!holder) {
      this.wanted.set(offer.tid, { chatId, offer });
      this.update(offer.tid, {
        state: 'failed',
        error:
          'Nobody who has this file is online. It will start on its own as soon as one of them is.',
      });
      return;
    }
    this.wanted.delete(offer.tid);
    this.incoming.set(offer.tid, {
      parts: [],
      got: 0,
      chat: chatId,
      name: offer.name,
      type: offer.type,
      size: offer.size,
    });
    this.update(offer.tid, { state: 'going' });
    this.mesh.sendTo(holder, chatFor(this.mesh, chatId), {
      t: 'file-get',
      tid: offer.tid,
    });
  }

  // Someone new is connected: have another go at anything that had nobody to
  // ask. A download already running or asking is left alone.
  retryWanted() {
    for (const [tid, want] of this.wanted) {
      const state = this.transferFor(tid)?.state;
      if (state === 'going' || state === 'asking') continue;
      if (!this.mesh.onlineInChat(want.chatId).length) continue;
      this.download(want.chatId, want.offer);
    }
  }

  // Ask everyone connected, and take the first device that says yes.
  findHolder(chatId, tid) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.asking.delete(tid);
        resolve(null);
      }, OFFER_WAIT_MS);
      this.asking.set(tid, (link) => {
        clearTimeout(timer);
        this.asking.delete(tid);
        resolve(link);
      });
      this.mesh.broadcast(chatId, { t: 'file-who', tid });
    });
  }

  // ─── The wire ────────────────────────────────────────────────────────

  async onSignal(chat, link, payload) {
    switch (payload.t) {
      case 'file-who': {
        if (this.has(payload.tid))
          this.mesh.sendTo(link, chat, { t: 'file-yes', tid: payload.tid });
        break;
      }
      case 'file-yes': {
        this.asking.get(payload.tid)?.(link);
        break;
      }
      case 'file-get': {
        await this.serve(chat, link, payload.tid);
        break;
      }
      case 'file-end': {
        await this.finish(payload.tid);
        break;
      }
      case 'file-none': {
        this.incoming.delete(payload.tid);
        this.update(payload.tid, {
          state: 'failed',
          error: 'The device that had this file no longer has it.',
        });
        break;
      }
    }
  }

  async serve(chat, link, tid) {
    const blob = await this.blobFor(tid);
    if (!blob) {
      this.mesh.sendTo(link, chat, { t: 'file-none', tid });
      return;
    }
    const total = Math.ceil(blob.size / CHUNK) || 1;
    this.track({
      tid,
      name: (await getBlob(tid))?.name ?? 'file',
      size: blob.size,
      done: 0,
      way: 'out',
      state: 'going',
      error: '',
    });
    for (let index = 0; index < total; index++) {
      if (!link.open) {
        this.update(tid, { state: 'failed', error: 'They went offline.' });
        return;
      }
      // Never get so far ahead that the channel is holding the whole file.
      while (link.conn.dataChannel?.bufferedAmount > BUFFER_LIMIT)
        await sleep(60);
      const slice = blob.slice(index * CHUNK, (index + 1) * CHUNK);
      const bytes = new Uint8Array(await slice.arrayBuffer());
      await this.mesh.sendBytesTo(link, chat, tid, index, bytes);
      this.update(tid, { done: Math.min(blob.size, (index + 1) * CHUNK) });
    }
    this.mesh.sendTo(link, chat, { t: 'file-end', tid });
    this.update(tid, { state: 'done', done: blob.size });
  }

  onPart(chat, link, { tid, bytes }) {
    const job = this.incoming.get(tid);
    if (!job || job.chat !== chat.id) return;
    // A Blob per piece rather than an array of buffers: the browser is free
    // to put it on disk, so receiving a 400 MB file doesn't need 400 MB of
    // memory.
    job.parts.push(new Blob([bytes]));
    job.got += bytes.byteLength;
    this.update(tid, { done: job.got });
  }

  async finish(tid) {
    const job = this.incoming.get(tid);
    if (!job) return;
    this.incoming.delete(tid);
    const blob = new Blob(job.parts, { type: job.type });
    save(blob, job.name);
    this.update(tid, { state: 'done', done: blob.size });
    // Keep a copy of anything reasonably sized, so this device can pass the
    // file on to the next person who asks and the sender stops being needed.
    if (blob.size <= KEEP_BYTES) {
      try {
        await putBlob({
          tid,
          chat: job.chat,
          blob,
          name: job.name,
          size: blob.size,
          type: job.type,
        });
        this.held = new Set([...this.held, tid]);
      } catch {
        // no room; the file is still saved where the person can see it
      }
    }
  }

  // ─── Progress ────────────────────────────────────────────────────────

  track(transfer) {
    this.transfers = [
      transfer,
      ...this.transfers.filter((t) => t.tid !== transfer.tid),
    ].slice(0, 12);
  }

  update(tid, patch) {
    this.transfers = this.transfers.map((t) =>
      t.tid === tid ? { ...t, ...patch } : t,
    );
  }

  clearFinished = () => {
    this.transfers = this.transfers.filter((t) => t.state === 'going');
  };
}

const chatFor = (mesh, chatId) => mesh.chats.find((c) => c.id === chatId);

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name || 'file';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
