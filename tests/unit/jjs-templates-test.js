import { module, test } from 'qunit';
import { KATANA, GON } from '../fixtures/jjs-characters';
import {
  decodeMoveset,
  encodeMoveset,
} from 'woogi-tools/utils/skillbuilder/format';
import { buildSkill } from 'woogi-tools/utils/jjs-skill';
import {
  TEMPLATES,
  buildTemplate,
  fieldsOf,
} from 'woogi-tools/utils/jjs-templates';

const template = (id) => TEMPLATES.find((t) => t.id === id);

// Equal, except that numbers need only agree to a hundredth: the exports
// carry animation times like 0.3333333432674408 that were dragged into place.
function near(a, b) {
  if (typeof a === 'number' && typeof b === 'number')
    return Math.abs(a - b) < 0.01;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a && b && typeof a === 'object') {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => k in b && near(a[k], b[k]))
    );
  }
  return a === b;
}

// Where two programs part ways, for a readable failure.
function firstDifference(a, b, path = '') {
  if (near(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object')
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDifference(a[k], b[k], `${path}.${k}`);
      if (found) return found;
    }
  return `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}

module('Unit | JJS templates', function () {
  test('every template builds from its defaults, and its fields are all used', function (assert) {
    for (const t of TEMPLATES) {
      const values = t.id === 'progress-bar' ? { ids: '1 2 3' } : {};
      const skills = buildTemplate(t, values);
      assert.true(skills.length > 0, t.name);
      const keys = fieldsOf(t).map((f) => f.key);
      assert.strictEqual(
        new Set(keys).size,
        keys.length,
        `${t.name}: no field twice`,
      );
    }
  });

  test('the progress bar is the Progress Bar Maker’s skill', function (assert) {
    const skills = buildTemplate(template('progress-bar'), {
      ids: '11, 12, 13',
      name: 'Mana',
      tag: 'Mana',
    });
    const maker = buildSkill({
      textures: ['11', '12', '13'],
      name: 'Mana',
      tag: 'Mana',
    });
    assert.deepEqual(
      skills,
      maker.map((s) => ({ ...s, DATA: JSON.parse(s.DATA) })),
    );
    assert.throws(
      () => buildTemplate(template('progress-bar'), { ids: '5' }),
      /at least 2 \(there is 1\)/,
      'too few pictures is explained',
    );
  });

  test('a progress bar can be client sided', function (assert) {
    const billboards = (values) =>
      buildTemplate(template('progress-bar'), {
        ids: '1 2',
        ...values,
      })[0].DATA.Branch['0'].Line.filter((n) => n.EFFECT === 'Billboard');
    assert.false(
      billboards({})[0]['CLIENT SIDED'],
      'seen by everyone by default',
    );
    const mine = billboards({ clientSided: true })[0];
    assert.true(mine['CLIENT SIDED'], 'or only by the player');
    assert.false(mine['RUN ON SERVER'], 'which is a different switch');
  });

  test('auto-sheathing, with its defaults, is the owner’s SheathPassive', async function (assert) {
    const real = (await decodeMoveset(KATANA)).find(
      (s) => s.NAME === 'SheathPassive',
    );
    const [made, debug] = buildTemplate(template('auto-sheath'));
    assert.strictEqual(made.NAME, 'SheathPassive');
    assert.strictEqual(made.KEY, 9);
    assert.strictEqual(
      firstDifference(made.DATA, real.DATA),
      null,
      'node for node',
    );
    assert.strictEqual(debug.NAME, 'Debug: Draw Katana');
    assert.deepEqual(
      debug.DATA.Line.map((n) => [n.TAG, n.VALUE, n.SET, n.TIME]),
      [['UseKatana', 'True', true, 4]],
      'the debug skill draws it the way the moves do',
    );
  });

  test('auto-sheathing follows its settings', function (assert) {
    const [made, ...rest] = buildTemplate(template('auto-sheath'), {
      weapon: 'Axe',
      tag: 'AxeOut',
      scabbard: false,
      sound: '',
      anim: '',
      flash: false,
      debug: false,
    });
    assert.strictEqual(rest.length, 0, 'no debug skill');
    assert.deepEqual(
      made.DATA.Line.map((n) => n['VISUAL TAG'] ?? n.BRANCH),
      ['Axe', 'Looper'],
      'no scabbard',
    );
    assert.deepEqual(
      made.DATA.Branch.Sheath.Line.map((n) => n.EFFECT ?? n.K_NAME),
      ['WAIT', 'Cancel', 'Mesh', 'BRANCH'],
      'no sound, animation or flash',
    );
    assert.deepEqual(
      made.DATA.Branch.Unsheath.Line.map((n) => n['VISUAL TAG'] ?? n.BRANCH),
      ['Axe', 'AxeHand', 'KeepKatana'],
    );
    assert.strictEqual(made.DATA.Branch.Looper.Line[1].TAG, 'AxeOut');
  });

  test('accurate M1s, with their defaults, are the owner’s Gon M1s', async function (assert) {
    const real = (await decodeMoveset(GON)).filter((s) => s.K_NAME === 'MELEE');
    const made = buildTemplate(template('accurate-m1s'));
    assert.deepEqual(
      made.map((s) => [s.NAME, s.K_NAME]),
      real.map((s) => [s.NAME, s.K_NAME]),
    );
    made.forEach((skill, i) =>
      assert.strictEqual(
        firstDifference(skill.DATA, real[i].DATA),
        null,
        `M1 ${skill.NAME}, node for node`,
      ),
    );
  });

  test('accurate M1s follow their settings', function (assert) {
    const made = buildTemplate(template('accurate-m1s'), {
      damage: 5,
      anim2: 'Killbind',
      swingSound: '',
      hitFlash: false,
      variants: false,
    });
    const base = made[1].DATA.Branch.Base.Line;
    assert.strictEqual(base[0].ANIM_USE, 'Killbind', 'animations by name');
    assert.false(
      base.some((n) => n.K_NAME === 'SFX'),
      'no swing sound',
    );
    assert.strictEqual(base.find((n) => n.K_NAME === 'HITBOX').DAMAGE, 5);
    assert.deepEqual(
      made[3].DATA.Line.map((n) => n.BRANCH),
      ['Base'],
      'the finisher alone',
    );
    assert.deepEqual(Object.keys(made[3].DATA.Branch).sort(), [
      'Base',
      'OnHitBase',
      'OnHitTarget',
    ]);
    assert.deepEqual(
      made[0].DATA.Branch.OnHitTarget.Line.map((n) => n.K_NAME),
      ['SFX'],
      'the hit sound without the flash',
    );
  });

  test('the accurate dash, with its defaults, is that chase without its blink', async function (assert) {
    const real = (await decodeMoveset(GON)).find((s) => s.K_NAME === 'CHASE');
    // The blink was a variant, switched on by a tag: take it away.
    const { Blink: _blink, ...branches } = real.DATA.Branch;
    const want = {
      ...real.DATA,
      Line: real.DATA.Line.filter((n) => n.BRANCH !== 'Blink'),
      Branch: branches,
    };
    const [made] = buildTemplate(template('accurate-dash'));
    assert.deepEqual(
      [made.K_NAME, made.NAME, made.COOLDOWN],
      ['CHASE', 'Chase', 6],
    );
    assert.strictEqual(firstDifference(made.DATA, want), null, 'node for node');
  });

  test('the dash follows its settings', function (assert) {
    const [made] = buildTemplate(template('accurate-dash'), {
      damage: 9,
      effects: false,
      dashSound: '',
    });
    const base = made.DATA.Branch.Base.Line;
    assert.false(
      base.some((n) => n.K_NAME === 'PARTICLE'),
      'no dust',
    );
    assert.false(
      base.some((n) => n.EFFECT === 'Melee Trail' && n.TIME === 1),
      'no trails',
    );
    assert.strictEqual(
      base.filter((n) => n.K_NAME === 'SFX').length,
      1,
      'one sound left',
    );
    assert.strictEqual(made.DATA.Branch.HitCheck.Line[0].DAMAGE, 9);
    assert.deepEqual(
      base.filter((n) => n.K_NAME === 'LOOP').map((n) => n['LOOP AMOUNT']),
      [5],
      'still looking in front six times',
    );
  });

  test('their codes open again, unchanged', async function (assert) {
    for (const t of TEMPLATES) {
      const skills = buildTemplate(
        t,
        t.id === 'progress-bar' ? { ids: '1 2' } : {},
      );
      const again = await decodeMoveset(await encodeMoveset(skills));
      assert.deepEqual(
        again.map(({ uid: _uid, ...s }) => s),
        skills,
        t.name,
      );
    }
  });
});
