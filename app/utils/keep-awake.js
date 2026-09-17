// Keeps the page alive while something long is running in it (a file
// transfer, say). Browsers put background tabs to sleep in three ways, and
// this leans on each: a screen wake lock so the device doesn't doze off, a
// beforeunload handler (Chrome never discards a tab that has one, and it
// also keeps the page out of the back/forward cache, so it is never frozen
// or silently reloaded), and a re-request of the wake lock whenever the tab
// comes back into view, since the browser drops it when the tab is hidden.
//
// Callers hold and release by name so two tools can overlap.

const holders = new Map();
let wakeLock = null;
let listening = false;

async function acquire() {
  if (wakeLock || !holders.size || document.visibilityState !== 'visible')
    return;
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    wakeLock?.addEventListener('release', () => (wakeLock = null));
  } catch {
    wakeLock = null;
  }
}

function onBeforeUnload(event) {
  const message = [...holders.values()][0];
  if (!message) return undefined;
  event.preventDefault();
  event.returnValue = message;
  return message;
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', acquire);
}

function unlisten() {
  if (!listening || holders.size) return;
  listening = false;
  window.removeEventListener('beforeunload', onBeforeUnload);
  document.removeEventListener('visibilitychange', acquire);
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

export function holdAwake(
  name,
  message = 'Something is still running here. Leave anyway?',
) {
  holders.set(name, message);
  listen();
  acquire();
}

export function releaseAwake(name) {
  holders.delete(name);
  unlisten();
}
