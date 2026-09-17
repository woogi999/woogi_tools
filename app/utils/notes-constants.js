// Preset font choices deliberately stick to what the site already loads
// (Moderustic, Inconsolata) plus safe system fallbacks, so picking one never
// triggers a network fetch. A note can also carry its own uploaded font,
// which lives on the note as `customFont` and is registered at runtime.
export const NOTE_FONTS = [
  { key: 'sans', label: 'Sans', stack: "'Moderustic', sans-serif" },
  { key: 'serif', label: 'Serif', stack: "Georgia, 'Times New Roman', serif" },
  {
    key: 'mono',
    label: 'Mono',
    stack: "'Inconsolata', ui-monospace, monospace",
  },
  {
    key: 'round',
    label: 'Round',
    stack: "'Comic Sans MS', 'Comic Sans', cursive",
  },
];

// Quick preset swatches for the sticky-note colour, plus a default paper tone.
export const NOTE_COLORS = [
  '#FFF3B0',
  '#FFD1DC',
  '#C7F0DB',
  '#CFE3FF',
  '#E5D4FF',
  '#FFDDBB',
];
export const DEFAULT_NOTE_COLOR = NOTE_COLORS[0];

export const STICKER_EMOJIS = [
  '😀',
  '😂',
  '😍',
  '🥳',
  '😎',
  '🤔',
  '😴',
  '🙌',
  '👍',
  '👏',
  '🔥',
  '✨',
  '💡',
  '⭐',
  '❤️',
  '💯',
  '🎉',
  '🎈',
  '🍕',
  '☕',
  '🌈',
  '🌙',
  '☀️',
  '🐱',
  '🐶',
  '🌸',
  '🍀',
  '⚡',
  '📌',
  '✅',
  '❌',
  '🚀',
];
