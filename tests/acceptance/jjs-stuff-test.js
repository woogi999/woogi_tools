import { module, test } from 'qunit';
import {
  visit,
  click,
  fillIn,
  waitUntil,
  find,
  findAll,
} from '@ember/test-helpers';
import { setupApplicationTest } from 'woogi-tools/tests/helpers';
import { decodeMoveset } from 'woogi-tools/utils/skillbuilder/format';

const byText = (selector, text) =>
  findAll(selector).find((el) => el.textContent.includes(text));

async function openTemplates() {
  await visit('/jjs-stuff');
  await click(byText('.jjs-tabs .home-chip', 'Templates'));
}

const code = () => find('.jjs-tpl-code')?.value ?? '';

// The code on show, decoded, once it's been rebuilt after `change`.
async function shownSkills(change) {
  const before = code();
  if (change) await change();
  await waitUntil(() => code() && code() !== before, { timeout: 5000 });
  return decodeMoveset(code());
}

module('Acceptance | JJS Stuff templates', function (hooks) {
  setupApplicationTest(hooks);

  test('a progress bar from pasted image IDs', async function (assert) {
    await openTemplates();
    assert.dom('.jjs-tpl-pick').exists({ count: 4 });
    assert.dom('.jjs-tpl-pick.active').includesText('Progress bar');
    assert
      .dom('.jjs-tpl-link')
      .hasAttribute(
        'href',
        '/jjs-progress-bar-maker',
        'with the way to draw one',
      );
    await waitUntil(() => find('.jjs-tpl-error'));
    assert
      .dom('.jjs-tpl-error')
      .includesText('at least 2', 'no code without pictures');

    await fillIn('.jjs-tpl-form textarea[name="ids"]', '111 222 333');
    const skills = await shownSkills(() =>
      fillIn('.jjs-tpl-form input[name="tag"]', 'Mana'),
    );
    assert.deepEqual(
      skills.map((s) => s.NAME),
      ['Bar', 'Bar Regen', 'Debug: Add Bar', 'Debug: Remove Bar'],
    );
    assert.strictEqual(skills[0].DATA.Line[0].TAG, 'Mana');
    assert.dom('.jjs-tpl-out').includesText('Set the Mana tag');
  });

  test('the M1s and the sheath, each with its own settings', async function (assert) {
    await openTemplates();
    let skills = await shownSkills(() =>
      click(byText('.jjs-tpl-pick', 'Accurate M1s')),
    );
    assert.deepEqual(
      skills.map((s) => `${s.K_NAME} ${s.NAME}`),
      ['MELEE 1', 'MELEE 2', 'MELEE 3', 'MELEE 4'],
    );
    assert
      .dom('.jjs-tpl-form input[name="animUp"]')
      .exists('the uppercut’s settings');
    skills = await shownSkills(() =>
      click('.jjs-tpl-form input[name="variants"]'),
    );
    assert
      .dom('.jjs-tpl-form input[name="animUp"]')
      .doesNotExist('which go with the uppercut');
    assert.strictEqual(
      skills[3].DATA.Line.length,
      1,
      'and the finisher has no variants',
    );

    skills = await shownSkills(() =>
      click(byText('.jjs-tpl-pick', 'Auto-sheathing')),
    );
    assert.deepEqual(
      skills.map((s) => s.NAME),
      ['SheathPassive', 'Debug: Draw Katana'],
    );
    assert.dom('.jjs-tpl-out').includesText('UseKatana = True');

    skills = await shownSkills(() =>
      click(byText('.jjs-tpl-pick', 'Accurate dash')),
    );
    assert.deepEqual(
      skills.map((s) => `${s.K_NAME} ${s.NAME}`),
      ['CHASE Chase'],
    );

    await click(byText('.jjs-tpl-pick', 'Accurate M1s'));
    assert
      .dom('.jjs-tpl-form input[name="variants"]')
      .isNotChecked('a template keeps its settings while another is open');
    await click('.jjs-tpl-reset');
    assert.dom('.jjs-tpl-form input[name="variants"]').isChecked('until reset');
  });

  test('searching finds templates', async function (assert) {
    await openTemplates();
    const skills = await shownSkills(() =>
      fillIn('.jjs-search input', 'sheath'),
    );
    assert.dom(byText('.jjs-tabs .home-chip', 'Templates')).includesText('1');
    assert.dom('.jjs-tpl-pick').exists({ count: 1 });
    assert.dom('.jjs-tpl-pick').includesText('Auto-sheathing');
    assert.strictEqual(
      skills[0].NAME,
      'SheathPassive',
      'its code, not the one picked before',
    );
    await fillIn('.jjs-search input', 'zzzz');
    assert.dom('.jjs').includesText('No templates match');
  });
});
