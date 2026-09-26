// Signing in with Roblox and uploading pictures as decals, straight from the
// browser.
//
// Sign-in is OAuth 2.0's authorization code flow with PKCE, which Roblox
// requires of "public" clients like a static site: there is no client secret
// to keep, the code verifier stands in for one. Roblox's OAuth, upload,
// operation and asset-delivery endpoints all answer this site's origin with
// CORS headers, so no server sits in between.
//
// The flow:
//   1. a popup goes to Roblox's authorize page with a code challenge;
//   2. Roblox sends it back to /roblox-callback.html with a code, which that
//      page broadcasts to this one (the popup can lose its opener on the way
//      through Roblox's login, so a BroadcastChannel carries it, not
//      window.opener);
//   3. the code and the verifier are exchanged for tokens.
//
// Tokens are kept in IndexedDB under a key outside "woogi-", so a site
// backup never carries them. The access token lasts 15 minutes and is
// refreshed quietly; the refresh token lasts 90 days.
//
// The app itself (its client ID, redirect URI and scopes) is registered by
// whoever runs the site, at create.roblox.com/dashboard/credentials. Its
// client ID is read from VITE_ROBLOX_CLIENT_ID at build time.

import { idbGet, idbSet, idbDelete } from './idb-store';
import { textureIdFrom } from './rbxm';

export const CLIENT_ID = import.meta.env?.VITE_ROBLOX_CLIENT_ID ?? '';
const OAUTH = 'https://apis.roblox.com/oauth/v1';
const ASSETS = 'https://apis.roblox.com/assets/v1';
const DELIVERY = 'https://apis.roblox.com/asset-delivery-api/v1';
// Uploading decals, and reading a decal back to find its image.
export const SCOPES = 'openid profile asset:read asset:write legacy-asset:manage';
export const CHANNEL = 'woogi-roblox-oauth';
const SESSION = 'auth:roblox';
const PENDING = 'woogi-roblox-oauth-pending';

export const redirectUri = () => `${window.location.origin}/roblox-callback.html`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const randomString = (bytes) =>
  base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export class RobloxError extends Error {}

async function tokenRequest(fields) {
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- Roblox's OAuth server, not app data
  const response = await fetch(`${OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new RobloxError(body.error_description || body.error || `Roblox said ${response.status}`);
  return body;
}

async function keep(tokens, user) {
  const session = {
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 900) * 1000,
    user,
  };
  await idbSet(SESSION, session);
  return session;
}

async function whoIs(access) {
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- Roblox's OAuth server, not app data
  const response = await fetch(`${OAUTH}/userinfo`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!response.ok) throw new RobloxError('Couldn’t read your Roblox account');
  const info = await response.json();
  return {
    id: String(info.sub),
    name: info.preferred_username || info.nickname || info.name || `user ${info.sub}`,
    picture: info.picture ?? null,
  };
}

// Waits for the callback page to broadcast the code for this sign-in.
function awaitCallback(state, signal) {
  return new Promise((resolve, reject) => {
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
    const timer = setTimeout(() => finish(new RobloxError('Sign-in timed out')), 10 * 60 * 1000);
    function finish(error, data) {
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(data);
    }
    function take(data) {
      if (data?.type !== CHANNEL || data.state !== state) return;
      if (data.error)
        finish(new RobloxError(data.errorDescription || 'Roblox didn’t allow it'));
      else finish(null, data);
    }
    const onMessage = (event) => {
      if (event.origin === window.location.origin) take(event.data);
    };
    // Last resort when BroadcastChannel is missing: the callback writes it here.
    const onStorage = (event) => {
      if (event.key !== PENDING || !event.newValue) return;
      try {
        take(JSON.parse(event.newValue));
      } catch {
        // someone else's write
      }
    };
    const onAbort = () => finish(new RobloxError('Sign-in cancelled'));
    if (channel) channel.onmessage = (event) => take(event.data);
    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Signs in with Roblox in a popup. Resolves with the session: tokens and
 * { id, name } of the account. Must be called from a click, or browsers
 * block the popup.
 */
export async function signIn({ signal } = {}) {
  if (!CLIENT_ID) throw new RobloxError('Roblox sign-in isn’t set up on this site');
  const verifier = randomString(48);
  const state = randomString(18);
  const url = new URL(`${OAUTH}/authorize`);
  // Opened first, while the click still counts; the address is set after.
  const popup = window.open('', 'roblox-sign-in', 'width=520,height=760');
  if (!popup) throw new RobloxError('Allow pop-ups for this site to sign in with Roblox');
  const challenge = base64url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  for (const [key, value] of Object.entries({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: SCOPES,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }))
    url.searchParams.set(key, value);
  popup.location.href = url.href;
  const { code } = await awaitCallback(state, signal);
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri(),
  });
  return keep(tokens, await whoIs(tokens.access_token));
}

/** The kept session, refreshed if it's about to run out, or null. */
export async function currentSession() {
  const session = await idbGet(SESSION);
  if (!session?.refresh) return null;
  if (session.expiresAt - 60000 > Date.now()) return session;
  try {
    const tokens = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: session.refresh,
    });
    return keep(tokens, session.user);
  } catch {
    await idbDelete(SESSION);
    return null;
  }
}

export async function signOut() {
  const session = await idbGet(SESSION);
  await idbDelete(SESSION);
  if (!session?.refresh) return;
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- Roblox's OAuth server, not app data
  await fetch(`${OAUTH}/token/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, token: session.refresh }),
  }).catch(() => {});
}

// A request with the account's token: refreshed if it has run out, and
// retried when Roblox says to slow down.
async function call(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const session = await currentSession();
    if (!session) throw new RobloxError('Signed out of Roblox: sign in again');
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- Roblox's Open Cloud, not app data
    const response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${session.access}` },
    });
    if (response.status === 429 && attempt < 6) {
      const after = Number(response.headers.get('retry-after'));
      await wait((after > 0 ? after : 2 ** attempt) * 1000);
      continue;
    }
    if (response.status === 401 && attempt === 0) {
      await idbSet(SESSION, { ...session, expiresAt: 0 });
      continue;
    }
    return response;
  }
}

async function reason(response) {
  const body = await response.json().catch(() => null);
  return body?.message || body?.errors?.[0]?.message || `Roblox said ${response.status}`;
}

/**
 * Uploads a PNG as a decal owned by `userId`, waits for Roblox to finish
 * with it, and resolves with the decal's asset ID and moderation state.
 */
export async function uploadDecal(blob, { name, description, userId }) {
  const form = new FormData();
  form.append(
    'request',
    JSON.stringify({
      assetType: 'Decal',
      displayName: name.slice(0, 50),
      description: description.slice(0, 1000),
      creationContext: { creator: { userId: String(userId) } },
    }),
  );
  form.append('fileContent', blob, 'step.png');
  const created = await call(`${ASSETS}/assets`, { method: 'POST', body: form });
  if (!created.ok) throw new RobloxError(await reason(created));
  let operation = await created.json();
  for (let tries = 0; !operation.done; tries++) {
    if (tries > 60) throw new RobloxError('Roblox is taking too long with the upload');
    await wait(Math.min(1000 + tries * 250, 3000));
    const polled = await call(`${ASSETS}/${operation.path}`);
    if (!polled.ok) throw new RobloxError(await reason(polled));
    operation = await polled.json();
  }
  if (operation.error || !operation.response?.assetId)
    throw new RobloxError(operation.error?.message || 'Roblox didn’t make the decal');
  return {
    decalId: String(operation.response.assetId),
    moderation: operation.response.moderationResult?.moderationState ?? null,
  };
}

/**
 * The image ID behind a decal: what a game actually draws. Roblox's upload
 * only returns the decal's ID, so the decal is read back (it's a tiny model
 * whose Decal points at the image). A new decal can take a moment to be
 * readable, so this tries a few times.
 */
export async function imageIdOf(decalId) {
  let lastError = null;
  for (let tries = 0; tries < 8; tries++) {
    if (tries) await wait(1500 * tries);
    try {
      const found = await call(`${DELIVERY}/assetId/${decalId}`);
      if (!found.ok) {
        lastError = new RobloxError(await reason(found));
        continue;
      }
      const { location } = await found.json();
      if (!location) continue;
      // The content itself is on Roblox's CDN, which is open to any page.
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- Roblox's CDN, not app data
      const content = await fetch(location);
      if (!content.ok) continue;
      const id = await textureIdFrom(new Uint8Array(await content.arrayBuffer()));
      if (id) return id;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new RobloxError('Couldn’t find the picture behind that decal');
}
