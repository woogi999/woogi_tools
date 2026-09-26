import { module, test } from 'qunit';
import { CHARACTER_1, CHARACTER_2 } from '../fixtures/jjs-characters';
import {
  decodeMoveset,
  encodeMoveset,
  toJjsSkill,
  lineOf,
  branchNames,
} from 'woogi-tools/utils/skillbuilder/format';
import { nodeInfo, nodeTitle, newNode, fieldsOf, vec3 } from 'woogi-tools/utils/skillbuilder/schema';
import { simulate, toWorld } from 'woogi-tools/utils/skillbuilder/sim';
import { buildSkill } from 'woogi-tools/utils/jjs-skill';

const withoutUid = (skills) => skills.map(({ uid: _uid, ...s }) => s);
const named = (skills, name, kind) =>
  skills.find((s) => s.NAME === name && (!kind || s.K_NAME === kind));
const allNodes = (skills) =>
  skills.flatMap((s) => [
    ...lineOf(s.DATA, ''),
    ...branchNames(s.DATA).flatMap((b) => lineOf(s.DATA, b)),
  ]);

module('Unit | Skill Builder format', function () {
  test('reads both characters, category by category', async function (assert) {
    const one = await decodeMoveset(CHARACTER_1);
    const two = await decodeMoveset(CHARACTER_2);
    assert.strictEqual(one.length, 12);
    assert.strictEqual(two.length, 20);
    const count = (skills, kind) => skills.filter((s) => s.K_NAME === kind).length;
    assert.deepEqual(
      ['SKILL', 'SPECIAL', 'AWAKENING', 'MELEE', 'CHASE'].map((k) => count(two, k)),
      [13, 1, 1, 4, 1],
    );
    const separator = named(two, '----BASE----');
    assert.false(separator.ADD, 'separators aren’t added');
    assert.false('DATA' in separator, 'and have no program at all');
    assert.true(Array.isArray(named(two, '4', 'SKILL').DATA.Branch), 'an empty Branch is []');
  });

  test('writes them back unchanged', async function (assert) {
    for (const code of [CHARACTER_1, CHARACTER_2]) {
      const skills = await decodeMoveset(code);
      const again = await decodeMoveset(await encodeMoveset(skills));
      assert.deepEqual(withoutUid(again), withoutUid(skills), 'every skill, field and node');
    }
    const one = await decodeMoveset(CHARACTER_1);
    const outfit = toJjsSkill(named(one, 'Outfit'));
    assert.true(outfit.DATA.includes('"TIME":1e38'), '"for ever" written as JJS writes it');
    const empty = toJjsSkill(named(await decodeMoveset(CHARACTER_2), '4', 'SKILL'));
    assert.true(empty.DATA.includes('"Branch":[]'), 'and an empty Branch as []');
  });

  test('turns away things that aren’t codes', async function (assert) {
    await assert.rejects(decodeMoveset('hello'), /isn’t a Skill Builder code/);
    await assert.rejects(decodeMoveset(''), /isn’t a Skill Builder code/);
  });
});

module('Unit | Skill Builder nodes', function () {
  test('knows every node kind JJS used in both characters', async function (assert) {
    const nodes = allNodes([
      ...(await decodeMoveset(CHARACTER_1)),
      ...(await decodeMoveset(CHARACTER_2)),
    ]);
    const kinds = [...new Set(nodes.map((n) => n.K_NAME))];
    assert.strictEqual(kinds.length, 20);
    assert.deepEqual(kinds.filter((k) => nodeInfo(k).group === 'Other'), [], 'none unknown');
  });

  test('titles, new nodes and unknown fields', function (assert) {
    assert.deepEqual(
      [nodeTitle({ K_NAME: 'BRANCH', BRANCH: '1Looper' }).detail, nodeTitle({ K_NAME: 'BRANCH' }).label],
      ['1Looper', 'BRANCH'],
    );
    assert.strictEqual(nodeTitle({ K_NAME: 'ANIM', ANIM_USE: [20, 1] }).label, 'ANIMATION');
    const wait = newNode('WAIT');
    assert.deepEqual(wait, { K_NAME: 'WAIT', TIME: 0.1 });
    const odd = { K_NAME: 'MYSTERY', POWER: 9, ON: true };
    assert.deepEqual(
      fieldsOf(odd).map((f) => [f.key, f.type]),
      [
        ['POWER', 'num'],
        ['ON', 'bool'],
      ],
      'unknown kinds still edit by their values',
    );
    assert.deepEqual(vec3('0, 1.5, -3'), [0, 1.5, -3]);
    assert.deepEqual(toWorld([0, 0, 1], 0), [0, 0, 1], 'forward is +z');
  });
});

module('Unit | Skill Builder simulator', function () {
  test('a melee picks its variant from the conditions', async function (assert) {
    const melee4 = named(await decodeMoveset(CHARACTER_1), '4', 'MELEE');
    const ground = simulate(melee4, { conditions: {} });
    assert.true(ground.log.some((l) => l.text === 'branch → Base'), 'on the ground: Base');
    const air = simulate(melee4, { conditions: { AIR: true } });
    assert.true(air.log.some((l) => l.text === 'branch → Downslam'), 'in the air: Downslam');
    assert.true(
      air.log.some((l) => /Base: its conditions don’t hold/.test(l.text)),
      'Base is skipped, not entered',
    );
  });

  test('a hit runs OnHit on you and OnHitTarget on the one hit', async function (assert) {
    const melee1 = named(await decodeMoveset(CHARACTER_1), '1', 'MELEE');
    const run = simulate(melee1, { hits: 'always' });
    const hit = run.events.find((e) => e.kind === 'HIT');
    assert.ok(hit, 'it hits');
    assert.true(run.log.some((l) => l.who === 'user' && l.text === 'starts OnHit'));
    assert.true(run.log.some((l) => l.who === 'target' && l.text === 'starts OnHitTarget'));
    assert.true(run.hp.at(-1).hp < 100, 'the dummy takes damage');
    const missed = simulate(melee1, { hits: 'never' });
    assert.notOk(missed.events.some((e) => e.kind === 'HIT'), 'or not, if asked');
  });

  test('loops, random branches and tags', function (assert) {
    const skill = (line, branch = {}) => ({ DATA: { Req: [], Line: line, Prop: {}, Branch: branch } });
    const looped = simulate(
      skill([
        { K_NAME: 'HITBOX', SIZE: '8, 8, 8', POSITION: '0, 0, 4', DAMAGE: 1, BRANCH: '', 'BRANCH TARGET': '' },
        { K_NAME: 'WAIT', TIME: 0.1 },
        { K_NAME: 'LOOP', 'LOOP BACK': 2, 'LOOP AMOUNT': 3 },
      ]),
      { hits: 'always' },
    );
    assert.strictEqual(looped.events.filter((e) => e.kind === 'HIT').length, 4, 'once, then three more');

    const coin = skill([{ K_NAME: 'BRANCH', BRANCH: '', RANDOM: 'A, B' }], {
      A: { Req: [], Line: [{ K_NAME: 'WAIT', TIME: 1 }] },
      B: { Req: [], Line: [{ K_NAME: 'WAIT', TIME: 2 }] },
    });
    const picks = [1, 2, 3, 4, 5, 6].map(
      (seed) => simulate(coin, { seed }).log.find((l) => l.text.startsWith('random'))?.text,
    );
    assert.true(picks.includes('random → A'), 'A comes up');
    assert.true(picks.includes('random → B'), 'and so does B');
    assert.deepEqual(
      simulate(coin, { seed: 3 }).log,
      simulate(coin, { seed: 3 }).log,
      'the same seed, the same pick',
    );

    const tags = simulate(
      skill(
        [
          { K_NAME: 'TAG', TAG: 'Bar', VALUE: '2', TIME: 1e38 },
          { K_NAME: 'TAG', TAG: 'Bar', VALUE: '-5', TIME: 1e38, SET: false },
          { K_NAME: 'TAG', TAG: 'Bar', VALUE: '<0', CHECK: true, BRANCH: 'Low' },
        ],
        { Low: { Req: [], Line: [{ K_NAME: 'WAIT', TIME: 0.1 }] } },
      ),
    );
    assert.deepEqual(tags.tags.map((t) => t.value), ['2', '-3'], 'adds up');
    assert.true(tags.log.some((l) => l.text === 'Bar <0 → Low'), 'and "<0" matches');
  });

  test('runs the Progress Bar Maker’s own skill: the bar shows full', function (assert) {
    const [bar] = buildSkill({ textures: ['100', '101', '102'] });
    const run = simulate({ DATA: JSON.parse(bar.DATA) }, { maxTime: 1 });
    const shown = run.events.find((e) => e.kind === 'VISUAL');
    assert.strictEqual(shown.node.EFFECT, 'Billboard');
    assert.strictEqual(shown.node.TEXTURE, 102, 'starts on the top step');
    assert.true(run.warnings.some((w) => /Runs for ever/.test(w)), 'a passive loop is cut off');
  });
});
