import { tracked } from '@glimmer/tracking';

// Keyboard and controller bindings for the games, editable in Settings.
//
// Keys are KeyboardEvent.code values ('KeyA', 'ArrowLeft', 'Space'), so they
// follow the key's position whatever the keyboard layout. Controller buttons use
// the names in utils/gamepad.js ('A', 'DPadLeft', 'RB'…).
//
//   actionForKey('woono', event)   -> action id or null
//   actionForPad('woono', 'A')     -> action id or null
//   keybinds.keys('woono', 'draw') -> ['Space', 'KeyS']

const STORE_KEY = 'woogi-keybinds';

export const GAME_CONTROLS = [
  {
    game: 'woono',
    label: 'Woono',
    actions: [
      { id: 'prev', label: 'Previous card (or colour / player when picking)', keys: ['ArrowLeft', 'KeyA'], pad: ['DPadLeft'] },
      { id: 'next', label: 'Next card (or colour / player when picking)', keys: ['ArrowRight', 'KeyD'], pad: ['DPadRight'] },
      { id: 'play', label: 'Play the lifted card / confirm a pick', keys: ['ArrowUp', 'KeyW', 'Enter'], pad: ['A'] },
      { id: 'draw', label: 'Draw (or take what’s coming)', keys: ['Space', 'KeyS'], pad: ['X'] },
      { id: 'keep', label: 'Keep the drawn card', keys: ['ArrowDown', 'KeyK'], pad: ['B'] },
      { id: 'pass', label: 'Pass', keys: ['KeyP'], pad: ['Y'] },
      { id: 'uno', label: 'Say Woono!', keys: ['KeyU'], pad: ['RB'] },
      { id: 'callout', label: 'Call someone out', keys: ['KeyC'], pad: ['LB'] },
      { id: 'challenge', label: 'Challenge a wild draw card', keys: ['KeyH'], pad: ['RT'] },
      { id: 'red', label: 'Pick red', keys: ['Digit1'], pad: [] },
      { id: 'yellow', label: 'Pick yellow', keys: ['Digit2'], pad: [] },
      { id: 'green', label: 'Pick green', keys: ['Digit3'], pad: [] },
      { id: 'blue', label: 'Pick blue', keys: ['Digit4'], pad: [] },
      { id: 'autolook', label: 'Toggle auto look', keys: ['KeyL'], pad: ['RS'] },
      { id: 'chat', label: 'Open chat', keys: ['KeyT'], pad: ['Back'] },
      { id: 'help', label: 'Show controls', keys: ['KeyI'], pad: ['Start'] },
    ],
  },
  {
    game: 'chess',
    label: 'Chess',
    actions: [
      { id: 'up', label: 'Move cursor up', keys: ['ArrowUp', 'KeyW'], pad: ['DPadUp'] },
      { id: 'down', label: 'Move cursor down', keys: ['ArrowDown', 'KeyS'], pad: ['DPadDown'] },
      { id: 'left', label: 'Move cursor left', keys: ['ArrowLeft', 'KeyA'], pad: ['DPadLeft'] },
      { id: 'right', label: 'Move cursor right', keys: ['ArrowRight', 'KeyD'], pad: ['DPadRight'] },
      { id: 'select', label: 'Pick up / drop a piece', keys: ['Enter', 'Space'], pad: ['A'] },
      { id: 'cancel', label: 'Put the piece back', keys: ['Escape'], pad: ['B'] },
      { id: 'takeback', label: 'Takeback', keys: ['KeyZ'], pad: ['Y'] },
      { id: 'draw', label: 'Offer a draw', keys: [], pad: [] },
      { id: 'resign', label: 'Resign', keys: [], pad: ['Back'] },
      { id: 'chat', label: 'Open chat', keys: ['KeyT'], pad: [] },
    ],
  },
  {
    game: 'snake',
    label: 'Snake',
    actions: [
      { id: 'up', label: 'Up', keys: ['ArrowUp', 'KeyW'], pad: ['DPadUp'] },
      { id: 'down', label: 'Down', keys: ['ArrowDown', 'KeyS'], pad: ['DPadDown'] },
      { id: 'left', label: 'Left', keys: ['ArrowLeft', 'KeyA'], pad: ['DPadLeft'] },
      { id: 'right', label: 'Right', keys: ['ArrowRight', 'KeyD'], pad: ['DPadRight'] },
      { id: 'boost', label: 'Boost (costs 1 length)', keys: ['ShiftLeft', 'ShiftRight', 'KeyE'], pad: ['A'] },
      { id: 'pause', label: 'Pause / resume', keys: ['Space', 'KeyP'], pad: ['Start'] },
      { id: 'chat', label: 'Open chat', keys: ['KeyT'], pad: [] },
    ],
  },
  {
    game: 'mines',
    label: 'Minesweeper',
    actions: [
      { id: 'up', label: 'Walk up', keys: ['ArrowUp', 'KeyW'], pad: ['DPadUp'] },
      { id: 'down', label: 'Walk down', keys: ['ArrowDown', 'KeyS'], pad: ['DPadDown'] },
      { id: 'left', label: 'Walk left', keys: ['ArrowLeft', 'KeyA'], pad: ['DPadLeft'] },
      { id: 'right', label: 'Walk right', keys: ['ArrowRight', 'KeyD'], pad: ['DPadRight'] },
      { id: 'dig', label: 'Dig the tile you’re on', keys: ['Space', 'KeyJ', 'Enter'], pad: ['A'] },
      { id: 'flag', label: 'Flag / unflag the tile you’re on', keys: ['KeyF', 'KeyK'], pad: ['X'] },
      { id: 'run', label: 'Run (hold, with the Running rule on)', keys: ['ShiftLeft', 'ShiftRight'], pad: ['RB'] },
      { id: 'chat', label: 'Open chat', keys: ['KeyT'], pad: ['Back'] },
    ],
  },
];

// Every controller button a binding can use, in the order Settings lists them.
export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'DPadUp', 'DPadDown', 'DPadLeft', 'DPadRight'];

const PAD_LABELS = { DPadUp: 'D-pad ↑', DPadDown: 'D-pad ↓', DPadLeft: 'D-pad ←', DPadRight: 'D-pad →', LS: 'Left stick press', RS: 'Right stick press', Back: 'Back / Select', Start: 'Start / Menu' };
const KEY_LABELS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', Tab: 'Tab' };

export function keyLabel(code) {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

export const padLabel = (button) => PAD_LABELS[button] ?? button;

// Keys a binding may not take: they belong to the browser or the site.
export const RESERVED_KEYS = new Set(['Tab', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight']);

const actionsOf = (game) => GAME_CONTROLS.find((g) => g.game === game)?.actions ?? [];

class Keybinds {
  // { [game]: { [action]: { keys?: [], pad?: [] } } }: only what differs from the defaults.
  @tracked overrides = {};

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved && typeof saved === 'object') this.overrides = saved;
    } catch {
      // nothing saved, or storage blocked
    }
  }

  persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.overrides));
    } catch {
      // storage blocked: lasts for this visit
    }
  }

  binding(game, action, kind) {
    const saved = this.overrides[game]?.[action]?.[kind];
    if (Array.isArray(saved)) return saved;
    return actionsOf(game).find((a) => a.id === action)?.[kind] ?? [];
  }

  keys(game, action) {
    return this.binding(game, action, 'keys');
  }

  pad(game, action) {
    return this.binding(game, action, 'pad');
  }

  set(game, action, kind, list) {
    const unique = [...new Set(list)].slice(0, 3);
    const gameOverrides = { ...this.overrides[game], [action]: { ...this.overrides[game]?.[action], [kind]: unique } };
    this.overrides = { ...this.overrides, [game]: gameOverrides };
    this.persist();
  }

  // A key or button can only do one thing per game: taking it for one action frees it from the others.
  assign(game, action, kind, value) {
    for (const other of actionsOf(game)) {
      if (other.id === action) continue;
      const list = this.binding(game, other.id, kind);
      if (list.includes(value)) this.set(game, other.id, kind, list.filter((v) => v !== value));
    }
    const current = this.binding(game, action, kind);
    this.set(game, action, kind, [...current.filter((v) => v !== value), value]);
  }

  unassign(game, action, kind, value) {
    this.set(game, action, kind, this.binding(game, action, kind).filter((v) => v !== value));
  }

  reset(game) {
    const next = { ...this.overrides };
    delete next[game];
    this.overrides = next;
    this.persist();
  }

  isCustomised(game) {
    return Boolean(this.overrides[game]) && Object.keys(this.overrides[game]).length > 0;
  }
}

export const keybinds = new Keybinds();

export function actionForKey(game, event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return actionsOf(game).find((a) => keybinds.keys(game, a.id).includes(event.code))?.id ?? null;
}

export function actionForPad(game, button) {
  return actionsOf(game).find((a) => keybinds.pad(game, a.id).includes(button))?.id ?? null;
}

// Whether a key press is someone typing, which game keys should leave alone.
export function isTyping(event) {
  const target = event.target;
  return Boolean(target?.closest?.('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]'));
}

// Readable summary of an action's keys and buttons, for help panels.
export function bindingText(game, action) {
  const keys = keybinds.keys(game, action).map(keyLabel);
  const pad = keybinds.pad(game, action).map(padLabel);
  return [keys.join(' / '), pad.length ? pad.join(' / ') : ''].filter(Boolean).join('  ·  ') || 'Not bound';
}

// Keyboard keys and controller buttons for an action, kept apart so a help panel can show each with its own icon.
export function bindingParts(game, action) {
  return { keys: keybinds.keys(game, action).map(keyLabel).join(' / '), pad: keybinds.pad(game, action).map(padLabel).join(' / ') };
}

// Short reminders for an in-game controls panel: one key (or controller button) per action,
// never the full list. `groups` is [{ label, actions: [action ids] }]; a group of several
// actions (steering) shows the first key of each, or just "D-pad" on a controller.
export function controlHints(game, groups) {
  return groups
    .map(({ label, actions }) => {
      const keys = actions.map((id) => keybinds.keys(game, id)[0]).filter(Boolean).map(keyLabel);
      const buttons = actions.map((id) => keybinds.pad(game, id)[0]).filter(Boolean);
      const pad = buttons.length > 1 && buttons.every((b) => b.startsWith('DPad')) ? [{ id: 'dpad', label: 'D-pad' }] : [...new Set(buttons)].map((b) => ({ id: b.toLowerCase(), label: b.startsWith('DPad') ? padLabel(b) : b }));
      return { label, keys, pad };
    })
    .filter((hint) => hint.keys.length || hint.pad.length);
}
