import config from 'woogi-tools/config/environment';

// WebRTC settings for internet connections the site makes (game rooms). All traffic is relayed through Cloudflare's TURN servers
// (`iceTransportPolicy: 'relay'`), so the other side only ever sees Cloudflare's
// address, never yours. Credentials are short-lived and come from the site's
// own Worker (worker/index.js); no keys are shipped in the page.
//
// Nearby play (utils/lan-link.js) is the exception: it's a direct link on the
// same Wi-Fi or hotspot with no internet, where there is nothing to relay through.
// File Share and device-to-device data transfer are the other exception: they
// connect directly where they can (and warn that the other side can see your IP
// address), and fall back to a public volunteer relay, never Cloudflare's, so
// big transfers don't run up the site's bill (`directOrRelayedPeerOptions`).

// Public STUN servers only find your own address; no traffic goes through them.
const DIRECT_RTC = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  ],
};

export function directPeerOptions() {
  return { config: DIRECT_RTC };
}

// Direct where it can be, and relayed through a public volunteer server
// where it can't. Two people behind strict (symmetric) NATs never manage a
// straight link, and that was the "sometimes it just won't connect" in File
// Share. The browser gathers candidates from every server listed and still
// prefers the direct route; the relay is only used as a last resort, and it
// is the Open Relay Project's free TURN service rather than the site's own
// Cloudflare account, so a gigabyte of holiday photos costs the site nothing.
const PUBLIC_RELAYS = [
  { urls: 'stun:openrelay.metered.ca:80' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const MORE_STUN = [
  { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

export function directOrRelayedPeerOptions() {
  return {
    config: {
      iceServers: [...DIRECT_RTC.iceServers, ...MORE_STUN, ...PUBLIC_RELAYS],
      // Every candidate type is tried at once, so a direct route is found
      // as quickly as before and the relay only wins when nothing else does.
      iceCandidatePoolSize: 4,
    },
  };
}

// Fetch fresh credentials well before the ones handed out expire.
const REFRESH_MS = 60 * 60 * 1000;

let cached = null;

export class PrivateConnectionError extends Error {
  type = 'private-connection';
}

// Resolves to PeerJS options ({ config }) for `new Peer(id, options)`.
export async function peerOptions() {
  const rtc = await rtcConfig();
  // No key at all (rather than `config: undefined`) keeps PeerJS's own defaults in development.
  return rtc ? { config: rtc } : {};
}

export function rtcConfig() {
  if (cached && Date.now() - cached.at < REFRESH_MS) return cached.promise;
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- connection credentials, not app data
  const promise = fetch('/api/turn', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`TURN ${response.status}`);
      const { iceServers } = await response.json();
      if (!iceServers?.length) throw new Error('No TURN servers');
      return { iceServers, iceTransportPolicy: 'relay' };
    })
    .catch((error) => {
      cached = null;
      // `vite` dev has no Worker; connect directly there so online play can still be tested.
      if (config.environment === 'development') {
        console.warn(
          'TURN unavailable in development, connecting without a relay:',
          error,
        );
        return undefined;
      }
      // Never fall back to a direct connection in production: that would expose IP addresses.
      throw new PrivateConnectionError(
        "Couldn't set up a private connection. Check your connection and try again.",
      );
    });
  cached = { at: Date.now(), promise };
  return promise;
}
