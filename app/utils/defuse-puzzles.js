// Defuse puzzles for Minesweeper's Defusing rule. Built from a seed, so the
// host only has to send a number; `level` is how many mines the player has
// already defused, and every puzzle gets harder with it.
//
//   wires:    cut the right wire (more wires, and trickier instructions, as you go)
//   code:     punch in the code on the keypad (longer, and hidden after a look)
//   sequence: tap the arrows in order (longer, and backwards later on)
//   timing:   stop the needle in the green zone (narrower, faster, more times)

export const WIRE_COLORS = [
  { id: 'red', hex: '#e5484d' },
  { id: 'blue', hex: '#3e7be0' },
  { id: 'yellow', hex: '#f2b90d' },
  { id: 'green', hex: '#3fae4f' },
  { id: 'white', hex: '#f4f4f4' },
  { id: 'black', hex: '#2b2b2b' },
];
export const ARROWS = ['up', 'right', 'down', 'left'];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export const PUZZLE_TYPES = ['wires', 'code', 'sequence', 'timing'];

// `forced` picks the puzzle type instead of the seed (debug).
export function makePuzzle(seed, level = 0, forced = null) {
  const rand = seeded(seed);
  const int = (n) => Math.floor(rand() * n);
  const pick = (list) => list[int(list.length)];
  const types =
    level <= 0
      ? ['wires', 'code']
      : level === 1
        ? ['wires', 'code', 'sequence']
        : PUZZLE_TYPES;
  const rolled = pick(types);
  const type = PUZZLE_TYPES.includes(forced) ? forced : rolled;

  if (type === 'wires') {
    const count = Math.min(6, 3 + level);
    const palette = WIRE_COLORS.slice(
      0,
      Math.min(WIRE_COLORS.length, 3 + Math.ceil(level / 2)),
    );
    const wires = Array.from({ length: count }, () => pick(palette));
    const indexesOf = (colour) =>
      wires.map((w, i) => (w.id === colour ? i : -1)).filter((i) => i >= 0);
    let text;
    let answer;
    if (level <= 0) {
      // One wire of a colour nobody else has.
      const i = int(count);
      const unique =
        palette.find((c) => !wires.some((w, k) => k !== i && w.id === c.id)) ??
        wires[i];
      wires[i] = unique;
      text = `Cut the ${unique.id} wire.`;
      answer = i;
    } else if (level <= 2) {
      const colour = pick(wires).id;
      const spots = indexesOf(colour);
      const last = rand() < 0.5;
      text = `Cut the ${last ? 'last' : 'first'} ${colour} wire.`;
      answer = last ? spots[spots.length - 1] : spots[0];
    } else {
      // A rule to read: if there's more than one of a colour, cut the last of them; otherwise cut a wire by position.
      const colour = pick(palette).id;
      const spots = indexesOf(colour);
      const fallback = int(count);
      text = `More than one ${colour} wire? Cut the last ${colour} one. Otherwise, cut the ${ORDINALS[fallback]} wire.`;
      answer = spots.length > 1 ? spots[spots.length - 1] : fallback;
    }
    return { type, level, text, wires: wires.map((w) => ({ ...w })), answer };
  }

  if (type === 'code') {
    const length = Math.min(6, 3 + level);
    const digits = Array.from({ length }, () => 1 + int(9));
    const hideAfter = level >= 2 ? Math.max(900, 2600 - level * 300) : null;
    return {
      type,
      level,
      text: hideAfter
        ? 'Memorise the code, then punch it in.'
        : 'Punch in the code.',
      digits,
      hideAfter,
    };
  }

  if (type === 'sequence') {
    const length = Math.min(8, 3 + level);
    const arrows = Array.from({ length }, () => pick(ARROWS));
    const backwards = level >= 4 && rand() < 0.5;
    return {
      type,
      level,
      text: backwards
        ? 'Enter the arrows backwards, last one first.'
        : 'Enter the arrows in order.',
      arrows,
      answer: backwards ? [...arrows].reverse() : arrows,
      backwards,
    };
  }

  const hits = Math.min(3, 1 + Math.floor(level / 3));
  const width = Math.max(0.09, 0.28 - level * 0.035);
  const zones = Array.from({ length: hits }, () => {
    const start = 0.05 + rand() * (0.9 - width);
    return [start, start + width];
  });
  return {
    type: 'timing',
    level,
    text:
      hits > 1
        ? `Stop the needle in the green zone ${hits} times.`
        : 'Stop the needle in the green zone.',
    zones,
    speed: 0.7 + level * 0.18,
  };
}
