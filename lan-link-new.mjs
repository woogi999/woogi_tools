// Compact rewrite of lan-link.js's wire format. Same job (turning an SDP into
// a short pairing code and back), far less text: instead of shipping the whole
// SDP, only the handful of fields that actually differ between browsers are
// pulled out and packed as bytes; everything else is boilerplate every
// browser emits the same way, so it's reconstructed from a fixed template
// instead of being sent at all.
//
// What's cut and why it's safe:
//   - The session/media boilerplate (v=, o=, s=, t=, m=, c=, bundle group,
//     sctp port, max message size, mid) is identical on every browser that
//     supports datachannels (RFC 8841): hardcoded, sent as zero bytes.
//   - The DTLS fingerprint's "sha-256" label and hex colons: the 32 raw bytes
//     are kept, the formatting is rebuilt.
//   - Candidate foundation/priority/generation: only used by the ICE agent to
//     order its own connectivity checks against candidates IT already knows
//     about; a fresh, valid, distinct value works exactly as well as the
//     original. Only the address and port are irreplaceable data.
//   - TCP candidates and anything but component 1: browsers don't gather TCP
//     host candidates with real listening ports (Firefox's are a stub on the
//     discard port, 9, that never connects), and there's only ever one
//     component for a datachannel-only connection.
const PREFIX = 'W1';
const MAX_CANDIDATES = 8;

const enc = new TextEncoder();
const dec = new TextDecoder();

function packString(bytes, str) {
  const utf8 = enc.encode(str);
  if (utf8.length > 255) throw new Error('That field is too long to fit in a nearby code.');
  bytes.push(utf8.length, ...utf8);
}

function fingerprintToBytes(hex) {
  const parts = hex.split(':');
  if (parts.length !== 32) throw new Error('Unexpected fingerprint from this browser.');
  return parts.map((h) => parseInt(h, 16));
}

function bytesToFingerprint(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

// Pulls just the bits that vary out of a real, browser-generated SDP.
function readSdp(sdp) {
  const ufrag = /^a=ice-ufrag:(\S+)/m.exec(sdp)?.[1];
  const pwd = /^a=ice-pwd:(\S+)/m.exec(sdp)?.[1];
  const fingerprint = /^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/m.exec(sdp)?.[1];
  const candidates = [...sdp.matchAll(/^a=candidate:\S+ (\d+) (udp|UDP) \S+ (\S+) (\d+) typ host/gm)]
    .filter((m) => m[1] === '1')
    .map((m) => ({ address: m[3], port: Number(m[4]) }));
  if (!ufrag || !pwd || !fingerprint) throw new Error('Couldn’t read the connection details from this browser.');
  if (!candidates.length) throw new Error('No network address was found to connect over. Try again once you’re on Wi-Fi.');
  return { ufrag, pwd, fingerprint, candidates };
}

export function encode({ type, id, sdp }) {
  const { ufrag, pwd, fingerprint, candidates } = readSdp(sdp);
  const bytes = [type === 'answer' ? 1 : 0];
  packString(bytes, id);
  packString(bytes, ufrag);
  packString(bytes, pwd);
  bytes.push(...fingerprintToBytes(fingerprint));
  const kept = candidates.slice(0, MAX_CANDIDATES);
  bytes.push(kept.length);
  for (const c of kept) {
    packString(bytes, c.address);
    bytes.push((c.port >> 8) & 0xff, c.port & 0xff);
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decode(code) {
  const clean = String(code ?? '').replace(/\s+/g, '');
  if (!clean.startsWith(PREFIX)) throw new Error('That isn’t a Woogi nearby-play code.');
  const base64 = clean.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
  let binary;
  try {
    binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  } catch {
    throw new Error('That code looks incomplete. Check it and try again.');
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  let i = 0;
  const need = (n) => {
    if (i + n > bytes.length) throw new Error('That code looks incomplete. Check it and try again.');
  };
  const byte = () => {
    need(1);
    return bytes[i++];
  };
  const str = () => {
    const len = byte();
    need(len);
    const s = dec.decode(bytes.subarray(i, i + len));
    i += len;
    return s;
  };
  const type = byte() === 1 ? 'answer' : 'offer';
  const id = str();
  const ufrag = str();
  const pwd = str();
  need(32);
  const fingerprint = bytesToFingerprint(bytes.subarray(i, i + 32));
  i += 32;
  const count = byte();
  const candidates = [];
  for (let n = 0; n < count; n++) {
    const address = str();
    const port = (byte() << 8) | byte();
    candidates.push({ address, port });
  }
  return { type, id, sdp: buildSdp({ type, ufrag, pwd, fingerprint, candidates }) };
}

// Rebuilds a full, spec-shaped SDP around the handful of fields that were
// actually transmitted. Every browser that supports RTCDataChannel emits (and
// accepts) this shape for a single, bundled application m-line.
function buildSdp({ type, ufrag, pwd, fingerprint, candidates }) {
  const lines = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...candidates.map((c, i) => `a=candidate:${i + 1} 1 udp ${2113937151 - i} ${c.address} ${c.port} typ host generation 0`),
    'a=end-of-candidates',
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fingerprint}`,
    `a=setup:${type === 'offer' ? 'actpass' : 'active'}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ];
  return lines.join('\r\n') + '\r\n';
}
