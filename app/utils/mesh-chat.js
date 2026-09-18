import { tracked } from '@glimmer/tracking';
import { loadProfile, saveProfile } from './profile';
import { avatarKey } from './avatar';
import { poseKey } from './pose';
import { directOrRelayedPeerOptions } from './ice';
import {
  ChatLog,
  buildView,
  eventId,
  loadEvents,
  saveEvents,
  dropChat,
  hex,
  randomHex,
} from './mesh-log';

// Messages: a chat that nobody hosts.
//
// A group chat here is a shared secret and a log of events (see mesh-log.js),
// and every device that has been invited keeps the whole thing. When you open
// the page, your device registers with PeerJS's public broker under an id
// derived from its own device id, then tries to reach every other device it
// knows is in your chats. Whoever answers swaps events with you until you
// both hold the same log, and anything new that arrives is passed on to the
// other devices you are connected to, so a message finds its way around the
// group even between two people who can never connect to each other directly.
//
// What that buys you: there is no host to wait for. As long as one other
// device in the chat is online at the same time as you, you will get
// everything said while you were away, from whoever happens to be there. If
// nobody is online, you still have every message you had before, and you can
// keep writing; what you write catches up with the others later.
//
// What goes over the wire, and where. The broker only ever sees peer ids and
// the connection details two browsers need to find each other: no names, no
// chat names, no messages. Everything after that is a direct browser-to-
// browser WebRTC connection, and on top of WebRTC's own encryption the
// contents are encrypted again with a key derived from the chat's secret, so
// only people who were given the invite link can read them. The secret lives
// in the fragment of the invite link (the part after the #), which browsers
// never send to a server.
//
// Calls (voice, video and screen sharing) go the same way: direct where the
// two networks allow it, and through the Open Relay Project's free public
// relay where they don't. They deliberately never touch this site's own
// Cloudflare relay, because an hour of group video would cost the site real
// money for something it isn't needed for.
//
// The one thing to know: a member is a device, not a person. Joining from
// your phone as well as your laptop puts two members in the chat with the
// same name, each with its own copy.

const DEVICE_KEY = 'woogi-msg-device';
const CHATS_KEY = 'woogi-msg-chats';
const PEER_PREFIX = 'woogi-msg-';

// How often to have another go at reaching the members who aren't connected.
const DIAL_EVERY_MS = 12000;
// An id the broker says is taken is usually this tab's own previous visit,
// whose socket the broker hasn't dropped yet. It is tried again this many
// times, this far apart, before this tab gives up and becomes a member of
// its own.
const ID_RETRIES = 4;
const ID_RETRY_MS = 2500;
// A connection attempt that hasn't opened by now is treated as "not there".
const DIAL_TIMEOUT_MS = 9000;
// Typing stops showing this long after the last keystroke arrived.
const TYPING_TTL_MS = 5000;
// How many meeting points a chat has. More slots mean more devices findable
// by a newcomer at once; four is plenty, since one answer is all it takes.
const BEACON_SLOTS = 4;
// Events are sent in batches so one slice of a long history can't overrun the
// data channel, and a picture-heavy chat still catches up.
const BATCH = 40;

export const MAX_MESSAGE = 4000;
export const MAX_NAME = 40;
export const MAX_IMAGE_BYTES = 600 * 1024;

const now = () => Date.now();
const emptyView = () => ({
  members: new Map(),
  messages: [],
  topic: '',
  photo: '',
});
const text = (value, limit) => String(value ?? '').slice(0, limit);

// ─── Identity and stored chats ─────────────────────────────────────────

// You are the same person here as in the games: the name, avatar and pose
// from your profile. Only the device id is Messages' own.
function withProfile(id) {
  const profile = loadProfile();
  return {
    id,
    name: text(profile.name, MAX_NAME),
    avatar: profile.avatar,
    pose: profile.pose,
  };
}

// This browser's one identity. A second tab of the same browser can't be the
// same member as the first: they would both write events as that member and
// both number them from one, which is exactly the thing version vectors
// cannot survive. So a tab that finds the identity genuinely in use takes one
// of its own (see `splitIdentity`), but every tab starts by trying the real
// one, so coming back to Messages never makes a second "you".
function loadDevice() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY));
    if (saved?.id) return withProfile(String(saved.id));
  } catch {
    // nothing saved, or storage blocked
  }
  const device = withProfile(randomHex(16));
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ id: device.id }));
  } catch {
    // storage blocked: this identity lasts until the tab closes
  }
  return device;
}

function loadChatList() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHATS_KEY));
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((chat) => chat?.id && chat?.secret)
      .map((chat) => ({
        id: String(chat.id),
        secret: String(chat.secret),
        name: text(chat.name, 60) || 'Chat',
        seenClock: Number(chat.seenClock) || 0,
        via: chat.via ? String(chat.via) : '',
      }));
  } catch {
    return [];
  }
}

function saveChatList(chats) {
  try {
    localStorage.setItem(
      CHATS_KEY,
      JSON.stringify(
        chats.map((chat) => ({
          id: chat.id,
          secret: chat.secret,
          name: chat.name,
          seenClock: chat.seenClock,
          via: chat.via,
        })),
      ),
    );
  } catch {
    // storage blocked
  }
}

// ─── Secrets, ids and keys ─────────────────────────────────────────────

const encoder = new TextEncoder();

async function sha256(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

// Everything about a chat is derived from its one secret, so an invite link
// only has to carry that: the id the devices file it under, the token they
// prove membership with, and the key the contents are encrypted with.
async function chatIdFor(secret) {
  return (await sha256(`${secret}/id`)).slice(0, 24);
}

async function tokenFor(secret) {
  return (await sha256(`${secret}/token`)).slice(0, 32);
}

const keyCache = new Map();

async function keyFor(secret) {
  if (keyCache.has(secret)) return keyCache.get(secret);
  const material = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${secret}/key`),
  );
  const promise = crypto.subtle.importKey('raw', material, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  keyCache.set(secret, promise);
  return promise;
}

async function seal(secret, payload) {
  const key = await keyFor(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return { iv: [...iv], ct: hex(cipher) };
}

async function unseal(secret, envelope) {
  const key = await keyFor(secret);
  const bytes = new Uint8Array(
    envelope.ct.match(/../g).map((pair) => parseInt(pair, 16)),
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(envelope.iv) },
    key,
    bytes,
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

// A piece of a file, encrypted on its own and sent as bytes rather than as
// text: hex would cost twice the size on the wire for no benefit.
async function sealBytes(secret, bytes) {
  const key = await keyFor(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    bytes,
  );
  return { iv: [...iv], ct: new Uint8Array(cipher) };
}

async function unsealBytes(secret, envelope) {
  const key = await keyFor(secret);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(envelope.iv) },
    key,
    envelope.ct instanceof Uint8Array
      ? envelope.ct
      : new Uint8Array(envelope.ct),
  );
  return new Uint8Array(plain);
}

const newSecret = () => randomHex(32);

const peerIds = new Map();

// A device's peer id is a hash of its device id rather than the id itself, so
// what the broker sees can't be read back as anything about the chat.
async function peerIdFor(deviceId) {
  if (!peerIds.has(deviceId))
    peerIds.set(
      deviceId,
      `${PEER_PREFIX}${(await sha256(`peer/${deviceId}`)).slice(0, 24)}`,
    );
  return peerIds.get(deviceId);
}

// Meeting points. Knowing a member's device id is enough to reach them, but
// someone joining from an invite link only knows the one device that wrote the
// link, and that device may never come online again. So each chat also has a
// handful of well-known peer ids derived from its secret, and every device
// tries to claim one of them: the broker only allows an id to be held once, so
// the first device online takes the first slot, the next takes the second, and
// so on. Anyone with the secret can then knock on each slot in turn and reach
// whoever is actually there, without knowing who that is. It is the same trick
// the game lobbies use to list public rooms.
async function beaconIdFor(secret, slot) {
  return `${PEER_PREFIX}${(await sha256(`${secret}/beacon/${slot}`)).slice(0, 24)}`;
}

// ─── Invites ───────────────────────────────────────────────────────────

export function inviteLink(chat, deviceId) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = `chat=${chat.secret}&name=${encodeURIComponent(chat.name)}&via=${deviceId}`;
  return url.toString();
}

export function parseInvite(value) {
  let fragment = String(value ?? '').trim();
  if (!fragment) return null;
  if (fragment.includes('#'))
    fragment = fragment.slice(fragment.indexOf('#') + 1);
  const params = new URLSearchParams(fragment);
  const secret = params.get('chat');
  if (!secret || !/^[0-9a-f]{40,128}$/.test(secret)) return null;
  return {
    secret,
    name: text(params.get('name') || 'Chat', 60),
    via: text(params.get('via') || '', 64),
  };
}

// ─── The tool's state ──────────────────────────────────────────────────

export default class MeshChat {
  @tracked device = loadDevice();
  @tracked chats = [];
  @tracked activeId = '';
  // The active chat, folded out of its log:
  // { members, messages, topic, photo }.
  @tracked view = emptyView();
  // 'starting' | 'online' | 'offline'
  @tracked status = 'starting';
  @tracked error = '';
  // Device ids we hold an open connection to, whatever chat they are in.
  @tracked connected = [];
  // chat id -> [{ id, name, at }] of who is typing right now.
  @tracked typing = [];
  @tracked peerReady = false;

  logs = new Map();
  views = new Map();
  peer = null;
  // The open connections, as { conn, device, chats:Set<chatId>, open, cid }.
  // A set rather than a map keyed by the remote peer id: two connections can
  // have the same remote peer at once (each side dialled the other), and
  // keying by it made one closing remove the other from the list.
  links = new Set();
  dialing = new Set();
  // chat id -> the extra Peer holding that chat's meeting point, and the ids
  // we hold, so we never knock on our own door.
  beacons = new Map();
  beaconIds = new Set();
  claiming = new Set();
  // True once this tab has taken an identity of its own, so it only ever
  // happens once however many times the broker refuses an id.
  split = false;
  idRetries = 0;
  dialTimer = null;
  typingTimer = null;
  typingSeen = new Map(); // `${chat}:${device}` -> time
  // Registered by the call manager, so call signals ride the same connections.
  signalHandlers = new Set();

  constructor({ onChange } = {}) {
    this.onChange = onChange ?? (() => {});
  }

  get selfId() {
    return this.device.id;
  }

  get active() {
    return this.chats.find((chat) => chat.id === this.activeId) ?? null;
  }

  get members() {
    return [...this.view.members.values()]
      .filter((member) => !member.left || member.id === this.selfId)
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  async start() {
    this.chats = loadChatList();
    for (const chat of this.chats) await this.loadChat(chat);
    // A name or avatar changed in Settings since last time reaches the logs
    // the same way any change does.
    for (const chat of this.chats) await this.announce(chat);
    const invite = parseInvite(window.location.hash);
    if (invite) {
      await this.joinInvite(invite);
      // The secret should not sit in the address bar once it is filed away.
      history.replaceState(null, '', window.location.pathname);
    }
    if (!this.activeId && this.chats.length) this.select(this.chats[0].id);
    this.refreshChats();
    await this.openPeer();
    this.dialTimer = setInterval(() => this.dialEveryone(), DIAL_EVERY_MS);
    this.typingTimer = setInterval(() => this.pruneTyping(), 1500);
  }

  destroy() {
    clearInterval(this.dialTimer);
    clearInterval(this.typingTimer);
    clearTimeout(this.retryTimer);
    for (const link of this.links) link.conn.close();
    this.links.clear();
    for (const peer of this.beacons.values()) peer.destroy();
    this.beacons.clear();
    this.beaconIds.clear();
    this.peer?.destroy();
    this.peer = null;
  }

  async loadChat(chat) {
    const log = new ChatLog(chat.id);
    log.add(await loadEvents(chat.id));
    this.logs.set(chat.id, log);
    this.rebuild(chat.id);
  }

  // ─── Peer connections ────────────────────────────────────────────────

  async openPeer() {
    const { default: Peer } = await import('peerjs');
    const id = await peerIdFor(this.selfId);
    const peer = new Peer(id, directOrRelayedPeerOptions());
    this.peer = peer;
    peer.on('open', () => {
      this.status = 'online';
      this.peerReady = true;
      this.error = '';
      this.idRetries = 0;
      this.dialEveryone();
    });
    peer.on('connection', (conn) => this.attach(conn, false));
    peer.on('disconnected', () => {
      // A peer we have already replaced (see splitIdentity) is not ours to
      // reconnect, and its "disconnected" says nothing about where we are now.
      if (this.peer !== peer) return;
      this.status = 'offline';
      // The broker drops idle sockets; without it nobody new can be reached.
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', (error) => this.onPeerError(error));
    // Calls arrive on the same peer; the call manager takes them from here.
    peer.on('call', (incoming) => {
      for (const handler of this.signalHandlers)
        if (handler.onMediaCall) handler.onMediaCall(incoming);
    });
  }

  onPeerError(error) {
    // A member who simply isn't online is the normal case, not a fault.
    if (error?.type === 'peer-unavailable') return;
    if (error?.type === 'unavailable-id') {
      // Most often this is our own last visit, not yet let go of by the
      // broker: wait and try the same id again. Only an id that stays taken
      // means another tab really is holding it.
      if (this.idRetries < ID_RETRIES) {
        this.idRetries += 1;
        this.retryTimer = setTimeout(() => {
          this.peer?.destroy();
          this.peer = null;
          this.openPeer();
        }, ID_RETRY_MS);
        return;
      }
      this.splitIdentity();
      return;
    }
    if (error?.type === 'network' || error?.type === 'server-error') {
      this.status = 'offline';
      return;
    }
    this.error =
      "Couldn't reach the connection service. Your messages are still here.";
  }

  // Take a fresh identity for this tab and open up again under it. The name
  // stays the same, so the chat shows two members with your name: one per tab,
  // each with its own copy, syncing with each other like any other pair.
  async splitIdentity() {
    if (this.split) return;
    this.split = true;
    // The same spare identity as last time this tab had to split, so its
    // events keep their numbering rather than starting a third member.
    let spare = '';
    try {
      spare = String(JSON.parse(sessionStorage.getItem(DEVICE_KEY))?.id ?? '');
    } catch {
      // nothing saved for this tab
    }
    const device = { ...this.device, id: spare || randomHex(16) };
    try {
      sessionStorage.setItem(DEVICE_KEY, JSON.stringify({ id: device.id }));
    } catch {
      // storage blocked: this identity lasts as long as the page does
    }
    this.device = device;
    this.peerReady = false;
    this.peer?.destroy();
    this.peer = null;
    this.links.clear();
    this.dialing.clear();
    await this.openPeer();
  }

  // Everyone in every chat, minus this device and the ones already connected.
  async dialEveryone() {
    if (!this.peer || !this.peerReady) return;
    const wanted = new Map(); // remote peer id -> device id
    for (const chat of this.chats) {
      const view = this.views.get(chat.id);
      const candidates = new Set(
        [...(view?.members.keys() ?? [])].filter(
          (id) => id !== this.selfId && !view.members.get(id)?.left,
        ),
      );
      // The device that sent the invite is worth trying before its first
      // message has arrived, since it is the only member we know of yet.
      if (chat.via && chat.via !== this.selfId) candidates.add(chat.via);
      for (const deviceId of candidates)
        wanted.set(await peerIdFor(deviceId), deviceId);
    }
    for (const [peerId] of wanted) {
      if (this.linkTo(peerId) || this.dialing.has(peerId)) continue;
      this.dial(peerId);
    }
    for (const chat of this.chats) {
      // Hold a meeting point of our own, so someone joining later can find
      // this device without knowing anything about it.
      this.claimBeacon(chat);
      // And knock on the others, but only while this chat has nobody: once a
      // single member answers, their log names everyone else.
      if (!this.onlineInChat(chat.id).length) await this.knockBeacons(chat);
    }
  }

  // Take the first meeting point that isn't already taken. An id the broker
  // refuses is one another device in this chat is holding, which is the answer
  // we wanted: try the next.
  async claimBeacon(chat) {
    if (this.beacons.has(chat.id) || this.claiming.has(chat.id)) return;
    this.claiming.add(chat.id);
    try {
      for (let slot = 0; slot < BEACON_SLOTS; slot++) {
        const id = await beaconIdFor(chat.secret, slot);
        if (this.beaconIds.has(id)) continue;
        if (await this.holdBeacon(chat.id, id)) return;
      }
    } finally {
      this.claiming.delete(chat.id);
    }
  }

  async holdBeacon(chatId, id) {
    const { default: Peer } = await import('peerjs');
    const peer = new Peer(id, directOrRelayedPeerOptions());
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (!ok) peer.destroy();
        resolve(ok);
      };
      peer.on('open', () => {
        this.beacons.set(chatId, peer);
        this.beaconIds.add(id);
        finish(true);
      });
      peer.on('connection', (conn) => this.attach(conn, false));
      // The slot is only useful while it is held; giving it up frees it for
      // the next device, and the dial round will try to claim one again.
      peer.on('close', () => this.releaseBeacon(chatId, id));
      peer.on('disconnected', () => this.releaseBeacon(chatId, id));
      peer.on('error', () => finish(false));
      setTimeout(() => finish(false), DIAL_TIMEOUT_MS);
    });
  }

  releaseBeacon(chatId, id) {
    this.beaconIds.delete(id);
    if (this.beacons.get(chatId)) {
      this.beacons.get(chatId).destroy();
      this.beacons.delete(chatId);
    }
  }

  async knockBeacons(chat) {
    for (let slot = 0; slot < BEACON_SLOTS; slot++) {
      const id = await beaconIdFor(chat.secret, slot);
      // Never knock on our own door.
      if (this.beaconIds.has(id) || this.linkTo(id) || this.dialing.has(id))
        continue;
      this.dial(id);
    }
  }

  linkTo(peerId) {
    for (const link of this.links) if (link.conn.peer === peerId) return link;
    return null;
  }

  dial(peerId) {
    this.dialing.add(peerId);
    const conn = this.peer.connect(peerId, { reliable: true });
    const timer = setTimeout(() => {
      if (!this.linkTo(peerId)) {
        this.dialing.delete(peerId);
        conn.close();
      }
    }, DIAL_TIMEOUT_MS);
    conn.on('open', () => clearTimeout(timer));
    conn.on('close', () => clearTimeout(timer));
    this.attach(conn, true);
  }

  attach(conn, weDialed) {
    // `cid` names this particular connection. The side that dialled makes it
    // up and the other side echoes it back, so when two devices end up with
    // two connections between them (one to the device's own id, one through a
    // meeting point) both of them can agree on which to keep.
    const link = {
      conn,
      device: '',
      chats: new Set(),
      open: false,
      cid: weDialed ? randomHex(8) : '',
    };
    conn.on('open', async () => {
      this.dialing.delete(conn.peer);
      link.open = true;
      this.links.add(link);
      if (weDialed) await this.sayHello(link);
    });
    conn.on('data', (message) => this.onData(link, message));
    conn.on('close', () => this.drop(link));
    conn.on('error', () => this.drop(link));
  }

  drop(link) {
    this.dialing.delete(link.conn.peer);
    const had = this.links.delete(link);
    link.open = false;
    if (had && link.device)
      for (const handler of this.signalHandlers)
        if (handler.onPeerGone) handler.onPeerGone(link.device);
    this.refreshPresence();
  }

  // The greeting proves, for each chat, that this device holds that chat's
  // secret: the token is derived from it and can't be worked out from
  // anything the broker or a stranger can see. A connection that can't prove
  // a single chat in common is closed without being told why.
  async sayHello(link) {
    const tokens = [];
    for (const chat of this.chats)
      tokens.push({ id: chat.id, token: await tokenFor(chat.secret) });
    this.rawSend(link, {
      t: 'hello',
      device: this.selfId,
      tokens,
      cid: link.cid,
    });
  }

  async onData(link, message) {
    if (!message || typeof message !== 'object') return;
    if (message.t === 'hello' || message.t === 'hello-back') {
      await this.onHello(link, message);
      return;
    }
    if (!link.device) return; // nothing is accepted before the greeting
    if (!message.chat || !link.chats.has(message.chat)) return;
    const chat = this.chats.find((c) => c.id === message.chat);
    if (!chat) return;
    // A piece of a file: bytes, not a message, and handed straight on.
    if (message.bin) {
      let bytes;
      try {
        bytes = await unsealBytes(chat.secret, message);
      } catch {
        return;
      }
      for (const handler of this.signalHandlers)
        if (handler.onFilePart)
          handler.onFilePart(chat, link, { tid: message.tid, bytes });
      return;
    }
    let payload;
    try {
      payload = await unseal(chat.secret, message);
    } catch {
      return; // not encrypted with this chat's key, so not from this chat
    }
    await this.onPayload(link, chat, payload);
  }

  async onHello(link, message) {
    const device = text(message.device, 64);
    if (!device || device === this.selfId) {
      link.conn.close();
      return;
    }
    const mine = new Map();
    for (const chat of this.chats) mine.set(await tokenFor(chat.secret), chat);
    const shared = [];
    for (const claim of Array.isArray(message.tokens) ? message.tokens : []) {
      const chat = mine.get(claim?.token);
      if (chat) shared.push(chat);
    }
    if (!shared.length) {
      link.conn.close();
      return;
    }
    if (!link.cid) link.cid = text(message.cid, 32);
    link.device = device;
    link.chats = new Set(shared.map((chat) => chat.id));
    // A member we had only heard about through an invite link is now a real
    // connection, and this is where its chats get a name to go with the id.
    if (message.t === 'hello') await this.sayHello(link);
    // Two connections to the same device would send everything twice, so all
    // but one are dropped. Both sides pick the same one, because both know
    // both connections' cid and both keep the smaller.
    const twins = [...this.links].filter(
      (other) => other.device === device && other.cid,
    );
    if (twins.length > 1) {
      const keep = twins.reduce((a, b) => (a.cid < b.cid ? a : b));
      for (const other of twins) if (other !== keep) other.conn.close();
      if (link !== keep) return;
    }
    for (const chat of shared) {
      await this.sendTo(link, chat, {
        t: 'sync',
        vector: this.logs.get(chat.id).versionVector(),
      });
      // Your own name has to reach a new device somehow, and the log is the
      // only thing that travels, so joining is itself an event in it.
      await this.announce(chat);
    }
    this.refreshPresence();
  }

  async onPayload(link, chat, payload) {
    const log = this.logs.get(chat.id);
    if (!log) return;
    switch (payload.t) {
      case 'sync': {
        const missing = log.missingFor(payload.vector ?? {});
        for (let i = 0; i < missing.length; i += BATCH)
          await this.sendTo(link, chat, {
            t: 'events',
            events: missing.slice(i, i + BATCH),
          });
        break;
      }
      case 'events': {
        const fresh = log.add(
          Array.isArray(payload.events) ? payload.events : [],
        );
        if (!fresh.length) break;
        await saveEvents(fresh);
        this.rebuild(chat.id);
        this.refreshChats();
        // Pass what was new on to everyone else in this chat, which is how a
        // message crosses a pair of devices that can never reach each other.
        await this.gossip(chat, fresh, link);
        break;
      }
      case 'typing': {
        this.typingSeen.set(`${chat.id}:${link.device}`, now());
        this.refreshTyping();
        break;
      }
      case 'call': {
        for (const handler of this.signalHandlers)
          if (handler.onCallSignal)
            handler.onCallSignal(chat.id, link.device, payload);
        break;
      }
      default: {
        // Asking for a file, offering one, or saying a transfer is over.
        if (typeof payload.t === 'string' && payload.t.startsWith('file-'))
          for (const handler of this.signalHandlers)
            if (handler.onFileSignal)
              await handler.onFileSignal(chat, link, payload);
      }
    }
  }

  async gossip(chat, events, except) {
    for (const link of this.links) {
      if (link === except || !link.chats.has(chat.id)) continue;
      for (let i = 0; i < events.length; i += BATCH)
        await this.sendTo(link, chat, {
          t: 'events',
          events: events.slice(i, i + BATCH),
        });
    }
  }

  rawSend(link, message) {
    try {
      if (link.open) link.conn.send(message);
    } catch {
      // the channel closed under us; the next dial round picks it back up
    }
  }

  async sendTo(link, chat, payload) {
    const envelope = await seal(chat.secret, payload);
    this.rawSend(link, { ...envelope, chat: chat.id });
  }

  async sendBytesTo(link, chat, tid, seq, bytes) {
    const envelope = await sealBytes(chat.secret, bytes);
    this.rawSend(link, { ...envelope, chat: chat.id, bin: 1, tid, seq });
  }

  async broadcast(chatId, payload) {
    const chat = this.chats.find((c) => c.id === chatId);
    if (!chat) return;
    for (const link of this.links)
      if (link.chats.has(chatId)) await this.sendTo(link, chat, payload);
  }

  // Who, in the active chat, is online right now.
  refreshPresence() {
    this.connected = [...this.links]
      .filter((link) => link.device && link.chats.has(this.activeId))
      .map((link) => link.device);
    this.announcePeers();
  }

  // Told to whoever is waiting for somebody, so a download that had nobody to
  // ask can have another go the moment a device turns up.
  announcePeers() {
    for (const handler of this.signalHandlers) handler.onPeers?.();
  }

  isOnline(deviceId) {
    return this.connected.includes(deviceId);
  }

  // ─── Writing to the log ──────────────────────────────────────────────

  async commit(chatId, kind, data) {
    const chat = this.chats.find((c) => c.id === chatId);
    const log = this.logs.get(chatId);
    if (!chat || !log) return null;
    const event = {
      chat: chatId,
      author: this.selfId,
      seq: log.nextSeq(this.selfId),
      clock: log.clock + 1,
      at: now(),
      kind,
      data,
    };
    event.id = await eventId(event);
    log.add([event]);
    await saveEvents([event]);
    this.rebuild(chatId);
    // Your own messages are read by definition.
    if (chatId === this.activeId) this.markRead();
    this.refreshChats();
    await this.gossip(chat, [event], null);
    return event;
  }

  // Sent on joining and whenever a new device turns up, so a log that has
  // never heard of this device learns its name. Sending it every time would
  // fill the log with nothing, so it only goes out when something changed.
  async announce(chat) {
    const view = this.views.get(chat.id);
    const known = view?.members.get(this.selfId);
    if (known && !known.left && this.looksLike(known)) return;
    // Coming back after leaving is a fresh join, so the others stop treating
    // this device as gone.
    await this.commit(
      chat.id,
      known && !known.left ? 'name' : 'join',
      this.me(),
    );
  }

  // What the log is told about this device: the name and look everyone sees.
  me() {
    const { name, avatar, pose } = this.device;
    return { name, avatar, pose };
  }

  looksLike(member) {
    return (
      member.name === this.device.name &&
      Boolean(member.avatar) &&
      avatarKey(member.avatar) === avatarKey(this.device.avatar) &&
      poseKey(member.pose) === poseKey(this.device.pose)
    );
  }

  rebuild(chatId) {
    const log = this.logs.get(chatId);
    if (!log) return;
    const view = buildView(log);
    this.views.set(chatId, view);
    if (chatId === this.activeId) this.view = view;
    this.onChange(chatId, view);
  }

  // The sidebar's rows: the chat's name, its last line and what is unread.
  refreshChats() {
    this.chats = this.chats.map((chat) => {
      const view = this.views.get(chat.id);
      const last = view?.messages[view.messages.length - 1] ?? null;
      const unread = (view?.messages ?? []).filter(
        (m) => m.clock > chat.seenClock && m.author !== this.selfId,
      ).length;
      const label = view?.topic || chat.name;
      return {
        ...chat,
        name: label,
        label,
        photo: view?.photo ?? '',
        people: view ? view.members.size : 0,
        last,
        lastText: last
          ? last.unsent
            ? 'Message taken back'
            : last.image && !last.text
              ? 'Sent a picture'
              : last.file && !last.text
                ? `Sent ${last.file.name}`
                : last.text
          : 'No messages yet',
        lastAt: last?.at ?? 0,
        unread,
      };
    });
    saveChatList(this.chats);
  }

  // ─── Things the page does ────────────────────────────────────────────

  select(chatId) {
    this.activeId = chatId;
    this.view = this.views.get(chatId) ?? emptyView();
    this.markRead();
    this.refreshPresence();
    this.refreshTyping();
  }

  markRead() {
    const view = this.views.get(this.activeId);
    const last = view?.messages[view.messages.length - 1];
    if (!last) return;
    this.chats = this.chats.map((chat) =>
      chat.id === this.activeId
        ? { ...chat, seenClock: Math.max(chat.seenClock, last.clock) }
        : chat,
    );
    this.refreshChats();
  }

  async createChat(name) {
    const secret = newSecret();
    const chat = {
      id: await chatIdFor(secret),
      secret,
      name: text(name, 60) || 'New chat',
      seenClock: 0,
      via: '',
    };
    this.chats = [...this.chats, chat];
    await this.loadChat(chat);
    await this.commit(chat.id, 'join', this.me());
    await this.commit(chat.id, 'topic', { name: chat.name });
    this.select(chat.id);
    this.refreshChats();
    return chat;
  }

  async joinInvite(invite) {
    const id = await chatIdFor(invite.secret);
    const existing = this.chats.find((chat) => chat.id === id);
    if (existing) {
      this.select(existing.id);
      // A second invite to a chat we already have is still a fresh lead on
      // someone who is in it, which is worth keeping.
      if (invite.via) {
        this.chats = this.chats.map((chat) =>
          chat.id === id ? { ...chat, via: invite.via } : chat,
        );
        this.refreshChats();
        this.dialEveryone();
      }
      return existing;
    }
    const chat = {
      id,
      secret: invite.secret,
      name: invite.name,
      seenClock: 0,
      via: invite.via,
    };
    this.chats = [...this.chats, chat];
    await this.loadChat(chat);
    await this.commit(chat.id, 'join', this.me());
    this.select(chat.id);
    this.refreshChats();
    this.dialEveryone();
    return chat;
  }

  async joinFromLink(value) {
    const invite = parseInvite(value);
    if (!invite) throw new Error("That doesn't look like an invite link.");
    return this.joinInvite(invite);
  }

  linkFor(chatId) {
    const chat = this.chats.find((c) => c.id === chatId);
    return chat ? inviteLink(chat, this.selfId) : '';
  }

  send(body, image = '', replyTo = '', file = null) {
    const message = text(body, MAX_MESSAGE).trim();
    if (!message && !image && !file) return Promise.resolve(null);
    return this.commit(this.activeId, 'msg', {
      text: message,
      ...(image ? { image } : {}),
      ...(file ? { file } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
  }

  note(chatId, what) {
    return this.commit(chatId, 'msg', { text: '', call: what });
  }

  edit(messageId, body) {
    return this.commit(this.activeId, 'edit', {
      target: messageId,
      text: text(body, MAX_MESSAGE).trim(),
    });
  }

  unsend(messageId) {
    return this.commit(this.activeId, 'unsend', { target: messageId });
  }

  react(messageId, emoji) {
    return this.commit(this.activeId, 'react', {
      target: messageId,
      emoji: text(emoji, 8),
    });
  }

  rename(chatId, name) {
    return this.commit(chatId, 'topic', { name: text(name, 60) });
  }

  // The chat's picture; an empty string takes it off again.
  setPhoto(chatId, photo) {
    return this.commit(chatId, 'topic', { photo: String(photo ?? '') });
  }

  // Your name and look are your game profile's, so changing them here changes
  // them there too, and everyone in every chat finds out the same way they
  // find out anything else.
  async setProfile(patch) {
    saveProfile({ ...loadProfile(), ...patch });
    await this.reloadProfile();
  }

  // Coming back from the Avatar Editor or Settings, or another tab having
  // changed the profile: take whatever is saved now.
  async reloadProfile() {
    const next = withProfile(this.device.id);
    const same =
      next.name === this.device.name &&
      avatarKey(next.avatar) === avatarKey(this.device.avatar) &&
      poseKey(next.pose) === poseKey(this.device.pose);
    if (same) return;
    this.device = next;
    for (const chat of this.chats) await this.announce(chat);
  }

  // Leaving says so in the log, so the others stop trying to reach this
  // device. Forgetting throws this device's copy away as well; the rest of
  // the group keeps theirs, because nobody's copy is the real one.
  async leave(chatId, forget = true) {
    await this.commit(chatId, 'leave', {});
    if (!forget) return;
    this.chats = this.chats.filter((chat) => chat.id !== chatId);
    this.logs.delete(chatId);
    this.views.delete(chatId);
    await dropChat(chatId);
    if (this.activeId === chatId) this.select(this.chats[0]?.id ?? '');
    this.refreshChats();
  }

  // ─── Typing ──────────────────────────────────────────────────────────

  sendTyping() {
    if (!this.activeId) return;
    const last = this.typingSentAt ?? 0;
    // One a second is plenty, and a keystroke shouldn't be a broadcast.
    if (now() - last < 1200) return;
    this.typingSentAt = now();
    this.broadcast(this.activeId, { t: 'typing' });
  }

  refreshTyping() {
    const cutoff = now() - TYPING_TTL_MS;
    const members = this.view.members;
    this.typing = [...this.typingSeen]
      .filter(([key, at]) => at > cutoff && key.startsWith(`${this.activeId}:`))
      .map(([key]) => key.slice(key.indexOf(':') + 1))
      .map((id) => members.get(id)?.name ?? 'Someone');
  }

  pruneTyping() {
    const cutoff = now() - TYPING_TTL_MS;
    let changed = false;
    for (const [key, at] of this.typingSeen)
      if (at <= cutoff) {
        this.typingSeen.delete(key);
        changed = true;
      }
    if (changed || this.typing.length) this.refreshTyping();
  }

  // ─── For the call manager ────────────────────────────────────────────

  addSignalHandler(handler) {
    this.signalHandlers.add(handler);
    return () => this.signalHandlers.delete(handler);
  }

  async peerIdOf(deviceId) {
    return peerIdFor(deviceId);
  }

  onlineInChat(chatId) {
    return [...this.links]
      .filter((link) => link.device && link.chats.has(chatId))
      .map((link) => link.device);
  }
}
