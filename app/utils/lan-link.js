import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

// Playing without internet: a direct WebRTC link between two devices on the
// same Wi-Fi or phone hotspot, with no server at all. Normally PeerJS's broker
// passes the connection details (an SDP offer and answer) between the two
// browsers; here people pass them instead, as a QR code or a pasted code:
//
//   host  -> invite code -> guest
//   guest -> reply code  -> host      and the data channel opens.
//
// With no STUN server, only the devices' local network addresses are offered,
// which is exactly what a LAN or hotspot needs. The connection is wrapped to
// look like the PeerJS DataConnection that GameRoom already speaks (on, send,
// close, open, peer), so the rest of the room code doesn't care which it is.

const GATHER_TIMEOUT_MS = 4000;
const PREFIX = 'WOOGI1';

function encode(payload) {
  const bytes = deflateSync(strToU8(JSON.stringify(payload)), { level: 9 });
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decode(code) {
  const clean = String(code ?? '').replace(/\s+/g, '');
  if (!clean.startsWith(PREFIX)) throw new Error('That isn’t a Woogi nearby-play code.');
  const base64 = clean.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(strFromU8(inflateSync(bytes)));
}

// Resolves once the browser has found all its local addresses (or gives up waiting).
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState !== 'complete') return;
      pc.removeEventListener('icegatheringstatechange', done);
      resolve();
    };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, GATHER_TIMEOUT_MS);
  });
}

// The DataConnection look-alike.
export class LanConnection {
  listeners = new Map();

  constructor(pc, channel, peer) {
    this.pc = pc;
    this.channel = channel;
    this.peer = peer;
    channel.addEventListener('open', () => this.emit('open'));
    channel.addEventListener('message', (event) => {
      try {
        this.emit('data', JSON.parse(event.data));
      } catch {
        // not ours
      }
    });
    channel.addEventListener('close', () => this.emit('close'));
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(pc.connectionState)) this.emit('close');
    });
  }

  get open() {
    return this.channel.readyState === 'open';
  }

  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
    // Joining late to an already-open channel still hears about it.
    if (event === 'open' && this.open) queueMicrotask(() => listener());
  }

  emit(event, data) {
    for (const listener of this.listeners.get(event) ?? []) listener(data);
    // A closed link only closes once.
    if (event === 'close') this.listeners.delete('close');
  }

  send(message) {
    if (this.open) this.channel.send(JSON.stringify(message));
  }

  close() {
    this.channel.close();
    this.pc.close();
  }
}

const newConnection = () => new RTCPeerConnection({ iceServers: [] });

// Host: a fresh invite for one guest. Hand `code` over, then give `accept` their reply.
export async function createInvite(id) {
  const pc = newConnection();
  const channel = pc.createDataChannel('woogi', { ordered: true });
  const connection = new LanConnection(pc, channel, id);
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  return {
    id,
    connection,
    code: encode({ t: 'offer', id, sdp: pc.localDescription.sdp }),
    async accept(reply) {
      const payload = decode(reply);
      if (payload.t !== 'answer' || payload.id !== id) throw new Error('That reply is for a different invite.');
      await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
    },
  };
}

// Guest: turns the host's invite into a reply code, and a connection that opens once the host accepts it.
export async function answerInvite(invite) {
  const payload = decode(invite);
  if (payload.t !== 'offer') throw new Error('That’s a reply code. Paste the invite from the host instead.');
  const pc = newConnection();
  const channelReady = new Promise((resolve) => pc.addEventListener('datachannel', (event) => resolve(event.channel)));
  await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { id: payload.id, pc, channelReady, code: encode({ t: 'answer', id: payload.id, sdp: pc.localDescription.sdp }) };
}
