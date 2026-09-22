// Which catalogue effects have a real shader, and how their knobs become
// uniforms.
//
// `effects.js` is generated from Ferrite's Rust and left alone, so this is the
// seam between it and `shaders.js`. It exists because the two describe the
// same knob differently: the catalogue speaks in the units an operator sees —
// per cent of the layer, degrees, pixels — while a shader wants a fraction of
// the box and radians. Doing that conversion here, once per effect, keeps both
// sides honest: the inspector stays in the numbers a person can reason about,
// and the shader stays in the numbers the maths wants.
//
// `pack` is handed the sampled parameter values (already interpolated by any
// keyframes) and returns the six `vec4`s the shader reads as `uParams`.

const vec4s = (...numbers) => {
  const out = new Float32Array(24);
  out.set(numbers.slice(0, 24));
  return out;
};

const pc = (v) => v / 100;

// Only the effects that take a colour need these; the rest get zeroes.
const NO_COLOURS = new Float32Array(16);

// A CSS colour to the `vec4` a shader reads, in straight (not premultiplied)
// components — a key compares against the colour somebody picked, not against
// that colour already faded by its own alpha.
let pen = null;
function rgba(value) {
  if (!pen) pen = document.createElement('canvas').getContext('2d');
  pen.fillStyle = '#000000';
  pen.fillStyle = value;
  const solved = pen.fillStyle;
  if (solved.startsWith('#')) {
    const n = parseInt(solved.slice(1), 16);
    return [
      ((n >> 16) & 255) / 255,
      ((n >> 8) & 255) / 255,
      (n & 255) / 255,
      1,
    ];
  }
  const parts = solved.match(/[\d.]+/g) ?? [];
  return [
    Number(parts[0] ?? 0) / 255,
    Number(parts[1] ?? 0) / 255,
    Number(parts[2] ?? 0) / 255,
    Number(parts[3] ?? 1),
  ];
}

function packRgba(colours) {
  const out = new Float32Array(16);
  (colours ?? []).slice(0, 4).forEach((c, i) => out.set(rgba(c), i * 4));
  return out;
}

export const SHADER_EFFECTS = {
  // ── Blur & Sharpen ────────────────────────────────────────────────────
  // CSS has one blur and it is round, so every blur that is not a gaussian
  // came out looking like every other one.
  'Box Blur': {
    shader: 'box-blur',
    pack: (v) => vec4s(v[0], v[0], v[1]),
  },
  'Axial Blur': {
    shader: 'box-blur',
    pack: (v) => vec4s(v[0], v[1], 1),
  },
  'Directional Blur': {
    shader: 'directional-blur',
    pack: (v) => vec4s(v[0], v[1]),
  },
  'Radial Blur': {
    shader: 'radial-blur',
    pack: (v) => vec4s(v[0], v[1], pc(v[2]), pc(v[3])),
  },
  'Bilateral Blur': {
    shader: 'bilateral-blur',
    pack: (v) => vec4s(v[0], v[1], 0),
  },
  'Tolerance Blur': {
    shader: 'bilateral-blur',
    pack: (v) => vec4s(v[0], v[1], v[2] > 0.5 ? 1 : 0),
  },
  'Unsharp Mask': {
    shader: 'unsharp-mask',
    pack: (v) => vec4s(v[0], v[1], v[2]),
  },
  'Bokeh Blur': {
    shader: 'bokeh-blur',
    pack: (v) => vec4s(v[0], v[1], v[2], v[3], v[4]),
  },
  Sharpen: { shader: 'sharpen', pack: (v) => vec4s(v[0]) },

  // ── the neighbourhood effects that were faking it with a blur ──────────
  Median: { shader: 'median', pack: (v) => vec4s(v[0], 0) },
  'Speckle Clean': { shader: 'median', pack: (v) => vec4s(v[0], v[1]) },
  Pixelate: {
    shader: 'mosaic',
    // Authored as a block size in pixels; the shader counts blocks.
    pack: (v, _c, size) =>
      vec4s(
        Math.max(1, (size?.w ?? 1920) / Math.max(v[0], 1)),
        Math.max(1, (size?.h ?? 1080) / Math.max(v[0], 1)),
        1,
      ),
  },
  Mosaic: {
    shader: 'mosaic',
    pack: (v) => vec4s(Math.max(1, v[0]), Math.max(1, v[1]), v[2]),
  },
  'Chromatic Aberration': {
    shader: 'chromatic-aberration',
    pack: (v) => vec4s(v[0], v[1]),
  },
  'Find Edges': {
    shader: 'find-edges',
    pack: (v) => vec4s(v[0], v[1], v[2], pc(v[3])),
  },
  Emboss: {
    shader: 'emboss',
    pack: (v) => vec4s(v[0], v[1], v[2], pc(v[3]), 0),
  },
  'Colour Emboss': {
    shader: 'emboss',
    pack: (v) => vec4s(v[0], v[1], v[2], pc(v[3]), 1),
  },
  Cartoon: {
    shader: 'cartoon',
    pack: (v) => vec4s(v[0], v[1], v[2], v[3]),
  },
  'Brush Strokes': {
    shader: 'brush-strokes',
    pack: (v) => vec4s(v[0], v[1], v[2], pc(v[4])),
  },
  Posterize: { shader: 'posterize', pack: (v) => vec4s(v[0]) },

  // ── Colour ────────────────────────────────────────────────────────────
  Fade: { shader: 'fade', pack: (v) => vec4s(v[0]) },
  Exposure: { shader: 'exposure', pack: (v) => vec4s(v[0]) },
  'Colour Balance': {
    shader: 'colour-balance',
    pack: (v) => vec4s(v[0], v[1], v[2]),
  },
  'Brightness & Contrast': {
    shader: 'brightness-contrast',
    pack: (v) => vec4s(v[0] / 100, v[1] / 100),
  },
  Levels: {
    // The dialog counts 0–255 the way a histogram does; the shader works in 0–1.
    shader: 'levels',
    pack: (v) =>
      vec4s(v[0] / 255, v[1] / 255, v[2], v[3] / 255, v[4] / 255, v[5]),
  },
  'Hue/Saturation': {
    shader: 'hue-saturation',
    pack: (v) =>
      vec4s(
        v[0],
        1 + v[1] / 100,
        v[2] / 100,
        v[3],
        v[4],
        v[5] / 100,
        v[6],
        v[7] / 360,
        v[8] / 360,
      ),
  },
  'Channel Mixer': {
    shader: 'channel-mixer',
    pack: (v) =>
      vec4s(
        v[0] / 100,
        v[1] / 100,
        v[2] / 100,
        v[3] / 100,
        v[4] / 100,
        v[5] / 100,
        v[6] / 100,
        v[7] / 100,
        v[8] / 100,
        v[9] / 100,
        v[10] / 100,
        v[11] / 100,
      ),
  },
  'Gamma/Pedestal/Gain': {
    shader: 'gamma-pedestal-gain',
    pack: (v) =>
      vec4s(v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8]),
  },
  'Selective Colour': {
    shader: 'selective-color',
    pack: (v) =>
      vec4s(v[0], v[5], 0, 0, v[1] / 100, v[2] / 100, v[3] / 100, v[4] / 100),
  },
  'Hue Replace': {
    shader: 'hue-replace',
    pack: (v) => vec4s(v[0], v[1], v[2], v[3] / 100, v[4] / 100, v[5]),
    colours: (c) => packRgba(c),
  },
  'Colour Cycle': {
    shader: 'colorama',
    pack: (v) => vec4s(v[0] / 360, Math.max(v[2], 0.0001), v[3] / 100, v[4]),
    colours: (c) => packRgba(c),
  },
  'Channel Phase': {
    shader: 'channel-phase',
    pack: (v) => vec4s(v[0] / 255, v[1] / 255, v[2] / 255, v[3]),
  },
  'Convolution Matrix': {
    shader: 'convolve',
    pack: (v) =>
      vec4s(
        v[0],
        v[1],
        v[2],
        v[3],
        v[4],
        v[5],
        v[6],
        v[7],
        v[8],
        v[9],
        v[10] / 255,
        v[11],
      ),
  },

  // ── Keying and matte ──────────────────────────────────────────────────
  'Colour Key': {
    shader: 'key',
    pack: (v) => vec4s(v[0] / 100, v[1] / 100, v[2], v[3], 0),
    colours: (c) => packRgba(c),
  },
  'Luma Key': {
    shader: 'key',
    pack: (v) => vec4s(v[0] / 100, v[1] / 100, v[2], v[3], 1),
    colours: (c) => packRgba(c),
  },
  'Linear Colour Key': {
    shader: 'key',
    pack: (v) => vec4s(v[0] / 100, v[1] / 100, v[2], v[3], 0),
    colours: (c) => packRgba(c),
  },
  'Colour Range': {
    shader: 'key',
    pack: (v) => vec4s(v[0] / 100, v[1] / 100, v[2], v[3], 0),
    colours: (c) => packRgba(c),
  },
  Extract: {
    shader: 'extract',
    pack: (v) =>
      vec4s(v[0], v[1] / 100, v[2] / 100, v[3] / 100, v[4] / 100, v[5]),
  },
  'Matte Shrink': { shader: 'choke', pack: (v) => vec4s(v[0]) },
  'Matte Choke': { shader: 'choke', pack: (v) => vec4s(v[0]) },
  Unmatte: {
    shader: 'unmatte',
    pack: () => vec4s(0),
    colours: (c) => packRgba(c),
  },

  // ── Channel ───────────────────────────────────────────────────────────
  'Shift Channels': {
    shader: 'shift-channels',
    pack: (v) => vec4s(v[0], v[1], v[2], v[3]),
  },
  Arithmetic: {
    shader: 'arithmetic',
    pack: (v) => vec4s(v[0], v[1], v[2]),
    colours: (c) => packRgba(c),
  },

  // ── Stylize ───────────────────────────────────────────────────────────
  'Strobe Light': {
    shader: 'strobe',
    pack: (v) => vec4s(v[0], v[1] / 100, v[2], v[3], v[4] / 100),
    colours: (c) => packRgba(c),
  },
  Kaleidoscope: {
    shader: 'kaleida',
    pack: (v) => vec4s(v[0], v[1], pc(v[2]), 0, pc(v[3]), pc(v[4])),
  },
  Honeycomb: {
    shader: 'hex-tile',
    pack: (v) => vec4s(v[0], v[1], 0, 0, pc(v[2]), pc(v[3])),
  },
  'Mirror Tile': {
    shader: 'repetile',
    pack: (v) => vec4s(Math.max(1, v[0]), Math.max(1, v[1]), v[2]),
  },
  'Block Reveal': {
    shader: 'block-load',
    pack: (v) => vec4s(Math.max(1, v[0]), pc(v[1])),
  },
  'Burn Through': {
    shader: 'burn-film',
    pack: (v) => vec4s(pc(v[0]), Math.max(v[1], 0.0001), pc(Math.max(v[2], 1))),
    colours: (c) => packRgba(c),
  },
  'Roughen Edges': {
    shader: 'roughen-edges',
    pack: (v) => vec4s(pc(v[0]), Math.max(v[1], 0.0001), v[2]),
  },
  Scatter: {
    shader: 'scatter',
    pack: (v) => vec4s(pc(v[0]), Math.max(v[1], 1)),
  },
  Refraction: {
    shader: 'glass',
    pack: (v) => vec4s(pc(v[0]), Math.max(v[1], 0.0001)),
  },

  // ── Blur ──────────────────────────────────────────────────────────────
  'Channel Blur': {
    shader: 'channel-blur',
    pack: (v) => vec4s(v[0], v[1], v[2], v[3]),
  },
  Bulge: {
    shader: 'bulge',
    // radiusX, radiusY, height, taper, spherical=0, centre
    pack: (v) =>
      vec4s(
        pc(v[4]),
        pc(v[5]),
        pc(v[0]),
        pc(v[1]),
        v[2],
        Math.max(v[3], 0.0001),
        0,
      ),
  },
  'Spherical Warp': {
    shader: 'bulge',
    pack: (v) => vec4s(pc(v[2]), pc(v[3]), pc(v[0]), pc(v[0]), v[1], 1, 1),
  },
  Twirl: {
    shader: 'twirl',
    pack: (v) => vec4s(pc(v[2]), pc(v[3]), pc(v[1]), v[0]),
  },
  Ripple: {
    shader: 'ripple',
    pack: (v) =>
      vec4s(
        pc(v[6]),
        pc(v[7]),
        pc(v[0]),
        pc(v[1]),
        pc(v[2]),
        (v[4] * Math.PI) / 180,
        v[5],
      ),
  },
  'Wave Warp': {
    shader: 'wave-warp',
    // A direction near vertical drives the wave down the layer instead of across.
    pack: (v) =>
      vec4s(
        v[0],
        pc(v[1]),
        pc(v[2]),
        v[5] / 360,
        Math.abs((((v[3] % 360) + 360) % 360) - 90) < 45 ? 0 : 1,
      ),
  },
  'Noise Warp': {
    shader: 'noise-warp',
    pack: (v) => vec4s(pc(v[1]), 100 / Math.max(v[2], 1), v[4], v[3]),
  },
  Mirror: {
    shader: 'mirror',
    pack: (v) => vec4s(pc(v[1]), pc(v[2]), v[0]),
  },
  Offset: {
    shader: 'offset',
    pack: (v) => vec4s(pc(v[0]), pc(v[1])),
  },
  'Polar Coordinates': {
    shader: 'polar',
    pack: (v) => vec4s(pc(v[1]), v[0] < 0.5 ? 1 : 0),
  },
  Magnify: {
    shader: 'magnify',
    pack: (v) => vec4s(pc(v[4]), pc(v[5]), pc(v[1]), pc(v[0]), pc(v[2])),
  },
  'Lens Distortion': {
    shader: 'optics',
    // Field of view to a barrel coefficient, reversed when asked.
    pack: (v) => vec4s((v[1] > 0.5 ? 1 : -1) * (v[0] / 100), 0, 1),
  },
  Fisheye: {
    shader: 'optics',
    pack: (v) => vec4s(-(v[0] / 100), -(v[0] / 400), 1),
  },
  'Grid Twist': {
    shader: 'griddler',
    pack: (v) => vec4s(Math.max(1, 100 / Math.max(v[0], 1)), v[1], pc(v[2])),
  },
  Shear: {
    shader: 'slant',
    pack: (v) => vec4s(pc(v[0]), 0),
  },
  'Tile Repeat': {
    shader: 'tiler',
    pack: (v) =>
      vec4s(
        Math.max(1, 100 / Math.max(v[0], 1)),
        Math.max(1, 100 / Math.max(v[0], 1)),
        v[2],
      ),
  },
  'Seamless Tile': {
    shader: 'tiler',
    pack: (v) =>
      vec4s(
        Math.max(1, 100 / Math.max(v[0], 1)),
        Math.max(1, 100 / Math.max(v[0], 1)),
        v[2],
      ),
  },
  'Band Bend': {
    shader: 'bend',
    pack: (v) =>
      vec4s(
        pc(v[0]),
        pc((v[1] + v[2]) / 2),
        Math.max(pc(Math.abs(v[2] - v[1])) / 2, 0.01),
        v[3],
      ),
  },
  Warp: {
    shader: 'warp',
    // The catalogue offers eight styles; the shader has three profiles, so the
    // rest fall to the nearest one rather than to nothing.
    pack: (v) =>
      vec4s(
        [0, 1, 0, 2, 2, 0, 1, 0][Math.round(v[0])] ?? 0,
        pc(v[1]),
        pc(v[2]),
        pc(v[3]),
      ),
  },
  'Corner Pin': {
    shader: 'corner-pin',
    pack: (v) =>
      vec4s(
        pc(v[0]),
        pc(v[1]),
        pc(v[2]),
        pc(v[3]),
        pc(v[4]),
        pc(v[5]),
        pc(v[6]),
        pc(v[7]),
      ),
  },
  Tear: {
    shader: 'split',
    pack: (v) => vec4s(pc(v[2]), pc(v[0]), 0),
  },
  'Twin Attractors': {
    shader: 'flo-motion',
    pack: (v) =>
      vec4s(
        pc(v[3]),
        pc(v[4]),
        pc(v[5]),
        pc(v[6]),
        pc(v[0]) * pc(v[2]),
        pc(v[1]) * pc(v[2]),
      ),
  },
  Displace: {
    shader: 'displace',
    pack: (v) => vec4s(v[0] / 200, v[1]),
  },
  // Both ignore their lighting parameters; the shader only wants to know
  // which of the two shapes it is wrapping around.
  'Sphere Wrap': {
    shader: 'sphere-wrap',
    pack: () => vec4s(1, 0),
  },
  'Cylinder Wrap': {
    shader: 'sphere-wrap',
    pack: () => vec4s(1, 1),
  },
};

export const shaderFor = (name) => SHADER_EFFECTS[name] ?? null;

export const packColours = (colours) =>
  colours?.length ? packRgba(colours) : NO_COLOURS;
