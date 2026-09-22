// File Share's fallback transport, from the page's side.
//
// WebRTC is still how two browsers talk whenever they can manage it: direct,
// free, and nothing in the middle. This is what happens when they can't --
// both behind strict NATs, or on a network that blocks UDP, where no amount
// of STUN will introduce them. It is a WebSocket to this site's own Worker
// (see worker/relay-room.js), which forwards frames between the two of them.
// A WebSocket on 443 is indistinguishable from loading the page itself, so
// the networks that break WebRTC don't break this.
//
// `openRelayLink` resolves to something shaped like a PeerJS DataConnection --
// `peer`, `send`, `dataChannel.bufferedAmount`, and open/data/close/error
// events -- so File Share can use it without caring which transport it got.

const RELAY_PATH = '/api/relay-room';

// How long to wait for the socket and the room's greeting before giving up.
const OPEN_TIMEOUT_MS = 10000;

// PeerJS hands `conn.send(value)` a structured value; here a frame has to go
// down the wire as bytes. A frame is the JSON header, its length, then the
// binary body, so the big ArrayBuffer is never base64'd or copied into a
// string.
const HEADER_BYTES = 4;

export function encodeFrame(message) {
  const { data, ...rest } = message ?? {};
  const body =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(0);
  const header = new TextEncoder().encode(JSON.stringify(rest));
  const frame = new Uint8Array(
    HEADER_BYTES + header.byteLength + body.byteLength,
  );
  new DataView(frame.buffer).setUint32(0, header.byteLength);
  frame.set(header, HEADER_BYTES);
  frame.set(body, HEADER_BYTES + header.byteLength);
  return frame.buffer;
}

export function decodeFrame(buffer) {
  const bytes = new Uint8Array(buffer);
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(
    0,
  );
  const start = HEADER_BYTES + headerLength;
  if (headerLength > bytes.byteLength - HEADER_BYTES)
    throw new Error('Bad frame');
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(HEADER_BYTES, start)),
  );
  // `slice` rather than `subarray`: the body outlives this frame, and the
  // receiving side stores it.
  return { ...header, data: bytes.slice(start).buffer };
}

export function relayUrl(code) {
  const url = new URL(RELAY_PATH, window.location.origin);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.searchParams.set('code', code);
  return url.toString();
}

// A PeerJS-shaped connection over one WebSocket.
class RelayConnection {
  constructor(socket, id) {
    this.socket = socket;
    // The id of whoever is on the other end, filled in from the room's
    // greeting. File Share keys its connections and transfers by this.
    this.peer = id;
    this.open = true;
    this.handlers = { open: [], data: [], close: [], error: [] };

    // File Share throttles itself on `dataChannel.bufferedAmount` and waits
    // for a `bufferedamountlow` event. A WebSocket has the amount but not the
    // event, so it is polled -- and polled off a timer only while the page is
    // actually blocked on it, which is a handful of times per file.
    this.dataChannel = {
      bufferedAmountLowThreshold: 0,
      get bufferedAmount() {
        return socket.bufferedAmount;
      },
      addEventListener: (type, listener, options) => {
        if (type !== 'bufferedamountlow') return;
        const threshold = this.dataChannel.bufferedAmountLowThreshold;
        const tick = () => {
          if (socket.readyState !== WebSocket.OPEN) return listener();
          if (socket.bufferedAmount <= threshold) return listener();
          setTimeout(tick, 50);
        };
        // `once` is the only option File Share passes, and polling is
        // one-shot by nature, so there is nothing to remove.
        void options;
        setTimeout(tick, 50);
      },
    };

    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') return this.onControl(event.data);
      try {
        this.emit('data', decodeFrame(event.data));
      } catch {
        // A frame this build doesn't understand is skipped rather than
        // killing a transfer that is otherwise fine.
      }
    });
    socket.addEventListener('close', () => this.shutDown());
    socket.addEventListener('error', () =>
      this.emit('error', new Error('Relay error')),
    );
  }

  onControl(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    // The room tells us who else is here; the first of them is our peer.
    if (message.type === 'joined' && !this.peer) {
      this.peer = message.id;
      this.emit('open');
    } else if (message.type === 'left' && message.id === this.peer) {
      this.shutDown();
    }
  }

  shutDown() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  on(event, handler) {
    this.handlers[event]?.push(handler);
    return this;
  }

  emit(event, ...args) {
    for (const handler of this.handlers[event] ?? []) handler(...args);
  }

  send(message) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeFrame(message));
  }

  close() {
    this.open = false;
    try {
      this.socket.close();
    } catch {
      // already closing
    }
  }
}

// Resolves once the room has greeted us and someone else is in it. Rejects if
// the socket won't open, so File Share can fall back to its error message
// rather than waiting for ever.
export function openRelayLink(code, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let socket;
    try {
      socket = new WebSocket(relayUrl(code));
    } catch (error) {
      return reject(error);
    }
    socket.binaryType = 'arraybuffer';

    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // already closing
      }
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error('The relay did not answer in time.')),
      OPEN_TIMEOUT_MS,
    );
    signal?.addEventListener('abort', () => fail(new Error('Cancelled')), {
      once: true,
    });

    const greeting = (event) => {
      if (typeof event.data !== 'string') return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type !== 'ready') return;
      socket.removeEventListener('message', greeting);
      settled = true;
      clearTimeout(timer);
      // Whoever arrived first waits for the other side's "joined"; whoever
      // arrived second already has a peer to talk to.
      const peer = message.peers?.[0] ?? null;
      const connection = new RelayConnection(socket, peer);
      resolve(connection);
      if (peer) queueMicrotask(() => connection.emit('open'));
    };

    socket.addEventListener('message', greeting);
    socket.addEventListener('error', () =>
      fail(new Error('The relay could not be reached.')),
    );
    socket.addEventListener('close', () =>
      fail(new Error('The relay closed the connection.')),
    );
  });
}
