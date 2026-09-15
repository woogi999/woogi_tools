import { tracked } from '@glimmer/tracking';
import { generateRoomCode, buildShareUrl } from './file-share';
import { playerAvatar } from './avatar';
import { loadProfile, saveProfile } from './profile';
import { censor } from './censor';
import { createInvite, answerInvite, LanConnection } from './lan-link';
import { peerOptions } from './ice';
import { sfx } from './sound';
import { normalisePose } from './pose';

// Peer ids are namespaced per game, so a Chess code can't collide with a Snake
// code (or a File Share code) that happens to be the same six characters.
const peerId = (game, code) => `woogi-${game}-${code}`;
// Public rooms also take one of a handful of well-known "listing" ids, so
// anyone can find them by trying each id in turn. No server keeps a list.
const LISTING_SLOTS = 12;
const listingId = (game, slot) => `woogi-${game}-lobby-${slot}`;
const BROWSE_MS = 4500;
const SLOW_CONNECT_MS = 12000;
const CHAT_HISTORY = 60;
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5000;
export const HOST_ID = 'host';
const LOCAL_ID = 'you';

// A game lobby that friends can join over PeerJS. The host registers with the
// PeerJS broker under the room code and every guest connects straight to the
// host (a star), so messages between guests go through the host.
//
// The host is always the authority: it owns the lobby (who's in, the rules)
// and the real game state, and guests only send their profile and their moves.
// Before a room is opened the lobby is purely local, which is how games
// against the computer work without any network at all.
//
// Rooms can be public (listed for anyone browsing) or private (code only),
// and either can have a password. With no internet at all, a room can run
// over a direct nearby link instead (utils/lan-link.js): same messages, no broker.
//
// Wire format: { t: 'hello' | 'profile' | 'lobby' | 'reject' | 'kick' | 'game', ... }.
// Pages only ever see the payload of 'game' messages.
export default class GameRoom {
  // 'idle' (local lobby) | 'opening' | 'open' (hosting) | 'joining' | 'joined'
  @tracked status = 'idle';
  @tracked code = '';
  @tracked error = '';
  @tracked slow = false;
  @tracked profile = loadProfile();
  @tracked settings;
  // Hosting: the guests, in join order. Joined: everyone, as the host sent it.
  @tracked guests = [];
  @tracked roster = [];
  // Set by the host while a game runs, so no one joins halfway through.
  @tracked locked = false;
  @tracked selfPeerId = null;
  // [{ id, from, name, text, system, bot }], oldest first. Works offline too, with the computer players.
  @tracked chat = [];
  // Host settings for who can find and join the room.
  @tracked listed = true;
  @tracked password = '';
  // Hosting: whether the room is listed right now. Joining: a code that turned out to need a password.
  @tracked listing = false;
  @tracked needsPassword = '';
  // True when the room runs over nearby links rather than the internet.
  @tracked lan = false;
  @tracked lanInvites = [];
  // Rule sets saved by name for this game: [{ id, name, settings }].
  @tracked presets = [];
  // Guests who've pressed Ready (the host keeps the real list and sends it out): { [id]: true }.
  // The host is always ready (they press Start), and so are computer players.
  @tracked readyIds = {};
  // When the host last called a ready check (this device's clock), so guests can be nudged.
  @tracked readyCheckAt = 0;

  chatSeq = 0;
  chatTimes = new Map(); // guest id -> recent message times, for the rate limit
  peer = null;
  listingPeer = null;
  conns = new Map(); // host: guest id -> connection
  hostConn = null; // guest: the connection to the host
  slowTimer = null;

  constructor(game, { maxPlayers = 2, settings = {}, onMessage, onGuestLeft, onClosed } = {}) {
    this.game = game;
    this.maxPlayers = maxPlayers;
    this.factory = settings;
    // The rules you last played with come back next time.
    const restored = { ...settings, ...pickKnown(settings, readJson(settingsKey(game))) };
    this.settings = restored;
    // A guest who leaves gets their own rules back, not the last host's.
    this.defaults = restored;
    this.presets = readPresets(game);
    this.onMessage = onMessage;
    this.onGuestLeft = onGuestLeft;
    this.onClosed = onClosed;
  }

  // ─── Who's here ──────────────────────────────────────────────────────

  get role() {
    return this.status === 'joining' || this.status === 'joined' ? 'guest' : 'host';
  }

  get isHost() {
    return this.role === 'host';
  }

  get isOnline() {
    return this.status === 'open' || this.status === 'joined';
  }

  get isBusy() {
    return this.status === 'opening' || this.status === 'joining';
  }

  get selfId() {
    if (this.role === 'guest') return this.selfPeerId;
    return this.status === 'open' ? HOST_ID : LOCAL_ID;
  }

  get shareUrl() {
    return this.code ? buildShareUrl(this.code) : '';
  }

  // Everyone in the lobby, host first: [{ id, name, avatar, isHost, isYou }].
  get members() {
    const ready = (id, isHost) => isHost || Boolean(this.readyIds[id]);
    if (this.role === 'guest') return this.roster.map((m) => ({ ...m, isYou: m.id === this.selfPeerId, ready: ready(m.id, m.isHost) }));
    const me = { id: this.selfId, ...this.profile, isHost: true, isYou: true, ready: true };
    return [me, ...this.guests.map((g) => ({ ...g, isHost: false, isYou: false, ready: ready(g.id, false) }))];
  }

  // ─── Ready ───────────────────────────────────────────────────────────

  // Every guest has pressed Ready (always true with no guests).
  get allReady() {
    return this.members.every((m) => m.ready);
  }

  get readyCount() {
    return this.members.filter((m) => m.ready).length;
  }

  get iAmReady() {
    return this.members.find((m) => m.isYou)?.ready ?? true;
  }

  // Guest: ready or not.
  setReady(ready) {
    if (this.role !== 'guest' || this.status !== 'joined') return;
    // Shown straight away; the host's next lobby message confirms it.
    this.readyIds = { ...this.readyIds, [this.selfPeerId]: Boolean(ready) };
    this.post(this.hostConn, { t: 'ready', ready: Boolean(ready) });
    sfx(ready ? 'ui.confirm' : 'ui.toggle');
  }

  // Host: clears everyone's Ready and asks them all to press it again.
  callReadyCheck() {
    if (this.status !== 'open') return;
    this.readyIds = {};
    this.readyCheckAt = Date.now();
    this.broadcastLobby();
    for (const conn of this.conns.values()) this.post(conn, { t: 'ready-check' });
  }

  // Host: everyone has to press Ready again (after a game starts, so a rematch needs everyone's say-so).
  resetReady() {
    if (!this.isHost) return;
    this.readyIds = {};
    this.readyCheckAt = 0;
    this.broadcastLobby();
  }

  // ─── Lobby state ─────────────────────────────────────────────────────

  // Picks up changes made elsewhere (Settings or the Avatar Editor) since this room was made.
  reloadProfile() {
    const fresh = loadProfile();
    if (JSON.stringify(fresh) === JSON.stringify(this.profile)) return;
    this.setProfile(fresh);
  }

  setProfile(patch) {
    this.profile = saveProfile({ ...this.profile, ...patch });
    if (this.role === 'guest') this.post(this.hostConn, { t: 'profile', profile: this.wireProfile() });
    else this.broadcastLobby();
  }

  setSettings(patch) {
    if (!this.isHost) return;
    const changed = Object.keys(patch).some((key) => JSON.stringify(this.settings[key]) !== JSON.stringify(patch[key]));
    this.settings = { ...this.settings, ...patch };
    this.defaults = this.settings;
    writeJson(settingsKey(this.game), withoutSeed(this.settings));
    // New rules: everyone has to agree to them again.
    if (changed && Object.keys(this.readyIds).length) {
      this.readyIds = {};
      if (this.status === 'open') this.postChat({ system: true, text: 'The rules changed, so everyone needs to press Ready again.' });
    }
    this.broadcastLobby();
  }

  // ─── Saved rule sets ─────────────────────────────────────────────────

  savePreset(name) {
    const label = String(name ?? '').trim().slice(0, 32) || `Rules ${this.presets.length + 1}`;
    const preset = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: label, settings: withoutSeed(this.settings) };
    this.presets = [...this.presets.filter((p) => p.name !== label), preset].slice(-MAX_PRESETS);
    writeJson(presetsKey(this.game), this.presets);
    return preset;
  }

  applyPreset(id) {
    const preset = this.presets.find((p) => p.id === id);
    if (preset) this.setSettings(pickKnown(this.factory, preset.settings));
  }

  deletePreset(id) {
    this.presets = this.presets.filter((p) => p.id !== id);
    writeJson(presetsKey(this.game), this.presets);
  }

  // Back to the page's own rules (keeping who the computer players are).
  resetSettings() {
    this.setSettings(withoutSeed(this.factory));
  }

  setLocked(locked) {
    if (!this.isHost) return;
    this.locked = locked;
    this.broadcastLobby();
  }

  wireProfile() {
    return { name: this.profile.name.trim() || 'Player', avatar: this.profile.avatar, pose: this.profile.pose };
  }

  broadcastLobby() {
    if (this.status !== 'open') return;
    const members = this.members.map(({ id, name, avatar, pose, isHost }) => ({ id, name: id === HOST_ID ? this.wireProfile().name : name, avatar, pose, isHost }));
    for (const conn of this.conns.values()) this.post(conn, { t: 'lobby', members, settings: this.settings, locked: this.locked, ready: this.readyIds });
  }

  // ─── Hosting ─────────────────────────────────────────────────────────

  async host() {
    if (this.peer || this.status !== 'idle') return;
    this.error = '';
    this.status = 'opening';
    this.code = generateRoomCode();
    const peer = await this.createPeer(peerId(this.game, this.code));
    if (!peer) return;
    peer.on('open', () => {
      this.settle();
      this.status = 'open';
      if (this.listed) this.list();
    });
    peer.on('connection', (conn) => this.admit(conn));
  }

  // Public or private, and the password; changes apply to whoever joins next.
  setAccess({ listed = this.listed, password = this.password } = {}) {
    this.listed = Boolean(listed);
    this.password = String(password ?? '').slice(0, 32);
    if (this.status !== 'open' || this.lan) return;
    if (this.listed && !this.listing) this.list();
    else if (!this.listed) this.unlist();
  }

  // Takes the first free listing slot, and answers anyone browsing with a short description of the room.
  async list(slot = 0) {
    if (slot >= LISTING_SLOTS || this.status !== 'open' || !this.listed) return;
    const [{ default: Peer }, options] = await Promise.all([import('peerjs'), peerOptions().catch(() => null)]);
    if (!options || this.status !== 'open' || !this.listed || this.listingPeer) return;
    const listing = new Peer(listingId(this.game, slot), options);
    this.listingPeer = listing;
    listing.on('open', () => (this.listing = true));
    listing.on('error', (error) => {
      if (this.listingPeer !== listing) return;
      listing.destroy();
      this.listingPeer = null;
      this.listing = false;
      if (error?.type === 'unavailable-id') this.list(slot + 1);
    });
    listing.on('connection', (conn) => {
      conn.on('open', () => {
        conn.send({ t: 'info', room: this.listingInfo() });
        setTimeout(() => conn.close(), 400);
      });
    });
  }

  unlist() {
    this.listingPeer?.destroy();
    this.listingPeer = null;
    this.listing = false;
  }

  listingInfo() {
    return { code: this.code, host: this.wireProfile().name, players: this.members.length, max: this.maxPlayers, locked: this.locked, password: Boolean(this.password) };
  }

  // Everyone's public rooms for a game, found by knocking on each listing slot.
  static async browse(game) {
    const [{ default: Peer }, options] = await Promise.all([import('peerjs'), peerOptions().catch(() => null)]);
    // Without a relay, knocking on listed rooms would show them your address; find nothing instead.
    if (!options) return [];
    return new Promise((resolve) => {
      const rooms = new Map();
      const peer = new Peer(options);
      const finish = () => {
        peer.destroy();
        resolve([...rooms.values()].sort((a, b) => Number(a.locked) - Number(b.locked) || b.players - a.players));
      };
      const timer = setTimeout(finish, BROWSE_MS);
      // Missing slots just raise 'peer-unavailable' errors, which are expected here.
      peer.on('error', (error) => {
        if (error?.type !== 'peer-unavailable') {
          clearTimeout(timer);
          finish();
        }
      });
      peer.on('open', () => {
        for (let slot = 0; slot < LISTING_SLOTS; slot++) {
          const conn = peer.connect(listingId(game, slot), { reliable: true, serialization: 'json' });
          conn.on('data', (message) => {
            const room = message?.room;
            if (message?.t !== 'info' || typeof room?.code !== 'string') return;
            rooms.set(room.code, { code: room.code.slice(0, 8).toUpperCase(), host: String(room.host ?? 'Someone').slice(0, 20), players: Number(room.players) || 1, max: Number(room.max) || 2, locked: Boolean(room.locked), password: Boolean(room.password) });
          });
        }
      });
    });
  }

  // ─── Nearby play (no internet) ───────────────────────────────────────

  hostNearby() {
    if (this.peer || this.status !== 'idle') return;
    this.error = '';
    this.lan = true;
    this.code = 'NEARBY';
    this.status = 'open';
  }

  // Host: an invite code for one more nearby player. Works while hosting online, too.
  async inviteNearby() {
    if (this.status !== 'open') return null;
    const invite = await createInvite(`lan-${generateRoomCode(8)}`);
    this.admit(invite.connection);
    this.lanInvites = [...this.lanInvites, invite];
    invite.connection.on('open', () => (this.lanInvites = this.lanInvites.filter((i) => i !== invite)));
    return invite;
  }

  async acceptNearbyReply(invite, reply) {
    await invite.accept(reply);
  }

  cancelInvite(invite) {
    if (!invite.connection.open) invite.connection.close();
    this.lanInvites = this.lanInvites.filter((i) => i !== invite);
  }

  // Guest: turns the host's invite into the reply code to show them.
  async joinNearby(inviteCode) {
    if (this.peer || this.status !== 'idle') return null;
    this.error = '';
    const answer = await answerInvite(inviteCode);
    this.lan = true;
    this.code = 'NEARBY';
    this.status = 'joining';
    this.selfPeerId = answer.id;
    this.lanPc = answer.pc;
    answer.channelReady.then((channel) => {
      if (this.lanPc !== answer.pc) return;
      const conn = new LanConnection(answer.pc, channel, HOST_ID);
      this.hostConn = conn;
      conn.on('open', () => this.post(conn, { t: 'hello', profile: this.wireProfile() }));
      conn.on('data', (message) => this.fromHost(message));
      conn.on('close', () => (this.status === 'joining' ? this.close('The nearby connection didn’t go through.') : this.hostLost()));
    });
    return answer.code;
  }

  admit(conn) {
    conn.on('data', (message) => {
      if (message?.t === 'hello') {
        const full = this.guests.length + 1 >= this.maxPlayers;
        const wrongPassword = this.password && message.password !== this.password;
        if (full || this.locked || wrongPassword) {
          const reason = wrongPassword ? (message.password ? 'Wrong password.' : 'This room has a password.') : this.locked ? 'That game has already started. Ask the host to go back to the lobby.' : 'That room is full.';
          this.post(conn, { t: 'reject', reason, password: Boolean(wrongPassword) });
          setTimeout(() => conn.close(), 300);
          return;
        }
        this.conns.set(conn.peer, conn);
        const guest = { id: conn.peer, ...cleanProfile(message.profile) };
        this.guests = [...this.guests.filter((g) => g.id !== conn.peer), guest];
        this.broadcastLobby();
        // A newcomer sees the recent conversation, then everyone sees them arrive.
        this.post(conn, { t: 'chat-history', messages: this.chat });
        this.postChat({ system: true, text: `${guest.name} joined.` });
      } else if (!this.conns.has(conn.peer)) {
        return;
      } else if (message?.t === 'profile') {
        this.guests = this.guests.map((g) => (g.id === conn.peer ? { id: g.id, ...cleanProfile(message.profile) } : g));
        this.broadcastLobby();
      } else if (message?.t === 'ready') {
        const guest = this.guests.find((g) => g.id === conn.peer);
        if (!guest || Boolean(this.readyIds[conn.peer]) === Boolean(message.ready)) return;
        const next = { ...this.readyIds };
        if (message.ready) next[conn.peer] = true;
        else delete next[conn.peer];
        this.readyIds = next;
        this.broadcastLobby();
        if (message.ready) sfx('ui.select');
      } else if (message?.t === 'chat') {
        const guest = this.guests.find((g) => g.id === conn.peer);
        if (guest && this.allowChat(conn.peer)) this.postChat({ from: conn.peer, name: guest.name, text: message.text });
      } else if (message?.t === 'game') {
        this.onMessage?.(message.data, conn.peer);
      }
    });
    const drop = () => this.dropGuest(conn.peer);
    conn.on('close', drop);
    conn.on('error', drop);
  }

  dropGuest(id) {
    if (!this.conns.has(id)) return;
    this.conns.get(id).close();
    this.conns.delete(id);
    const guest = this.guests.find((g) => g.id === id);
    this.guests = this.guests.filter((g) => g.id !== id);
    if (this.readyIds[id]) {
      const next = { ...this.readyIds };
      delete next[id];
      this.readyIds = next;
    }
    this.broadcastLobby();
    if (guest) this.postChat({ system: true, text: `${guest.name} left.` });
    this.onGuestLeft?.(id);
  }

  kick(id) {
    const conn = this.conns.get(id);
    if (!conn) return;
    this.post(conn, { t: 'kick' });
    setTimeout(() => this.dropGuest(id), 150);
  }

  // ─── Joining ─────────────────────────────────────────────────────────

  async join(code, password = '') {
    const clean = code.trim().toUpperCase();
    if (this.peer || !clean) return;
    this.error = '';
    this.needsPassword = '';
    this.status = 'joining';
    this.code = clean;
    const peer = await this.createPeer();
    if (!peer) return;
    peer.on('open', (id) => {
      this.selfPeerId = id;
      const conn = peer.connect(peerId(this.game, clean), { reliable: true, serialization: 'json' });
      this.hostConn = conn;
      conn.on('open', () => this.post(conn, { t: 'hello', profile: this.wireProfile(), password }));
      conn.on('data', (message) => this.fromHost(message));
      conn.on('close', () => this.hostLost());
      conn.on('error', () => this.hostLost());
    });
  }

  fromHost(message) {
    if (message?.t === 'lobby') {
      if (this.status === 'joining') this.settle();
      this.status = 'joined';
      this.roster = Array.isArray(message.members) ? message.members.map((m) => ({ ...m, ...cleanProfile(m) })) : [];
      this.settings = message.settings;
      this.locked = message.locked;
      this.readyIds = message.ready && typeof message.ready === 'object' ? Object.fromEntries(Object.keys(message.ready).map((id) => [id, true])) : {};
    } else if (message?.t === 'ready-check') {
      this.readyCheckAt = Date.now();
      sfx('uno.myturn');
    } else if (message?.t === 'reject') {
      const code = this.code;
      this.close(message.reason);
      if (message.password) this.needsPassword = code;
    } else if (message?.t === 'kick') {
      this.close('The host removed you from the room.');
    } else if (message?.t === 'chat-history') {
      this.chat = (message.messages ?? []).slice(-CHAT_HISTORY).map(cleanChat);
    } else if (message?.t === 'chat-msg') {
      this.addChat(cleanChat(message.message));
    } else if (message?.t === 'game') {
      this.onMessage?.(message.data, HOST_ID);
    }
  }

  hostLost() {
    if (this.status !== 'joined') return;
    this.close('The host closed the room.');
    this.onClosed?.();
  }

  // ─── Chat ────────────────────────────────────────────────────────────

  // Guests send their text to the host; the host filters it, stamps who said
  // it and passes it to everyone. Every copy is filtered again on arrival, so a
  // modified client can't slip anything past the other players.
  sendChat(text) {
    const clean = censor(text);
    if (!clean || this.isBusy) return;
    if (this.role === 'guest') this.post(this.hostConn, { t: 'chat', text: clean });
    else this.postChat({ from: HOST_ID, name: this.wireProfile().name, text: clean });
  }

  // A computer player talking. Only the host runs the computer players, so only the host says their lines.
  botChat(name, text) {
    if (this.isHost) this.postChat({ from: `bot:${name}`, name, text, bot: true });
  }

  postChat({ from = null, name = '', text, system = false, bot = false }) {
    const message = cleanChat({ id: `${Date.now().toString(36)}-${++this.chatSeq}`, from, name, text, system, bot });
    if (!message.text) return;
    this.addChat(message);
    for (const conn of this.conns.values()) this.post(conn, { t: 'chat-msg', message });
  }

  addChat(message) {
    this.chat = [...this.chat.slice(-(CHAT_HISTORY - 1)), message];
    if (message.system) sfx(/ left\.$/.test(message.text) ? 'ui.leave' : 'ui.join');
    else if (!message.bot && message.from !== this.selfId) sfx('ui.chat');
  }

  // At most CHAT_BURST messages per guest in any CHAT_WINDOW_MS.
  allowChat(id) {
    const now = Date.now();
    const recent = (this.chatTimes.get(id) ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_BURST) return false;
    this.chatTimes.set(id, [...recent, now]);
    return true;
  }

  // ─── Messages ────────────────────────────────────────────────────────

  // Host: to every guest. Guest: to the host.
  send(data) {
    if (this.role === 'guest') this.post(this.hostConn, { t: 'game', data });
    else for (const conn of this.conns.values()) this.post(conn, { t: 'game', data });
  }

  sendTo(id, data) {
    this.post(this.conns.get(id), { t: 'game', data });
  }

  post(conn, message) {
    if (conn?.open) conn.send(message);
  }

  // ─── Plumbing ────────────────────────────────────────────────────────

  async createPeer(id) {
    this.slowTimer = setTimeout(() => (this.slow = true), SLOW_CONNECT_MS);
    try {
      // Only loaded once someone actually plays online.
      const [{ default: Peer }, options] = await Promise.all([import('peerjs'), peerOptions()]);
      if (!this.isBusy) return null; // cancelled while loading
      // Relayed through TURN (utils/ice.js), so no one in the room sees anyone else's IP address.
      const peer = id ? new Peer(id, options) : new Peer(options);
      this.peer = peer;
      peer.on('error', (error) => this.fail(error));
      return peer;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  settle() {
    clearTimeout(this.slowTimer);
    this.slow = false;
  }

  fail(error) {
    // Once a room is up, broker hiccups don't matter: real losses arrive as a closed connection.
    if (this.isOnline) return;
    if (error?.type === 'private-connection') this.close(error.message);
    else if (error?.type === 'unavailable-id') this.close('That room code just got taken. Try again.');
    else if (error?.type === 'peer-unavailable') this.close('No room found with that code. Check it and try again.');
    else this.close("Couldn't reach the connection service. Check your connection and try again.");
  }

  // Back to a local lobby. Guests keep nothing; a host keeps its rules.
  close(error = '') {
    const wasGuest = this.role === 'guest';
    const links = [this.hostConn, ...this.lanInvites.map((i) => i.connection), ...this.conns.values()].filter((c) => c instanceof LanConnection);
    this.settle();
    this.unlist();
    this.peer?.destroy();
    this.peer = null;
    this.conns.clear();
    this.hostConn = null;
    this.lanInvites = [];
    // A guest still waiting for the host to accept their reply has no connection yet, just the peer link.
    if (!links.length) this.lanPc?.close();
    this.lanPc = null;
    this.lan = false;
    this.guests = [];
    this.roster = [];
    this.chat = [];
    this.chatTimes.clear();
    this.locked = false;
    this.readyIds = {};
    this.readyCheckAt = 0;
    this.status = 'idle';
    this.code = '';
    this.selfPeerId = null;
    this.error = error;
    if (wasGuest) this.settings = { ...this.defaults };
    // Nearby links close last, once nothing is listening for them any more.
    for (const link of links) link.close();
  }
}

const MAX_PRESETS = 12;
const settingsKey = (game) => `woogi-lobby-${game}`;
const presetsKey = (game) => `woogi-lobby-presets-${game}`;

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: remembered until the tab closes
  }
}

// Computer player names are picked fresh each visit, so they aren't saved.
function withoutSeed(settings) {
  const rest = { ...settings };
  delete rest.botSeed;
  return rest;
}

// Only keys the page knows about, with the same kind of value, from something saved (or edited by hand).
function pickKnown(defaults, saved) {
  if (!saved || typeof saved !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(saved)) {
    if (key === 'botSeed' || !(key in defaults)) continue;
    const expected = defaults[key];
    if (expected !== null && typeof expected === 'object') {
      if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = { ...expected, ...pickKnown(expected, value) };
    } else if (typeof value === typeof expected) {
      out[key] = value;
    }
  }
  return out;
}

function readPresets(game) {
  const list = readJson(presetsKey(game));
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p.id === 'string' && p.settings && typeof p.settings === 'object')
    .slice(-MAX_PRESETS)
    .map((p) => ({ id: p.id, name: String(p.name ?? 'Rules').slice(0, 32), settings: p.settings }));
}

function cleanChat(message) {
  return {
    id: String(message?.id ?? Math.random()),
    from: message?.from ?? null,
    name: String(message?.name ?? '').slice(0, 20),
    text: censor(message?.text),
    system: Boolean(message?.system),
    bot: Boolean(message?.bot),
  };
}

function cleanProfile(profile) {
  return { name: String(profile?.name ?? 'Player').slice(0, 20) || 'Player', avatar: playerAvatar(profile?.avatar), pose: normalisePose(profile?.pose) };
}
