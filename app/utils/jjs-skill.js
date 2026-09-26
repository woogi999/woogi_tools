// Turns a progress bar's pictures into a Jujutsu Shenanigans Skill Builder
// skill that shows them.
//
// JJS skills are JSON: an array of skills, each with its program in DATA as
// a JSON string. Exported skill code is that array, compact, compressed with
// Zstandard and written as base64. The skill made here is a small state
// machine on one tag (default "Bar"), in one of two styles.
//
// Complex (the default, and lag-proof): each step's billboard is shown once,
// for ever, under a VISUAL TAG of its own ("Bar0", "Bar1"…), and the others
// are taken off by Cancel effects with their tags. Then the step waits in a
// LOOP of its own, checking for any other step (and the rails), so nothing is
// drawn again until the tag actually changes:
//
//   start     set the tag to the starting step, go to branch "-"
//   "-"       for each step from the top down: if the tag equals it, go there
//   "<step>"  show this step (tag "BarN") for ever; Cancel the rails' own
//             billboards ("BarLesser", "BarGreater") and every other step;
//             >Checks: the other steps; >Safety Rails; WAIT; LOOP back to
//             >Checks for ever (back over the checks, the two comments and
//             the wait: the other steps + 2 rails + 3)
//
// Legacy (the first version): each step shows its billboard for a moment and
// goes back to "-", which checks again and shows it again, for ever:
//
//   "-"       for each step from the top down: if the tag equals it, go to
//             that step's branch; then loop back to "-"
//   "<step>"  show a billboard with that step's picture, wait, go to "-"
//
// Anything else that changes the tag (another skill, a hit, a timer) moves
// the bar. The field names, key order and values follow a skill exported
// from JJS itself.

import { compressBytes, decompressBytes } from './codec';
import { vec3 } from './skillbuilder/schema';

// JJS writes this as 1e38 ("for ever"); JSON.stringify would write 1e+38.
const FOREVER = '__FOREVER__';

// A Billboard is placed pseudo-2D, on the screen around the body part:
// x across (negative is to the right), y up and down, z its layer (negative
// in front of the character, positive behind). Its y only sticks if ALT
// POSITION holds minus twice that y (confirmed by the site's owner in JJS):
// POSITION "0, 4, 0" wants ALT POSITION "0, -8, 0".
export function billboardAlt(position) {
  const [, y] = vec3(position);
  return `0, ${y ? -2 * y : 0}, 0`;
}

function visual(
  texture,
  { size, position, time, clientSided, effect = 'Billboard', visualTag },
) {
  const node = {
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
    'ALT POSITION': billboardAlt(position),
    'EASING STYLE': 'Linear',
    'ALT SIZE': 1,
    TIME: time,
    'BODY PART': 'HumanoidRootPart',
    'SIZE 2': '-1, -1, -1',
    'CLIENT SIDED': clientSided,
    K_NAME: 'VISUAL',
    ROTATION: '0, 0, 0',
    'LAST HIT': -1,
    EFFECT: effect,
    'RUN ON SERVER': false,
    'ALT OPACITY': 0,
  };
  if (visualTag) node['VISUAL TAG'] = visualTag;
  return node;
}

// A jump to another branch.
const branch = (name) => ({ 'LAST HIT': -1, BRANCH: name, K_NAME: 'BRANCH' });

const back = { 'LAST HIT': -1, BRANCH: '-', K_NAME: 'BRANCH' };

// A TAG node that checks the bar's tag and branches when it matches.
const check = (tag, value, branch) => ({
  'ADD/REMOVE': false,
  TIME: 1,
  TAG: tag,
  SET: false,
  K_NAME: 'TAG',
  'LAST HIT': -1,
  BRANCH: branch,
  VALUE: value,
  CHECK: true,
});

// A TAG node that replaces the tag's value: with TIME 0 it clears it, with
// FOREVER it sets it for good.
const set = (tag, value, time) => ({
  'ADD/REMOVE': true,
  TIME: time,
  TAG: tag,
  CHECK: false,
  K_NAME: 'TAG',
  'LAST HIT': -1,
  VALUE: value,
  SET: true,
});

// A skill as JJS stores it, with its program serialised into DATA.
const skillOf = (name, key, data) => ({
  ADD: true,
  NAME: name,
  K_NAME: 'SKILL',
  KEY: key,
  'TOOL TIP': '',
  DATA: JSON.stringify(data).replaceAll(`"${FOREVER}"`, '1e38'),
  COOLDOWN: 0,
});

// A branch that doesn't exist does nothing when taken, so a BRANCH node to a
// name like this is a comment in the Skill Builder.
const comment = (text) => ({
  'LAST HIT': -1,
  BRANCH: `>${text}`,
  K_NAME: 'BRANCH',
});

// Adds `value` (a signed number) to the tag once.
const nudge = (tag, value) => ({
  TAG: tag,
  VALUE: value,
  K_NAME: 'TAG',
  TIME: FOREVER,
  SET: false,
});

/**
 * The skills, as the array JJS exports: the bar itself, then the helpers.
 *
 * textures     one image ID per step, step 0 (empty) first
 * name         the bar skill's name; the helpers are named after it
 * tag          the tag that holds the bar's step
 * start        'full' or 'empty': which step the bar starts on
 * size         the billboard's size
 * position     its offset from the body part, "x, y, z"
 * style        'complex' (each step shown once, for ever, and cancelled by
 *              its VISUAL TAG) or 'legacy' (shown again and again)
 * checkEvery   complex: the wait between checks of the tag, in seconds
 * showFor      legacy: how long each billboard is shown for, in seconds
 * waitFor      legacy: the wait before the tag is checked again, in seconds
 * clientSided  show the pictures only on the player's own screen (JJS's
 *              CLIENT SIDED, not RUN ON SERVER): others don't see the bar
 * rails        keep the tag between 0 and the top step: anything that
 *              pushes it past either end is put back at that end
 * regen        { amount, every }: add `amount` to the tag every `every`
 *              seconds, in a passive skill of its own; null for none
 *
 * Two debug skills always come last: key 1 adds one step, key 2 takes one
 * away, for trying the bar out in the builder.
 */
export function buildSkill({
  textures,
  name = 'Bar',
  tag = 'Bar',
  start = 'full',
  size = 2,
  position = '0, 0, 0',
  style = 'complex',
  checkEvery = 0.05,
  showFor = 0.12,
  waitFor = 0.1,
  rails = true,
  clientSided = false,
  regen = { amount: 1, every: 1 },
}) {
  const top = textures.length - 1;
  const steps = textures.map((_, i) => String(i));
  const billboard = (texture) =>
    visual(Number(texture), { size, position, time: showFor, clientSided });
  const dispatch = [
    // Highest first, as JJS's own export has them.
    ...[...steps].reverse().map((step) => check(tag, step, step)),
  ];
  if (rails)
    dispatch.push(
      comment('Safety Rails'),
      check(tag, '<0', 'SafetyLesser'),
      check(tag, `>${top}`, 'SafetyGreater'),
    );
  dispatch.push(back);
  const branches = { '-': { Line: dispatch, Req: [] } };
  if (style === 'complex') {
    Object.assign(
      branches,
      complexSteps({
        textures,
        tag,
        rails,
        checkEvery,
        show: { size, position, clientSided },
      }),
    );
    return withHelpers(name, tag, start, top, branches, regen);
  }
  textures.forEach((texture, i) => {
    branches[String(i)] = {
      Line: [billboard(texture), { TIME: waitFor, K_NAME: 'WAIT' }, back],
      Req: [],
    };
  });
  // Past an end: show the end it's going back to, clear the tag and set it
  // to that end for good.
  const clamp = (texture, value) => ({
    Line: [
      billboard(texture),
      set(tag, value, 0),
      set(tag, value, FOREVER),
      { TIME: waitFor, K_NAME: 'WAIT' },
      back,
    ],
    Req: [],
  });
  if (rails) {
    branches.SafetyLesser = clamp(textures[0], '0');
    branches.SafetyGreater = clamp(textures[top], String(top));
  }
  return withHelpers(name, tag, start, top, branches, regen);
}

// A step's billboard, shown for good, and its own tag to cancel it by.
const stepTag = (tag, i) => `${tag}${i}`;

function complexSteps({ textures, tag, rails, checkEvery, show }) {
  const top = textures.length - 1;
  const steps = textures.map((_, k) => k);
  const branches = {};
  // The rails' own billboards, cancelled by every step.
  const lesser = `${tag}Lesser`;
  const greater = `${tag}Greater`;
  const shown = (texture, visualTag) =>
    visual(texture, { ...show, time: FOREVER, visualTag });
  const cancel = (texture, visualTag) =>
    visual(texture, { ...show, time: FOREVER, effect: 'Cancel', visualTag });
  const reset = (step) => [
    set(tag, String(step), 0),
    set(tag, String(step), FOREVER),
  ];

  // The loop every step and rail ends on: check for any other step (not
  // `step`, the one on show) and the rails, wait, and go back to >Checks for
  // ever. `over` and `under` are where a push past an end goes.
  const waitInLoop = (
    step,
    { under = 'SafetyLesser', over = 'SafetyGreater' } = {},
  ) => {
    const tail = [comment('Checks')];
    // Highest first, as the dispatcher has them.
    for (const k of [...steps].reverse())
      if (k !== step) tail.push(check(tag, String(k), String(k)));
    if (rails)
      tail.push(
        comment('Safety Rails'),
        check(tag, '<0', under),
        check(tag, `>${top}`, over),
      );
    tail.push({ TIME: checkEvery, K_NAME: 'WAIT' });
    return [
      ...tail,
      {
        'LOOP BACK': tail.length,
        HOLD: false,
        'LOOP AMOUNT': FOREVER,
        K_NAME: 'LOOP',
      },
    ];
  };

  for (const i of steps) {
    const texture = Number(textures[i]);
    branches[String(i)] = {
      Line: [
        shown(texture, stepTag(tag, i)),
        ...(rails ? [cancel(texture, lesser), cancel(texture, greater)] : []),
        ...steps
          .filter((k) => k !== i)
          .map((k) => cancel(texture, stepTag(tag, k))),
        ...waitInLoop(i),
      ],
      Req: [],
    };
  }

  if (rails) {
    // Past an end: that end's picture, once, under the rail's own tag, with
    // every step taken off; then on to the rail's Hold. The Hold puts the tag
    // back to that end and waits, and a push past the same end again comes
    // back to the Hold, not the rail: it's clamped again without drawing
    // another billboard over the first, which would pile up and thicken.
    const rail = (name, visualTag, step, loop) => {
      const texture = Number(textures[step]);
      branches[name] = {
        Line: [
          shown(texture, visualTag),
          ...steps.map((k) => cancel(texture, stepTag(tag, k))),
          branch(`${name}Hold`),
        ],
        Req: [],
      };
      branches[`${name}Hold`] = {
        Line: [...reset(step), ...waitInLoop(step, loop)],
        Req: [],
      };
    };
    rail('SafetyLesser', lesser, 0, { under: 'SafetyLesserHold' });
    rail('SafetyGreater', greater, top, { over: 'SafetyGreaterHold' });
  }
  return branches;
}

function withHelpers(name, tag, start, top, branches, regen) {
  const skills = [
    skillOf(name, 99, {
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
    }),
  ];
  if (regen)
    skills.push(
      skillOf(`${name} Regen`, 99, {
        Req: [],
        Line: [{ BRANCH: '-', K_NAME: 'BRANCH' }],
        // REP2 keeps it repeating.
        Prop: {
          USE: true,
          REP2: true,
          NOSTUN: true,
          AWK2: true,
          AWK: true,
          NOCANCEL: true,
        },
        Branch: {
          '-': {
            Line: [
              {
                'ADD/REMOVE': true,
                TIME: FOREVER,
                SET: false,
                TAG: tag,
                K_NAME: 'TAG',
                'LAST HIT': -1,
                CHECK: false,
                VALUE: String(regen.amount),
              },
              { TIME: regen.every, K_NAME: 'WAIT' },
              back,
            ],
            Req: [],
          },
        },
      }),
    );
  skills.push(
    skillOf(`Debug: Add ${name}`, 1, {
      Line: [nudge(tag, '1')],
      Req: [],
      Prop: [],
    }),
    skillOf(`Debug: Remove ${name}`, 2, {
      Line: [nudge(tag, '-1')],
      Req: [],
      Prop: [],
    }),
  );
  return skills;
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
