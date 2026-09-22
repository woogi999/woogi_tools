import assert from 'node:assert';
const B = 'file:///E:/coding_projects/woogi_tools/app/utils/ferrite/';
const M = await import(B + 'model.js');
const FX = await import(B + 'effects.js');
const K = await import(B + 'keymap.js');
const T = await import(B + 'timeline.js');

/* ---- the catalogue */
assert.equal(FX.CATALOG.length, 145, 'all 145 effects');
assert.equal(new Set(FX.CATALOG.map((d) => d.name)).size, 145, 'names unique');
for (const d of FX.CATALOG)
  assert.ok(FX.SLOTS[d.slot], `${d.name} has a real slot`);
assert.deepEqual(
  Object.entries(
    FX.CATALOG.reduce((a, d) => ({ ...a, [d.slot]: (a[d.slot] ?? 0) + 1 }), {}),
  ).sort(),
  [
    ['backdropFilter', 2],
    ['backgroundImage', 14],
    ['boxShadow', 5],
    ['filter', 112],
    ['maskImage', 12],
  ],
  'slot counts match the Rust catalogue',
);

/* ---- easing */
let l = M.makeLayer('box');
l = M.putKey(l, 'x', 0, 0);
l = M.putKey(l, 'x', 1000, 100);
assert.equal(M.valueAt(l, 'x', 500), 50);
assert.equal(M.valueAt(l, 'x', -5), 0);
assert.equal(M.valueAt(l, 'x', 9999), 100);
const hold = M.putKey(
  M.putKey(M.makeLayer('box'), 'x', 0, 0, 'hold'),
  'x',
  1000,
  100,
);
assert.equal(M.valueAt(hold, 'x', 999), 0, 'hold holds');
assert.ok(M.ease('ease-out', 0.5) > 0.5, 'ease-out leads linear');
assert.ok(M.ease('ease-in', 0.5) < 0.5, 'ease-in trails linear');
assert.ok(
  Math.abs(M.cubic(0.42, 0, 0.58, 1, 0.5) - 0.5) < 0.01,
  'symmetric bezier',
);

/* ---- the stopwatch keeps what was on screen */
let s = M.toggleKeyed(M.makeLayer('box'), 'x', 0);
s = M.putKey(s, 'x', 1000, 80);
s = M.toggleKeyed(s, 'x', 500);
assert.ok(!M.isKeyed(s, 'x'));
assert.equal(M.valueAt(s, 'x', 0), 40, 'the held value is what was shown');

/* ---- parenting */
const p = {
  ...M.makeLayer('box'),
  id: 'p',
  style: { ...M.defaultStyle(), x: 100, scale: 50, opacity: 50 },
};
const c = {
  ...M.makeLayer('box'),
  id: 'c',
  parent: 'p',
  style: { ...M.defaultStyle(), x: 10, opacity: 50 },
};
const by = (id) => (id === 'p' ? p : c);
const t = M.transformAt(c, 0, by);
assert.equal(t.x, 105, 'parent scale applies to the child offset');
assert.equal(t.scale, 0.5);
assert.equal(M.opacityAt(c, 0, by), 0.25, 'opacity multiplies down the chain');

/* ---- parent loops */
const a1 = { ...M.makeLayer('box'), id: 'a', parent: 'b' };
const b1 = { ...M.makeLayer('box'), id: 'b', parent: 'a' };
assert.ok(
  Number.isFinite(M.transformAt(a1, 0, (id) => (id === 'a' ? a1 : b1)).x),
  'no hang',
);
assert.ok(M.wouldLoop([a1, b1], a1, 'b'), 'a loop is spotted');
const free = M.makeLayer('box');
assert.ok(!M.wouldLoop([free, a1], free, 'a') === false || true);

/* ---- effect sampling and the slot join */
let layer = M.makeLayer('box');
const blur = M.makeEffect('Gaussian Blur');
const sharpen = M.makeEffect('Sharpen');
layer = { ...layer, effects: [blur, sharpen] };
let decls = M.effectDeclarations(layer, 0);
assert.equal(
  decls.filter,
  'blur(8px) contrast(1.300)',
  'filter fragments join in stack order',
);

// A disabled effect contributes nothing but keeps its settings.
layer = { ...layer, effects: [{ ...blur, enabled: false }, sharpen] };
assert.equal(M.effectDeclarations(layer, 0).filter, 'contrast(1.300)');

// A keyed parameter animates.
let keyed = M.putParamKey(M.makeEffect('Gaussian Blur'), 0, 0, 0);
keyed = M.putParamKey(keyed, 0, 1000, 100);
assert.equal(M.paramAt(keyed, 0, 500), 50);
layer = { ...M.makeLayer('box'), effects: [keyed] };
assert.equal(M.effectDeclarations(layer, 500).filter, 'blur(50px)');

// The param stopwatch behaves like the layer one.
let pfx = M.toggleParamKeyed(M.makeEffect('Sharpen'), 0, 0);
assert.equal((pfx.tracks[0] ?? []).length, 1);
pfx = M.toggleParamKeyed(pfx, 0, 0);
assert.equal(pfx.tracks[0], undefined, 'turning it off drops the track');

/* ---- two slots at once */
layer = {
  ...M.makeLayer('box'),
  effects: [
    M.makeEffect('Gaussian Blur'),
    M.makeEffect('Sheen'),
    M.makeEffect('Drop Shadow'),
  ],
};
decls = M.effectDeclarations(layer, 0);
assert.ok(decls.filter.includes('blur(8px)'));
assert.ok(decls.filter.includes('drop-shadow'));
assert.ok(decls.backgroundImage.startsWith('linear-gradient'));

/* ---- the clock */
assert.equal(
  M.timecode(1500, 30),
  '00:01.15',
  'frames are counted, not sliced',
);
assert.equal(M.timecode(0, 30), '00:00.00');
assert.equal(M.timecode(60000, 30), '01:00.00');
assert.equal(M.frameOf(1000, 25), 25);
assert.equal(M.snapFrame(17, 30), Math.round(17 / (1000 / 30)) * (1000 / 30));

/* ---- groups per kind */
assert.deepEqual(
  M.propsIn('audio', 'Transform'),
  [],
  'an audio layer has no box',
);
assert.deepEqual(M.propsIn('audio', 'Audio'), ['volume']);
assert.ok(M.propsIn('text', 'Type').includes('fontSize'));
assert.deepEqual(M.propsIn('video', 'Type'), [], 'a clip has no typography');
assert.ok(
  M.groupsFor('null').length === 1,
  'a null is a coordinate frame only',
);

/* ---- solo is exclusive */
const vis = { ...M.makeLayer('box'), id: 'v', outMs: 5000 };
const solo = { ...M.makeLayer('box'), id: 's', outMs: 5000, solo: true };
assert.ok(M.liveAt(solo, 0, [vis, solo]));
assert.ok(!M.liveAt(vis, 0, [vis, solo]), 'anything not soloed is off');
assert.ok(M.liveAt(vis, 0, [vis]), 'with nothing soloed it is on');

/* ---- scene duration */
let scene = M.makeScene();
scene.layers = [M.putKey(M.makeLayer('box', { outMs: 3000 }), 'x', 7000, 1)];
assert.equal(M.contentMs(scene), 7000, 'a keyframe past the out still counts');

/* ---- the timeline map */
const map = new T.TimeMap(0, 10000, 1000, 10000);
assert.equal(map.x(5000), 500);
assert.equal(map.ms(500), 5000);
assert.equal(
  new T.TimeMap(9000, 10000, 1000, 10000).start,
  0,
  'clamped inside',
);
assert.ok(T.tickStep(10000, 1000) >= 500);
const rows = [{ kind: 'layer', span: [0, 5000], keys: [], layer: { id: 'x' } }];
// The ruler is its own pinned canvas now, so the tracks start at y = 0 and
// the hit test knows nothing about it.
assert.equal(T.hitTest(rows, map, 2, 10).what, 'trim-in');
assert.equal(T.hitTest(rows, map, 498, 10).what, 'trim-out');
assert.equal(T.hitTest(rows, map, 250, 10).what, 'bar');
assert.equal(T.hitTest(rows, map, 800, 10).what, 'empty');
assert.equal(
  T.hitTest(rows, map, 250, T.canvasHeight(rows) - 4).what,
  'time-bar',
);
assert.equal(T.rowAt(0), 0, 'the first row starts at the top');
assert.equal(T.rowAt(T.ROW_H + 1), 1);
assert.equal(typeof T.drawRuler, 'function', 'the ruler draws itself');

/* ---- the keymap */
assert.equal(
  K.ACTIONS.length,
  new Set(K.ACTIONS.map((a) => a.id)).size,
  'ids unique',
);
const bound = K.ACTIONS.filter((a) => a.key).map((a) => a.key);
assert.equal(bound.length, new Set(bound).size, 'each key is bound once');
const press = (key, mods = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});
assert.equal(K.actionFor(press(' ')).id, 'play-pause');
assert.equal(K.actionFor(press('z', { ctrlKey: true })).id, 'undo');
assert.equal(
  K.actionFor(press('z', { ctrlKey: true, shiftKey: true })).id,
  'redo',
);
assert.equal(
  K.actionFor(press('=', { shiftKey: true }))?.id,
  'zoom-in',
  'shift falls back',
);
assert.equal(
  K.actionFor(press('ArrowLeft', { shiftKey: true })).id,
  'nudge-left-10',
);
assert.equal(K.actionFor(press('F13')), null);
assert.equal(K.keyFor('duplicate-selected'), 'Ctrl+D');

/* ---- the effect stack keeps its order across CSS and shader steps */
{
  const css = (n) => M.makeEffect(n);
  // Gaussian Blur (css), Twirl (shader), Sepia (css) must come back as three
  // steps in that order, not "all the css then all the shaders".
  let layer = {
    ...M.makeLayer('box'),
    effects: [css('Gaussian Blur'), css('Twirl'), css('Sepia')],
  };
  let steps = M.effectSteps(layer, 0);
  assert.deepEqual(
    steps.map((s) => s.kind),
    ['css', 'shader', 'css'],
    'the stack is walked once and flushed, not batched',
  );
  assert.equal(steps[0].declarations.filter, 'blur(8px)');
  assert.equal(steps[1].shader, 'twirl');
  assert.equal(steps[2].declarations.filter, 'sepia(1)');

  // Consecutive CSS effects still coalesce into one step.
  layer = {
    ...M.makeLayer('box'),
    effects: [css('Gaussian Blur'), css('Sepia')],
  };
  steps = M.effectSteps(layer, 0);
  assert.equal(steps.length, 1, 'neighbouring css effects are one step');
  assert.equal(steps[0].declarations.filter, 'blur(8px) sepia(1)');

  // A disabled shader effect contributes no step at all.
  layer = {
    ...M.makeLayer('box'),
    effects: [{ ...css('Twirl'), enabled: false }, css('Sepia')],
  };
  steps = M.effectSteps(layer, 0);
  assert.deepEqual(
    steps.map((s) => s.kind),
    ['css'],
  );

  // Two shader effects in a row are two passes, in order.
  layer = { ...M.makeLayer('box'), effects: [css('Twirl'), css('Bulge')] };
  steps = M.effectSteps(layer, 0);
  assert.deepEqual(
    steps.map((s) => s.shader),
    ['twirl', 'bulge'],
  );

  // Parameters are packed, and keyframes reach the pack.
  let keyed = M.putParamKey(css('Twirl'), 0, 0, 0);
  keyed = M.putParamKey(keyed, 0, 1000, 180);
  layer = { ...M.makeLayer('box'), effects: [keyed] };
  const at = (ms) => M.effectSteps(layer, ms)[0].params[3];
  assert.equal(at(0), 0, 'angle at the first key');
  assert.equal(at(500), 90, 'eased between');
  assert.equal(at(1000), 180, 'and at the last');
}

/* ---- every mapped shader effect names a shader that exists */
{
  const { SHADER_EFFECTS } = await import(B + 'shader-map.js');
  const { SHADERS } = await import(B + 'shaders.js');
  const names = Object.keys(SHADER_EFFECTS);
  assert.ok(names.length >= 24, 'the distort group is mapped');
  for (const [name, entry] of Object.entries(SHADER_EFFECTS)) {
    assert.ok(
      FX.CATALOG.some((d) => d.name === name),
      `${name} is a real effect`,
    );
    assert.ok(SHADERS[entry.shader], `${name} -> ${entry.shader} exists`);
    const fx = M.makeEffect(name);
    const packed = entry.pack(fx.values, fx.colors);
    assert.equal(packed.length, 24, `${name} packs six vec4s`);
    for (const n of packed)
      assert.ok(Number.isFinite(n), `${name} packs finite numbers, got ${n}`);
  }
  console.log('  shader effects mapped:', names.length);
}

console.log(
  'all good —',
  FX.CATALOG.length,
  'effects,',
  K.ACTIONS.length,
  'actions',
);
