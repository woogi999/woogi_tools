// What Webskill Shenanigans opens with: a tiny moveset built the way JJS
// movesets are (a hitbox that forks into OnHit on you and OnHitTarget on
// them, knockback through LAST HIT), so there's something to play at once.

import { newUid } from './format';
import { newNode } from './schema';

const node = (kind, fields = {}) => ({ ...newNode(kind), ...fields });

function punch() {
  return {
    uid: newUid(),
    ADD: true,
    NAME: 'Big Punch',
    K_NAME: 'SKILL',
    KEY: 1,
    COOLDOWN: 8,
    'TOOL TIP': '',
    DATA: {
      Req: [],
      Line: [
        node('SETCD'),
        node('STATE', { STATE: 'InSkill', VALUE: 1, TIME: 0.8 }),
        node('ANIM', { ANIM_USE: [1, 1], PREVIEW: [0, 0.6] }),
        node('WAIT', { TIME: 0.25 }),
        node('VISUAL', { EFFECT: 'Melee Trail', 'BODY PART': 'Right Arm', TIME: 0.3, SIZE: 0.9, 'ALT SIZE': 0.9 }),
        node('VELO', { FORCE: '0, 0, 25', TIME: 0.15, FADE: true }),
        node('HITBOX', { SIZE: '7, 7, 8', POSITION: '0, 0, 4', DAMAGE: 8, STUN: 1 }),
        node('WAIT', { TIME: 0.5 }),
      ],
      Prop: { REP: true, KEEP: true, AWK: true, NOSTUN: true },
      Branch: {
        OnHit: {
          Req: [],
          Line: [
            node('VELO', { FORCE: '0, 12, 40', TIME: 0.2, 'LAST HIT': 0.5, RAGDOLL: 1 }),
            node('VISUAL', { EFFECT: 'Shake Medium', TIME: 0.5 }),
            node('VISUAL', { EFFECT: 'Field of View', TIME: 0.4 }),
          ],
        },
        OnHitTarget: {
          Req: [],
          Line: [
            node('VISUAL', { EFFECT: 'Clash', TIME: 0.25, COLOR: '255, 200, 90', 'ALT COLOR': '255, 120, 40' }),
            node('VISUAL', { EFFECT: 'Wind Expand', TIME: 0.4, SIZE: 0.4, 'ALT SIZE': 1.4 }),
            node('VISUAL', { EFFECT: 'Sparks', TIME: 0.3, SIZE: 1.2 }),
            node('STATE', { STATE: 'Stun', VALUE: 1, TIME: 1 }),
          ],
        },
      },
    },
  };
}

function jab() {
  return {
    uid: newUid(),
    NAME: '1',
    K_NAME: 'MELEE',
    DATA: {
      Req: [],
      Line: [
        node('ANIM', { ANIM_USE: [2, 1], PREVIEW: [0, 0.35] }),
        node('WAIT', { TIME: 0.12 }),
        node('HITBOX', { SIZE: '6, 6, 7', POSITION: '0, 0, 3.5', DAMAGE: 3, STUN: 0.6 }),
        node('WAIT', { TIME: 0.25 }),
      ],
      Prop: { REP: true, KEEP: true, AWK: true, NOSTUN: true },
      Branch: {
        OnHitTarget: {
          Req: [],
          Line: [
            node('VISUAL', { EFFECT: 'Clash', TIME: 0.15, SIZE: 0.6 }),
            node('VELO', { FORCE: '0, 0, 6', TIME: 0.1 }),
          ],
        },
      },
    },
  };
}

export const starterMoveset = () => [punch(), jab()];

// A new, empty skill of a category, as the builder's "+" makes one.
export function blankSkill(category, name = 'New skill') {
  const skill = { uid: newUid(), ADD: true, NAME: name, K_NAME: category };
  if (category === 'SKILL') Object.assign(skill, { KEY: 1, COOLDOWN: 10, 'TOOL TIP': '' });
  if (category === 'SPECIAL' || category === 'CHASE') skill.COOLDOWN = 10;
  if (category === 'AWAKENING') Object.assign(skill, { DURATION: 60, DELAY: 0, COLOR: '255,119,0 255,215,38' });
  skill.DATA = { Req: [], Line: [], Prop: {}, Branch: {} };
  return skill;
}
