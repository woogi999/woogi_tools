// Turns a progress bar's pictures into a Jujutsu Shenanigans Skill Builder
// skill that shows them.
//
// JJS skills are JSON: an array of skills, each with its program in DATA as
// a JSON string. Exported skill code is that array, compact, compressed with
// Zstandard and written as base64. The skill made here is a small state
// machine on one tag (default "Bar"):
//
//   start     set the tag to the starting step, go to branch "-"
//   "-"       for each step from the top down: if the tag equals it, go to
//             that step's branch; then loop back to "-"
//   "<step>"  show a billboard with that step's picture, wait, go to "-"
//
// Anything else that changes the tag (another skill, a hit, a timer) moves
// the bar. The field names, key order and values follow a skill exported
// from JJS itself.

import { compressBytes, decompressBytes } from './codec';

// JJS writes this as 1e38 ("for ever"); JSON.stringify would write 1e+38.
const FOREVER = '__FOREVER__';

function visual(texture, { size, position }) {
  return {
    SIZE: size,
    'RELATIVE FROM BRANCH': false,
    'CAN COLLIDE': false,
    OPACITY: 0,
    TEXTURE: texture,
    'ALT SIZE 2': '-1, -1, -1',
    'ALT COLOR': '255, 255, 255',
    COLOR: '255, 255, 255',
    'CANCEL ON INTERRUPT': false,
    AMOUNT: 1,
    'ALT ROTATION': '0, 0, 0',
    POSITION: position,
    'EASING DIRECTION': 'In',
    'ALT POSITION': '0, 0, 0',
    'EASING STYLE': 'Linear',
    'ALT SIZE': 1,
    TIME: 0.06,
    'BODY PART': 'HumanoidRootPart',
    'SIZE 2': '-1, -1, -1',
    'CLIENT SIDED': false,
    K_NAME: 'VISUAL',
    ROTATION: '0, 0, 0',
    'LAST HIT': -1,
    EFFECT: 'Billboard',
    'RUN ON SERVER': false,
    'ALT OPACITY': 0,
  };
}

const back = { 'LAST HIT': -1, BRANCH: '-', K_NAME: 'BRANCH' };

/**
 * The skill, as the object JJS exports.
 *
 * textures  one image ID per step, step 0 (empty) first
 * name      the skill's name in the builder
 * tag       the tag that holds the bar's step
 * key       the key code that uses the skill (99 is C)
 * start     'full' or 'empty': which step the bar starts on
 * size      the billboard's size
 * position  its offset from the body part, "x, y, z"
 */
export function buildSkill({
  textures,
  name = 'Bar',
  tag = 'Bar',
  key = 99,
  start = 'full',
  size = 2,
  position = '0, 0, 0',
}) {
  const top = textures.length - 1;
  const steps = textures.map((_, i) => String(i));
  const branches = {
    '-': {
      Line: [
        // Highest first, as JJS's own export has them.
        ...[...steps].reverse().map((step) => ({
          'ADD/REMOVE': false,
          TIME: 1,
          TAG: tag,
          SET: false,
          K_NAME: 'TAG',
          'LAST HIT': -1,
          BRANCH: step,
          VALUE: step,
          CHECK: true,
        })),
        back,
      ],
      Req: [],
    },
  };
  textures.forEach((texture, i) => {
    branches[String(i)] = {
      Line: [
        visual(Number(texture), { size, position }),
        { TIME: 0.05, K_NAME: 'WAIT' },
        back,
      ],
      Req: [],
    };
  });
  const data = {
    Req: [],
    Line: [
      {
        TAG: tag,
        K_NAME: 'TAG',
        TIME: FOREVER,
        VALUE: String(start === 'empty' ? 0 : top),
      },
      { BRANCH: '-', K_NAME: 'BRANCH' },
    ],
    Prop: { USE: true, AWK: true, NOSTUN: true, AWK2: true, NOCANCEL: true },
    Branch: branches,
  };
  return [
    {
      ADD: true,
      NAME: name,
      K_NAME: 'SKILL',
      KEY: key,
      'TOOL TIP': '',
      DATA: JSON.stringify(data).replace(`"${FOREVER}"`, '1e38'),
      COOLDOWN: 0,
    },
  ];
}

const toBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// The code to paste into JJS's Skill Builder.
export async function encodeSkill(skill) {
  const bytes = new TextEncoder().encode(JSON.stringify(skill));
  return toBase64(await compressBytes(bytes, 'zstd', 19));
}

// Skill code back to the skill, for checking a paste (and the tests).
export async function decodeSkill(code) {
  const bytes = Uint8Array.from(atob(code.replace(/\s+/g, '')), (c) =>
    c.charCodeAt(0),
  );
  return JSON.parse(
    new TextDecoder().decode(await decompressBytes(bytes, 'zstd')),
  );
}

// "123, 456\n789" → ['123', '456', '789']: IDs typed or pasted any way.
export const parseIds = (text) => String(text ?? '').match(/\d+/g) ?? [];

// A key as typed ("c", "C", "99") to the key code JJS stores.
export function keyCode(value) {
  const text = String(value ?? '').trim();
  if (/^\d+$/.test(text)) return Number(text);
  return text ? text[0].toLowerCase().charCodeAt(0) : 99;
}
