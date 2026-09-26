import { module, test } from 'qunit';
import {
  visit,
  click,
  fillIn,
  triggerEvent,
  waitUntil,
  find,
  findAll,
} from '@ember/test-helpers';
import { setupApplicationTest } from 'woogi-tools/tests/helpers';
import { clearAllToolState } from 'woogi-tools/utils/tool-state';
import { idbDeletePrefix } from 'woogi-tools/utils/idb-store';
import { decodeSkill } from 'woogi-tools/utils/jjs-skill';

// What the picture on the page shows at (x, y), once it has been painted.
const pixelAt = (x, y) => {
  const canvas = find('.pb-canvas');
  if (!canvas?.width) return null;
  return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
};

const isGreenish = (p) => p && p[3] === 255 && p[1] > 150 && p[0] < 150;
const isWhite = (p) => p && p[0] === 255 && p[1] === 255 && p[2] === 255;
const layers = () => findAll('.pb-layer:not(.pb-layer-canvas)');
const byText = (selector, text) =>
  findAll(selector).find((el) => el.textContent.includes(text));

// Drags across the picture with the tool in hand, in picture pixels.
async function dragOnPicture(from, to) {
  const r = find('.pb-overlay').getBoundingClientRect();
  const at = ([x, y]) => ({
    clientX: r.left + (x * r.width) / 1024,
    clientY: r.top + (y * r.height) / 1024,
    button: 0,
    pointerId: 1,
  });
  await triggerEvent('.pb-overlay', 'pointerdown', at(from));
  await triggerEvent('.pb-overlay', 'pointermove', at(to));
  await triggerEvent('.pb-overlay', 'pointerup', at(to));
}

module('Acceptance | JJS progress bar maker', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    await clearAllToolState();
    await idbDeletePrefix('woogi-shelf:progress-bar:');
  });

  test('starts on a plain bar on a 1024 square, and it empties on step 0', async function (assert) {
    await visit('/jjs-progress-bar-maker');
    assert.dom('.hero-title span').hasText('JJS Progress Bar Maker');
    assert.dom('.container.is-game').exists('uses the games layout');

    // Step 13 of 20: the left end of the bar is green, the right end isn't.
    await waitUntil(() => isGreenish(pixelAt(200, 512)), { timeout: 3000 });
    assert.dom('.pb-canvas').hasAttribute('width', '1024');
    assert.dom('.pb-canvas').hasAttribute('height', '1024');
    assert.false(isGreenish(pixelAt(900, 512)), 'the far end is still empty');
    assert.strictEqual(layers().length, 1, 'one bar, not a finished example');

    await fillIn('.pb-frame-range', '0');
    await waitUntil(() => !isGreenish(pixelAt(200, 512)), { timeout: 3000 });
    assert.deepEqual(pixelAt(200, 512), [31, 41, 55, 255], 'only the track');
  });

  test('the step count sets how many pictures come out', async function (assert) {
    await visit('/jjs-progress-bar-maker');
    await fillIn('.pb-steps', '5');
    assert.dom('.pb-status').includesText('6 pictures');
    await waitUntil(() => findAll('.pb-thumb').length === 6, { timeout: 3000 });
    assert.dom('.pb-thumb').exists({ count: 6 }, 'one per step, 0 to 5');
    assert.dom('.pb-frame-range').hasAttribute('max', '5');
    assert.dom('.pb-frame-label').includesText('5/5');
  });

  test('the shape tool draws progress bars and plain shapes', async function (assert) {
    await visit('/jjs-progress-bar-maker');
    await click('.pb-rail-btn[aria-label$="(U)"]');
    assert.dom('.pb-kinds button.active').hasText('Progress bar', 'bars first');

    // A second bar, lower down: its left end fills on step 13.
    await dragOnPicture([100, 800], [900, 900]);
    assert.strictEqual(layers().length, 2);
    assert.dom('.pb-layer.is-active').includesText('Bar');
    assert.dom('.pb-options').includesText('Bar', 'back to moving it');
    await waitUntil(() => isGreenish(pixelAt(200, 850)), { timeout: 3000 });

    await click('.pb-rail-btn[aria-label$="(U)"]');
    await click(byText('.pb-kinds button', 'Rectangle'));
    await dragOnPicture([700, 100], [900, 300]);
    assert.dom('.pb-layer.is-active').includesText('Rectangle');
    assert.dom('.pb-tabs button').exists({ count: 3 }, 'Shape, Effects and Layer');
    await waitUntil(() => isWhite(pixelAt(800, 200)), { timeout: 3000 });
    assert.false(isWhite(pixelAt(600, 200)), 'only where it was drawn');
  });

  test('New keeps the size and picks a start; examples are there to open', async function (assert) {
    await visit('/jjs-progress-bar-maker');
    await click('.pb-new');
    assert.dom('.pb-dialog').exists();
    assert.dom('.pb-dialog').includesText('1024 × 1024');
    await fillIn('.pb-new-steps', '8');
    await click(byText('.pb-dialog .pb-seg button', 'A ring'));
    await click('.pb-create');
    assert.dom('.pb-dialog').doesNotExist();
    assert.strictEqual(layers().length, 1);
    assert.dom('.pb-layer.is-active').includesText('Ring');
    assert.dom('.pb-frame-range').hasAttribute('max', '8');

    await click('.pb-new');
    await click(byText('.pb-examples button', 'Ring'));
    assert.strictEqual(layers().length, 2, 'a ring and its percentage');
    assert.dom('.pb-canvas').hasAttribute('width', '1024');

    await click('[aria-label="Undo"]');
    assert.strictEqual(layers().length, 1, 'opening an example can be undone');
  });

  test('layers, clipping, the canvas row and undo', async function (assert) {
    await visit('/jjs-progress-bar-maker');
    await click('[aria-label="New drawing layer"]');
    assert.strictEqual(layers().length, 2);
    assert.dom('.pb-layer.is-active').includesText('Drawing');

    await click('.pb-layer.is-active .pb-layer-clip');
    assert.dom('.pb-layer.is-active').hasClass('is-clipped');

    await click('.pb-layer-canvas .pb-layer-name');
    assert.dom('.pb-panel-head h3').hasText('Canvas');
    assert.dom('.pb-tabs').doesNotExist();
    assert.dom('.pb-count').includesText('21 pictures');

    await click('[aria-label="Undo"]');
    assert.dom('.pb-layer.is-clipped').doesNotExist('clipping undone');
    await click('[aria-label="Undo"]');
    assert.strictEqual(layers().length, 1, 'the drawing layer is gone again');
    await click('[aria-label="Redo"]');
    assert.strictEqual(layers().length, 2);
  });

  test('a bar’s settings change the picture', async function (assert) {
    await visit('/jjs-progress-bar-maker');
    await waitUntil(() => isGreenish(pixelAt(100, 512)), { timeout: 3000 });
    assert.dom('.pb-tabs button.active').hasText('Shape');

    // Four stepped segments on step 13 of 20 light two whole segments: the
    // third (from x≈520) stays dark.
    await fillIn(byText('.pb-slider', 'Count').querySelector('input'), '4');
    await click(
      byText('.pb-props .math-check', 'whole segments').querySelector('input'),
    );
    await waitUntil(() => !isGreenish(pixelAt(600, 512)), { timeout: 3000 });
    assert.true(isGreenish(pixelAt(100, 512)), 'the first segment is lit');
    assert.false(isGreenish(pixelAt(600, 512)), 'the third segment is not');

    await click(byText('.pb-tabs button', 'Fill'));
    assert.dom('.pb-paint').exists('the fill editor is on its own tab');
  });

  test('designs are saved inside the site and open again', async function (assert) {
    await visit('/jjs-progress-bar-maker');
    await fillIn('.pb-name-input', 'Six Eyes');
    assert.dom('.pb-dirty').hasClass('is-dirty', 'renamed, not yet saved');
    await click('.pb-save');
    await waitUntil(() => find('.pb-status')?.textContent.includes('Saved'), {
      timeout: 3000,
    });
    assert.dom('.pb-dirty').doesNotHaveClass('is-dirty', 'saved');

    await click('.pb-new');
    await click('.pb-create');
    assert.dom('.pb-name-input').hasValue('Untitled bar', 'a fresh design');

    await click('.pb-open');
    await waitUntil(() => find('.pb-design'), { timeout: 3000 });
    assert.dom('.pb-design').exists({ count: 1 });
    assert.dom('.pb-design').includesText('Six Eyes');
    assert.dom('.pb-design-thumb img').exists('with a picture of it');
    await click('.pb-design-open');
    await waitUntil(() => find('.pb-name-input')?.value === 'Six Eyes', {
      timeout: 3000,
    });
    assert.dom('.pb-dialog').doesNotExist();
    assert.dom('.pb-dirty').doesNotHaveClass('is-dirty');
  });

  test('the shape tool draws text bars too', async function (assert) {
    await visit('/jjs-progress-bar-maker');
    await click('.pb-rail-btn[aria-label$="(U)"]');
    await click(byText('.pb-kinds button', 'Text bar'));
    await dragOnPicture([200, 200], [800, 500]);
    assert.dom('.pb-layer.is-active').includesText('Text');
    assert.dom('.pb-text-input').hasValue('力');
    await click(byText('.pb-props .pb-chips button', 'Stroke order'));
    assert.dom('.pb-props').includesText('KanjiVG');
  });

  test('the JJS skill export turns image IDs into skill code', async function (assert) {
    await visit('/jjs-progress-bar-maker');
    await fillIn('.pb-steps', '4');
    await click('.pb-export-btn');
    await click('.pb-jjs-tab');
    // No Roblox app in the test build: it says so, and IDs can still be typed in.
    assert.dom('.pb-dialog').includesText('isn’t');
    assert.dom('.pb-roblox-sign-in').doesNotExist();

    await fillIn('.pb-ids', '111 222 333');
    assert.dom('.pb-dialog').includesText('needs 5 image IDs');
    assert.dom('.pb-skill-code').doesNotExist();

    await fillIn('.pb-ids', '111\n222\n333\n444\n555');
    await fillIn('.pb-skill-tag', 'CE');
    await fillIn('.pb-skill-wait', '0.2');
    await waitUntil(() => find('.pb-skill-code')?.value, { timeout: 3000 });
    const skill = await decodeSkill(find('.pb-skill-code').value);
    const data = JSON.parse(skill[0].DATA);
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((i) => data.Branch[String(i)].Line[0].TEXTURE),
      [111, 222, 333, 444, 555],
      'each step shows its picture',
    );
    assert.strictEqual(data.Line[0].TAG, 'CE');
    assert.strictEqual(data.Branch['0'].Line[0].TIME, 0.12, 'billboard time default');
    assert.strictEqual(data.Branch['0'].Line[1].TIME, 0.2, 'the wait as set');
    assert.strictEqual(skill[0].KEY, 99);
    assert.dom('.pb-skill-rails').isChecked('Safety Rails on by default');
    assert.deepEqual(
      skill.map((k) => [k.NAME, k.KEY]),
      [
        ['Untitled bar', 99],
        ['Untitled bar Regen', 99],
        ['Debug: Add Untitled bar', 1],
        ['Debug: Remove Untitled bar', 2],
      ],
      'the bar, its regen and the two debug skills',
    );
    assert.true('SafetyLesser' in data.Branch, 'with the rails');
    assert.dom('.pb-skill-fields').doesNotIncludeText('Key');
    assert.strictEqual(skill[0].NAME, 'Untitled bar', 'named after the design');
  });
});
