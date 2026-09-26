import { module, test } from 'qunit';
import {
  coverage,
  fillTokens,
  frameName,
  newBar,
  newDoc,
  newRing,
  newShape,
  normaliseDoc,
  render,
  sampleStops,
  setIn,
  solid,
  paint,
  TEMPLATES,
} from 'woogi-tools/utils/progress-bar';
import { parseStrokes } from 'woogi-tools/utils/kanji-strokes';

const pixel = (canvas, x, y) =>
  Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

// A plain 100×20 red bar with no track, so empty means see-through.
const plainBar = (extra = {}) =>
  newBar({
    x: 0,
    y: 0,
    w: 100,
    h: 20,
    radius: 0,
    trackOn: false,
    fill: solid('#FF0000'),
    ...extra,
  });

const doc = (layers, extra = {}) =>
  newDoc({ width: 100, height: 20, frames: 10, layers, ...extra });

module('Unit | progress bar maker', function () {
  test('a bar is empty on frame 0, full on the last and half way between', function (assert) {
    const d = doc([plainBar()]);
    assert.deepEqual(pixel(render(d, 0), 50, 10), CLEAR, 'empty');
    assert.deepEqual(pixel(render(d, 10), 95, 10), RED, 'full');
    const half = render(d, 5);
    assert.deepEqual(pixel(half, 25, 10), RED, 'left half filled');
    assert.deepEqual(pixel(half, 75, 10), CLEAR, 'right half not yet');
  });

  test('direction decides which end fills first', function (assert) {
    const half = render(doc([plainBar({ direction: 'rtl' })]), 5);
    assert.deepEqual(pixel(half, 25, 10), CLEAR);
    assert.deepEqual(pixel(half, 75, 10), RED);

    const middle = render(doc([plainBar({ direction: 'center-h' })]), 5);
    assert.deepEqual(pixel(middle, 50, 10), RED, 'grows out of the middle');
    assert.deepEqual(pixel(middle, 5, 10), CLEAR);
    assert.deepEqual(pixel(middle, 95, 10), CLEAR);
  });

  test('stepped segments light up whole or not at all', function (assert) {
    const bar = plainBar({ segments: 4, gap: 0, stepped: true });
    // 3 of 8 steps is one and a half segments' worth: only the first shows.
    const d = doc([bar], { frames: 8 });
    const c = render(d, 3);
    assert.deepEqual(pixel(c, 12, 10), RED);
    assert.deepEqual(pixel(c, 30, 10), CLEAR, 'the half-covered segment stays dark');
    assert.strictEqual(coverage(bar, 3 / 8).parts.length, 1);
    assert.strictEqual(
      coverage({ ...bar, stepped: false }, 3 / 8).parts.length,
      2,
      'smooth segments fill part-way',
    );
  });

  test('a ring fills clockwise from twelve o’clock', function (assert) {
    const ring = newRing({
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      thickness: 20,
      roundEnds: false,
      trackOn: false,
      fill: solid('#FF0000'),
    });
    const d = newDoc({ width: 100, height: 100, frames: 4, layers: [ring] });
    // A quarter of the way round, on the middle of the ring's band.
    const c = render(d, 1);
    const at = (degrees) => {
      const a = (degrees * Math.PI) / 180;
      return pixel(c, Math.round(50 + 40 * Math.sin(a)), Math.round(50 - 40 * Math.cos(a)));
    };
    assert.deepEqual(at(45), RED, 'filled at half past twelve');
    assert.deepEqual(at(135), CLEAR, 'not yet at half past three');
    assert.deepEqual(pixel(c, 50, 50), CLEAR, 'the hole stays empty');
    assert.deepEqual(at(-4), CLEAR, 'nothing spills back past the start');
  });

  test('a clipped layer only shows inside the bar’s fill', function (assert) {
    const cover = newShape('rect', {
      x: 0,
      y: 0,
      w: 100,
      h: 20,
      fill: solid('#0000FF'),
      clip: true,
    });
    const withTrack = plainBar({ trackOn: true, track: solid('#00FF00') });
    const c = render(doc([withTrack, cover]), 5);
    assert.deepEqual(pixel(c, 25, 10), BLUE, 'over the fill');
    assert.deepEqual(pixel(c, 75, 10), [0, 255, 0, 255], 'the track is left alone');

    const whole = render(doc([{ ...withTrack, clipTo: 'all' }, cover]), 5);
    assert.deepEqual(pixel(whole, 75, 10), BLUE, 'or the whole bar, if asked');

    const unclipped = render(doc([withTrack, { ...cover, clip: false, y: 0, h: 20 }]), 0);
    assert.deepEqual(pixel(unclipped, 75, 10), BLUE, 'without clipping it covers everything');
  });

  test('by-progress fills take one colour from the gradient', function (assert) {
    const bar = plainBar({
      fillMode: 'progress',
      fill: paint('solid', [
        [0, '#FF0000'],
        [100, '#0000FF'],
      ]),
    });
    assert.deepEqual(pixel(render(doc([bar]), 10), 50, 10), BLUE);
    assert.deepEqual(pixel(render(doc([bar]), 1), 5, 10).slice(0, 3), [230, 0, 26]);
    assert.strictEqual(
      sampleStops(bar.fill.stops, 50),
      'rgba(128,0,128,1)',
    );
  });

  test('text, names and paths', function (assert) {
    assert.strictEqual(fillTokens('{percent}% ({frame}/{frames}, {left} left)', 3, 12), '25% (3/12, 9 left)');
    assert.strictEqual(frameName('hp', 7, 20), 'hp_07.png');
    assert.strictEqual(frameName('a/b', 120, 120), 'a_b_120.png');
    const d = { layers: [{ fill: { stops: [{ color: '#000000' }] } }] };
    const next = setIn(d, 'layers.0.fill.stops.0.color', '#FFFFFF');
    assert.strictEqual(next.layers[0].fill.stops[0].color, '#FFFFFF');
    assert.strictEqual(d.layers[0].fill.stops[0].color, '#000000', 'the original is untouched');
    assert.true(Array.isArray(next.layers[0].fill.stops), 'arrays stay arrays');
  });

  test('designs read back get their missing settings filled in', function (assert) {
    assert.strictEqual(normaliseDoc(null), null);
    assert.strictEqual(normaliseDoc({ width: 5 }), null, 'not a design');
    const d = normaliseDoc({
      width: 512,
      height: 64,
      frames: 0,
      layers: [
        { type: 'bar', id: 'x', x: 10, y: 10, stripes: { on: true } },
        { type: 'nonsense' },
      ],
    });
    assert.strictEqual(d.width, 1024, 'every design is 1024 wide…');
    assert.strictEqual(d.height, 1024, '…and 1024 high');
    assert.deepEqual(
      [d.layers[0].x, d.layers[0].y],
      [266, 490],
      'an older, smaller design is centred on it',
    );
    assert.strictEqual(d.frames, 20, 'a missing step count gets the default');
    assert.strictEqual(d.layers.length, 1, 'unknown layers are dropped');
    assert.strictEqual(d.layers[0].id, 'x');
    assert.true(d.layers[0].stripes.on);
    assert.strictEqual(d.layers[0].stripes.width, 24, 'nested settings are merged');
    assert.strictEqual(d.layers[0].clipTo, 'fill');
  });

  test('the examples are all 1024 × 1024', function (assert) {
    for (const t of TEMPLATES) {
      const d = t.make();
      assert.deepEqual([d.width, d.height], [1024, 1024], t.label);
    }
  });

  test('a pinned pattern stays put; one riding the fill moves with it', function (assert) {
    const striped = (anchor) =>
      doc([
        plainBar({
          stripes: {
            ...newBar().stripes,
            on: true,
            kind: 'stripes',
            color: '#0000FF',
            alpha: 100,
            width: 4,
            gap: 4,
            angle: 0,
            anchor,
          },
        }),
      ]);
    const row = (c) => Array.from({ length: 8 }, (_, k) => pixel(c, 10 + k, 10).join());
    const pinned = striped('canvas');
    assert.deepEqual(row(render(pinned, 5)), row(render(pinned, 6)), 'pinned');
    const riding = striped('fill');
    assert.notDeepEqual(row(render(riding, 5)), row(render(riding, 6)), 'riding');
  });

  test('strokes can be solid, dashed or off', function (assert) {
    const outlined = (stroke) =>
      newDoc({
        width: 100,
        height: 40,
        frames: 10,
        layers: [
          plainBar({
            x: 10,
            y: 10,
            w: 80,
            h: 20,
            stroke: { ...newBar().stroke, width: 4, paint: solid('#0000FF'), ...stroke },
          }),
        ],
      });
    // Just above the bar, where an outside stroke sits.
    const edge = (d) => {
      const c = render(d, 10);
      return Array.from({ length: 60 }, (_, k) => pixel(c, 20 + k, 8)[3]);
    };
    assert.true(edge(outlined({ on: true })).every((a) => a === 255), 'solid');
    const dashed = edge(outlined({ on: true, style: 'dashed', dash: 6, gap: 6 }));
    assert.true(dashed.some((a) => a === 255), 'dashes');
    assert.true(dashed.some((a) => a === 0), 'and gaps');
    assert.true(edge(outlined({ on: false })).every((a) => a === 0), 'none');
  });

  test('segments take other shapes, and taper', function (assert) {
    const full = (extra) => render(doc([plainBar(extra)]), 10);
    assert.deepEqual(pixel(full({}), 3, 10), RED, 'a rectangle fills its corner');
    const chevron = full({ segShape: 'chevron', segDepth: 100 });
    assert.deepEqual(pixel(chevron, 3, 10), CLEAR, 'a chevron is notched');
    assert.deepEqual(pixel(chevron, 50, 10), RED);

    const wedge = full({ taperStart: 20, taperEnd: 100 });
    assert.deepEqual(pixel(wedge, 2, 2), CLEAR, 'thin at the start');
    assert.deepEqual(pixel(wedge, 2, 10), RED);
    assert.deepEqual(pixel(wedge, 97, 2), RED, 'full height at the end');
  });

  test('the background can hide under a see-through fill', function (assert) {
    const bar = plainBar({
      trackOn: true,
      track: solid('#00FF00'),
      fill: solid('#FF0000', 50),
    });
    assert.true(pixel(render(doc([bar]), 5), 25, 10)[1] > 0, 'shows through');
    const cut = render(doc([{ ...bar, trackCut: true }]), 5);
    assert.strictEqual(pixel(cut, 25, 10)[1], 0, 'hidden under the fill');
    assert.deepEqual(pixel(cut, 75, 10), [0, 255, 0, 255], 'still there ahead');
  });

  test('the catch-up trail runs ahead of the fill', function (assert) {
    const bar = plainBar({
      trail: { on: true, color: '#0000FF', alpha: 100, amount: 20 },
    });
    const c = render(doc([bar]), 5);
    assert.deepEqual(pixel(c, 40, 10), RED, 'the fill');
    assert.deepEqual(pixel(c, 60, 10), BLUE, 'the trail, 20% ahead');
    assert.deepEqual(pixel(c, 80, 10), CLEAR, 'nothing past it');
  });

  test('layer effects: drop shadow, and showing on some steps only', function (assert) {
    const box = newShape('rect', { x: 0, y: 0, w: 40, h: 20, fill: solid('#FF0000') });
    const shadowed = {
      ...box,
      fx: { ...box.fx, shadow: { on: true, color: '#0000FF', alpha: 100, x: 30, y: 0, blur: 0 } },
    };
    const c = render(doc([shadowed]), 0);
    assert.deepEqual(pixel(c, 20, 10), RED);
    assert.deepEqual(pixel(c, 60, 10), BLUE, 'the shadow, 30px across');

    const finale = { ...box, fx: { ...box.fx, range: { on: true, from: 100, to: 100 } } };
    assert.deepEqual(pixel(render(doc([finale]), 9), 20, 10), CLEAR, 'hidden');
    assert.deepEqual(pixel(render(doc([finale]), 10), 20, 10), RED, 'on the last step');
  });

  test('an old border comes back as a stroke', function (assert) {
    const d = normaliseDoc({
      width: 1024,
      height: 1024,
      layers: [{ type: 'bar', id: 'b', border: 6, borderColor: '#FF0000' }],
    });
    assert.true(d.layers[0].stroke.on);
    assert.strictEqual(d.layers[0].stroke.width, 6);
    assert.strictEqual(d.layers[0].stroke.paint.stops[0].color, '#FF0000');
    assert.false(d.layers[0].fx.shadow.on, 'layer effects filled in, off');
  });

  // ─── Pictures and text ────────────────────────────────────────────────

  // A 20×10 picture, red on the left and blue on the right, or half
  // see-through. Big enough that smoothing only softens its outer edge.
  const picture = (right = '#0000FF') => {
    const c = document.createElement('canvas');
    c.width = 20;
    c.height = 10;
    const x = c.getContext('2d');
    x.fillStyle = '#FF0000';
    x.fillRect(0, 0, 10, 10);
    if (right) {
      x.fillStyle = right;
      x.fillRect(10, 0, 10, 10);
    }
    return c;
  };
  const withPictures = (map) => ({ resolve: (src) => map[src] ?? null });
  const imagePaint = (extra) => ({ ...solid('#000000'), type: 'image', src: 'p', fit: 'stretch', ...extra });

  test('a picture can fill the bar, or each segment', function (assert) {
    const pics = withPictures({ p: picture() });
    const across = render(doc([plainBar({ fill: imagePaint() })]), 10, pics);
    assert.deepEqual(pixel(across, 20, 10), RED, 'left half of the picture');
    assert.deepEqual(pixel(across, 80, 10), BLUE, 'right half');

    const each = render(
      doc([plainBar({ segments: 2, gap: 0, fill: imagePaint({ map: 'segment' }) })]),
      10,
      pics,
    );
    assert.deepEqual(pixel(each, 10, 10), RED, 'first segment starts red');
    assert.deepEqual(pixel(each, 40, 10), BLUE);
    assert.deepEqual(pixel(each, 60, 10), RED, 'and the second starts over');
    assert.deepEqual(pixel(each, 90, 10), BLUE);
  });

  test('a picture can be the shape of each segment', function (assert) {
    // Opaque on the left, see-through on the right: each segment keeps only its left half.
    const pics = withPictures({ heart: picture(null) });
    const c = render(
      doc([plainBar({ segments: 2, gap: 0, segShape: 'image', segImage: 'heart', segImageFit: 'stretch' })]),
      10,
      pics,
    );
    assert.deepEqual(pixel(c, 10, 10), RED);
    assert.deepEqual(pixel(c, 40, 10), CLEAR, 'the see-through half is not bar');
    assert.deepEqual(pixel(c, 60, 10), RED);
    assert.deepEqual(pixel(c, 90, 10), CLEAR);
  });

  test('a picture can be the pattern', function (assert) {
    const pics = withPictures({ p: picture('#00FF00') });
    const bar = plainBar({
      stripes: { ...newBar().stripes, on: true, kind: 'image', src: 'p', width: 10, gap: 0, angle: 0, alpha: 100 },
    });
    const c = render(doc([bar]), 10, pics);
    const all = Array.from(c.getContext('2d').getImageData(0, 0, 100, 20).data);
    let green = 0;
    for (let i = 0; i < all.length; i += 4)
      if (all[i + 1] > 200 && all[i] < 60 && all[i + 3] === 255) green++;
    assert.true(green > 50, `the picture shows over the fill (${green} px)`);
  });

  // How far right anything is drawn, on the middle row.
  const reach = (canvas, y) => {
    let right = -1;
    for (let x = 0; x < canvas.width; x++) if (pixel(canvas, x, y)[3] > 0) right = x;
    return right;
  };

  test('text is a bar: the letters fill as a sweep', function (assert) {
    const word = newBar({
      shape: 'text',
      text: 'HHHH',
      textFont: 'sans-serif',
      x: 0,
      y: 0,
      w: 200,
      h: 60,
      trackOn: false,
      fill: solid('#FF0000'),
    });
    const d = newDoc({ width: 200, height: 60, frames: 10, layers: [word] });
    assert.strictEqual(reach(render(d, 0), 30), -1, 'nothing at the start');
    const full = reach(render(d, 10), 30);
    const half = reach(render(d, 5), 30);
    assert.true(full > 150, 'all the letters when full');
    assert.true(half > 50, `past the start at the middle step (${half})`);
    assert.true(half < 130, `short of the end at the middle step (${half})`);
  });

  test('text in stroke order draws each stroke along its length', function (assert) {
    const one = newBar({
      shape: 'text',
      text: '一',
      textMode: 'strokes',
      // One stroke straight across KanjiVG's 109-unit square.
      strokeData: { '一': ['M5,54.5 L104,54.5'] },
      textPen: 10,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      trackOn: false,
      fill: solid('#FF0000'),
    });
    const d = newDoc({ width: 100, height: 100, frames: 10, layers: [one] });
    const full = reach(render(d, 10), 50);
    const half = reach(render(d, 5), 50);
    assert.true(full > 80, `the whole stroke (${full})`);
    assert.true(half > 35, `at least a third of it (${half})`);
    assert.true(half < 65, `at most two thirds of it (${half})`);
  });

  test('KanjiVG files are read in stroke order', function (assert) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g id="kvg:StrokePaths_0529b">
      <path id="kvg:0529b-s2" d="M2,2"/><path id="kvg:0529b-s1" d="M1,1"/>
    </g></svg>`;
    assert.deepEqual(parseStrokes(svg), ['M1,1', 'M2,2']);
  });

  test('a design keeps its name', function (assert) {
    assert.strictEqual(normaliseDoc({ name: 'Cursed energy', layers: [] }).name, 'Cursed energy');
    assert.strictEqual(normaliseDoc({ layers: [] }).name, 'Untitled bar');
  });
});
