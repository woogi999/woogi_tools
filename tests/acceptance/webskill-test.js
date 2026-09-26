import { module, test } from 'qunit';
import {
  visit,
  click,
  fillIn,
  waitUntil,
  find,
  findAll,
  triggerEvent,
} from '@ember/test-helpers';
import { setupApplicationTest } from 'woogi-tools/tests/helpers';
import { clearAllToolState } from 'woogi-tools/utils/tool-state';
import { idbDeletePrefix } from 'woogi-tools/utils/idb-store';
import { decodeMoveset, lineOf } from 'woogi-tools/utils/skillbuilder/format';
import { CHARACTER_2 } from '../fixtures/jjs-characters';

const byText = (selector, text) =>
  findAll(selector).find((el) => el.textContent.includes(text));

// The code the export dialog shows, decoded.
async function exported() {
  await click('.ws-export');
  await waitUntil(() => find('.ws-export-code')?.value, { timeout: 5000 });
  const skills = await decodeMoveset(find('.ws-export-code').value);
  await click('.ws-dialog [aria-label="Close"]');
  return skills;
}

module('Acceptance | Webskill Shenanigans', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    await clearAllToolState();
    await idbDeletePrefix('woogi-shelf:webskill:');
  });

  test('opens on a small moveset, laid out like the Skill Builder', async function (assert) {
    await visit('/webskill-shenanigans');
    assert
      .dom('.sidebar')
      .doesNotExist('the whole window, like the video editor');
    assert.dom('.ws-brand').hasAttribute('href', '/', 'with its own way home');
    assert
      .dom('.ws-category')
      .exists({ count: 5 }, 'SKILL, SPECIAL, AWAKENING, MELEE, CHASE');
    assert.dom('.ws-skill.active').includesText('[Big Punch] SKILL');
    assert
      .dom('.ws-branch')
      .exists({ count: 4 }, 'Default, OnHit, OnHitTarget and +');
    assert.dom('.ws-node').exists({ count: 8 });
    assert.dom('.ws-node.active').includesText('COOLDOWN');
    await waitUntil(() => find('.ws-canvas'), { timeout: 8000 });
    assert.dom('.ws-canvas').exists('the 3D view is up');
  });

  test('imports a real character and sorts it into its categories', async function (assert) {
    await visit('/webskill-shenanigans');
    await click('.ws-import');
    await fillIn('.ws-code', CHARACTER_2);
    await click('.ws-do-import');
    assert.dom('.ws-dialog').doesNotExist();
    assert.dom('.ws-status').includesText('Imported 20 skills');
    assert.deepEqual(
      findAll('.ws-category .ws-count').map((e) => e.textContent.trim()),
      ['13', '1', '1', '4', '1'],
    );
    await click(byText('.ws-skill', 'Double Strike'));
    assert.dom('.ws-branch.active').hasText('Default');
    assert.true(
      findAll('.ws-branch').some((b) => b.textContent.trim() === 'UseTwice'),
    );
    assert
      .dom('.ws-node')
      .exists({ count: 2 }, 'its default line: a TAG check and a BRANCH');
    assert.dom('.ws-node').includesText('S3UseTwice = 1 → UseTwice');

    await click('.ws-import');
    await fillIn('.ws-code', 'not a code');
    await click('.ws-do-import');
    assert.dom('.tool-error').includesText('isn’t a Skill Builder code');
  });

  test('edits go into the exported code, and undo takes them back', async function (assert) {
    await visit('/webskill-shenanigans');
    await click(byText('.ws-node', 'HITBOX'));
    await click(byText('.ws-palette-node', 'WAIT'));
    assert.dom('.ws-node').exists({ count: 9 });
    assert
      .dom('.ws-node.active')
      .includesText('[0.1s] WAIT', 'added after the hitbox, selected');
    const time = find('.ws-inspector input[type="number"]');
    await fillIn(time, '0.35');
    await triggerEvent(time, 'change');
    assert.dom('.ws-node.active').includesText('[0.35s] WAIT');

    const skills = await exported();
    const line = lineOf(skills[0].DATA, '');
    assert.deepEqual(
      line[7],
      { K_NAME: 'WAIT', TIME: 0.35 },
      'in the code, where it was put',
    );

    await click('[aria-label="Undo"]');
    await click('[aria-label="Undo"]');
    assert.dom('.ws-node').exists({ count: 8 }, 'undone');
  });

  test('renaming a branch renames everything that goes to it', async function (assert) {
    await visit('/webskill-shenanigans');
    await click(byText('.ws-branch', 'OnHitTarget'));
    await click(byText('.ws-tabs button', 'Conditions'));
    const name = find('.ws-branch-name');
    await fillIn(name, 'Reeling');
    await triggerEvent(name, 'change');
    assert.true(
      findAll('.ws-branch').some((b) => b.textContent.trim() === 'Reeling'),
    );
    const skills = await exported();
    const hitbox = lineOf(skills[0].DATA, '').find(
      (n) => n.K_NAME === 'HITBOX',
    );
    assert.strictEqual(
      hitbox['BRANCH TARGET'],
      'Reeling',
      'the hitbox now sends them there',
    );
    assert.ok(skills[0].DATA.Branch.Reeling, 'and the branch moved');
  });

  test('plays a skill: the punch lands on the dummy', async function (assert) {
    await visit('/webskill-shenanigans');
    await click(byText('.ws-conds .ws-seg button', 'Always hit'));
    await waitUntil(() => findAll('.ws-log li').length, { timeout: 3000 });
    assert.dom('.ws-log').includesText('hitbox hits for 8');
    assert.dom('.ws-log').includesText('starts OnHitTarget');
    await click(byText('.ws-conds .ws-seg button', 'Whiff'));
    await waitUntil(() => find('.ws-log')?.textContent.includes('misses'), {
      timeout: 3000,
    });
    assert
      .dom('.ws-log')
      .doesNotIncludeText(
        'starts OnHitTarget',
        'a whiff starts nothing on them',
      );
  });
});
