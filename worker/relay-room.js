// File Share's last-resort transport.
//
// WebRTC connects the two browsers straight to each other whenever it can,
// which is free, fast, and never touches this Worker. But two people behind
// strict (symmetric) NATs can't be introduced to each other at all, and plenty
// of school, office and hotel networks block UDP outright, so WebRTC has
// nothing to work with. The usual answer is a TURN server; this is not one.
// It's an ordinary WebSocket on port 443, the same port that served the page,
// which is why it gets through the networks TURN-over-UDP doesn't.
//
// A room is one Durable Object, named after the share code. Whatever one
// socket sends is forwarded to the others in the room and nothing is ever
// stored: this object is a wire, not a mailbox. Frames pass through opaque,
// so the Worker is not a place where anyone's files sit.
//
// Hibernation matters here. `acceptWebSocket` lets the runtime evict this
// object from memory between frames, so an idle room costs nothing and a busy
// one is billed for the moment it spends forwarding rather than for the hours
// a big transfer is open.

// A room with nobody in it is finished; so is one that has outlived any
// plausible transfer. Both are guards against a room being held open for ever.
const EMPTY_GRACE_MS = 60 * 1000;
const MAX_ROOM_MS = 12 * 60 * 60 * 1000;

// Enough for File Share's 4 MB pieces and their header, with room to spare.
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

// Two people sharing files, plus a little slack for a host serving a couple of
// devices at once and for sockets that haven't noticed they're closed yet.
const MAX_SOCKETS = 8;

export class RelayRoom {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected a WebSocket', { status: 426 });

    const sockets = this.state.getWebSockets();
    if (sockets.length >= MAX_SOCKETS)
      return new Response('That room is full', { status: 409 });

    const id =
      new URL(request.url).searchParams.get('id') || crypto.randomUUID();
    const { 0: client, 1: server } = new WebSocketPair();

    // The id is attached to the socket rather than kept in memory, so it
    // survives the object being evicted between frames.
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id });

    // Everyone already here learns who just arrived, and the newcomer learns
    // who was already waiting. That is how each side gets the peer id it
    // needs, without this object ever holding a list of its own.
    const others = sockets
      .map((s) => s.deserializeAttachment()?.id)
      .filter(Boolean);
    for (const other of sockets) send(other, { type: 'joined', id });
    send(server, { type: 'ready', id, peers: others });

    await this.state.storage.setAlarm(Date.now() + MAX_ROOM_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Forwarded as-is, to everyone but the sender. A frame is a file piece, so
  // this is the hot path: no parsing, no copying, no storage.
  webSocketMessage(socket, message) {
    const size =
      typeof message === 'string' ? message.length : message.byteLength;
    if (size > MAX_FRAME_BYTES) {
      socket.close(1009, 'Frame too large');
      return;
    }
    for (const other of this.state.getWebSockets())
      if (other !== socket) trySend(other, message);
  }

  webSocketClose(socket) {
    this.farewell(socket);
  }

  webSocketError(socket) {
    this.farewell(socket);
  }

  // The other side is told immediately, so File Share can show "they left"
  // rather than waiting on a transfer that is never going to finish.
  farewell(socket) {
    const { id } = socket.deserializeAttachment() ?? {};
    for (const other of this.state.getWebSockets())
      if (other !== socket) send(other, { type: 'left', id });
    this.scheduleSweep();
  }

  async scheduleSweep() {
    const remaining = this.state
      .getWebSockets()
      .filter((s) => s.readyState === 1);
    if (!remaining.length)
      await this.state.storage.setAlarm(Date.now() + EMPTY_GRACE_MS);
  }

  // The room's own expiry. Anything still connected is closed and the object
  // is left with nothing to keep it alive.
  async alarm() {
    for (const socket of this.state.getWebSockets())
      try {
        socket.close(1001, 'Room closed');
      } catch {
        // already gone
      }
    await this.state.storage.deleteAll();
  }
}

function send(socket, payload) {
  trySend(socket, JSON.stringify(payload));
}

function trySend(socket, data) {
  try {
    socket.send(data);
  } catch {
    // A socket that died mid-forward is not this room's problem; its close
    // event will clean it up.
  }
}
