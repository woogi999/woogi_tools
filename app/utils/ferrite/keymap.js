// Ferrite's keymap, ported from `ferrite-app/src/keymap.rs`.
//
// One table: every action the editor has, the key it is on, and the words the
// menus quote. Menus read this rather than carrying their own copies, so a
// rebound shortcut never leaves a menu advertising the key it used to be.
//
// The production actions (take, clear program, fullscreen output, the Live
// and Automate workspaces) are not here, because none of them is.

export const ACTIONS = [
  // Transport
  { id: 'play-pause', label: 'Play / pause', group: 'Transport', key: 'Space' },
  { id: 'stop', label: 'Stop', group: 'Transport', key: 'Ctrl+.' },
  { id: 'go-start', label: 'Go to start', group: 'Transport', key: 'Home' },
  { id: 'go-end', label: 'Go to end', group: 'Transport', key: 'End' },
  {
    id: 'step-forward',
    label: 'Step forward one frame',
    group: 'Transport',
    key: 'PageDown',
    alt: '.',
  },
  {
    id: 'step-back',
    label: 'Step back one frame',
    group: 'Transport',
    key: 'PageUp',
    alt: ',',
  },
  {
    id: 'step-forward-10',
    label: 'Step forward ten frames',
    group: 'Transport',
    key: 'Shift+PageDown',
  },
  {
    id: 'step-back-10',
    label: 'Step back ten frames',
    group: 'Transport',
    key: 'Shift+PageUp',
  },
  { id: 'next-key', label: 'Next keyframe', group: 'Transport', key: 'K' },
  { id: 'prev-key', label: 'Previous keyframe', group: 'Transport', key: 'J' },
  { id: 'go-in', label: 'Go to in marker', group: 'Transport', key: 'I' },
  { id: 'go-out', label: 'Go to out marker', group: 'Transport', key: 'O' },
  {
    id: 'set-in',
    label: 'Set in marker to playhead',
    group: 'Transport',
    key: 'B',
  },
  {
    id: 'set-out',
    label: 'Set out marker to playhead',
    group: 'Transport',
    key: 'N',
  },
  {
    id: 'add-marker',
    label: 'Add marker at playhead',
    group: 'Transport',
    key: 'M',
  },
  {
    id: 'toggle-loop',
    label: 'Toggle loop',
    group: 'Transport',
    key: 'Ctrl+L',
  },

  {
    id: 'scroll-left',
    label: 'Scroll timeline left',
    group: 'Timeline',
    key: 'Alt+ArrowLeft',
  },
  {
    id: 'scroll-right',
    label: 'Scroll timeline right',
    group: 'Timeline',
    key: 'Alt+ArrowRight',
  },
  {
    id: 'time-zoom-in',
    label: 'Zoom timeline in',
    group: 'Timeline',
    key: '+',
  },
  {
    id: 'time-zoom-out',
    label: 'Zoom timeline out',
    group: 'Timeline',
    key: '_',
  },
  {
    id: 'time-fit',
    label: 'Fit timeline to the scene',
    group: 'Timeline',
    key: 'Shift+0',
  },
  {
    id: 'time-zoom-selection',
    label: 'Zoom timeline to the selection',
    group: 'Timeline',
    key: 'Shift+9',
  },
  {
    id: 'next-marker',
    label: 'Next marker',
    group: 'Timeline',
    key: 'Shift+.',
  },
  {
    id: 'prev-marker',
    label: 'Previous marker',
    group: 'Timeline',
    key: 'Shift+,',
  },
  {
    id: 'split-at-playhead',
    label: 'Split at the playhead',
    group: 'Timeline',
    key: 'Ctrl+Shift+D',
  },
  {
    id: 'delete-keys',
    label: 'Delete selected keyframes',
    group: 'Timeline',
    key: 'Alt+Delete',
  },
  {
    id: 'ease-in-out',
    label: 'Ease selected keyframes',
    group: 'Timeline',
    key: 'F9',
  },
  {
    id: 'ease-linear',
    label: 'Make selected keyframes linear',
    group: 'Timeline',
    key: 'Ctrl+Alt+F9',
  },
  {
    id: 'ease-hold',
    label: 'Hold selected keyframes',
    group: 'Timeline',
    key: 'Ctrl+Alt+H',
  },

  // Tools
  { id: 'tool-select', label: 'Select tool', group: 'Tools', key: 'V' },
  { id: 'tool-hand', label: 'Hand tool', group: 'Tools', key: 'H' },
  { id: 'tool-rotate', label: 'Rotate tool', group: 'Tools', key: 'W' },
  { id: 'tool-anchor', label: 'Anchor point tool', group: 'Tools', key: 'Y' },

  // Reveal
  {
    id: 'reveal-position',
    label: 'Reveal position',
    group: 'Reveal',
    key: 'P',
  },
  { id: 'reveal-scale', label: 'Reveal scale', group: 'Reveal', key: 'S' },
  {
    id: 'reveal-rotation',
    label: 'Reveal rotation',
    group: 'Reveal',
    key: 'R',
  },
  { id: 'reveal-opacity', label: 'Reveal opacity', group: 'Reveal', key: 'T' },
  {
    id: 'reveal-anchor',
    label: 'Reveal anchor point',
    group: 'Reveal',
    key: 'A',
  },
  {
    id: 'reveal-animated',
    label: 'Reveal animated only',
    group: 'Reveal',
    key: 'U',
  },
  { id: 'reveal-effects', label: 'Reveal effects', group: 'Reveal', key: 'E' },
  {
    id: 'reveal-all',
    label: 'Reveal all properties',
    group: 'Reveal',
    key: 'Escape',
  },

  // Nudge
  { id: 'nudge-left', label: 'Nudge left', group: 'Nudge', key: 'ArrowLeft' },
  {
    id: 'nudge-right',
    label: 'Nudge right',
    group: 'Nudge',
    key: 'ArrowRight',
  },
  { id: 'nudge-up', label: 'Nudge up', group: 'Nudge', key: 'ArrowUp' },
  { id: 'nudge-down', label: 'Nudge down', group: 'Nudge', key: 'ArrowDown' },
  {
    id: 'nudge-left-10',
    label: 'Nudge left x10',
    group: 'Nudge',
    key: 'Shift+ArrowLeft',
  },
  {
    id: 'nudge-right-10',
    label: 'Nudge right x10',
    group: 'Nudge',
    key: 'Shift+ArrowRight',
  },
  {
    id: 'nudge-up-10',
    label: 'Nudge up x10',
    group: 'Nudge',
    key: 'Shift+ArrowUp',
  },
  {
    id: 'nudge-down-10',
    label: 'Nudge down x10',
    group: 'Nudge',
    key: 'Shift+ArrowDown',
  },

  // View
  { id: 'zoom-in', label: 'Zoom in', group: 'View', key: '=' },
  { id: 'zoom-out', label: 'Zoom out', group: 'View', key: '-' },
  { id: 'zoom-fit', label: 'Zoom to fit', group: 'View', key: 'Ctrl+0' },
  { id: 'zoom-actual', label: 'Zoom to 100%', group: 'View', key: 'Ctrl+1' },
  {
    id: 'toggle-safe',
    label: 'Toggle safe areas',
    group: 'View',
    key: "Ctrl+'",
  },
  {
    id: 'toggle-handles',
    label: 'Toggle selection handles',
    group: 'View',
    key: 'Ctrl+Shift+H',
  },
  {
    id: 'toggle-theme',
    label: 'Switch light / dark',
    group: 'View',
    key: 'Ctrl+Alt+T',
  },

  // Selection
  {
    id: 'select-all',
    label: 'Select all layers',
    group: 'Selection',
    key: 'Ctrl+A',
  },
  {
    id: 'deselect-all',
    label: 'Deselect all',
    group: 'Selection',
    key: 'Ctrl+Shift+A',
  },
  {
    id: 'delete-selected',
    label: 'Delete selection',
    group: 'Selection',
    key: 'Delete',
    alt: 'Backspace',
  },
  {
    id: 'duplicate-selected',
    label: 'Duplicate selection',
    group: 'Selection',
    key: 'Ctrl+D',
  },
  {
    id: 'centre-anchor',
    label: 'Centre anchor point',
    group: 'Selection',
    key: 'Ctrl+Alt+Home',
  },
  { id: 'align-h', label: 'Centre horizontally', group: 'Selection', key: '' },
  {
    id: 'align-v',
    label: 'Centre vertically',
    group: 'Selection',
    key: 'Ctrl+Alt+V',
  },
  {
    id: 'select-next',
    label: 'Select the layer below',
    group: 'Selection',
    key: 'Ctrl+ArrowDown',
  },
  {
    id: 'select-prev',
    label: 'Select the layer above',
    group: 'Selection',
    key: 'Ctrl+ArrowUp',
  },

  // Layers
  { id: 'new-box', label: 'New box layer', group: 'Layers', key: 'Ctrl+Alt+Y' },
  {
    id: 'new-text',
    label: 'New text layer',
    group: 'Layers',
    key: 'Ctrl+Alt+Shift+T',
  },
  {
    id: 'slide-in',
    label: 'Move layer start to playhead',
    group: 'Layers',
    key: '[',
  },
  {
    id: 'slide-out',
    label: 'Move layer end to playhead',
    group: 'Layers',
    key: ']',
  },
  {
    id: 'trim-in',
    label: 'Trim layer in to playhead',
    group: 'Layers',
    key: 'Alt+[',
  },
  {
    id: 'trim-out',
    label: 'Trim layer out to playhead',
    group: 'Layers',
    key: 'Alt+]',
  },
  {
    id: 'bring-forward',
    label: 'Bring forward',
    group: 'Layers',
    key: 'Ctrl+]',
  },
  {
    id: 'send-backward',
    label: 'Send backward',
    group: 'Layers',
    key: 'Ctrl+[',
  },
  {
    id: 'bring-front',
    label: 'Bring to front',
    group: 'Layers',
    key: 'Ctrl+Shift+]',
  },
  {
    id: 'send-back',
    label: 'Send to back',
    group: 'Layers',
    key: 'Ctrl+Shift+[',
  },
  {
    id: 'fit-to-scene',
    label: 'Fit to scene',
    group: 'Layers',
    key: 'Ctrl+Alt+F',
  },
  {
    id: 'centre-in-scene',
    label: 'Centre in scene',
    group: 'Layers',
    key: 'Ctrl+Home',
  },

  // Project
  { id: 'undo', label: 'Undo', group: 'Project', key: 'Ctrl+Z' },
  {
    id: 'redo',
    label: 'Redo',
    group: 'Project',
    key: 'Ctrl+Shift+Z',
    alt: 'Ctrl+Y',
  },
  { id: 'save', label: 'Save project', group: 'Project', key: 'Ctrl+S' },
  { id: 'open', label: 'Open project', group: 'Project', key: 'Ctrl+O' },
  {
    id: 'save-as',
    label: 'Save to disk',
    group: 'Project',
    key: 'Ctrl+Shift+S',
  },
  { id: 'render', label: 'Render', group: 'Project', key: 'Ctrl+M' },
  { id: 'home', label: 'Start page', group: 'Project', key: 'Ctrl+Alt+P' },
  { id: 'new-scene', label: 'New scene', group: 'Project', key: 'Ctrl+N' },
  {
    id: 'scene-settings',
    label: 'Scene properties',
    group: 'Project',
    key: 'Ctrl+K',
  },
  {
    id: 'fit-duration',
    label: 'Fit duration to keyframes',
    group: 'Project',
    key: '',
  },
  {
    id: 'open-settings',
    label: 'Keyboard shortcuts',
    group: 'Project',
    key: 'Ctrl+,',
  },
];

export const actionById = (id) => ACTIONS.find((a) => a.id === id);

// action id -> the key somebody chose instead of the default.
let overrides = {};

const STORE = 'woogi-tool:video-editor-keys';

export function loadBindings() {
  try {
    overrides = JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {};
  } catch {
    overrides = {};
  }
  return overrides;
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(overrides));
  } catch {
    // Storage blocked: the binding still works for this session.
  }
}

export const keyFor = (id) => overrides[id] ?? actionById(id)?.key ?? '';

// Whether this action is on something other than what it shipped with.
export const isRebound = (id) =>
  Object.prototype.hasOwnProperty.call(overrides, id);

/**
 * Puts `id` on `key`, taking it off whoever had it.
 *
 * Returns the action that lost it, so the settings list can say so rather than
 * letting a shortcut quietly stop working.
 */
export function rebind(id, key) {
  let displaced = null;
  for (const action of ACTIONS) {
    if (action.id === id) continue;
    if (keyFor(action.id) === key) {
      displaced = action;
      overrides[action.id] = '';
    }
  }
  overrides[id] = key;
  save();
  return displaced;
}

export function resetBindings() {
  overrides = {};
  save();
}

export const KEY_GROUPS = [...new Set(ACTIONS.map((a) => a.group))];

// The binding a key press matches, written the way the table writes it.
export function pressLabel(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  let key = event.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

// Which action a press means, or null. Shift is ignored for a plain character
// key with no exact binding, so a shifted `=` still zooms in.
const matches = (action, label) =>
  keyFor(action.id) === label ||
  (!isRebound(action.id) && action.alt === label);

export function actionFor(event) {
  const label = pressLabel(event);
  const exact = ACTIONS.find((a) => matches(a, label));
  if (exact) return exact;
  // Shift is ignored for a plain character key with no exact binding, so a
  // shifted `=` still zooms in.
  if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const without = label.replace('Shift+', '');
    return ACTIONS.find((a) => matches(a, without)) ?? null;
  }
  return null;
}
