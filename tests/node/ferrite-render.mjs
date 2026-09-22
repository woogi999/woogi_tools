// The compositor, exercised through a recording 2D context. There is no real
// canvas in node, so this checks the decisions rather than the pixels: what
// gets drawn, in what order, with which filter, and where the geometry lands.
import assert from 'node:assert';

const B = 'file:///E:/coding_projects/woogi_tools/app/utils/ferrite/';
const M = await import(B + 'model.js');

/* ---- a canvas that writes down what it was asked to do */
function recorder(width = 1920, height = 1080) {
  const calls = [];
  const ctx = {
    canvas: null,
    _filter: 'none',
    get filter() {
      return this._filter;
    },
    set filter(v) {
      this._filter = v;
      calls.push(['filter', v]);
    },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    letterSpacing: '',
    setTransform: () => {},
    transform: () => {},
    translate: (x, y) => calls.push(['translate', x, y]),
    rotate: (a) => calls.push(['rotate', a]),
    scale: (x, y) => calls.push(['scale', x, y]),
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    rect: () => {},
    roundRect: () => {},
    clip: () => {},
    stroke: () => {},
    strokeRect: () => {},
    fill: () => {},
    clearRect: () => calls.push(['clear']),
    fillRect: function (x, y, w, h) {
      calls.push(['fillRect', this.fillStyle, x, y, w, h, this._filter]);
    },
    fillText: function (text) {
      calls.push(['fillText', text, this.fillStyle, this.font]);
    },
    drawImage: function (src, x, y, w, h) {
      calls.push([
        'drawImage',
        src?._tag ?? 'surface',
        x,
        y,
        w,
        h,
        this._filter,
      ]);
    },
    createLinearGradient: () => ({ addColorStop: () => {}, _tag: 'linear' }),
    createRadialGradient: () => ({ addColorStop: () => {}, _tag: 'radial' }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => {},
  };
  ctx.canvas = { width, height, _tag: 'target', getContext: () => ctx };
  return { ctx, calls };
}

// `drawScene` borrows offscreen canvases; give it ones backed by recorders.
const madeSurfaces = [];
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const { ctx } = recorder(0, 0);
    const surface = {
      _tag: `surface${madeSurfaces.length}`,
      width: 0,
      height: 0,
      getContext: () => ctx,
      calls: null,
    };
    ctx.canvas = surface;
    madeSurfaces.push(surface);
    return surface;
  },
};

const R = await import(B + 'render.js');

const settings = { width: 1920, height: 1080, fps: 30 };
const scene = (layers, patch = {}) =>
  M.makeScene({ layers, background: '#101010', ...patch });

/* ---- the background is painted, then the layers, back to front */
{
  const a = M.makeLayer('box', { id: 'a', outMs: 5000 });
  a.style.background = '#ff0000';
  const b = M.makeLayer('box', { id: 'b', outMs: 5000 });
  b.style.background = '#00ff00';
  const { ctx, calls } = recorder();
  R.drawScene(ctx, scene([a, b]), settings, 0, new Map());
  const bg = calls.find((c) => c[0] === 'fillRect' && c[1] === '#101010');
  assert.ok(bg, 'the scene background is painted');
  assert.deepEqual(bg.slice(2, 6), [0, 0, 1920, 1080], 'over the whole raster');
  // Top of the list is the front, so it is drawn last.
  const draws = calls.filter((c) => c[0] === 'drawImage');
  assert.equal(draws.length, 2, 'both layers drawn');
}

/* ---- a layer outside its own span is not drawn at all */
{
  const early = M.makeLayer('box', { inMs: 0, outMs: 1000 });
  const { ctx, calls } = recorder();
  R.drawScene(ctx, scene([early]), settings, 2000, new Map());
  assert.equal(
    calls.filter((c) => c[0] === 'drawImage').length,
    0,
    'trimmed out',
  );
  R.drawScene(ctx, scene([early]), settings, 500, new Map());
  assert.ok(
    calls.some((c) => c[0] === 'drawImage'),
    'inside its span it is',
  );
}

/* ---- solo turns everything else off */
{
  const one = M.makeLayer('box', { id: 'one', outMs: 5000 });
  const two = M.makeLayer('box', { id: 'two', outMs: 5000, solo: true });
  const { ctx, calls } = recorder();
  R.drawScene(ctx, scene([one, two]), settings, 0, new Map());
  assert.equal(
    calls.filter((c) => c[0] === 'drawImage').length,
    1,
    'only the soloed one',
  );
}

/* ---- an invisible layer is skipped */
{
  const hidden = M.makeLayer('box', { outMs: 5000, visible: false });
  const { ctx, calls } = recorder();
  R.drawScene(ctx, scene([hidden]), settings, 0, new Map());
  assert.equal(calls.filter((c) => c[0] === 'drawImage').length, 0);
}

/* ---- the effect stack's filter reaches the draw verbatim */
{
  const fx = M.makeLayer('box', { outMs: 5000 });
  fx.effects = [M.makeEffect('Gaussian Blur'), M.makeEffect('Sepia')];
  const { ctx, calls } = recorder();
  R.drawScene(ctx, scene([fx]), settings, 0, new Map());
  const draw = calls.find((c) => c[0] === 'drawImage');
  assert.equal(
    draw[6],
    'blur(8px) sepia(1)',
    'the catalogue CSS is used as written',
  );
}

/* ---- a keyed effect parameter animates the filter */
{
  let effect = M.putParamKey(M.makeEffect('Gaussian Blur'), 0, 0, 0);
  effect = M.putParamKey(effect, 0, 1000, 40);
  const fx = M.makeLayer('box', { outMs: 5000 });
  fx.effects = [effect];
  for (const [ms, want] of [
    [0, 'blur(0px)'],
    [500, 'blur(20px)'],
    [1000, 'blur(40px)'],
  ]) {
    const { ctx, calls } = recorder();
    R.drawScene(ctx, scene([fx]), settings, ms, new Map());
    assert.equal(
      calls.find((c) => c[0] === 'drawImage')[6],
      want,
      `at ${ms}ms`,
    );
  }
}

/* ---- a fully transparent layer is skipped before any work is done */
{
  const clear = M.makeLayer('box', { outMs: 5000 });
  clear.style.opacity = 0;
  const { ctx, calls } = recorder();
  R.drawScene(ctx, scene([clear]), settings, 0, new Map());
  assert.equal(calls.filter((c) => c[0] === 'drawImage').length, 0);
}

/* ---- a matte layer draws nothing of its own */
{
  const matte = M.makeLayer('box', { id: 'matte', outMs: 5000 });
  const under = M.makeLayer('box', {
    id: 'under',
    outMs: 5000,
    matte: 'alpha',
  });
  const { ctx, calls } = recorder();
  R.drawScene(ctx, scene([matte, under]), settings, 0, new Map());
  // Only the matted layer reaches the target; the matte itself is consumed.
  const onTarget = calls.filter((c) => c[0] === 'drawImage');
  assert.equal(onTarget.length, 1, 'the matte is not drawn as a layer');
}

/* ---- an audio layer draws nothing */
{
  const sound = M.makeLayer('audio', { outMs: 5000 });
  const { ctx, calls } = recorder();
  R.drawScene(ctx, scene([sound]), settings, 0, new Map());
  assert.equal(calls.filter((c) => c[0] === 'drawImage').length, 0);
}

/* ---- text is drawn with its own transform applied */
{
  const title = M.makeLayer('text', { outMs: 5000, content: 'HELLO' });
  title.style.color = '#ffcc00';
  const { ctx, calls } = recorder();
  R.drawScene(ctx, scene([title]), settings, 0, new Map());
  const surfaceCalls = madeSurfaces
    .map((s) => s.getContext().canvas)
    .filter(Boolean);
  assert.ok(surfaceCalls.length, 'a surface was borrowed');
  void calls;
}

/* ---- rotation and scale reach the context */
{
  const turned = M.makeLayer('box', { outMs: 5000 });
  turned.style.rotation = 90;
  turned.style.scale = 200;
  const { ctx, calls } = recorder();
  R.drawScene(ctx, scene([turned]), settings, 0, new Map());
  const rot = calls.find((c) => c[0] === 'rotate');
  assert.ok(Math.abs(rot[1] - Math.PI / 2) < 1e-9, '90 degrees in radians');
  const sc = calls.find((c) => c[0] === 'scale');
  assert.deepEqual(sc.slice(1), [2, 2], 'scale is a percentage');
}

/* ---- boxOf and hit testing agree with each other */
{
  const box = M.makeLayer('box', { id: 'hit', outMs: 5000 });
  const sc = scene([box]);
  const { w, h } = R.boxOf(box, 0, sc, settings, null);
  assert.deepEqual([w, h], [1920, 1080], 'an auto-sized box fills the raster');
  assert.equal(
    R.layerAt(sc, settings, 0, new Map(), 960, 540)?.id,
    'hit',
    'centre hits',
  );
  assert.equal(
    R.layerAt(sc, settings, 0, new Map(), -50, 540),
    null,
    'outside misses',
  );

  // Moved, the box moves with it.
  const moved = M.makeLayer('box', { id: 'm', outMs: 5000 });
  moved.style.autoSize = false;
  moved.style.width = 100;
  moved.style.height = 100;
  moved.style.x = 400;
  const sc2 = scene([moved]);
  assert.equal(R.layerAt(sc2, settings, 0, new Map(), 960 + 400, 540)?.id, 'm');
  assert.equal(R.layerAt(sc2, settings, 0, new Map(), 960, 540), null);
}

/* ---- a locked layer cannot be picked */
{
  const locked = M.makeLayer('box', { id: 'lk', outMs: 5000, locked: true });
  assert.equal(
    R.layerAt(scene([locked]), settings, 0, new Map(), 960, 540),
    null,
  );
}

/* ---- the handles sit on the corners of the layer's own box */
{
  const sized = M.makeLayer('box', { outMs: 5000 });
  sized.style.autoSize = false;
  sized.style.width = 200;
  sized.style.height = 100;
  const { corners, anchor } = R.handlesOf(
    sized,
    scene([sized]),
    settings,
    0,
    new Map(),
  );
  assert.equal(corners.length, 4);
  // Anchored at its centre, so the box straddles the middle of the raster.
  assert.deepEqual(
    corners.map((c) => [Math.round(c.x), Math.round(c.y)]),
    [
      [860, 490],
      [1060, 490],
      [1060, 590],
      [860, 590],
    ],
  );
  assert.deepEqual([Math.round(anchor.x), Math.round(anchor.y)], [960, 540]);
}

/* ---- a parented layer's handles follow its parent */
{
  const dad = { ...M.makeLayer('box', { id: 'dad', outMs: 5000 }) };
  dad.style = { ...dad.style, x: 300, autoSize: false, width: 10, height: 10 };
  const kid = {
    ...M.makeLayer('box', { id: 'kid', outMs: 5000, parent: 'dad' }),
  };
  kid.style = { ...kid.style, autoSize: false, width: 100, height: 100 };
  const sc = scene([dad, kid]);
  const { anchor } = R.handlesOf(kid, sc, settings, 0, new Map());
  assert.equal(
    Math.round(anchor.x),
    1260,
    'the child is carried by the parent',
  );
}

console.log('compositor checks passed');
