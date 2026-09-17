// The storage and merge layer under Messages.
//
// There is no server holding a conversation and no "host" who owns it. Every
// device keeps its own complete copy of a chat as an append-only log of small
// events (someone joined, someone said something, someone took a message
// back), and two devices that manage to reach each other swap the events the
// other one is missing. That is the whole trick: a merge is a union of two
// logs, so it doesn't matter who was online when, in what order things
// arrive, or how many times the same event turns up. It is the same idea as
// pulling from a git remote, with the events playing the part of commits.
//
// Ordering. Every event carries the author's own counter (`seq`) and a Lamport
// clock (`clock`) set to one more than the highest clock that device had seen.
// Sorting by clock, then by wall-clock time, then by id puts a conversation
// into an order everyone agrees on, and keeps a reply after the message it
// replies to even when two people's clocks disagree about the time of day.
//
// Catching up. Because an author's events are a strict sequence from one
// device, "what am I missing" fits in a version vector: a map of author to the
// highest seq we hold. Send that, and the other side can answer with exactly
// the events above each mark rather than a list of everything it has.

const DB_NAME = 'woogi-messages';
const DB_VERSION = 2;
const STORE = 'events';
// Files big enough to be sent device to device rather than carried in the log
// live here, on every device that has a copy (see mesh-files.js).
const BLOBS = 'blobs';

// Events are content-addressed so the same one arriving twice is the same row.
export async function eventId(event) {
  const canonical = JSON.stringify([
    event.chat,
    event.author,
    event.seq,
    event.clock,
    event.at,
    event.kind,
    event.data ?? null,
  ]);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return hex(digest);
}

export function hex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomHex(bytes = 16) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ─── IndexedDB ─────────────────────────────────────────────────────────
//
// A conversation with pictures in it outgrows localStorage quickly, so the log
// lives in IndexedDB. This is the smallest wrapper that makes it bearable.

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('chat', 'chat');
      }
      if (!db.objectStoreNames.contains(BLOBS)) {
        const store = db.createObjectStore(BLOBS, { keyPath: 'tid' });
        store.createIndex('chat', 'chat');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadEvents(chatId) {
  const db = await openDb();
  const index = db
    .transaction(STORE, 'readonly')
    .objectStore(STORE)
    .index('chat');
  return new Promise((resolve, reject) => {
    const request = index.getAll(chatId);
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function saveEvents(events) {
  if (!events.length) return;
  const db = await openDb();
  const transaction = db.transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  for (const event of events) store.put(event);
  return done(transaction);
}

// ─── The files that travel beside the log ──────────────────────────────

export async function putBlob(record) {
  const db = await openDb();
  const transaction = db.transaction(BLOBS, 'readwrite');
  transaction.objectStore(BLOBS).put(record);
  return done(transaction);
}

export async function getBlob(tid) {
  const db = await openDb();
  const store = db.transaction(BLOBS, 'readonly').objectStore(BLOBS);
  return new Promise((resolve, reject) => {
    const request = store.get(tid);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

// Which of these files this device could hand to somebody else.
export async function heldBlobs() {
  const db = await openDb();
  const store = db.transaction(BLOBS, 'readonly').objectStore(BLOBS);
  return new Promise((resolve, reject) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(new Set(request.result ?? []));
    request.onerror = () => reject(request.error);
  });
}

export async function dropChat(chatId) {
  const db = await openDb();
  const transaction = db.transaction(STORE, 'readwrite');
  const index = transaction.objectStore(STORE).index('chat');
  const request = index.openKeyCursor(chatId);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    transaction.objectStore(STORE).delete(cursor.primaryKey);
    cursor.continue();
  };
  await done(transaction);
  return dropBlobsFor(chatId);
}

async function dropBlobsFor(chatId) {
  const db = await openDb();
  const transaction = db.transaction(BLOBS, 'readwrite');
  const index = transaction.objectStore(BLOBS).index('chat');
  const request = index.openKeyCursor(chatId);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    transaction.objectStore(BLOBS).delete(cursor.primaryKey);
    cursor.continue();
  };
  return done(transaction);
}

// ─── One chat's log, in memory ──────────────────────────────────────────

export class ChatLog {
  // id -> event, in arrival order; sorting happens when the view is built.
  events = new Map();
  // author -> highest seq held, which is what a catch-up request is made of.
  vector = new Map();
  clock = 0;

  constructor(chatId) {
    this.chatId = chatId;
  }

  // Returns the events that were genuinely new, so a caller can save exactly
  // those and pass exactly those on to its other connections.
  add(incoming) {
    const fresh = [];
    for (const event of incoming) {
      if (!isWellFormed(event, this.chatId) || this.events.has(event.id))
        continue;
      this.events.set(event.id, event);
      const seen = this.vector.get(event.author) ?? 0;
      if (event.seq > seen) this.vector.set(event.author, event.seq);
      if (event.clock > this.clock) this.clock = event.clock;
      fresh.push(event);
    }
    return fresh;
  }

  versionVector() {
    return Object.fromEntries(this.vector);
  }

  // Everything the other side's vector says it hasn't got. An author it has
  // never heard of is missing all of that author's events.
  missingFor(vector = {}) {
    const out = [];
    for (const event of this.events.values())
      if (event.seq > (vector[event.author] ?? 0)) out.push(event);
    return out.sort((a, b) => a.clock - b.clock || a.at - b.at);
  }

  ordered() {
    return [...this.events.values()].sort(
      (a, b) =>
        a.clock - b.clock ||
        a.at - b.at ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  nextSeq(author) {
    return (this.vector.get(author) ?? 0) + 1;
  }
}

const KINDS = new Set([
  'join',
  'name',
  'msg',
  'edit',
  'unsend',
  'react',
  'topic',
  'leave',
]);

// Anything arriving from another device is checked before it is believed: a
// missing field or the wrong chat means the event is dropped rather than
// allowed to sit in the log as something the view has to defend itself from.
function isWellFormed(event, chatId) {
  return Boolean(
    event &&
    typeof event.id === 'string' &&
    /^[0-9a-f]{64}$/.test(event.id) &&
    event.chat === chatId &&
    typeof event.author === 'string' &&
    event.author.length &&
    Number.isInteger(event.seq) &&
    event.seq > 0 &&
    Number.isInteger(event.clock) &&
    Number.isFinite(event.at) &&
    KINDS.has(event.kind),
  );
}

// ─── Building the conversation from the log ─────────────────────────────

const MAX_TEXT = 4000;
const clean = (value, limit = MAX_TEXT) =>
  typeof value === 'string' ? value.slice(0, limit) : '';

// Folds the log into what the screen needs: the members, the messages in
// order, and each message's edits, reactions and whether it was taken back.
// Later events win, which is why an edit from a device whose clock is behind
// can never quietly undo a newer one.
export function buildView(log) {
  const members = new Map();
  const messages = new Map();
  let topic = '';
  let topicClock = -1;

  for (const event of log.ordered()) {
    const author = event.author;
    const data = event.data ?? {};
    switch (event.kind) {
      case 'join':
      case 'name': {
        const existing = members.get(author);
        members.set(author, {
          id: author,
          name: clean(data.name, 40) || existing?.name || 'Someone',
          joinedAt: existing?.joinedAt ?? event.at,
          left: event.kind === 'join' ? false : Boolean(existing?.left),
        });
        break;
      }
      case 'leave': {
        const existing = members.get(author);
        if (existing) members.set(author, { ...existing, left: true });
        break;
      }
      case 'topic': {
        if (event.clock >= topicClock) {
          topic = clean(data.name, 60);
          topicClock = event.clock;
        }
        break;
      }
      case 'msg': {
        messages.set(event.id, {
          id: event.id,
          author,
          at: event.at,
          clock: event.clock,
          text: clean(data.text),
          image: typeof data.image === 'string' ? data.image : '',
          file: fileOffer(data.file),
          replyTo: typeof data.replyTo === 'string' ? data.replyTo : '',
          call: typeof data.call === 'string' ? data.call : '',
          editedAt: 0,
          unsent: false,
          reactions: new Map(),
        });
        break;
      }
      case 'edit': {
        const target = messages.get(clean(data.target, 64));
        // Only the person who wrote something may rewrite it.
        if (target && target.author === author && !target.unsent) {
          target.text = clean(data.text);
          target.editedAt = event.at;
        }
        break;
      }
      case 'unsend': {
        const target = messages.get(clean(data.target, 64));
        if (target && target.author === author) {
          target.unsent = true;
          target.text = '';
          target.image = '';
          target.file = null;
        }
        break;
      }
      case 'react': {
        const target = messages.get(clean(data.target, 64));
        if (!target) break;
        const emoji = clean(data.emoji, 8);
        const who = target.reactions.get(author);
        // The same emoji again takes the reaction off, as it does everywhere else.
        if (!emoji || who === emoji) target.reactions.delete(author);
        else target.reactions.set(author, emoji);
        break;
      }
    }
  }

  const list = [...messages.values()].sort(
    (a, b) => a.clock - b.clock || a.at - b.at,
  );
  return { members, messages: list, topic };
}

// A file offer as it sits in the log: what the file is, not the file itself.
// Anything malformed becomes no offer at all rather than a half-drawn one.
function fileOffer(offer) {
  if (!offer || typeof offer !== 'object') return null;
  const tid = clean(offer.tid, 40);
  const name = clean(offer.name, 200);
  const size = Number(offer.size);
  if (!tid || !name || !Number.isFinite(size) || size < 0) return null;
  return {
    tid,
    name,
    size,
    type: clean(offer.type, 120),
    // Small files are carried in the log itself, so they are always there.
    inline: typeof offer.inline === 'string' ? offer.inline : '',
  };
}

// Reactions are stored per person; the bubble wants them grouped per emoji.
export function groupReactions(reactions, members, selfId) {
  const groups = new Map();
  for (const [who, emoji] of reactions) {
    const group = groups.get(emoji) ?? {
      emoji,
      count: 0,
      who: [],
      mine: false,
    };
    group.count += 1;
    group.who.push(members.get(who)?.name ?? 'Someone');
    if (who === selfId) group.mine = true;
    groups.set(emoji, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
