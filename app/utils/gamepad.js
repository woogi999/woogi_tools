import { tracked } from '@glimmer/tracking';

// Controller support for the whole site.
//
// Controllers are polled once a frame while one is connected (the Gamepad API
// has no button events). Button names follow the standard mapping, Xbox-style:
// A B X Y, LB RB LT RT, Back Start, LS RS (stick presses), DPad*.
// The left stick also acts as a D-pad; the right stick is read as analog.
//
// Whoever pushed a handler last gets presses first (a game while it's being
// played); a handler returns true to keep a press. Anything left over drives
// the site: the D-pad moves focus between things you can press, A presses,
// B goes back or closes, the bumpers and right stick scroll, Start opens search.
//
//   const release = pushPadHandler((button, { down, repeat }) => …)
//   padStick('right') -> { x, y } from -1 to 1

const NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'DPadUp', 'DPadDown', 'DPadLeft', 'DPadRight', 'Home'];
const DIRECTIONS = new Set(['DPadUp', 'DPadDown', 'DPadLeft', 'DPadRight']);
const REPEAT_DELAY_MS = 380;
const REPEAT_EVERY_MS = 110;
const STICK_DEAD = 0.5;
const ANALOG_DEAD = 0.18;

class PadState {
  // The controller's name while one is connected, else null.
  @tracked connected = null;
  // True from the first controller press until the mouse or keyboard is used again.
  @tracked active = false;
}

export const padState = new PadState();

const handlers = [];
const held = new Map(); // button -> { since, lastRepeat }
let stick = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
let frame = null;
let installed = false;

export function pushPadHandler(handler) {
  handlers.push(handler);
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

export const padStick = (side) => stick[side] ?? { x: 0, y: 0 };

function emit(button, info) {
  if (info.down && !padState.active) {
    padState.active = true;
    document.documentElement.classList.add('is-pad');
  }
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i](button, info)) return;
  siteNavigation(button, info);
}

function poll(now) {
  frame = null;
  const pads = navigator.getGamepads?.() ?? [];
  const pad = [...pads].find((p) => p?.connected);
  if (!pad) {
    held.clear();
    return;
  }
  const pressed = new Set();
  pad.buttons.forEach((b, i) => {
    if (NAMES[i] && (b.pressed || b.value > 0.5)) pressed.add(NAMES[i]);
  });
  const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
  if (ly < -STICK_DEAD) pressed.add('DPadUp');
  if (ly > STICK_DEAD) pressed.add('DPadDown');
  if (lx < -STICK_DEAD) pressed.add('DPadLeft');
  if (lx > STICK_DEAD) pressed.add('DPadRight');
  const dead = (v) => (Math.abs(v) < ANALOG_DEAD ? 0 : v);
  stick = { left: { x: dead(lx), y: dead(ly) }, right: { x: dead(rx), y: dead(ry) } };

  for (const button of pressed) {
    const state = held.get(button);
    if (!state) {
      held.set(button, { since: now, lastRepeat: now });
      emit(button, { down: true, repeat: false });
    } else if (DIRECTIONS.has(button) && now - state.since > REPEAT_DELAY_MS && now - state.lastRepeat > REPEAT_EVERY_MS) {
      state.lastRepeat = now;
      emit(button, { down: true, repeat: true });
    }
  }
  for (const button of [...held.keys()]) {
    if (pressed.has(button)) continue;
    held.delete(button);
    emit(button, { down: false, repeat: false });
  }
  // The right stick scrolls the page when nothing else is using it.
  if (!handlers.length && stick.right.y) window.scrollBy({ top: stick.right.y * 18, behavior: 'instant' });
  frame = requestAnimationFrame(poll);
}

function start() {
  if (frame === null) frame = requestAnimationFrame(poll);
}

export function installGamepad() {
  if (installed || typeof window === 'undefined' || !('getGamepads' in navigator)) return;
  installed = true;
  window.addEventListener('gamepadconnected', (event) => {
    padState.connected = event.gamepad.id.replace(/\s*\(.*\)\s*$/, '') || 'Controller';
    start();
  });
  window.addEventListener('gamepaddisconnected', () => {
    const still = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
    padState.connected = still ? still.id : null;
    if (still) start();
  });
  // Mouse or keyboard again: hide the controller focus ring.
  const calm = () => {
    if (!padState.active) return;
    padState.active = false;
    document.documentElement.classList.remove('is-pad');
  };
  window.addEventListener('pointermove', calm, { passive: true });
  window.addEventListener('keydown', calm, { passive: true });
  // A controller already connected before the page loaded shows up on its first press.
  start();
  setInterval(() => {
    if (frame === null && [...(navigator.getGamepads?.() ?? [])].some((p) => p?.connected)) start();
  }, 1000);
}

// ─── Moving round the site ─────────────────────────────────────────────

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function scope() {
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  return dialogs.at(-1) ?? document;
}

function visible(el) {
  if (el.closest('[inert], [hidden]')) return false;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function focusables() {
  return [...scope().querySelectorAll(FOCUSABLE)].filter(visible);
}

function focus(el) {
  el.focus({ preventScroll: true, focusVisible: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

// The nearest element in a direction, favouring ones straight ahead.
function move(direction) {
  const all = focusables();
  const current = document.activeElement && all.includes(document.activeElement) ? document.activeElement : null;
  if (!current) {
    // Start from whatever is nearest the top of the screen.
    const first = all.find((el) => el.getBoundingClientRect().top >= 0) ?? all[0];
    if (first) focus(first);
    return;
  }
  const from = current.getBoundingClientRect();
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const [dx, dy] = { DPadUp: [0, -1], DPadDown: [0, 1], DPadLeft: [-1, 0], DPadRight: [1, 0] }[direction];
  let best = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === current) continue;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - cx;
    const y = rect.top + rect.height / 2 - cy;
    const along = x * dx + y * dy;
    if (along <= 4) continue;
    const across = Math.abs(x * dy) + Math.abs(y * dx);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) focus(best);
  else if (dy) window.scrollBy({ top: dy * window.innerHeight * 0.4, behavior: 'smooth' });
}

function key(target, type, keyName, code) {
  target.dispatchEvent(new KeyboardEvent(type, { key: keyName, code, bubbles: true, cancelable: true }));
}

function siteNavigation(button, { down }) {
  const active = document.activeElement;
  // Hold-to-confirm buttons are held with A, like holding Space.
  if (button === 'A' && active?.classList?.contains('hold-btn')) {
    key(active, down ? 'keydown' : 'keyup', ' ', 'Space');
    return;
  }
  if (!down) return;
  if (DIRECTIONS.has(button)) {
    // Sliders slide sideways; everything else moves focus.
    if (active?.matches?.('input[type="range"]') && (button === 'DPadLeft' || button === 'DPadRight')) {
      const step = Number(active.step) || 1;
      active.value = String(Number(active.value) + (button === 'DPadRight' ? step : -step));
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (active?.matches?.('select') && (button === 'DPadLeft' || button === 'DPadRight')) {
      active.selectedIndex = Math.max(0, Math.min(active.options.length - 1, active.selectedIndex + (button === 'DPadRight' ? 1 : -1)));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    move(button);
    return;
  }
  switch (button) {
    case 'A':
      if (!active || active === document.body) move('DPadDown');
      else if (active.matches('input[type="text"], input[type="search"], input:not([type]), textarea')) active.focus();
      else active.click();
      break;
    case 'B': {
      const dialog = scope();
      if (dialog !== document) {
        dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
        return;
      }
      if (active && active !== document.body && active.matches('input, textarea')) {
        active.blur();
        return;
      }
      key(document.activeElement ?? document.body, 'keydown', 'Escape', 'Escape');
      if (!document.querySelector('.command-palette, .sidebar.is-open')) history.back();
      break;
    }
    case 'X':
      document.querySelector('.mobile-menu-btn')?.click();
      break;
    case 'Start':
    case 'Y':
      // The site's search (Ctrl+F).
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true }));
      break;
    case 'LB':
    case 'LT':
      window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
      break;
    case 'RB':
    case 'RT':
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
      break;
    default:
      break;
  }
}
