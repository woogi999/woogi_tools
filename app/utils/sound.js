import { tracked } from '@glimmer/tracking';

// One sound system for the whole site. The effects are real recordings from
// CC0 (public domain) packs, kept in public/sounds:
//
//   ui/       clicks, hovers, toggles, ticks, dialogs        (Interface Sounds, UI Audio)
//   cards/    shuffles, slides, places, fans                 (Casino Audio)
//   chess/    wooden taps and knocks                         (Impact Sounds)
//   snake/    plucks, drops and bumps                        (Interface/Impact Sounds)
//   jingles/  short win, lose, reverse and hit stingers      (Music Jingles)
//   keyboard/ mechanical key presses                         (Unicae Games Keyboard Soundpack #1, OpenGameArt)
//
// Everything from Kenney.nl except the keyboard.
//
// Names with several files pick a random take; every sound's pitch is nudged a
// little, so repeated sounds never sound copy-pasted.
// Files are fetched and decoded the first time they're needed, then kept.
//
//   sfx('cards.place')          play an effect
//   soundPrefs.muted / .volume  tracked, saved in localStorage
//
// Browsers only allow audio after a user gesture; sounds before that are skipped.

const PREFS_KEY = 'woogi-sound';
const MIN_GAP_MS = 35;
const BASE = '/sounds';

const takes = (folder, name, count) =>
  Array.from({ length: count }, (_, i) => `${folder}/${name}-${i + 1}.ogg`);
const one = (path) => [path];
// { files, gain, vary (pitch spread), rate }
const S = (files, gain = 1, vary = 0.04, rate = 1) => ({
  files,
  gain,
  vary,
  rate,
});

const CARD_PLACE = takes('cards', 'card-place', 4);
const CARD_SLIDE = takes('cards', 'card-slide', 6);
const CARD_SHOVE = takes('cards', 'card-shove', 4);
const CARD_FAN = takes('cards', 'card-fan', 2);

const SOUNDS = {
  // Site-wide interface. One fixed sound each (random takes sounded messy here), just nudged in pitch.
  'ui.click': S(one('ui/hover-1.ogg'), 0.5, 0.05),
  'ui.hover': S(one('ui/hover-2.ogg'), 0.2, 0.05),
  'ui.toggle': S(one('ui/toggle-1.ogg'), 0.5, 0.05),
  'ui.tick': S(one('ui/tick-1.ogg'), 0.25, 0.05),
  // Typing: thocky mechanical key presses, played a little lower for a deeper sound.
  'ui.type': S(
    takes('keyboard', 'key', 8).map((f) => f.replace('.ogg', '.wav')),
    0.55,
    0.05,
    0.82,
  ),
  'ui.open': S(one('ui/open.ogg'), 0.45),
  'ui.close': S(one('ui/close.ogg'), 0.45),
  'ui.hold': S(one('ui/select.ogg'), 0.4),
  'ui.confirm': S(one('ui/confirm.ogg'), 0.5, 0),
  'ui.error': S(one('ui/error.ogg'), 0.45, 0),
  'ui.join': S(one('ui/join.ogg'), 0.45, 0),
  'ui.leave': S(one('ui/leave.ogg'), 0.45, 0),
  'ui.chat': S(one('ui/chat.ogg'), 0.45),
  'ui.shutter': S(one('ui/scroll.ogg'), 0.6, 0),
  'ui.select': S(one('ui/select.ogg'), 0.45),
  // Cards on the home page.
  'cards.hover': S(CARD_SLIDE, 0.22, 0.08, 1.15),
  'cards.place': S(CARD_PLACE, 0.7),
  'cards.fan': S(CARD_FAN, 0.55),
  'cards.shuffle': S(one('cards/card-shuffle.ogg'), 0.7, 0.03),

  // Chess: clean wooden taps.
  'chess.move': S(takes('chess', 'move', 5), 0.8),
  'chess.capture': S(takes('chess', 'capture', 5), 0.85),
  'chess.castle': S(takes('chess', 'move', 5), 0.8),
  'chess.check': S(one('chess/check.ogg'), 0.55, 0.02),
  'chess.promote': S(one('ui/confirm.ogg'), 0.5, 0),
  'chess.illegal': S(one('chess/illegal.ogg'), 0.45, 0.03),
  'chess.start': S(one('jingles/start.ogg'), 0.35, 0),
  'chess.tick': S(one('ui/tick-1.ogg'), 0.35, 0.03),
  'chess.win': S(one('jingles/chess-win.ogg'), 0.45, 0),
  'chess.lose': S(one('jingles/chess-lose.ogg'), 0.45, 0),
  'chess.draw': S(one('jingles/chess-draw.ogg'), 0.45, 0),

  // Snake: playful plucks and bumps.
  'snake.eat': S(takes('snake', 'eat', 3), 0.6, 0.1),
  'snake.turn': S(one('snake/turn.ogg'), 0.15, 0.12),
  'snake.die': S(one('snake/die.ogg'), 0.7),
  'snake.crash': S(one('snake/crash.ogg'), 0.5, 0.08),
  'snake.start': S(one('jingles/start.ogg'), 0.4, 0),
  'snake.win': S(one('jingles/snake-win.ogg'), 0.45, 0),
  'snake.lose': S(one('jingles/snake-lose.ogg'), 0.45, 0),
  'snake.pause': S(one('snake/pause.ogg'), 0.45, 0),
  'snake.boost': S(takes('cards', 'card-shove', 4), 0.55, 0.1, 1.3),
  'snake.whoosh': S(CARD_FAN, 0.75, 0.06, 0.65),
  'snake.boostEnd': S(CARD_SLIDE, 0.3, 0.08, 0.8),
  'snake.thud': S(one('cards/land.ogg'), 0.6, 0.1, 0.9),

  // Minesweeper: digs, flags and bangs.
  'mines.dig': S(takes('snake', 'eat', 3), 0.5, 0.12, 0.8),
  'mines.clear': S(one('cards/card-shuffle.ogg'), 0.45, 0.05, 1.3),
  'mines.flag': S(takes('cards', 'card-place', 4), 0.6, 0.08),
  'mines.boom': S(one('cards/slam.ogg'), 0.9, 0.05, 0.7),
  'mines.land': S(one('cards/land.ogg'), 0.6, 0.1),
  'mines.step': S(CARD_SLIDE, 0.12, 0.15, 1.6),
  'mines.stun': S(one('snake/die.ogg'), 0.45, 0.05, 1.2),
  'mines.start': S(one('jingles/start.ogg'), 0.4, 0),
  'mines.win': S(one('jingles/snake-win.ogg'), 0.45, 0),
  'mines.lose': S(one('jingles/snake-lose.ogg'), 0.45, 0),

  // Woono: real cards, punchy.
  // The deal: a short riffle (cut off after 0.9 s), then one flick per card as each flies out.
  'uno.deal': { ...S(one('cards/card-shuffle.ogg'), 0.8, 0.02), duration: 0.9 },
  'uno.dealCard': S(CARD_SLIDE, 0.32, 0.1, 1.2),
  // A card from the deck landing in a hand, and the thud when a big pile lands.
  'uno.receive': S(CARD_SLIDE, 0.5, 0.08),
  'uno.land': S(one('cards/land.ogg'), 0.55, 0.05),
  'uno.slam': S(one('cards/slam.ogg'), 0.6, 0.04),
  // Things done to you.
  'uno.skipped': S(one('jingles/woono-skipped.ogg'), 0.5, 0),
  'uno.plused': S(one('jingles/woono-plus.ogg'), 0.55, 0),
  'uno.play': S(CARD_PLACE, 0.85, 0.06),
  'uno.draw': S(CARD_SLIDE, 0.7, 0.06),
  'uno.keep': S(CARD_SHOVE, 0.55, 0.05),
  'uno.myturn': S(one('ui/select.ogg'), 0.4, 0),
  'uno.skip': S(CARD_SHOVE, 0.9, 0.04, 0.85),
  'uno.reverse': S(one('jingles/woono-reverse.ogg'), 0.5, 0),
  'uno.reverseCard': S(CARD_FAN, 0.7),
  'uno.attack': S(CARD_SHOVE, 1, 0.03, 0.8),
  'uno.hit': S(one('cards/cards-pack-take-out-1.ogg'), 0.75),
  'uno.wild': S(CARD_FAN, 0.9, 0.03, 1.1),
  'uno.color': S(one('ui/confirm.ogg'), 0.4, 0.03),
  'uno.uno': S(one('jingles/woono-uno.ogg'), 0.45, 0),
  'uno.callout': S(one('ui/error.ogg'), 0.55, 0),
  'uno.block': S(one('jingles/woono-block.ogg'), 0.55, 0),
  'uno.reflect': S(CARD_FAN, 0.9, 0.02, 1.25),
  'uno.swap': S(one('cards/cards-pack-open-1.ogg'), 0.8),
  'uno.rotate': S(one('cards/card-shuffle.ogg'), 0.6, 0.03, 1.2),
  'uno.challenge': S(one('chess/illegal.ogg'), 0.7, 0),
  'uno.timeout': S(one('ui/error.ogg'), 0.45, 0),
  'uno.tick': S(one('ui/tick-1.ogg'), 0.35, 0.03),
  'uno.win': S(one('jingles/woono-win.ogg'), 0.5, 0),
  'uno.lose': S(one('jingles/woono-lose.ogg'), 0.45, 0),
};

export const SOUND_NAMES = Object.keys(SOUNDS);

// Channels for the mixer in Settings: each sound belongs to one, and each has its own volume and mute.
export const SOUND_GROUPS = [
  {
    id: 'clicks',
    label: 'Clicks & toggles',
    hint: 'Buttons, switches, sliders and dialogs across the site.',
    icon: 'pointer',
    sample: 'ui.click',
  },
  {
    id: 'hover',
    label: 'Hover',
    hint: 'The soft tick when your mouse moves onto something.',
    icon: 'eye',
    sample: 'ui.hover',
  },
  {
    id: 'typing',
    label: 'Typing',
    hint: 'Keyboard thocks in search boxes and the typing test.',
    icon: 'type',
    sample: 'ui.type',
  },
  {
    id: 'cards',
    label: 'Home page cards',
    hint: 'Card slides and flicks on the home page.',
    icon: 'sticky-note',
    sample: 'cards.place',
  },
  {
    id: 'alerts',
    label: 'Alerts & chat',
    hint: 'Chat messages, people joining, your turn, ready checks and timer ticks.',
    icon: 'bell-ring',
    sample: 'ui.chat',
  },
  {
    id: 'chess',
    label: 'Chess',
    hint: 'Piece moves, captures and checks.',
    icon: 'crown',
    sample: 'chess.move',
  },
  {
    id: 'snake',
    label: 'Snake',
    hint: 'Eating, turning, boosting and crashing.',
    icon: 'dices',
    sample: 'snake.eat',
  },
  {
    id: 'mines',
    label: 'Minesweeper',
    hint: 'Digging, flagging and explosions.',
    icon: 'bomb',
    sample: 'mines.flag',
  },
  {
    id: 'woono',
    label: 'Woono',
    hint: 'Dealing, playing, drawing and every card effect.',
    icon: 'file-stack',
    sample: 'uno.play',
  },
  {
    id: 'music',
    label: 'Jingles',
    hint: 'Short music stings: wins, losses, reverses, skips and hits.',
    icon: 'music',
    sample: 'uno.reverse',
  },
];

const ALERTS = new Set([
  'ui.chat',
  'ui.join',
  'ui.leave',
  'uno.myturn',
  'uno.tick',
  'chess.tick',
]);

function groupOf(name, sound) {
  if (sound.files.some((f) => f.startsWith('jingles/'))) return 'music';
  if (ALERTS.has(name)) return 'alerts';
  if (name === 'ui.hover' || name === 'cards.hover') return 'hover';
  if (name === 'ui.type') return 'typing';
  if (name.startsWith('ui.')) return 'clicks';
  if (name.startsWith('cards.')) return 'cards';
  if (name.startsWith('chess.')) return 'chess';
  if (name.startsWith('snake.')) return 'snake';
  if (name.startsWith('mines.')) return 'mines';
  return 'woono';
}

for (const [name, sound] of Object.entries(SOUNDS))
  sound.group = groupOf(name, sound);

const GROUP_IDS = SOUND_GROUPS.map((g) => g.id);
const defaultGroups = () =>
  Object.fromEntries(GROUP_IDS.map((id) => [id, { volume: 1, muted: false }]));

let ctx = null;
let master = null;
const buffers = new Map(); // path -> Promise<AudioBuffer | null>
const lastPlayed = new Map();

class SoundPrefs {
  @tracked muted = false;
  @tracked volume = 0.6;
  // { [group id]: { volume 0..1, muted } }
  @tracked groups = defaultGroups();

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY));
      if (saved) {
        this.muted = Boolean(saved.muted);
        if (Number.isFinite(saved.volume))
          this.volume = Math.max(0, Math.min(1, saved.volume));
        const groups = defaultGroups();
        for (const id of GROUP_IDS) {
          const g = saved.groups?.[id];
          if (!g) continue;
          groups[id] = {
            volume: Number.isFinite(g.volume)
              ? Math.max(0, Math.min(1, g.volume))
              : 1,
            muted: Boolean(g.muted),
          };
        }
        this.groups = groups;
      }
    } catch {
      // nothing saved, or storage blocked
    }
  }

  group(id) {
    return this.groups[id] ?? { volume: 1, muted: false };
  }

  // A channel's own multiplier (on top of the master volume), with the same perceptual curve.
  groupLevel(id) {
    const g = this.group(id);
    return g.muted ? 0 : g.volume * g.volume;
  }

  setGroupVolume(id, volume) {
    if (!GROUP_IDS.includes(id)) return;
    const value = Math.max(0, Math.min(1, Number(volume) || 0));
    this.groups = {
      ...this.groups,
      [id]: { volume: value, muted: value > 0 ? false : this.group(id).muted },
    };
    this.persist();
  }

  toggleGroupMuted(id) {
    if (!GROUP_IDS.includes(id)) return;
    const g = this.group(id);
    this.groups = { ...this.groups, [id]: { ...g, muted: !g.muted } };
    this.persist();
  }

  resetGroups() {
    this.groups = defaultGroups();
    this.persist();
  }

  get customised() {
    return GROUP_IDS.some(
      (id) => this.group(id).muted || this.group(id).volume !== 1,
    );
  }

  persist() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          muted: this.muted,
          volume: this.volume,
          groups: this.groups,
        }),
      );
    } catch {
      // storage blocked: lasts for this visit
    }
    if (master) master.gain.value = this.level;
  }

  get level() {
    return this.muted ? 0 : this.volume * this.volume; // perceptual curve
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.persist();
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    if (!this.muted) sfx('ui.toggle');
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    if (this.volume > 0 && this.muted) this.muted = false;
    this.persist();
  }
}

export const soundPrefs = new SoundPrefs();

function audio() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  master = ctx.createGain();
  master.gain.value = soundPrefs.level;
  master.connect(ctx.destination);
  return ctx;
}

function load(path) {
  if (!buffers.has(path)) {
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- static audio files, not app data
    const promise = fetch(`${BASE}/${path}`)
      .then((response) =>
        response.ok
          ? response.arrayBuffer()
          : Promise.reject(new Error(String(response.status))),
      )
      .then(
        (data) =>
          new Promise((resolve, reject) =>
            ctx.decodeAudioData(data, resolve, reject),
          ),
      )
      .catch(() => null);
    buffers.set(path, promise);
  }
  return buffers.get(path);
}

// Starts fetching a group's files ahead of time ('uno', 'chess'…), so the first play isn't late.
export function preloadSounds(prefix) {
  if (!unlocked || !audio()) return;
  for (const [name, sound] of Object.entries(SOUNDS))
    if (name.startsWith(`${prefix}.`)) sound.files.forEach(load);
}

// The browser unlocks audio on the first real gesture; set up then.
let unlocked = false;
function unlock() {
  if (unlocked) return;
  unlocked = true;
  audio()
    ?.resume?.()
    .catch(() => {});
  preloadSounds('ui');
  preloadSounds('cards');
}
if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown', 'touchstart'])
    window.addEventListener(type, unlock, {
      once: true,
      capture: true,
      passive: true,
    });
}

export function sfx(name, { force = false } = {}) {
  if (soundPrefs.muted || soundPrefs.volume <= 0 || !unlocked) return;
  const sound = SOUNDS[name];
  if (!sound) return;
  // `force` plays a muted channel's sample anyway (the mixer's preview button).
  const channel = force
    ? Math.max(soundPrefs.groupLevel(sound.group), 0.25)
    : soundPrefs.groupLevel(sound.group);
  if (channel <= 0) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? 0) < MIN_GAP_MS) return;
  lastPlayed.set(name, now);
  const context = audio();
  if (!context) return;
  if (context.state === 'suspended') context.resume().catch(() => {});
  const path = sound.files[Math.floor(Math.random() * sound.files.length)];
  load(path).then((buffer) => {
    // A slow first load: skip rather than play out of step with what happened.
    if (!buffer || performance.now() - now > 600) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value =
      sound.rate * (1 + (Math.random() * 2 - 1) * sound.vary);
    const gain = context.createGain();
    const level = sound.gain * channel;
    gain.gain.value = level;
    source.connect(gain).connect(master);
    master.gain.value = soundPrefs.level;
    source.start();
    // Long recordings cut short (with a quick fade) when only the start is wanted.
    if (sound.duration) {
      const end = context.currentTime + sound.duration;
      gain.gain.setValueAtTime(level, end - 0.15);
      gain.gain.linearRampToValueAtTime(0, end);
      source.stop(end + 0.02);
    }
  });
}
