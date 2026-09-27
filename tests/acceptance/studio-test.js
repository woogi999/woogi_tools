import { module, test } from 'qunit';
import {
  visit,
  click,
  fillIn,
  find,
  findAll,
  waitUntil,
  triggerEvent,
  triggerKeyEvent,
  currentURL,
} from '@ember/test-helpers';
import { getPageTitle } from 'ember-page-title/test-support';
import { setupApplicationTest } from 'woogi-tools/tests/helpers';
import { idbDelete, idbDeletePrefix } from 'woogi-tools/utils/idb-store';

const byText = (selector, text) =>
  findAll(selector).find((el) => el.textContent.trim().includes(text));

const frames = (n = 3) =>
  new Promise((resolve) => {
    const step = (k) =>
      k ? requestAnimationFrame(() => step(k - 1)) : resolve();
    step(n);
  });

async function open() {
  await visit('/3d-studio');
  await waitUntil(() => find('.st-canvas'), { timeout: 20000 });
  await frames();
}

// The viewport's pixel at a fraction across and down (the renderer keeps
// its drawing buffer, so it can be read back).
function pixel(fx = 0.5, fy = 0.5) {
  const c = find('.st-canvas');
  const tmp = document.createElement('canvas');
  tmp.width = c.width;
  tmp.height = c.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(c, 0, 0);
  return [
    ...ctx.getImageData(
      Math.floor(c.width * fx),
      Math.floor(c.height * fy),
      1,
      1,
    ).data,
  ];
}

const BACKGROUND = [42, 45, 52];
const near = (a, b, tol = 6) =>
  a.slice(0, 3).every((x, i) => Math.abs(x - b[i]) <= tol);

// Clicks (or drags across) the viewport at fractions of its size.
async function pointer(type, fx, fy, opts = {}) {
  const c = find('.st-canvas');
  const r = c.getBoundingClientRect();
  await triggerEvent(c, type, {
    clientX: r.left + r.width * fx,
    clientY: r.top + r.height * fy,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    pointerId: 1,
    ...opts,
  });
}

async function clickViewport(fx = 0.5, fy = 0.5) {
  await pointer('pointerdown', fx, fy);
  await pointer('pointerup', fx, fy);
}

async function key(k, opts = {}) {
  await triggerKeyEvent('.st-canvas', 'keydown', k, opts);
}

// Types into a scrubbable number field (click turns it into an input).
async function setNum(label, value, scope = document) {
  const field = [...scope.querySelectorAll('.st-num')].find(
    (n) =>
      (n.querySelector('.st-num-label')?.textContent.trim() ?? '') === label,
  );
  const span = field.querySelector('.st-num-value');
  await triggerEvent(span, 'pointerdown', {
    button: 0,
    clientX: 5,
    pointerId: 1,
  });
  await triggerEvent(span, 'pointerup', {
    button: 0,
    clientX: 5,
    pointerId: 1,
  });
  await waitUntil(() => field.querySelector('.st-num-input'));
  await fillIn(field.querySelector('.st-num-input'), String(value));
  await triggerEvent(field.querySelector('.st-num-input'), 'blur');
}

const faces = () =>
  Number(
    find('.st-counts')
      .textContent.match(/([\d,]+)\s+faces/)[1]
      .replace(/,/g, ''),
  );

module('Acceptance | 3D Studio', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    await idbDelete('woogi-tool:3d-studio');
    await idbDelete('woogi-tool:3d-studio:project');
    await idbDeletePrefix('woogi-shelf:3d-studio:');
  });

  test('opens full-window on a starter scene, and draws it', async function (assert) {
    await open();
    assert.strictEqual(getPageTitle(), '3D Studio | Woogi Tools');
    assert
      .dom('.sidebar')
      .doesNotExist('a page of its own, like the video editor');
    assert.dom('.st-brand').hasAttribute('href', '/', 'with its own way home');
    assert
      .dom('.st-ws')
      .exists(
        { count: 7 },
        'Model, Sculpt, UV, Texture, Material, Rig, Animate',
      );
    for (const name of ['Cube', 'Sun', 'Camera'])
      assert.ok(byText('.st-row-name', name), `${name} in the outliner`);
    const centre = pixel(0.5, 0.52);
    assert.false(
      near(centre, BACKGROUND),
      `the cube is drawn in the middle (${centre})`,
    );
    assert.true(
      near(pixel(0.02, 0.95), BACKGROUND, 40),
      'and the corner is background',
    );
  });

  test('is a Magnum Opus showpiece with a beta tag, in orange', async function (assert) {
    await visit('/');
    const card = findAll('.tool-card').find((c) =>
      c.querySelector('.tool-card-link')?.textContent.includes('3D Studio'),
    );
    assert.dom(card).hasClass('is-opus');
    assert.dom(card.querySelector('.card-sticker')).hasText('beta');
    const link = findAll('.sidebar-nav .nav-link').find((a) =>
      a.textContent.includes('3D Studio'),
    );
    assert.dom(link).hasClass('is-opus');
    assert.dom(link.querySelector('.nav-tag')).hasText('beta');
    const group = [
      ...link.closest('.sidebar-nav').querySelectorAll('.nav-group-label'),
    ].map((e) => e.textContent.trim());
    assert.true(group.includes('Magnum Opus'));
  });

  test('a stinger plays over the jump in and back out', async function (assert) {
    const stinger = this.owner.lookup('service:stinger');
    stinger.enabled = true;
    const seen = [];
    const observer = new MutationObserver(() => {
      const el = find('.stinger');
      if (el) seen.push(el.className);
    });
    observer.observe(document.querySelector('#ember-testing'), {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    await visit('/qr-code');
    await click('.sidebar-nav a[href="/3d-studio"]');
    assert.strictEqual(currentURL(), '/3d-studio');
    assert.true(
      seen.some((c) => c.includes('is-in')),
      'covered',
    );
    assert.true(
      seen.some((c) => c.includes('is-out')),
      'and uncovered',
    );
    seen.length = 0;
    await waitUntil(() => find('.st-brand'), { timeout: 20000 });
    await click('.st-brand');
    assert.strictEqual(currentURL(), '/');
    assert.true(seen.length > 0, 'on the way out too');
    observer.disconnect();
    stinger.enabled = false;
  });

  test('primitives keep their recipe: a cylinder becomes a cone', async function (assert) {
    await open();
    await click('.st-add');
    await click('.st-add-cylinder');
    assert.ok(byText('.st-row-name', 'Cylinder'), 'added');
    assert.strictEqual(faces(), 26, '24 sides and two caps');
    await setNum('Sides', 8);
    assert.strictEqual(faces(), 10, 'fewer sides');
    await setNum('Top radius', 0);
    assert.strictEqual(
      faces(),
      9,
      'the top closes to a point: eight triangles and a base',
    );
    await key('Z', { ctrlKey: true });
    assert.strictEqual(faces(), 10, 'undo');
  });

  test('booleans stay live: moving the cutter re-cuts', async function (assert) {
    await open();
    await click(byText('.st-row', 'Cube'));
    await click('.st-bool-subtract');
    assert.ok(
      byText('.st-row-sub', 'Boolean Subtract'),
      'the recipe shows the boolean',
    );
    assert.ok(
      byText('.st-row.is-cutter', 'Subtract cylinder'),
      'with its cutter under it',
    );
    await click(byText('.st-row', 'Cube'));
    const cut = faces();
    assert.true(cut > 6, `the cube is cut (${cut} faces)`);
    await click(byText('.st-row', 'Subtract cylinder'));
    await setNum('', 0.9, find('.st-vec'));
    await click(byText('.st-row', 'Cube'));
    assert.notStrictEqual(faces(), cut, 'moving the cutter changed the cut');
  });

  test('edit mode: pick a face, extrude it, undo', async function (assert) {
    await open();
    await click(byText('.st-row', 'Cube'));
    await key('Tab');
    assert.dom('.st-mode-chip').hasText('Edit');
    await key('3');
    assert.dom('.st-sel-face').hasClass('active');
    await clickViewport(0.5, 0.52);
    await click('.st-op-extrude');
    assert.strictEqual(faces(), 10, 'one face out, four walls');
    assert.dom('.st-lastop').exists('the last operation can be retuned');
    await key('Z', { ctrlKey: true });
    assert.strictEqual(faces(), 6);
    await key('Tab');
    assert.dom('.st-mode-chip').hasText('Object');
  });

  test('texture: a smart material, then a brush stroke on top', async function (assert) {
    await open();
    await click(byText('.st-row', 'Cube'));
    await key('F4');
    assert.dom('.st-mode-chip').hasText('Texture paint');
    const before = pixel(0.5, 0.52);
    await click('.st-smart-tab');
    await click('.st-smart-rust');
    await click(byText('.st-subtabs button', 'Layers'));
    assert
      .dom('.st-layer')
      .exists({ count: 2 }, 'steel and rust, as editable layers');
    await frames(4);
    const rusty = pixel(0.5, 0.52);
    assert.false(
      near(rusty, before, 3),
      `the material changed (${before} → ${rusty})`,
    );
    // Paint across the middle of the cube.
    await pointer('pointerdown', 0.45, 0.52);
    for (let i = 1; i <= 6; i++)
      await pointer('pointermove', 0.45 + i * 0.02, 0.52);
    await pointer('pointerup', 0.57, 0.52);
    await frames(4);
    assert
      .dom('.st-layer')
      .exists({ count: 3 }, 'the stroke went on a new paint layer');
    const painted = pixel(0.5, 0.52);
    assert.true(
      painted[0] > painted[2] + 30,
      `the brush's red is there (${painted})`,
    );
    await key('Z', { ctrlKey: true });
    await frames(4);
    assert.false(
      near(pixel(0.5, 0.52), painted, 2),
      'undo takes the stroke off',
    );
  });

  test('rig: a humanoid fitted and bound to a mesh, with controllers', async function (assert) {
    await open();
    await click('.st-add');
    await click('.st-add-capsule');
    await key('F6');
    await click('.st-generate-rig');
    assert.ok(byText('.st-row-name', 'Humanoid rig'));
    for (const name of [
      'LeftHand.IK',
      'RightFoot.IK',
      'LeftForeArm.Pole',
      'Head.FK',
    ])
      assert.ok(byText('.st-row-name', name), name);
    await click(byText('.st-row', 'Capsule'));
    await click('.st-weights-tab');
    assert
      .dom('.st-group')
      .exists({ count: 17 }, 'a vertex group per deforming bone');
    await click('.st-paint-weights');
    assert.dom('.st-mode-chip').hasText('Weight paint');
  });

  test('animate: keys, auto-keying and interpolation', async function (assert) {
    await open();
    await click(byText('.st-row', 'Cube'));
    await key('F7');
    assert.dom('.st-clip').exists({ count: 1 }, 'a clip to start with');
    await key('I');
    assert.ok(byText('.st-tl-label', 'Location'), 'keyed');
    await setNum('Frame', 20, find('.st-transport'));
    const x = find('.st-vec .st-num');
    await setNum('', 4, x.parentElement);
    await setNum('Frame', 10, find('.st-transport'));
    const shown = Number(find('.st-vec .st-num-value').textContent);
    assert.true(shown > 0.5, `past the start at frame 10 (${shown})`);
    assert.true(shown < 3.5, `short of the end at frame 10 (${shown})`);
    await click('.st-graph-btn');
    assert
      .dom('.st-tl-curve')
      .exists({ count: 9 }, 'a curve per channel of the selection');
  });

  test('sculpt: a stroke raises the surface', async function (assert) {
    await open();
    await click(byText('.st-row', 'Cube'));
    await key('F2');
    assert.dom('.st-mode-chip').hasText('Sculpt');
    await click('.st-subdivide');
    await click('.st-subdivide');
    assert.strictEqual(
      faces(),
      96,
      'subdivided twice to have something to sculpt',
    );
    await frames();
    const before = pixel(0.5, 0.52);
    await pointer('pointerdown', 0.48, 0.52);
    for (let i = 1; i <= 5; i++)
      await pointer('pointermove', 0.48 + i * 0.01, 0.52);
    await pointer('pointerup', 0.53, 0.52);
    await frames(4);
    assert.false(
      near(pixel(0.5, 0.52), before, 1),
      'the shading moved with the surface',
    );
    assert.strictEqual(
      faces(),
      96,
      'sculpting moves vertices, it doesn’t add faces',
    );
  });

  test('UV: auto unwrap from the UV workspace', async function (assert) {
    await open();
    await click(byText('.st-row', 'Cube'));
    await key('F3');
    assert.dom('.st-uv-canvas').exists('the UV editor is beside the viewport');
    assert.dom('.st-mode-chip').hasText('Edit');
    await click('.st-uv-auto');
    assert
      .dom('.st-uv-stats')
      .includesText('6 islands', 'one per side of the cube');
    assert.dom('.st-uv-stats').doesNotIncludeText('overlapping');
  });

  test('rig: moving a hand controller bends the skinned mesh', async function (assert) {
    await open();
    await click('.st-add');
    await click('.st-add-capsule');
    await key('F6');
    await click('.st-generate-rig');
    await frames();
    const view = find('.st-canvas').studioView;
    const capsule = [...view.nodes.values()].find((n) => n.mesh?.isSkinnedMesh);
    assert.ok(capsule, 'the capsule is a skinned mesh now');
    const geometry = capsule.mesh.geometry;
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const names = capsule.mesh.skeleton.bones.map((b) => b.name);
    const hand = names.indexOf('LeftForeArm');
    // The vertex the left forearm moves most.
    let best = -1;
    let bestW = 0;
    for (let i = 0; i < skinIndex.count; i++)
      for (let k = 0; k < 4; k++)
        if (
          skinIndex.getComponent(i, k) === hand &&
          skinWeight.getComponent(i, k) > bestW
        ) {
          bestW = skinWeight.getComponent(i, k);
          best = i;
        }
    assert.true(
      bestW > 0.3,
      `the forearm has a vertex group (${bestW.toFixed(2)})`,
    );
    const where = () => {
      capsule.mesh.updateMatrixWorld(true);
      capsule.mesh.skeleton.update();
      const v = new (find(
        '.st-canvas',
      ).studioView.camera.position.constructor)().fromBufferAttribute(
        geometry.getAttribute('position'),
        best,
      );
      capsule.mesh.applyBoneTransform(best, v);
      return v.clone();
    };
    const rest = where();
    await click(byText('.st-row', 'LeftHand.IK'));
    const location = findAll('.st-vec').find(
      (v) => v.querySelector('.st-label')?.textContent.trim() === 'Location',
    );
    assert.ok(location, 'the controller’s transform is in the Rig panel');
    const y = Number(location.querySelectorAll('.st-num-value')[1].textContent);
    const field = location.querySelectorAll('.st-num')[1];
    const span = field.querySelector('.st-num-value');
    await triggerEvent(span, 'pointerdown', {
      button: 0,
      clientX: 5,
      pointerId: 1,
    });
    await triggerEvent(span, 'pointerup', {
      button: 0,
      clientX: 5,
      pointerId: 1,
    });
    await waitUntil(() => field.querySelector('.st-num-input'));
    await fillIn(field.querySelector('.st-num-input'), String(y + 0.4));
    await triggerEvent(field.querySelector('.st-num-input'), 'blur');
    await frames();
    const moved = where();
    assert.true(
      moved.distanceTo(rest) > 0.05,
      `the forearm's vertex followed the IK (${moved.distanceTo(rest).toFixed(3)})`,
    );
  });

  test('exports a GLB and an OBJ', async function (assert) {
    await open();
    // Downloads are caught on their way out rather than saved.
    const files = [];
    const realClick = HTMLAnchorElement.prototype.click;
    const realUrl = URL.createObjectURL;
    HTMLAnchorElement.prototype.click = function () {};
    URL.createObjectURL = (blob) => {
      files.push(blob);
      return realUrl(blob);
    };
    try {
      await click('.st-export');
      await click('.st-format-glb');
      await click('.st-do-export');
      await waitUntil(() => files.length === 1, { timeout: 20000 });
      const glb = new Uint8Array(await files[0].arrayBuffer());
      assert.strictEqual(
        String.fromCharCode(...glb.slice(0, 4)),
        'glTF',
        'a binary glTF',
      );
      await click('.st-export');
      await click('.st-format-obj');
      await click('.st-do-export');
      await waitUntil(() => files.length === 2, { timeout: 20000 });
      const zip = new Uint8Array(await files[1].arrayBuffer());
      assert.strictEqual(String.fromCharCode(zip[0], zip[1]), 'PK', 'a zip');
      // And back in again.
      const rows = findAll('.st-row').length;
      await click('.st-open');
      await triggerEvent('.st-dialog input[type="file"]', 'change', {
        files: [
          new File([glb], 'round-trip.glb', { type: 'model/gltf-binary' }),
        ],
      });
      await waitUntil(() => findAll('.st-row').length > rows, {
        timeout: 20000,
      });
      const names = findAll('.st-row-name').map((e) => e.textContent.trim());
      assert.true(
        names.includes('Cube.001'),
        `the exported cube came back as a mesh (${names.join(', ')})`,
      );
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
      URL.createObjectURL = realUrl;
    }
  });

  test('saves in the browser and opens again', async function (assert) {
    await open();
    await fillIn('.st-name-input', 'Robot');
    await triggerEvent('.st-name-input', 'change');
    await click('.st-save');
    await waitUntil(() => find('.st-dirty:not(.is-dirty)'), { timeout: 5000 });
    await click('.st-open');
    await waitUntil(() => find('.st-project'), { timeout: 5000 });
    assert.dom('.st-project').includesText('Robot');
  });
});
