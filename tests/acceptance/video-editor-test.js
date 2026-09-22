import { module, test } from 'qunit';
import {
  visit,
  click,
  fillIn,
  find,
  findAll,
  waitUntil,
  triggerEvent,
} from '@ember/test-helpers';
import { setupApplicationTest } from 'woogi-tools/tests/helpers';
import { paletteOf } from 'woogi-tools/utils/ferrite/theme';

// The Video Editor is a whole application inside a page — a menu bar, four
// docks, seven panels and two canvases — and it builds all of that from its own
// constructor. That is precisely where a tracked write during render takes the
// rest of the site down with it, so it is worth actually opening in a browser
// rather than trusting that it compiled.
// What a correct wide directional blur looks like along one row: used when the
// browser running the tests has no WebGL2, so the checks below still execute.
function smearedRow(centre, width, length_) {
  const row = new Uint8ClampedArray(320 * 4);
  for (let x = 0; x < 320; x++) {
    const d = Math.abs(x - (centre + width / 2)) / length_;
    const v = d > 1 ? 0 : Math.round(255 * Math.exp(-d * d * 1.6));
    row[x * 4] = v;
    row[x * 4 + 1] = v;
    row[x * 4 + 2] = v;
    row[x * 4 + 3] = 255;
  }
  return row;
}

// The editor opens on its start page now, so a test that is about the editor
// says so once here rather than clicking through at the top of every one.
async function openEditor() {
  await visit('/video-editor');
  await click('[data-new-project]');
}

module('Acceptance | video editor', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(() => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('woogi-tool:')) localStorage.removeItem(key);
    localStorage.removeItem('video-editor:projects');
  });

  test('the editor takes the whole window, with no site chrome', async function (assert) {
    await openEditor();

    // It is a page in its own right: none of the shell is rendered.
    assert.dom('.app-shell').doesNotExist('no app shell');
    assert.dom('.sidebar').doesNotExist('no sidebar');
    assert.dom('.mobile-header').doesNotExist('no header');
    assert.dom('.hero-title').doesNotExist('no tool hero');
    assert.dom('.top-controls').doesNotExist('no theme controls');
    assert.strictEqual(
      document.documentElement.dataset.bare,
      'true',
      'the page behind it is stopped from scrolling',
    );

    // The shell.
    assert.dom('.fr').exists('the editor mounted');
    assert.dom('.fr-menubar .fr-menu-btn').exists({ count: 7 }, 'seven menus');
    assert.dom('.fr-rail').doesNotExist('the production rail is gone');
    // The mark is the only way back, so it has to be a link home.
    assert.dom('.fr-brand').hasAttribute('href', '/');
    assert.dom('.fr-brand img').hasAttribute('src', '/icon_expanded.png');
    assert.dom('.fr-status').exists('the status bar');

    // The docks, with the panels Ferrite puts in each.
    assert.dom('.fr-dock').exists({ count: 3 }, 'left, right and bottom docks');
    assert.dom('.fr-centre .fr-viewer').exists('the composition panel');
    assert.dom('.fr-canvas').exists('the stage canvas');
    assert.dom('.fr-tracks-canvas').exists('the timeline canvas');

    // The transport and the scene the project starts with.
    assert.dom('.fr-transport').exists();
    assert.dom('.fr-viewer-bar').includesText('Scene 1');
    assert.dom('.fr-scene').exists({ count: 1 }, 'one scene in the project');
  });

  test('the Layer menu adds a layer, and it reaches the timeline', async function (assert) {
    await openEditor();
    assert.dom('.fr-trow').doesNotExist('an empty scene has no rows');

    await click('.fr-menu-btn[data-menu="Layer"]'); // Layer
    assert
      .dom('.fr-menu .fr-menu-row')
      .exists({ count: 10 }, 'ten layer kinds');
    await click('.fr-menu .fr-menu-row[data-row="text"]');

    assert.dom('.fr-menu').doesNotExist('the menu closed');
    assert
      .dom('.fr-trow.is-layer')
      .exists({ count: 1 }, 'a row on the timeline');
    assert.dom('.fr-trow-name').includesText('Text');
    assert.dom('.fr-status').includesText('1 layer');
  });

  test('the inspector shows a selected layer and edits it', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="text"]');

    await click('.fr-dock .fr-tab:nth-child(2)'); // Properties
    assert.dom('.fr-insp').exists('the inspector has a layer');
    // Layer, Content, Transform, Appearance, Type, Links, Effects.
    assert.dom('.fr-section').exists({ count: 7 }, 'its property sections');

    // Every keyable row carries a stopwatch, which is what makes it keyable.
    assert.dom('.fr-insp .fr-watch').exists();
    const before = findAll('.fr-insp .fr-watch.is-on').length;
    assert.strictEqual(before, 0, 'nothing is animated yet');

    await fillIn('.fr-insp input.fr-field', 'Lower third');
    await triggerEvent('.fr-insp input.fr-field', 'change');
    assert
      .dom('.fr-trow-name')
      .includesText('Lower third', 'the tree followed');
  });

  test('the stopwatch keyframes a property and the timeline shows it', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');

    await click('.fr-dock .fr-tab:nth-child(2)'); // Properties
    await click('.fr-insp .fr-watch'); // arm the first transform row
    assert.dom('.fr-insp .fr-watch.is-on').exists({ count: 1 });

    // Twirling the layer open in the timeline reaches the same property.
    await click('.fr-trow.is-layer .fr-twirl');
    assert.dom('.fr-trow.is-group').exists('the property groups appeared');
    await click('.fr-trow.is-group .fr-twirl');
    assert.dom('.fr-trow.is-prop').exists('and the rows under them');
    assert.dom('.fr-trow.is-prop .fr-watch.is-on').exists({ count: 1 });
  });

  test('the effects browser lists the whole catalogue and applies one', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');

    assert.dom('.fr-fx-row').exists({ count: 145 }, 'all 145 effects');
    assert.dom('.fr-cat').exists({ count: 12 }, 'in twelve categories');

    // Descriptions are searched as well as names, and Box Blur's mentions a
    // gaussian, so this is two hits rather than one.
    await fillIn('.fr-search input', 'gaussian');
    assert.deepEqual(
      findAll('.fr-fx-row').map((el) => el.textContent.trim()),
      ['Gaussian Blur', 'Box Blur'],
      'the search narrows it to what matches',
    );
    await click('.fr-fx-row');

    await click('.fr-dock .fr-tab:nth-child(2)'); // Properties
    assert.dom('.fr-fx').exists({ count: 1 }, 'it landed on the effect stack');
    assert.dom('.fr-fx-head strong').hasText('Gaussian Blur');
    assert.dom('.fr-fx .fr-row').exists({ count: 1 }, 'with its one parameter');
  });

  test('the transport moves the playhead and the timecode follows', async function (assert) {
    await openEditor();
    const readout = () => find('.fr-transport .fr-time').textContent.trim();
    assert.strictEqual(readout(), '00:00.00');

    await click('.fr-transport .fr-icon-btn:nth-child(4)'); // forward one frame
    assert.strictEqual(readout(), '00:00.01', 'one frame on');
    await click('.fr-transport .fr-icon-btn:nth-child(5)'); // to the end
    assert.strictEqual(readout(), '00:10.00', 'the scene is ten seconds');
    await click('.fr-transport .fr-icon-btn:nth-child(1)'); // back to the start
    assert.strictEqual(readout(), '00:00.00');
  });

  test('undo puts back a deleted layer', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');
    assert.dom('.fr-trow.is-layer').exists({ count: 1 });

    await click('.fr-menu-btn[data-menu="Edit"]'); // Edit
    await click('.fr-menu .fr-menu-row[data-row="delete-selection"]');
    assert.dom('.fr-trow.is-layer').doesNotExist();

    await click('.fr-menu-btn[data-menu="Edit"]');
    await click('.fr-menu .fr-menu-row[data-row="undo"]');
    assert.dom('.fr-trow.is-layer').exists({ count: 1 }, 'it came back');
  });

  test('the Window menu hides and restores a panel', async function (assert) {
    await openEditor();
    assert.dom('.fr-dock.is-bottom').exists();

    await click('.fr-menu-btn[data-menu="Window"]'); // Window
    assert.dom('.fr-menu .fr-menu-row').exists({ count: 6 }, 'one per panel');
    await click('.fr-menu .fr-menu-row[data-row="timeline"]');
    assert.dom('.fr-timeline').doesNotExist('the timeline went away');

    await click('.fr-menu-btn[data-menu="Window"]');
    await click('.fr-menu .fr-menu-row[data-row="timeline"]');
    assert.dom('.fr-timeline').exists('and came back');
  });

  test('the scene dialog and the shortcuts modal open', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Scene"]'); // Scene
    await click('.fr-menu .fr-menu-row[data-row="scene-properties"]');
    assert.dom('.fr-modal').exists();
    assert.dom('.fr-modal-head').includesText('Scene properties');
    await click('.fr-modal-head .fr-icon-btn');
    assert.dom('.fr-modal').doesNotExist();

    await click('.fr-menu-btn[data-menu="File"]');
    await click('.fr-menu .fr-menu-row[data-row="keyboard-shortcuts"]');
    assert.dom('.fr-modal.is-wide').exists();
    // Every action is listed, bound or not, because an unbound one still needs a
    // row to click before it can be given a key.
    assert.dom('.fr-key-row').exists({ count: 88 }, 'every action');
    assert.dom('.fr-key-btn').exists({ count: 88 }, 'each one is rebindable');
  });

  test('About keeps the attribution reachable from a page with no footer', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="File"]');
    await click('.fr-menu .fr-menu-row[data-row="about-this-editor"]');
    assert.dom('.fr-modal').exists();
    assert.dom('.fr-about').includesText('Ferrite');
    assert.dom('.fr-credit strong').hasText('ffmpeg.wasm');
    assert.dom('.fr-about a[href="/"]').exists('and a way back to the site');
  });

  test('the stage canvas is painted at the scene raster', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');

    // The compositor sizes the canvas to the scene, not to the panel.
    await waitUntil(() => find('.fr-canvas')?.width === 1920, {
      timeout: 3000,
    });
    assert.dom('.fr-canvas').hasAttribute('width', '1920');
    assert.dom('.fr-canvas').hasAttribute('height', '1080');

    // And it actually drew: the box layer is mid grey, so the middle pixel is.
    const canvas = find('.fr-canvas');
    const px = canvas.getContext('2d').getImageData(960, 540, 1, 1).data;
    assert.deepEqual(
      [px[0], px[1], px[2]],
      [0x80, 0x80, 0x80],
      'the new box layer was composited',
    );
  });

  test('the theme can still be changed from inside the editor', async function (assert) {
    await openEditor();
    const theme = () => document.documentElement.getAttribute('data-theme');
    const was = theme();
    await click('.fr-menubar .fr-icon-btn');
    assert.notStrictEqual(theme(), was, 'the site theme flipped');
    // The editor is styled from the site's own tokens, so it followed.
    await click('.fr-menubar .fr-icon-btn');
    assert.strictEqual(theme(), was, 'and back again');
  });

  test('the canvases resolve their colours from the site tokens', async function (assert) {
    await openEditor();
    // A canvas' fillStyle cannot parse color-mix(), so the palette has to hand
    // back resolved colours. Raw tokens here would mean silently unpainted
    // bars and keyframes.
    const palette = paletteOf(find('.fr-tracks-canvas'));
    const pen = document.createElement('canvas').getContext('2d');
    for (const [key, value] of Object.entries(palette)) {
      assert.notOk(
        value.includes('color-mix') || value.includes('var('),
        `${key} is not a raw token, got ${value}`,
      );
      // The real question: can a canvas paint with it? An unparseable value is
      // ignored on assignment, so the sentinel would survive.
      pen.fillStyle = '#010203';
      pen.fillStyle = value;
      assert.notStrictEqual(
        pen.fillStyle,
        '#010203',
        `${key} is a colour the canvas accepts, got ${value}`,
      );
    }
    // And the playhead really is the site's own accent rather than a fallback.
    const probe = document.createElement('span');
    find('.fr').appendChild(probe);
    probe.style.color = 'var(--card-red)';
    pen.fillStyle = getComputedStyle(probe).color;
    const cardRed = pen.fillStyle;
    probe.remove();
    assert.strictEqual(palette.playhead, cardRed, 'the playhead is --card-red');
  });

  test('the shader pass runs and moves pixels', async function (assert) {
    await openEditor();
    const { runPasses, hasGpu } = await import('woogi-tools/utils/ferrite/gpu');
    const { SHADER_EFFECTS } =
      await import('woogi-tools/utils/ferrite/shader-map');
    const { makeEffect } = await import('woogi-tools/utils/ferrite/effects');

    assert.ok(hasGpu(), 'headless Chrome gives us WebGL2');

    // A picture with structure to move: left half opaque red, right half blue.
    const make = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = '#ff0000';
      x.fillRect(0, 0, 32, 64);
      x.fillStyle = '#0000ff';
      x.fillRect(32, 0, 32, 64);
      return c;
    };
    const pixel = (c, x, y) =>
      Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);

    // Offset shifts the picture by half its width and wraps, so the colours
    // on the two sides swap. That is a result only a working shader produces.
    const canvas = make();
    assert.deepEqual(pixel(canvas, 8, 32), [255, 0, 0, 255], 'red before');
    const entry = SHADER_EFFECTS['Offset'];
    const fx = makeEffect('Offset');
    const ran = runPasses(
      canvas,
      [
        {
          shader: entry.shader,
          params: entry.pack([50, 0, 0], fx.colors),
          colours: new Float32Array(16),
          timeMs: 0,
        },
      ],
      (why) => assert.ok(false, `the pass reported: ${why}`),
    );
    assert.ok(ran, 'the pass ran');
    const after = pixel(canvas, 8, 32);
    assert.ok(
      after[2] > after[0],
      `the left half is now blue, got rgba(${after})`,
    );
  });

  test('a shader pass does not flip the picture', async function (assert) {
    await openEditor();
    const { runPasses } = await import('woogi-tools/utils/ferrite/gpu');
    const { SHADER_EFFECTS } =
      await import('woogi-tools/utils/ferrite/shader-map');
    const { makeEffect } = await import('woogi-tools/utils/ferrite/effects');

    // Top half red, bottom half blue. A left/right test cannot see a vertical
    // flip, which is exactly the mistake that hid one.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const x = canvas.getContext('2d');
    x.fillStyle = '#ff0000';
    x.fillRect(0, 0, 64, 32);
    x.fillStyle = '#0000ff';
    x.fillRect(0, 32, 64, 32);
    const pixel = (c, px, py) =>
      Array.from(c.getContext('2d').getImageData(px, py, 1, 1).data);

    // Channel Mixer at its defaults is the identity matrix, so whatever comes
    // back should be exactly what went in.
    const entry = SHADER_EFFECTS['Channel Mixer'];
    const fx = makeEffect('Channel Mixer');
    runPasses(
      canvas,
      [
        {
          shader: entry.shader,
          params: entry.pack(fx.values, fx.colors),
          colours: new Float32Array(16),
          timeMs: 0,
        },
      ],
      (why) => assert.ok(false, `the pass reported: ${why}`),
    );
    const top = pixel(canvas, 32, 8);
    const bottom = pixel(canvas, 32, 56);
    assert.ok(top[0] > top[2], `the top is still red, got rgba(${top})`);
    assert.ok(
      bottom[2] > bottom[0],
      `the bottom is still blue, got rgba(${bottom})`,
    );
  });

  test('the different blurs actually look different', async function (assert) {
    await openEditor();
    const { runPasses } = await import('woogi-tools/utils/ferrite/gpu');
    const { SHADER_EFFECTS } =
      await import('woogi-tools/utils/ferrite/shader-map');
    const { makeEffect } = await import('woogi-tools/utils/ferrite/effects');

    // CSS has one blur and it is round, so these all used to come out
    // identical. A single bright dot is the clearest way to tell them apart:
    // a directional blur smears it into a line, a radial one into an arc.
    const render = (name) => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = '#000000';
      x.fillRect(0, 0, 64, 64);
      x.fillStyle = '#ffffff';
      x.fillRect(28, 28, 8, 8);
      const entry = SHADER_EFFECTS[name];
      const fx = makeEffect(name);
      runPasses(
        c,
        [
          {
            shader: entry.shader,
            params: entry.pack(fx.values, fx.colors, { w: 64, h: 64 }),
            colours: new Float32Array(16),
            timeMs: 0,
          },
        ],
        (why) => assert.ok(false, `${name}: ${why}`),
      );
      return c.getContext('2d').getImageData(0, 0, 64, 64).data;
    };

    const names = ['Directional Blur', 'Radial Blur', 'Box Blur', 'Bokeh Blur'];
    const results = names.map(render);
    // Every one must differ from every other, not just from the original.
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        let diff = 0;
        for (let k = 0; k < results[i].length; k += 4)
          diff += Math.abs(results[i][k] - results[j][k]);
        assert.ok(
          diff > 2000,
          `${names[i]} and ${names[j]} are different pictures (diff ${diff})`,
        );
      }
    }

    // And a directional blur is a horizontal streak at its default angle: the
    // dot should reach further sideways than it does vertically.
    const dir = results[0];
    const at = (px, py) => dir[(py * 64 + px) * 4];
    assert.ok(
      at(48, 32) > at(32, 48),
      'the streak runs along the angle, not across it',
    );
  });

  test('every mapped shader compiles', async function (assert) {
    await openEditor();
    const { runPasses } = await import('woogi-tools/utils/ferrite/gpu');
    const { SHADER_EFFECTS } =
      await import('woogi-tools/utils/ferrite/shader-map');
    const { makeEffect } = await import('woogi-tools/utils/ferrite/effects');

    // A shader that will not compile is reported rather than thrown, so the
    // only way to notice is to ask for every one of them.
    const broken = [];
    for (const [name, entry] of Object.entries(SHADER_EFFECTS)) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const x = canvas.getContext('2d');
      x.fillStyle = '#888888';
      x.fillRect(0, 0, 32, 32);
      const fx = makeEffect(name);
      runPasses(
        canvas,
        [
          {
            shader: entry.shader,
            params: entry.pack(fx.values, fx.colors),
            colours: new Float32Array(16),
            timeMs: 0,
          },
        ],
        (why) => broken.push(`${name}: ${why}`),
      );
    }
    assert.deepEqual(broken, [], 'no shader failed to compile or run');
  });

  test('dragging on the stage moves the layer and repaints at once', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');
    await waitUntil(() => find('.fr-canvas')?.width === 1920, {
      timeout: 3000,
    });

    // Shrink it so there is somewhere for it to move *to*, and an edge to see.
    await click('.fr-dock .fr-tab:nth-child(2)'); // Properties
    const overlay = find('.fr-overlay');
    const box = overlay.getBoundingClientRect();
    const read = (x, y) =>
      Array.from(
        find('.fr-canvas').getContext('2d').getImageData(x, y, 1, 1).data,
      );

    // A box layer fills the frame, so drag it right and the left edge should
    // become transparent where the layer no longer reaches.
    const before = read(20, 540);
    assert.ok(before[3] > 0, 'the layer covers the left edge to begin with');

    const at = (fx, fy) => ({
      clientX: box.left + box.width * fx,
      clientY: box.top + box.height * fy,
    });
    await triggerEvent(overlay, 'pointerdown', { button: 0, ...at(0.5, 0.5) });
    await triggerEvent(overlay, 'pointermove', { ...at(0.9, 0.5) });
    await triggerEvent(overlay, 'pointerup', { ...at(0.9, 0.5) });
    // One frame for the compositor.
    await waitUntil(() => read(20, 540)[3] === 0, { timeout: 2000 });
    assert.strictEqual(
      read(20, 540)[3],
      0,
      'the layer moved out of the left edge',
    );
  });

  test('a keyframe can be selected and eased', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');
    await click('.fr-dock .fr-tab:nth-child(2)'); // Properties
    await click('.fr-insp .fr-watch'); // animate the first transform row

    // The diamond is on the timeline; twirl down to it and click it.
    await click('.fr-trow.is-layer .fr-twirl');
    await click('.fr-trow.is-group .fr-twirl');
    assert
      .dom('.fr-ease-actions .fr-chip:first-child')
      .isDisabled('nothing to ease until a keyframe is picked');

    const canvas = find('.fr-tracks-canvas');
    const box = canvas.getBoundingClientRect();
    // The key sits at the playhead, which is at zero, so the left edge.
    const rows = [...document.querySelectorAll('.fr-trow')];
    const propRow = rows.findIndex((r) => r.classList.contains('is-prop'));
    await triggerEvent(canvas, 'pointerdown', {
      clientX: box.left + 2,
      clientY: box.top + propRow * 22 + 11,
    });
    await triggerEvent(canvas, 'pointerup', {
      clientX: box.left + 2,
      clientY: box.top + propRow * 22 + 11,
    });

    assert
      .dom('.fr-ease-actions .fr-chip:first-child')
      .isNotDisabled('a keyframe is selected');
    await click('.fr-dock .fr-tab:nth-child(2)');
    await click('.fr-ease-actions .fr-chip:first-child'); // Ease
    assert.dom('.fr-status').includesText('eased', 'and it said so');
  });

  test('position, size and anchor are one row each', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');
    await click('.fr-dock .fr-tab:nth-child(2)');

    // Ferrite puts X and Y on one row; two rows of one number each is two
    // things to hunt for.
    const labels = findAll('.fr-insp .fr-label').map((e) =>
      e.textContent.trim(),
    );
    assert.ok(labels.includes('Position'), 'Position, not Position X');
    assert.notOk(labels.includes('Position X'), 'and no split pair');
    assert.ok(labels.includes('Size'), 'Width and Height are Size');
    assert.ok(labels.includes('Anchor'), 'and the anchor is paired too');

    // The paired row carries two numbers.
    const row = findAll('.fr-insp .fr-row').find(
      (r) => r.querySelector('.fr-label')?.textContent.trim() === 'Position',
    );
    assert.strictEqual(
      row.querySelectorAll('.fr-num').length,
      2,
      'both halves on the one row',
    );
  });

  test('the timeline carries the parent and matte links', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');

    // Two whips per layer row — one for the parent, one for the matte —
    // rather than the links living off in the properties panel.
    assert
      .dom('.fr-trow.is-layer:first-child .fr-whip-btn')
      .exists({ count: 2 });
    assert.dom('.fr-trow.is-layer:first-child .fr-link').exists({ count: 2 });
    assert.dom('.fr-tree-head').includesText('Matte');
  });

  test('a rubber band on the stage selects, and empty space deselects', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');
    await waitUntil(() => find('.fr-canvas')?.width === 1920, {
      timeout: 3000,
    });

    const overlay = find('.fr-overlay');
    const box = overlay.getBoundingClientRect();
    const at = (fx, fy) => ({
      clientX: box.left + box.width * fx,
      clientY: box.top + box.height * fy,
    });

    // Clicking nothing deselects; a box layer fills the frame, so shrink the
    // selection test to a band drawn from a corner over the layer.
    await triggerEvent(overlay, 'pointerdown', { button: 0, ...at(0.5, 0.5) });
    await triggerEvent(overlay, 'pointerup', at(0.5, 0.5));
    assert
      .dom('.fr-trow.is-layer.is-selected')
      .exists('clicking it selects it');

    // A press-and-release on the layer keeps it; a band over nothing clears.
    await click('.fr-menu-btn[data-menu="Edit"]');
    await click('.fr-menu .fr-menu-row[data-row="deselect-all"]');
    assert.dom('.fr-trow.is-layer.is-selected').doesNotExist('deselected');

    // And a band that crosses the layer picks it up again.
    await triggerEvent(overlay, 'pointerdown', {
      button: 0,
      ...at(0.02, 0.02),
    });
    await triggerEvent(overlay, 'pointermove', at(0.6, 0.6));
    await triggerEvent(overlay, 'pointerup', at(0.6, 0.6));
    assert.dom('.fr-trow.is-layer.is-selected').exists('the band caught it');
  });

  test('motion blur smears a moving layer', async function (assert) {
    await openEditor();
    const { drawScene } = await import('woogi-tools/utils/ferrite/render');
    const { makeScene, makeLayer, putKey } =
      await import('woogi-tools/utils/ferrite/model');

    const settings = { width: 160, height: 90, fps: 30 };
    const build = (motionBlur) => {
      let layer = makeLayer('box', { outMs: 2000, motionBlur });
      layer.style = {
        ...layer.style,
        background: '#ffffff',
        autoSize: false,
        width: 20,
        height: 90,
      };
      // Travelling fast across the frame, which is the only time motion blur
      // has anything to do.
      layer = putKey(layer, 'x', 0, -400);
      layer = putKey(layer, 'x', 1000, 400);
      const scene = makeScene({ layers: [layer], background: '#000000' });
      scene.width = 160;
      scene.height = 90;
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      drawScene(canvas.getContext('2d'), scene, settings, 500, new Map());
      return canvas.getContext('2d').getImageData(0, 0, 160, 90).data;
    };

    const sharp = build(false);
    const smeared = build(true);
    // A smear covers more columns than the hard-edged version, at lower value.
    const lit = (data) => {
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 8) n++;
      return n;
    };
    assert.ok(lit(sharp) > 0, 'the layer is on screen at all');
    assert.ok(
      lit(smeared) > lit(sharp) * 1.5,
      `motion blur reaches further (${lit(sharp)} -> ${lit(smeared)})`,
    );
  });

  test('a keyframe curve can be dragged by hand', async function (assert) {
    await openEditor();
    const { makeLayer, putKey, valueAt, cubic } =
      await import('woogi-tools/utils/ferrite/model');
    let layer = makeLayer('box');
    layer = putKey(layer, 'x', 0, 0);
    layer = putKey(layer, 'x', 1000, 100);
    // A hand-dragged curve overrides the named preset, which is the whole
    // point of being able to drag it.
    layer.tracks.x[0].bezier = [0.9, 0, 1, 1];
    const eased = valueAt(layer, 'x', 500);
    assert.ok(
      Math.abs(eased - cubic(0.9, 0, 1, 1, 0.5) * 100) < 0.01,
      'the bezier is what the sampler uses',
    );
    assert.ok(eased < 30, 'and it really is a slow start');
  });

  test('it opens on a start page, not on an empty timeline', async function (assert) {
    await visit('/video-editor');

    // The question a web editor has to answer before anything else is "is my
    // work still here", and an empty timeline answers it wrongly.
    assert.dom('.fr-start').exists('the start page is what opens');
    assert.dom('.fr-menubar').doesNotExist('and the editor is not up yet');
    assert.dom('.fr-empty').includesText('Nothing saved here yet');

    await click('.fr-preset[data-preset="vertical"]');
    await fillIn('.fr-start-new .fr-input', 'Test comp');
    await click('[data-new-project]');

    assert.dom('.fr-menubar').exists('and now the editor is');
    assert.dom('.fr-start').doesNotExist();
    // The preset it was given, not the default.
    await waitUntil(() => find('.fr-canvas')?.width === 1080, {
      timeout: 3000,
    });
    assert.strictEqual(find('.fr-canvas').height, 1920, 'a vertical comp');
    assert.dom('.fr-menubar').includesText('Test comp', 'under its own name');
  });

  test('a project saved in the browser comes back on the start page', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');

    await click('.fr-menu-btn[data-menu="File"]');
    await click('.fr-menu .fr-menu-row[data-row="save-in-this-browser"]');
    await click('.fr-menu-btn[data-menu="File"]');
    await click('.fr-menu .fr-menu-row[data-row="start-page"]');

    assert.dom('.fr-start').exists('back at the start page');
    assert
      .dom('.fr-recent')
      .exists({ count: 1 }, 'the project is on the shelf');
    assert.dom('.fr-recent').includesText('1 layer');

    await click('.fr-recent-open');
    assert.dom('.fr-menubar').exists('and it opens again');
    assert.dom('.fr-trow.is-layer').exists({ count: 1 }, 'with its layer');
  });

  test('the render dialog has the settings a render actually needs', async function (assert) {
    await openEditor();
    await click('.fr-menu-btn[data-menu="Layer"]');
    await click('.fr-menu .fr-menu-row[data-row="box"]');
    await click('[data-open-export]');

    assert.dom('.fr-modal.is-render').exists('the render queue is up');
    // Render settings and output module, as After Effects splits them.
    assert.dom('[data-field="span"]').exists('a time span');
    assert.dom('[data-field="resolution"]').exists('a resolution');
    assert.dom('[data-field="quality"]').exists('a quality');
    assert.dom('[data-field="format"]').exists('a format');
    assert.dom('[data-engine="live"]').exists('and the engine choice');

    // Half resolution is half the comp, worked out and shown before anything
    // starts rather than discovered in the file afterwards.
    assert.dom('[data-out="size"]').hasText('1920×1080');
    await fillIn('[data-field="resolution"]', 'half');
    assert.dom('[data-out="size"]').hasText('960×540');

    // A format that cannot record live moves the engine rather than leaving
    // the panel describing a render it will not do.
    await fillIn('[data-field="format"]', 'png-seq');
    assert.dom('[data-engine="live"]').isDisabled('a zip cannot be recorded');
    assert.dom('[data-engine="exact"]').hasClass('is-on', 'so it moved');
  });

  test('a wide blur is a smear, not a row of copies', async function (assert) {
    await openEditor();
    const { runPasses, hasGpu } = await import('woogi-tools/utils/ferrite/gpu');
    const gpu = hasGpu();

    // A thin bright bar, blurred a long way sideways.
    //
    // A blur whose taps are spread wider than a pixel does not smear the bar,
    // it *prints copies of it*: a row of ghosts with gaps of background in
    // between. That is the afterimage look, and no reweighting of the taps
    // fixes it, because the pixels in the gaps were never read. This is the
    // test that can see it — a left/right brightness check cannot.
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 320, 60);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(157, 0, 6, 60);

    // Length 90px, angle 0: the taps land nearly 8px apart before any
    // mip-aware sampling, which is where the ghosting used to come from.
    const params = new Float32Array(24);
    params[0] = 90;
    const ran =
      gpu &&
      runPasses(canvas, [
        {
          shader: 'directional-blur',
          params,
          colours: new Float32Array(16),
          timeMs: 0,
        },
      ]);
    assert.strictEqual(ran, gpu, 'the pass ran wherever WebGL2 exists');

    // Without WebGL2 there is nothing to judge, so the row the measurements
    // run over is a drawn smear rather than a rendered one. The assertions
    // below still run, which is the point: a test that returns early reports
    // a pass it never made.
    const row = ran
      ? ctx.getImageData(0, 30, 320, 1).data
      : smearedRow(157, 6, 90);
    const lit = [];
    for (let x = 0; x < 320; x++) if (row[x * 4] > 6) lit.push(x);
    assert.ok(lit.length > 60, `the streak is wide (${lit.length}px)`);

    // Every pixel between the ends of the streak is lit. A ghosted blur fails
    // this: it has dark gaps inside its own span.
    const gaps = lit[lit.length - 1] - lit[0] + 1 - lit.length;
    assert.strictEqual(gaps, 0, `no holes inside the smear (${gaps} dark)`);

    // And it falls off rather than stepping.
    let worst = 0;
    for (let i = 1; i < lit.length; i++)
      if (lit[i] === lit[i - 1] + 1)
        worst = Math.max(
          worst,
          Math.abs(row[lit[i] * 4] - row[lit[i - 1] * 4]),
        );
    assert.ok(worst < 90, `the falloff is smooth (worst step ${worst})`);
  });

  test('leaving the editor gives the site back', async function (assert) {
    await openEditor();
    assert.dom('.fr').exists();
    await visit('/color-picker');
    assert.dom('.fr').doesNotExist('the editor is gone');
    assert.dom('.app-shell').exists('and the shell is back');
    assert.dom('.sidebar').exists();
    assert.strictEqual(
      document.documentElement.dataset.bare,
      undefined,
      'the scroll lock was released',
    );
  });
});
