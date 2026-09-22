// Ferrite's effect catalogue, translated from `ferrite-core/src/effects.rs`.
//
// An effect is a named, parameterised contribution to one CSS property of a
// layer. Nothing here rasterises anything: an effect turns its sampled
// parameters into a CSS fragment, and the compositor in `render.js` decides
// what to do with the fragment. Effects in the same slot are joined in stack
// order, which is what makes the stack an After Effects stack: the order in
// the list is the order they apply, and any one can be switched off without
// losing its settings.
//
// This file is generated from the Rust catalogue and then kept by hand; the
// three effects whose Rust bodies branch are written out below the generated
// ones.

const n = (v) =>
  Math.abs(v - Math.round(v)) < 0.0005 ? String(Math.round(v)) : v.toFixed(3);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// One animatable number belonging to an effect.
const p = (label, value, min, max, step, suffix) => ({
  label,
  value,
  min,
  max,
  step,
  suffix,
  choices: [],
});

// A parameter that picks from a short list. The value is the index, still a
// number, and still keyable, because a mode that could not be animated would
// be the one thing on a layer a timeline could not describe.
const choice = (label, value, choices) => ({
  label,
  value,
  min: 0,
  max: Math.max(0, choices.length - 1),
  step: 1,
  suffix: '',
  choices,
});

// The two frames a directional effect can work in. An effect runs on a surface
// the layer was drawn into before it was turned, so every angle is in the
// layer's own frame and turns with it, right for a bevel, whose light is
// bolted to the object, wrong for a long shadow, which is cast onto the world.
export const SPACES = ['Layer', 'Comp'];
const spaceParam = () => choice('Angle follows', 0, SPACES);

// A colour parameter. Colours are not keyframed: the whole declaration is
// interpolated anyway.
const c = (label, value) => ({ label, value });

// The CSS property an effect contributes to, and how two fragments in the same
// slot are joined.
export const SLOTS = {
  filter: { css: 'filter', separator: ' ' },
  backdropFilter: { css: 'backdrop-filter', separator: ' ' },
  boxShadow: { css: 'box-shadow', separator: ', ' },
  maskImage: { css: 'mask-image', separator: ', ' },
  backgroundImage: { css: 'background-image', separator: ', ' },
};

export const CATALOG = [
  {
    name: 'Gaussian Blur',
    category: 'Blur & Sharpen',
    description: 'Softens the whole layer',
    slot: 'filter',
    params: [p('Blurriness', 8, 0, 120, 0.5, 'px')],
    colors: [],
    render: (v, col) => {
      return `blur(${n(v[0])}px)`;
    },
  },
  {
    name: 'Backdrop Blur',
    category: 'Blur & Sharpen',
    description: 'Blurs whatever is behind the layer',
    slot: 'backdropFilter',
    params: [p('Blurriness', 12, 0, 120, 0.5, 'px')],
    colors: [],
    render: (v, col) => {
      return `blur(${n(v[0])}px)`;
    },
  },
  {
    name: 'Sharpen',
    category: 'Blur & Sharpen',
    description: 'Raises local contrast',
    slot: 'filter',
    params: [p('Amount', 1.3, 1, 3, 0.01, '')],
    colors: [],
    render: (v, col) => {
      return `contrast(${n(v[0])})`;
    },
  },
  {
    name: 'Frosted Glass',
    category: 'Blur & Sharpen',
    description: 'Blurs and lifts what is behind',
    slot: 'backdropFilter',
    params: [
      p('Blurriness', 14, 0, 80, 0.5, 'px'),
      p('Saturation', 1.4, 0, 4, 0.01, ''),
    ],
    colors: [],
    render: (v, col) => {
      return `blur(${n(v[0])}px) saturate(${n(v[1])})`;
    },
  },
  {
    name: 'Drop Shadow',
    category: 'Stylize',
    description: "Shadow cast by the layer's shape",
    slot: 'filter',
    params: [
      p('Distance X', 0, -200, 200, 1, 'px'),
      p('Distance Y', 14, -200, 200, 1, 'px'),
      p('Softness', 28, 0, 200, 1, 'px'),
      spaceParam(),
    ],
    colors: [c('Colour', 'rgba(0,0,0,0.55)')],
    render: (v, col) => {
      return `drop-shadow(${n(v[0])}px ${n(v[1])}px ${n(v[2])}px ${col[0]})`;
    },
  },
  {
    name: 'Glow',
    category: 'Stylize',
    description: 'Coloured bloom around the shape',
    slot: 'filter',
    params: [p('Radius', 18, 0, 160, 1, 'px')],
    colors: [c('Colour', 'rgba(134,54,237,0.85)')],
    render: (v, col) => {
      return `drop-shadow(0 0 ${n(v[0])}px ${col[0]})`;
    },
  },
  {
    name: 'Inner Shadow',
    category: 'Stylize',
    description: 'Recessed edge inside the box',
    slot: 'boxShadow',
    params: [
      p('Distance X', 0, -100, 100, 1, 'px'),
      p('Distance Y', 2, -100, 100, 1, 'px'),
      p('Softness', 12, 0, 100, 1, 'px'),
      spaceParam(),
    ],
    colors: [c('Colour', 'rgba(0,0,0,0.6)')],
    render: (v, col) => {
      return `inset ${n(v[0])}px ${n(v[1])}px ${n(v[2])}px ${col[0]}`;
    },
  },
  {
    name: 'Stroke',
    category: 'Stylize',
    description: "An outline that follows the layer's own shape",
    slot: 'boxShadow',
    params: [
      p('Width', 2, 0, 40, 0.5, 'px'),
      choice('Position', 0, ['Outside', 'Centre', 'Inside']),
      p('Opacity', 100, 0, 100, 1, '%'),
    ],
    colors: [c('Colour', 'rgba(255,255,255,0.85)')],
    render: (v, col) => {
      return `0 0 0 ${n(v[0])}px ${col[0]}`;
    },
  },
  {
    name: 'Vignette',
    category: 'Stylize',
    description: 'Darkens towards the edges',
    slot: 'boxShadow',
    params: [
      p('Size', 120, 0, 600, 2, 'px'),
      p('Amount', 0.75, 0, 1, 0.01, ''),
      p('Roundness', 100, 0, 100, 1, '%'),
      p('Feather', 50, 0, 100, 1, '%'),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [c('Colour', '#000000')],
    render: (v, col) => {
      return `inset 0 0 ${n(v[0])}px rgba(0,0,0,${n(v[1])})`;
    },
  },
  {
    name: 'Sheen',
    category: 'Stylize',
    description: 'Diagonal highlight sweep',
    slot: 'backgroundImage',
    params: [
      p('Angle', 115, 0, 360, 1, 'deg'),
      p('Position', 50, -50, 150, 0.5, '%'),
      p('Width', 10, 1, 60, 0.5, '%'),
      spaceParam(),
    ],
    colors: [c('Colour', 'rgba(255,255,255,0.22)')],
    render: (v, col) => {
      const [angle, pos, w] = [v[0], v[1], Math.max(v[2], 0.5)];
      return `linear-gradient(${n(angle)}deg, transparent ${n(pos - w)}%, ${col[0]} ${n(pos)}%, transparent ${n(pos + w)}%)`;
    },
  },
  {
    name: 'Gradient Fade',
    category: 'Stylize',
    description: 'Fades the layer out along an axis',
    slot: 'maskImage',
    params: [
      p('Angle', 180, 0, 360, 1, 'deg'),
      p('Start', 55, 0, 100, 0.5, '%'),
      p('End', 100, 0, 100, 0.5, '%'),
      spaceParam(),
    ],
    colors: [],
    render: (v, col) => {
      return `linear-gradient(${n(v[0])}deg, #000 ${n(v[1])}%, transparent ${n(v[2])}%)`;
    },
  },
  {
    name: 'Linear Wipe',
    category: 'Transition',
    description: 'Hard-edged reveal; keyframe the completion',
    slot: 'maskImage',
    params: [
      p('Angle', 90, 0, 360, 1, 'deg'),
      p('Completion', 0, 0, 100, 0.5, '%'),
      p('Feather', 0, 0, 50, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      const [angle, done, feather] = [v[0], v[1], v[2]];
      return `linear-gradient(${n(angle)}deg, transparent ${n(done)}%, #000 ${n(Math.min(done + feather, 100))}%)`;
    },
  },
  {
    name: 'Brightness',
    category: 'Colour',
    description: 'Scales luminance',
    slot: 'filter',
    params: [p('Amount', 1.2, 0, 4, 0.01, '')],
    colors: [],
    render: (v, col) => {
      return `brightness(${n(v[0])})`;
    },
  },
  {
    name: 'Contrast',
    category: 'Colour',
    description: 'Pushes tones apart',
    slot: 'filter',
    params: [p('Amount', 1.2, 0, 4, 0.01, '')],
    colors: [],
    render: (v, col) => {
      return `contrast(${n(v[0])})`;
    },
  },
  {
    name: 'Saturation',
    category: 'Colour',
    description: 'Colour intensity',
    slot: 'filter',
    params: [p('Amount', 1.3, 0, 4, 0.01, '')],
    colors: [],
    render: (v, col) => {
      return `saturate(${n(v[0])})`;
    },
  },
  {
    name: 'Hue Rotate',
    category: 'Colour',
    description: 'Spins the colour wheel',
    slot: 'filter',
    params: [p('Angle', 45, -360, 360, 1, 'deg')],
    colors: [],
    render: (v, col) => {
      return `hue-rotate(${n(v[0])}deg)`;
    },
  },
  {
    name: 'Black & White',
    category: 'Colour',
    description: 'Removes colour',
    slot: 'filter',
    params: [p('Amount', 1, 0, 1, 0.01, '')],
    colors: [],
    render: (v, col) => {
      return `grayscale(${n(v[0])})`;
    },
  },
  {
    name: 'Sepia',
    category: 'Colour',
    description: 'Warm monochrome',
    slot: 'filter',
    params: [p('Amount', 1, 0, 1, 0.01, '')],
    colors: [],
    render: (v, col) => {
      return `sepia(${n(v[0])})`;
    },
  },
  {
    name: 'Invert',
    category: 'Colour',
    description: 'Negative image',
    slot: 'filter',
    params: [p('Amount', 1, 0, 1, 0.01, '')],
    colors: [],
    render: (v, col) => {
      return `invert(${n(v[0])})`;
    },
  },
  {
    name: 'Tint',
    category: 'Colour',
    description: 'Maps the layer onto one hue',
    slot: 'filter',
    params: [p('Hue', 260, 0, 360, 1, 'deg'), p('Amount', 1, 0, 4, 0.01, '')],
    colors: [],
    render: (v, col) => {
      return `sepia(1) hue-rotate(${n(v[0] - 40)}deg) saturate(${n(v[1] * 3)})`;
    },
  },
  {
    name: 'Fade',
    category: 'Colour',
    description: 'Transparency inside the effect stack',
    slot: 'filter',
    params: [p('Opacity', 1, 0, 1, 0.01, '')],
    colors: [],
    render: (v, col) => {
      return `opacity(${n(v[0])})`;
    },
  },
  {
    name: 'Exposure',
    category: 'Colour',
    description: 'Stops of light, not a percentage',
    slot: 'filter',
    params: [p('Exposure', 0, -5, 5, 0.05, 'stops')],
    colors: [],
    render: (v, col) => {
      return `brightness(${n(Math.pow(2, v[0]))})`;
    },
  },
  {
    name: 'Threshold',
    category: 'Colour',
    description: 'Everything to black or white',
    slot: 'filter',
    params: [p('Level', 50, 1, 99, 0.5, '%')],
    colors: [],
    render: (v, col) => {
      const level = clamp(v[0], 1, 99) / 100;
      return `grayscale(1) brightness(${n(0.5 / Math.max(level, 0.01))}) contrast(255)`;
    },
  },
  {
    name: 'Photo Filter',
    category: 'Colour',
    description: 'Warms or cools the whole layer',
    slot: 'filter',
    params: [
      p('Hue', 30, 0, 360, 1, 'deg'),
      p('Density', 40, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      const density = clamp(v[1] / 100, 0, 1);
      return `sepia(${n(density)}) hue-rotate(${n(v[0] - 40)}deg) saturate(${n(1 + density)})`;
    },
  },
  {
    name: 'Colour Balance',
    category: 'Colour',
    description: 'Hue, saturation and lightness together',
    slot: 'filter',
    params: [
      p('Hue', 0, -180, 180, 1, 'deg'),
      p('Saturation', 1, 0, 3, 0.01, ''),
      p('Lightness', 1, 0, 3, 0.01, ''),
    ],
    colors: [],
    render: (v, col) => {
      return `hue-rotate(${n(v[0])}deg) saturate(${n(v[1])}) brightness(${n(v[2])})`;
    },
  },
  {
    name: 'Radial Wipe',
    category: 'Transition',
    description: 'Sweeps round like a clock hand',
    slot: 'maskImage',
    params: [
      p('Start Angle', 0, 0, 360, 1, 'deg'),
      p('Completion', 0, 0, 100, 0.5, '%'),
      p('Feather', 0, 0, 40, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      const [from, done, feather] = [v[0], clamp(v[1], 0, 100), v[2]];
      return `conic-gradient(from ${n(from)}deg, transparent ${n(done)}%, #000 ${n(Math.min(done + feather, 100))}%)`;
    },
  },
  {
    name: 'Iris Wipe',
    category: 'Transition',
    description: 'Opens or closes from a point',
    slot: 'maskImage',
    params: [
      p('Completion', 100, 0, 100, 0.5, '%'),
      p('Feather', 4, 0, 50, 0.5, '%'),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      const done = clamp(v[0], 0, 100) * 0.75;
      return `radial-gradient(circle at ${n(v[2])}% ${n(v[3])}%, #000 ${n(Math.max(done - v[1], 0))}%, transparent ${n(done)}%)`;
    },
  },
  {
    name: 'Venetian Blinds',
    category: 'Transition',
    description: 'Reveals through widening slats',
    slot: 'maskImage',
    params: [
      p('Direction', 0, 0, 360, 1, 'deg'),
      p('Width', 40, 4, 400, 1, 'px'),
      p('Completion', 100, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      const width = Math.max(v[1], 1);
      const open = (width * clamp(v[2], 0, 100)) / 100;
      return `repeating-linear-gradient(${n(v[0])}deg, #000 0 ${n(open)}px, transparent ${n(open)}px ${n(width)}px)`;
    },
  },
  {
    name: 'Scan Lines',
    category: 'Stylize',
    description: 'Broadcast monitor lines over the layer',
    slot: 'backgroundImage',
    params: [
      p('Spacing', 4, 2, 40, 0.5, 'px'),
      p('Thickness', 1, 0.5, 20, 0.5, 'px'),
      p('Angle', 0, 0, 360, 1, 'deg'),
      spaceParam(),
    ],
    colors: [c('Colour', 'rgba(0,0,0,0.35)')],
    render: (v, col) => {
      const spacing = Math.max(v[0], 1);
      const thickness = Math.min(v[1], spacing);
      return `repeating-linear-gradient(0deg, ${col[0]} 0 ${n(thickness)}px, transparent ${n(thickness)}px ${n(spacing)}px)`;
    },
  },
  {
    name: 'Grid',
    category: 'Stylize',
    description: 'Ruled lines across the layer',
    slot: 'backgroundImage',
    params: [p('Size', 40, 4, 400, 1, 'px'), p('Width', 1, 0.5, 20, 0.5, 'px')],
    colors: [c('Colour', 'rgba(255,255,255,0.25)')],
    render: (v, col) => {
      const size = Math.max(v[0], 2);
      const width = Math.min(v[1], size);
      return `repeating-linear-gradient(0deg, ${col[0]} 0 ${n(width)}px, transparent ${n(width)}px ${n(size)}px), repeating-linear-gradient(90deg, ${col[0]} 0 ${n(width)}px, transparent ${n(width)}px ${n(size)}px)`;
    },
  },
  {
    name: 'Checkerboard',
    category: 'Stylize',
    description: 'Two-tone squares',
    slot: 'backgroundImage',
    params: [p('Size', 32, 4, 400, 1, 'px')],
    colors: [c('Colour', 'rgba(255,255,255,0.18)')],
    render: (v, col) => {
      const size = Math.max(v[0], 2);
      return `conic-gradient(${col[0]} 0 25%, transparent 0 50%, ${col[0]} 0 75%, transparent 0) 0 0 / ${n(size)}px ${n(size)}px`;
    },
  },
  {
    name: 'Bevel Alpha',
    category: 'Stylize',
    description: 'Lights one edge and shades the other',
    slot: 'boxShadow',
    params: [
      p('Depth', 3, 0, 40, 0.5, 'px'),
      p('Light Angle', 315, 0, 360, 1, 'deg'),
      spaceParam(),
    ],
    colors: [
      c('Highlight', 'rgba(255,255,255,0.55)'),
      c('Shade', 'rgba(0,0,0,0.45)'),
    ],
    render: (v, col) => {
      const [depth, angle] = [v[0], (v[1] * Math.PI) / 180];
      const [dx, dy] = [depth * Math.cos(angle), depth * Math.sin(angle)];
      return `inset ${n(dx)}px ${n(dy)}px ${n(depth)}px ${col[0]}, inset ${n(-dx)}px ${n(-dy)}px ${n(depth)}px ${col[1]}`;
    },
  },
  {
    name: 'Box Blur',
    category: 'Blur & Sharpen',
    description: 'Box blur, repeated; cheaper than a gaussian',
    slot: 'filter',
    params: [
      p('Blurriness', 12, 0, 300, 0.5, 'px'),
      p('Iterations', 1, 1, 4, 1, ''),
    ],
    colors: [],
    render: (v, col) => {
      return `blur(${n(v[0] * Math.sqrt(Math.max(v[1], 1) / 3))}px)`;
    },
  },
  {
    name: 'Axial Blur',
    category: 'Blur & Sharpen',
    description: 'Separate horizontal and vertical blurs',
    slot: 'filter',
    params: [
      p('Horizontal', 12, 0, 300, 0.5, 'px'),
      p('Vertical', 12, 0, 300, 0.5, 'px'),
    ],
    colors: [],
    render: (v, col) => {
      return `blur(${n((v[0] + v[1]) * 0.5)}px)`;
    },
  },
  {
    name: 'Directional Blur',
    category: 'Blur & Sharpen',
    description: 'A streak along one axis, centred on the pixel',
    slot: 'filter',
    params: [
      p('Length', 16, 0, 400, 0.5, 'px'),
      p('Angle', 0, 0, 360, 1, 'deg'),
      spaceParam(),
    ],
    colors: [],
    render: (v, col) => {
      return `blur(${n(v[0] * 0.5)}px)`;
    },
  },
  {
    name: 'Radial Blur',
    category: 'Blur & Sharpen',
    description: 'Spin or zoom about a centre',
    slot: 'filter',
    params: [
      p('Amount', 10, -100, 100, 0.5, ''),
      choice('Type', 0, ['Spin', 'Zoom']),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return `blur(${n(Math.abs(v[0]) * 0.15)}px)`;
    },
  },
  {
    name: 'Channel Blur',
    category: 'Blur & Sharpen',
    description: 'A separate radius per channel',
    slot: 'filter',
    params: [
      p('Red', 0, 0, 200, 0.5, 'px'),
      p('Green', 0, 0, 200, 0.5, 'px'),
      p('Blue', 0, 0, 200, 0.5, 'px'),
      p('Alpha', 0, 0, 200, 0.5, 'px'),
    ],
    colors: [],
    render: (v, col) => {
      const widest = Math.max(Math.max(Math.max(v[0], v[1]), v[2]), v[3]);
      return `blur(${n(widest)}px)`;
    },
  },
  {
    name: 'Bilateral Blur',
    category: 'Blur & Sharpen',
    description: 'Smooths flat areas and leaves edges alone',
    slot: 'filter',
    params: [
      p('Radius', 6, 0, 40, 0.5, 'px'),
      p('Threshold', 10, 0.5, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return `blur(${n(v[0] * 0.5)}px)`;
    },
  },
  {
    name: 'Tolerance Blur',
    category: 'Blur & Sharpen',
    description: 'Blurs within a tolerance; can show the edges instead',
    slot: 'filter',
    params: [
      p('Radius', 6, 0, 40, 0.5, 'px'),
      p('Threshold', 10, 0.5, 100, 0.5, '%'),
      choice('Mode', 0, ['Normal', 'Edge Only', 'Overlay Edge']),
    ],
    colors: [],
    render: (v, col) => {
      return `blur(${n(v[0] * 0.5)}px)`;
    },
  },
  {
    name: 'Unsharp Mask',
    category: 'Blur & Sharpen',
    description: 'Local contrast, above a threshold',
    slot: 'filter',
    params: [
      p('Amount', 50, 0, 500, 1, '%'),
      p('Radius', 2, 0.1, 100, 0.1, 'px'),
      p('Threshold', 0, 0, 100, 0.5, ''),
    ],
    colors: [],
    render: (v, col) => {
      return `contrast(${n(1 + v[0] / 200)})`;
    },
  },
  {
    name: 'Bokeh Blur',
    category: 'Blur & Sharpen',
    description: 'Defocus with a real iris, and highlights that bloom',
    slot: 'filter',
    params: [
      p('Blur Radius', 10, 0, 200, 0.5, 'px'),
      p('Iris Blades', 6, 0, 12, 1, ''),
      p('Iris Rotation', 0, 0, 360, 1, 'deg'),
      p('Highlight Gain', 4, 0, 40, 0.1, ''),
      p('Highlight Threshold', 70, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return `blur(${n(v[0])}px)`;
    },
  },
  {
    name: 'Bulge',
    category: 'Distort',
    description: 'Swells the picture out from a centre',
    slot: 'filter',
    params: [
      p('Horizontal Radius', 35, 0, 200, 0.5, '%'),
      p('Vertical Radius', 35, 0, 200, 0.5, '%'),
      p('Bulge Height', 0.5, -4, 4, 0.01, ''),
      p('Taper Radius', 1, 0.1, 4, 0.01, ''),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Spherical Warp',
    category: 'Distort',
    description: 'Wraps the picture onto a sphere',
    slot: 'filter',
    params: [
      p('Radius', 35, 0, 200, 0.5, '%'),
      p('Strength', 1, -2, 2, 0.01, ''),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Twirl',
    category: 'Distort',
    description: 'Winds the picture around a centre',
    slot: 'filter',
    params: [
      p('Angle', 90, -3600, 3600, 1, 'deg'),
      p('Twirl Radius', 40, 0, 200, 0.5, '%'),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Ripple',
    category: 'Distort',
    description: 'Concentric waves running out from a centre',
    slot: 'filter',
    params: [
      p('Radius', 40, 0, 200, 0.5, '%'),
      p('Ripple Height', 2, -50, 50, 0.1, '%'),
      p('Ripple Width', 15, 0.5, 100, 0.5, '%'),
      p('Wave Speed', 1, -10, 10, 0.05, ''),
      p('Phase', 0, 0, 3600, 1, 'deg'),
      choice('Type', 1, ['Asymmetric', 'Symmetric']),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Wave Warp',
    category: 'Distort',
    description: 'A travelling wave across the layer',
    slot: 'filter',
    params: [
      choice('Wave Type', 0, [
        'Sine',
        'Square',
        'Triangle',
        'Sawtooth',
        'Noise',
      ]),
      p('Wave Height', 5, -100, 100, 0.5, '%'),
      p('Wave Width', 25, 0.5, 200, 0.5, '%'),
      p('Direction', 90, 0, 360, 1, 'deg'),
      p('Wave Speed', 1, -10, 10, 0.05, ''),
      p('Phase', 0, 0, 3600, 1, 'deg'),
      choice('Pinning', 0, ['None', 'Both Edges']),
      spaceParam(),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Noise Warp',
    category: 'Distort',
    description: 'Fractal noise pushed through the picture',
    slot: 'filter',
    params: [
      choice('Displacement', 0, [
        'Turbulent',
        'Bulge',
        'Twist',
        'Horizontal',
        'Vertical',
      ]),
      p('Amount', 5, -100, 100, 0.5, '%'),
      p('Size', 40, 1, 400, 0.5, '%'),
      p('Complexity', 3, 1, 8, 1, ''),
      p('Evolution', 0, -100, 100, 0.1, ''),
      p('Evolution Speed', 0, -10, 10, 0.05, ''),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Mirror',
    category: 'Distort',
    description: 'Reflects one side of the layer across a line',
    slot: 'filter',
    params: [
      p('Reflection Angle', 0, 0, 360, 1, 'deg'),
      p('Reflection Centre X', 50, -50, 150, 0.5, '%'),
      p('Reflection Centre Y', 50, -50, 150, 0.5, '%'),
      spaceParam(),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Offset',
    category: 'Distort',
    description: 'Slides the picture, wrapping at the edges',
    slot: 'filter',
    params: [
      p('Shift X', 0, -100, 100, 0.5, '%'),
      p('Shift Y', 0, -100, 100, 0.5, '%'),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Polar Coordinates',
    category: 'Distort',
    description: 'Bends a straight layer into a ring, or unrolls one',
    slot: 'filter',
    params: [
      choice('Type', 0, ['Rect to Polar', 'Polar to Rect']),
      p('Interpolation', 100, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Magnify',
    category: 'Distort',
    description: 'A lens over part of the layer',
    slot: 'filter',
    params: [
      p('Magnification', 200, 1, 1000, 1, '%'),
      p('Size', 25, 0, 200, 0.5, '%'),
      p('Feather', 20, 0, 100, 0.5, '%'),
      choice('Shape', 0, ['Circle', 'Square']),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Lens Distortion',
    category: 'Distort',
    description: "Adds or removes a lens's barrel distortion",
    slot: 'filter',
    params: [
      p('Field of View', 20, 0, 200, 0.5, ''),
      choice('Reverse Lens Distortion', 0, ['No', 'Yes']),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Fisheye',
    category: 'Distort',
    description: 'A glass ball over the whole layer',
    slot: 'filter',
    params: [
      p('Convergence', 40, -200, 200, 0.5, ''),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Grid Twist',
    category: 'Distort',
    description: 'Cuts the layer into tiles and turns each one',
    slot: 'filter',
    params: [
      p('Tile Size', 10, 0.5, 100, 0.5, '%'),
      p('Rotation', 0, -360, 360, 1, 'deg'),
      p('Scale', 100, 1, 400, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Shear',
    category: 'Distort',
    description: 'Leans the layer over, with one edge held down',
    slot: 'filter',
    params: [
      p('Slant', 20, -200, 200, 0.5, '%'),
      p('Height', 100, 1, 200, 0.5, '%'),
      p('Floor', 100, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Tile Repeat',
    category: 'Distort',
    description: 'Repeats the layer across itself',
    slot: 'filter',
    params: [
      p('Scale', 50, 1, 400, 0.5, '%'),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
      choice('Mirror Edges', 0, ['No', 'Yes']),
      p('Phase', 0, 0, 100, 0.5, '%'),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Seamless Tile',
    category: 'Stylize',
    description: 'Tiles the layer, optionally mirrored at each seam',
    slot: 'filter',
    params: [
      p('Tile Width', 100, 1, 400, 0.5, '%'),
      p('Phase', 0, 0, 100, 0.5, '%'),
      choice('Mirror Edges', 1, ['No', 'Yes']),
      p('Tile Centre X', 50, -50, 150, 0.5, '%'),
      p('Tile Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Band Bend',
    category: 'Distort',
    description: 'Bends a band of the layer',
    slot: 'filter',
    params: [
      p('Bend', 10, -100, 100, 0.5, '%'),
      p('Start', 0, -50, 150, 0.5, '%'),
      p('End', 100, -50, 150, 0.5, '%'),
      choice('Axis', 0, ['Horizontal', 'Vertical']),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Warp',
    category: 'Distort',
    description: 'The arc, flag, fish and twist shapes a text warp offers',
    slot: 'filter',
    params: [
      choice('Warp Style', 0, [
        'Arc',
        'Arch',
        'Bulge',
        'Flag',
        'Wave',
        'Fish',
        'Rise',
        'Twist',
      ]),
      p('Bend', 30, -100, 100, 0.5, '%'),
      p('Horizontal Distortion', 0, -100, 100, 0.5, '%'),
      p('Vertical Distortion', 0, -100, 100, 0.5, '%'),
      choice('Warp Axis', 0, ['Horizontal', 'Vertical']),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Corner Pin',
    category: 'Distort',
    description: 'Pins the four corners anywhere; a true perspective map',
    slot: 'filter',
    params: [
      p('Top Left X', 0, -100, 200, 0.5, '%'),
      p('Top Left Y', 0, -100, 200, 0.5, '%'),
      p('Top Right X', 100, -100, 200, 0.5, '%'),
      p('Top Right Y', 0, -100, 200, 0.5, '%'),
      p('Bottom Right X', 100, -100, 200, 0.5, '%'),
      p('Bottom Right Y', 100, -100, 200, 0.5, '%'),
      p('Bottom Left X', 0, -100, 200, 0.5, '%'),
      p('Bottom Left Y', 100, -100, 200, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Tear',
    category: 'Distort',
    description: 'Tears the layer apart along a line',
    slot: 'filter',
    params: [
      p('Split', 5, -100, 100, 0.5, '%'),
      p('Point A X', 0, -50, 150, 0.5, '%'),
      p('Point A Y', 50, -50, 150, 0.5, '%'),
      p('Point B X', 100, -50, 150, 0.5, '%'),
      p('Point B Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Twin Attractors',
    category: 'Distort',
    description: 'Two knots that pull the picture towards them',
    slot: 'filter',
    params: [
      p('Amount 1', 10, -100, 100, 0.5, '%'),
      p('Amount 2', 10, -100, 100, 0.5, '%'),
      p('Tightness', 5, 0.5, 100, 0.5, '%'),
      p('Knot 1 X', 35, -50, 150, 0.5, '%'),
      p('Knot 1 Y', 50, -50, 150, 0.5, '%'),
      p('Knot 2 X', 65, -50, 150, 0.5, '%'),
      p('Knot 2 Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Brightness & Contrast',
    category: 'Colour',
    description: 'The two sliders together, as one matrix',
    slot: 'filter',
    params: [
      p('Brightness', 0, -100, 100, 0.5, ''),
      p('Contrast', 0, -100, 100, 0.5, ''),
    ],
    colors: [],
    render: (v, col) => {
      return `brightness(${n(1 + v[0] / 100)}) contrast(${n(1 + v[1] / 100)})`;
    },
  },
  {
    name: 'Levels',
    category: 'Colour',
    description: 'Input and output range, with a gamma between them',
    slot: 'filter',
    params: [
      p('Input Black', 0, 0, 255, 1, ''),
      p('Input White', 255, 0, 255, 1, ''),
      p('Gamma', 1, 0.1, 10, 0.01, ''),
      p('Output Black', 0, 0, 255, 1, ''),
      p('Output White', 255, 0, 255, 1, ''),
      choice('Channel', 0, ['RGB', 'Red', 'Green', 'Blue', 'Alpha']),
    ],
    colors: [],
    render: (v, col) => {
      const span = Math.max(v[1] - v[0], 1) / 255;
      return `contrast(${n(1 / span)}) brightness(${n(1 / Math.max(v[2], 0.1))})`;
    },
  },
  {
    name: 'Hue/Saturation',
    category: 'Colour',
    description: 'Shift a band of the wheel, or colorise outright',
    slot: 'filter',
    params: [
      p('Master Hue', 0, -180, 180, 1, 'deg'),
      p('Master Saturation', 0, -100, 100, 0.5, ''),
      p('Master Lightness', 0, -100, 100, 0.5, ''),
      choice('Colorize', 0, ['No', 'Yes']),
      p('Colorize Hue', 0, 0, 360, 1, 'deg'),
      p('Colorize Saturation', 50, 0, 100, 0.5, ''),
      p('Range Centre', 0, 0, 360, 1, 'deg'),
      p('Range Width', 180, 0, 180, 1, 'deg'),
      p('Range Feather', 30, 0, 180, 1, 'deg'),
    ],
    colors: [],
    render: (v, col) => {
      return `hue-rotate(${n(v[0])}deg) saturate(${n(1 + v[1] / 100)})`;
    },
  },
  {
    name: 'Channel Mixer',
    category: 'Colour',
    description: 'Each output channel from any mix of the inputs',
    slot: 'filter',
    params: [
      p('Red from Red', 100, -200, 200, 1, '%'),
      p('Red from Green', 0, -200, 200, 1, '%'),
      p('Red from Blue', 0, -200, 200, 1, '%'),
      p('Red Constant', 0, -100, 100, 1, '%'),
      p('Green from Red', 0, -200, 200, 1, '%'),
      p('Green from Green', 100, -200, 200, 1, '%'),
      p('Green from Blue', 0, -200, 200, 1, '%'),
      p('Green Constant', 0, -100, 100, 1, '%'),
      p('Blue from Red', 0, -200, 200, 1, '%'),
      p('Blue from Green', 0, -200, 200, 1, '%'),
      p('Blue from Blue', 100, -200, 200, 1, '%'),
      p('Blue Constant', 0, -100, 100, 1, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'saturate(1)';
    },
  },
  {
    name: 'Tritone',
    category: 'Colour',
    description: 'Maps shadows, midtones and highlights to three colours',
    slot: 'filter',
    params: [p('Blend With Original', 0, 0, 100, 0.5, '%')],
    colors: [
      c('Shadows', '#0b1026'),
      c('Midtones', '#7a6a55'),
      c('Highlights', '#fff6e0'),
    ],
    render: (v, col) => {
      return `sepia(${n(1 - v[0] / 100)})`;
    },
  },
  {
    name: 'Vibrance',
    category: 'Colour',
    description: 'Saturates the dull colours and spares the vivid ones',
    slot: 'filter',
    params: [
      p('Vibrance', 30, -100, 100, 0.5, ''),
      p('Saturation', 0, -100, 100, 0.5, ''),
      choice('Protect Skin', 1, ['No', 'Yes']),
    ],
    colors: [],
    render: (v, col) => {
      return `saturate(${n(1 + (v[0] + v[1]) / 200)})`;
    },
  },
  {
    name: 'Gamma/Pedestal/Gain',
    category: 'Colour',
    description: 'Lift, gamma and gain, one set per channel',
    slot: 'filter',
    params: [
      p('Red Gamma', 1, 0.1, 10, 0.01, ''),
      p('Green Gamma', 1, 0.1, 10, 0.01, ''),
      p('Blue Gamma', 1, 0.1, 10, 0.01, ''),
      p('Red Pedestal', 0, -1, 1, 0.01, ''),
      p('Green Pedestal', 0, -1, 1, 0.01, ''),
      p('Blue Pedestal', 0, -1, 1, 0.01, ''),
      p('Red Gain', 1, 0, 4, 0.01, ''),
      p('Green Gain', 1, 0, 4, 0.01, ''),
      p('Blue Gain', 1, 0, 4, 0.01, ''),
    ],
    colors: [],
    render: (v, col) => {
      return `brightness(${n((v[6] + v[7] + v[8]) / 3)})`;
    },
  },
  {
    name: 'Selective Colour',
    category: 'Colour',
    description: 'Adjust one family of colours and leave the rest',
    slot: 'filter',
    params: [
      choice('Colours', 0, [
        'Reds',
        'Yellows',
        'Greens',
        'Cyans',
        'Blues',
        'Magentas',
        'Whites',
        'Neutrals',
        'Blacks',
      ]),
      p('Cyan', 0, -100, 100, 0.5, '%'),
      p('Magenta', 0, -100, 100, 0.5, '%'),
      p('Yellow', 0, -100, 100, 0.5, '%'),
      p('Black', 0, -100, 100, 0.5, '%'),
      choice('Method', 0, ['Relative', 'Absolute']),
    ],
    colors: [],
    render: (v, col) => {
      return 'saturate(1)';
    },
  },
  {
    name: 'Shadow/Highlight',
    category: 'Colour',
    description: 'Opens the shadows and pulls the highlights back',
    slot: 'filter',
    params: [
      p('Shadow Amount', 30, 0, 100, 0.5, '%'),
      p('Highlight Amount', 0, 0, 100, 0.5, '%'),
      p('Shadow Tonal Width', 35, 1, 100, 0.5, '%'),
      p('Highlight Tonal Width', 35, 1, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return `brightness(${n(1 + v[0] / 300)})`;
    },
  },
  {
    name: 'Hue Replace',
    category: 'Colour',
    description: 'Replaces one hue with another, keeping the shading',
    slot: 'filter',
    params: [
      p('From Hue', 0, 0, 360, 1, 'deg'),
      p('Hue Tolerance', 30, 0, 180, 0.5, 'deg'),
      p('Softness', 30, 0, 180, 0.5, 'deg'),
      p('Amount', 100, 0, 100, 0.5, '%'),
      p('Saturation Tolerance', 15, 0, 100, 0.5, '%'),
      choice('Invert Selection', 0, ['No', 'Yes']),
    ],
    colors: [c('To Colour', '#3366ff')],
    render: (v, col) => {
      return `hue-rotate(${n(v[0])}deg)`;
    },
  },
  {
    name: 'Isolate Colour',
    category: 'Colour',
    description: 'Drains every colour but one',
    slot: 'filter',
    params: [
      p('Hue to Keep', 0, 0, 360, 1, 'deg'),
      p('Tolerance', 30, 0, 180, 0.5, 'deg'),
      p('Softness', 30, 0, 180, 0.5, 'deg'),
      p('Amount to Decolour', 100, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return `grayscale(${n(v[3] / 100)})`;
    },
  },
  {
    name: 'Colour Cycle',
    category: 'Colour',
    description: 'Cycles the picture through a colour ramp',
    slot: 'filter',
    params: [
      p('Phase', 0, -10, 10, 0.01, ''),
      p('Cycle Speed', 0, -10, 10, 0.01, ''),
      p('Repetitions', 1, 0.1, 20, 0.1, ''),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
      choice('Driven By', 0, ['Lightness', 'Hue']),
    ],
    colors: [
      c('Colour A', '#ff0033'),
      c('Colour B', '#1a99ff'),
      c('Colour C', '#ffe633'),
    ],
    render: (v, col) => {
      return `hue-rotate(${n(v[0] * 360)}deg)`;
    },
  },
  {
    name: 'Broadcast Colours',
    category: 'Colour',
    description: 'Pulls the picture inside legal levels',
    slot: 'filter',
    params: [
      p('Maximum Level', 235, 0, 255, 1, ''),
      p('Minimum Level', 16, 0, 255, 1, ''),
      choice('How', 0, ['Reduce Luminance', 'Reduce Saturation']),
    ],
    colors: [],
    render: (v, col) => {
      return `contrast(${n(Math.max(v[0] - v[1], 1) / 255)})`;
    },
  },
  {
    name: 'Tone Map',
    category: 'Colour',
    description: 'A three-point tone map across the range',
    slot: 'filter',
    params: [p('Blend With Original', 0, 0, 100, 0.5, '%')],
    colors: [
      c('Blacks', '#0d0d1f'),
      c('Midtones', '#807366'),
      c('Whites', '#fffae6'),
    ],
    render: (v, col) => {
      return `sepia(${n(1 - v[0] / 100)})`;
    },
  },
  {
    name: 'Channel Phase',
    category: 'Colour',
    description: "Rotates each channel's response independently",
    slot: 'filter',
    params: [
      p('Red Phase', 0, -1, 1, 0.005, ''),
      p('Green Phase', 0, -1, 1, 0.005, ''),
      p('Blue Phase', 0, -1, 1, 0.005, ''),
      choice('Overflow', 1, ['Clamp', 'Wrap']),
    ],
    colors: [],
    render: (v, col) => {
      return `hue-rotate(${n(v[0] * 360)}deg)`;
    },
  },
  {
    name: 'Convolution Matrix',
    category: 'Colour',
    description: 'A 3x3 convolution: emboss, edge detect, whatever you type',
    slot: 'filter',
    params: [
      p('Row 1 Col 1', 0, -10, 10, 0.1, ''),
      p('Row 1 Col 2', 0, -10, 10, 0.1, ''),
      p('Row 1 Col 3', 0, -10, 10, 0.1, ''),
      p('Row 2 Col 1', 0, -10, 10, 0.1, ''),
      p('Row 2 Col 2', 1, -10, 10, 0.1, ''),
      p('Row 2 Col 3', 0, -10, 10, 0.1, ''),
      p('Row 3 Col 1', 0, -10, 10, 0.1, ''),
      p('Row 3 Col 2', 0, -10, 10, 0.1, ''),
      p('Row 3 Col 3', 0, -10, 10, 0.1, ''),
      p('Divisor', 0, -100, 100, 0.1, ''),
      p('Offset', 0, -1, 1, 0.01, ''),
      p('Spread', 1, 1, 64, 0.5, 'px'),
    ],
    colors: [],
    render: (v, col) => {
      return 'contrast(1)';
    },
  },
  {
    name: '4-Colour Gradient',
    category: 'Generate',
    description: 'Four colours bleeding into one another',
    slot: 'backgroundImage',
    params: [
      p('Falloff', 2, 0.5, 8, 0.1, ''),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [
      c('Colour 1', '#ff1a33'),
      c('Colour 2', '#ffcc1a'),
      c('Colour 3', '#1a80ff'),
      c('Colour 4', '#66ff99'),
    ],
    render: (v, col) => {
      return `radial-gradient(at 0% 0%, ${col[0]} 0%, transparent 60%), radial-gradient(at 100% 0%, ${col[1]} 0%, transparent 60%), radial-gradient(at 0% 100%, ${col[2]} 0%, transparent 60%), radial-gradient(at 100% 100%, ${col[3]} 0%, transparent 60%)`;
    },
  },
  {
    name: 'Circle',
    category: 'Generate',
    description: 'A disc or ring drawn over the layer',
    slot: 'backgroundImage',
    params: [
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
      p('Radius X', 30, 0, 150, 0.5, '%'),
      p('Radius Y', 30, 0, 150, 0.5, '%'),
      p('Feather', 1, 0, 100, 0.5, '%'),
      p('Edge Thickness', 0, 0, 100, 0.5, '%'),
      choice('Invert', 0, ['No', 'Yes']),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [c('Colour', '#ffffff')],
    render: (v, col) => {
      return `radial-gradient(ellipse ${n(v[2])}% ${n(v[3])}% at ${n(v[0])}% ${n(v[1])}%, ${col[0]} 99%, transparent 100%)`;
    },
  },
  {
    name: 'Fill',
    category: 'Generate',
    description: 'Floods the layer with one colour, keeping its shape',
    slot: 'backgroundImage',
    params: [
      p('Opacity', 100, 0, 100, 0.5, '%'),
      choice('Cover', 0, ['Layer Shape', 'Whole Box']),
    ],
    colors: [c('Colour', '#ff0000')],
    render: (v, col) => {
      return `linear-gradient(${col[0]}, ${col[0]})`;
    },
  },
  {
    name: 'Beam',
    category: 'Generate',
    description: 'A tapering beam between two points',
    slot: 'backgroundImage',
    params: [
      p('Start X', 10, -50, 150, 0.5, '%'),
      p('Start Y', 50, -50, 150, 0.5, '%'),
      p('End X', 90, -50, 150, 0.5, '%'),
      p('End Y', 50, -50, 150, 0.5, '%'),
      p('Start Thickness', 2, 0.1, 50, 0.1, '%'),
      p('End Thickness', 2, 0.1, 50, 0.1, '%'),
      p('Length', 100, 0, 100, 0.5, '%'),
      p('Softness', 40, 0, 100, 0.5, '%'),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [c('Colour', '#ffffff')],
    render: (v, col) => {
      return `linear-gradient(90deg, transparent, ${col[0]}, transparent)`;
    },
  },
  {
    name: 'Lens Flare',
    category: 'Generate',
    description: 'Core, halo, ghosts and an anamorphic streak',
    slot: 'backgroundImage',
    params: [
      p('Centre X', 30, -50, 150, 0.5, '%'),
      p('Centre Y', 30, -50, 150, 0.5, '%'),
      p('Brightness', 100, 0, 400, 1, '%'),
      p('Scale', 25, 1, 200, 0.5, '%'),
      p('Ghosts', 30, 0, 200, 0.5, '%'),
      p('Streak', 40, 0, 200, 0.5, '%'),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [c('Colour', '#fff2d9')],
    render: (v, col) => {
      return `radial-gradient(circle at ${n(v[0])}% ${n(v[1])}%, ${col[0]} 0%, transparent ${n(v[3])}%)`;
    },
  },
  {
    name: 'Voronoi Cells',
    category: 'Generate',
    description: 'Worley cells: crystals, bubbles and plates',
    slot: 'backgroundImage',
    params: [
      choice('Cell Type', 0, ['Bubbles', 'Crystals', 'Plates', 'Tubular']),
      p('Size', 15, 0.5, 100, 0.5, '%'),
      p('Contrast', 100, 0, 400, 1, '%'),
      p('Evolution', 0, -100, 100, 0.1, ''),
      p('Evolution Speed', 0, -10, 10, 0.05, ''),
      choice('Invert', 0, ['No', 'Yes']),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'linear-gradient(#808080, #808080)';
    },
  },
  {
    name: 'Expanding Rings',
    category: 'Generate',
    description: 'Rings born on a period and expanding outward',
    slot: 'backgroundImage',
    params: [
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
      p('Period', 0.5, 0.05, 10, 0.01, 's'),
      p('Expansion Speed', 30, 0, 200, 0.5, '%/s'),
      p('Lifespan', 2, 0.05, 20, 0.05, 's'),
      p('Thickness', 1, 0.1, 30, 0.1, '%'),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [c('Colour', 'rgba(255,255,255,0.8)')],
    render: (v, col) => {
      return `radial-gradient(circle, transparent 40%, ${col[0]} 42%, transparent 44%)`;
    },
  },
  {
    name: 'Ray Burst',
    category: 'Generate',
    description: 'Streaks of light radiating from a point',
    slot: 'filter',
    params: [
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
      p('Intensity', 100, 0, 400, 1, '%'),
      p('Ray Length', 30, 0, 100, 0.5, '%'),
      p('Threshold', 50, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return `brightness(${n(1 + v[2] / 400)})`;
    },
  },
  {
    name: 'Light Bar',
    category: 'Generate',
    description: 'A band of light travelling across the layer',
    slot: 'filter',
    params: [
      p('Centre', 50, -50, 150, 0.5, '%'),
      p('Width', 20, 0.5, 200, 0.5, '%'),
      p('Direction', 90, 0, 360, 1, 'deg'),
      p('Intensity', 100, 0, 400, 1, '%'),
      choice('Shape', 0, ['Smooth', 'Linear', 'Sharp']),
      p('Edge Falloff', 100, 10, 400, 1, '%'),
      spaceParam(),
    ],
    colors: [c('Colour', 'rgba(255,255,255,0.6)')],
    render: (v, col) => {
      return `brightness(${n(1 + v[3] / 400)})`;
    },
  },
  {
    name: 'Fractal Noise',
    category: 'Noise & Grain',
    description: 'The fractal field itself: clouds, smoke and turbulence',
    slot: 'backgroundImage',
    params: [
      choice('Fractal Type', 1, ['Basic', 'Turbulent']),
      p('Contrast', 100, 0, 400, 1, '%'),
      p('Brightness', 0, -100, 100, 0.5, '%'),
      p('Scale', 30, 1, 400, 0.5, '%'),
      p('Offset X', 0, -400, 400, 0.5, '%'),
      p('Offset Y', 0, -400, 400, 0.5, '%'),
      p('Rotation', 0, -360, 360, 1, 'deg'),
      p('Complexity', 5, 1, 8, 1, ''),
      p('Sub Influence', 50, 5, 100, 0.5, '%'),
      p('Evolution', 0, -100, 100, 0.1, ''),
      p('Evolution Speed', 0, -10, 10, 0.05, ''),
      choice('Invert', 0, ['No', 'Yes']),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'linear-gradient(#808080, #808080)';
    },
  },
  {
    name: 'Turbulent Noise',
    category: 'Noise & Grain',
    description: 'The smoother, non-folding member of the fractal family',
    slot: 'backgroundImage',
    params: [
      p('Contrast', 100, 0, 400, 1, '%'),
      p('Brightness', 0, -100, 100, 0.5, '%'),
      p('Scale', 30, 1, 400, 0.5, '%'),
      p('Complexity', 5, 1, 8, 1, ''),
      p('Evolution', 0, -100, 100, 0.1, ''),
      p('Evolution Speed', 0, -10, 10, 0.05, ''),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'linear-gradient(#808080, #808080)';
    },
  },
  {
    name: 'Noise',
    category: 'Noise & Grain',
    description: 'Per-pixel noise added to the picture',
    slot: 'filter',
    params: [
      p('Amount of Noise', 15, 0, 100, 0.5, '%'),
      choice('Noise Type', 0, ['Monochrome', 'Colour']),
      choice('Overflow', 1, ['Wrap', 'Clip']),
      choice('Noise Alpha', 0, ['No', 'Yes']),
      choice('Animate', 1, ['No', 'Yes']),
      p('Seed', 0, 0, 1000, 1, ''),
    ],
    colors: [],
    render: (v, col) => {
      return `contrast(${n(1 + v[0] / 400)})`;
    },
  },
  {
    name: 'HSL Noise',
    category: 'Noise & Grain',
    description: 'Noise in hue, lightness and saturation',
    slot: 'filter',
    params: [
      p('Hue', 5, 0, 100, 0.5, '%'),
      p('Lightness', 10, 0, 100, 0.5, '%'),
      p('Saturation', 10, 0, 100, 0.5, '%'),
      p('Grain Size', 1, 0.5, 64, 0.5, 'px'),
      choice('Animate', 0, ['No', 'Yes']),
      p('Seed', 0, 0, 1000, 1, ''),
    ],
    colors: [],
    render: (v, col) => {
      return `saturate(${n(1 + v[2] / 200)})`;
    },
  },
  {
    name: 'Film Grain',
    category: 'Noise & Grain',
    description: 'Film grain, strongest in the midtones',
    slot: 'filter',
    params: [
      p('Intensity', 10, 0, 100, 0.5, '%'),
      p('Size', 1, 0.5, 32, 0.1, 'px'),
      p('Softness', 50, 0, 100, 0.5, '%'),
      p('Colour Tint', 0, 0, 100, 0.5, '%'),
      p('Shadow Bias', 0, 0, 100, 0.5, '%'),
      choice('Animate', 1, ['No', 'Yes']),
      p('Seed', 0, 0, 1000, 1, ''),
    ],
    colors: [],
    render: (v, col) => {
      return `contrast(${n(1 + v[0] / 500)})`;
    },
  },
  {
    name: 'Median',
    category: 'Noise & Grain',
    description: 'Replaces each pixel with the middle of its neighbours',
    slot: 'filter',
    params: [p('Radius', 1, 1, 32, 0.5, 'px')],
    colors: [],
    render: (v, col) => {
      return `blur(${n(v[0] * 0.4)}px)`;
    },
  },
  {
    name: 'Speckle Clean',
    category: 'Noise & Grain',
    description: 'A median that only replaces what stands out',
    slot: 'filter',
    params: [
      p('Radius', 2, 1, 32, 0.5, 'px'),
      p('Threshold', 10, 0.5, 100, 0.5, ''),
    ],
    colors: [],
    render: (v, col) => {
      return `blur(${n(v[0] * 0.3)}px)`;
    },
  },
  {
    name: 'Posterize',
    category: 'Stylize',
    description: 'Flattens each channel to a number of steps',
    slot: 'filter',
    params: [p('Level', 8, 2, 64, 1, '')],
    colors: [],
    render: (v, col) => {
      return `contrast(${n(1 + 8 / Math.max(v[0], 2))})`;
    },
  },
  {
    name: 'Pixelate',
    category: 'Stylize',
    description: 'Snaps the picture to a coarse pixel grid',
    slot: 'filter',
    params: [p('Size', 8, 1, 200, 0.5, 'px')],
    colors: [],
    render: (v, col) => {
      return `blur(${n(v[0] * 0.35)}px)`;
    },
  },
  {
    name: 'Mosaic',
    category: 'Stylize',
    description: 'Averages the picture into a grid of blocks',
    slot: 'filter',
    params: [
      p('Horizontal Blocks', 20, 1, 400, 1, ''),
      p('Vertical Blocks', 12, 1, 400, 1, ''),
      choice('Sharp Colours', 1, ['No', 'Yes']),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(4px)';
    },
  },
  {
    name: 'Chromatic Aberration',
    category: 'Stylize',
    description: 'Splits the channels apart the way a lens does',
    slot: 'filter',
    params: [
      p('Amount', 2, -50, 50, 0.1, 'px'),
      p('Angle', 0, 0, 360, 1, 'deg'),
      spaceParam(),
    ],
    colors: [],
    render: (v, col) => {
      return `blur(${n(Math.abs(v[0]) * 0.25)}px)`;
    },
  },
  {
    name: 'Displace',
    category: 'Distort',
    description: 'A simple travelling sine displacement',
    slot: 'filter',
    params: [
      p('Amount', 8, -200, 200, 0.5, 'px'),
      p('Frequency', 4, 0.1, 40, 0.1, ''),
      p('Speed', 1, -10, 10, 0.05, ''),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Find Edges',
    category: 'Stylize',
    description: "Traces the picture's edges, dark on white",
    slot: 'filter',
    params: [
      p('Width', 1, 1, 32, 0.5, 'px'),
      choice('Invert', 0, ['No', 'Yes']),
      choice('Edges', 0, ['Monochrome', 'Per Channel']),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'invert(1) contrast(2)';
    },
  },
  {
    name: 'Emboss',
    category: 'Stylize',
    description: 'Raises the edges into grey relief',
    slot: 'filter',
    params: [
      p('Direction', 45, 0, 360, 1, 'deg'),
      p('Relief', 1, 0.1, 32, 0.1, 'px'),
      p('Contrast', 100, 0, 800, 1, '%'),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'grayscale(1) contrast(2)';
    },
  },
  {
    name: 'Colour Emboss',
    category: 'Stylize',
    description: "Emboss that keeps the artwork's own colour",
    slot: 'filter',
    params: [
      p('Direction', 45, 0, 360, 1, 'deg'),
      p('Relief', 1, 0.1, 32, 0.1, 'px'),
      p('Contrast', 100, 0, 800, 1, '%'),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'contrast(1.6)';
    },
  },
  {
    name: 'Roughen Edges',
    category: 'Stylize',
    description: "Eats into the layer's edge with fractal noise",
    slot: 'filter',
    params: [
      choice('Edge Type', 0, ['Roughen', 'Cut']),
      p('Border', 10, 0, 100, 0.5, '%'),
      p('Scale', 10, 0.5, 200, 0.5, '%'),
      p('Complexity', 3, 1, 8, 1, ''),
      p('Edge Sharpness', 10, 0.5, 100, 0.5, '%'),
      p('Evolution', 0, -100, 100, 0.1, ''),
      p('Evolution Speed', 0, -10, 10, 0.05, ''),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Scatter',
    category: 'Stylize',
    description: 'Displaces every pixel at random',
    slot: 'filter',
    params: [
      p('Scatter Amount', 2, 0, 50, 0.1, '%'),
      choice('Horizontal', 1, ['No', 'Yes']),
      choice('Vertical', 1, ['No', 'Yes']),
      p('Grain Size', 1, 0.5, 64, 0.5, 'px'),
      choice('Animate', 0, ['No', 'Yes']),
      p('Seed', 0, 0, 1000, 1, ''),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Strobe Light',
    category: 'Stylize',
    description: 'Flashes the layer on a period',
    slot: 'filter',
    params: [
      p('Strobe Period', 1, 0.02, 30, 0.01, 's'),
      p('Strobe Duration', 10, 0, 100, 0.5, '%'),
      choice('Strobe', 0, ['Makes Layer Transparent', 'Flashes Colour']),
      choice('Random Strobe', 0, ['No', 'Yes']),
      p('Intensity', 100, 0, 100, 0.5, '%'),
    ],
    colors: [c('Strobe Colour', '#ffffff')],
    render: (v, col) => {
      return 'brightness(1)';
    },
  },
  {
    name: 'Cartoon',
    category: 'Stylize',
    description: 'Flattens to bands of colour and inks the edges',
    slot: 'filter',
    params: [
      p('Shading Steps', 6, 2, 64, 1, ''),
      p('Edge Width', 1, 1, 32, 0.5, 'px'),
      p('Edge Threshold', 8, 0.5, 100, 0.5, '%'),
      p('Edge Opacity', 100, 0, 100, 0.5, '%'),
      p('Smoothness', 100, 0, 400, 1, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'saturate(1.4) contrast(1.3)';
    },
  },
  {
    name: 'Refraction',
    category: 'Stylize',
    description: 'Refracts and lights the layer through its own luminance',
    slot: 'filter',
    params: [
      p('Displacement', 5, -100, 100, 0.5, '%'),
      p('Softness', 2, 1, 32, 0.5, 'px'),
      p('Height', 100, -400, 400, 1, '%'),
      p('Light Angle', 45, 0, 360, 1, 'deg'),
      p('Light Intensity', 60, 0, 400, 1, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Honeycomb',
    category: 'Stylize',
    description: 'Repeats one hexagon of the layer across the frame',
    slot: 'filter',
    params: [
      p('Size', 20, 0.5, 200, 0.5, '%'),
      p('Rotation', 0, -360, 360, 1, 'deg'),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Kaleidoscope',
    category: 'Stylize',
    description: 'Mirrors a wedge of the layer around a centre',
    slot: 'filter',
    params: [
      p('Sides', 6, 1, 32, 1, ''),
      p('Rotation', 0, -360, 360, 1, 'deg'),
      p('Size', 100, 1, 400, 1, '%'),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Mirror Tile',
    category: 'Stylize',
    description: 'Tiles the layer, mirroring alternate cells',
    slot: 'filter',
    params: [
      p('Horizontal Tiles', 2, 1, 64, 1, ''),
      p('Vertical Tiles', 2, 1, 64, 1, ''),
      choice('Tiling', 1, ['Repeat', 'Mirror']),
      p('Expand', 100, 10, 400, 1, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Block Reveal',
    category: 'Stylize',
    description: 'Reveals the layer block by block, as a picture used to load',
    slot: 'filter',
    params: [
      p('Completion', 50, 0, 100, 0.5, '%'),
      p('Blocks', 24, 1, 200, 1, ''),
      choice('Order', 0, ['Random', 'Scanline']),
      p('Start Blur', 50, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Burn Through',
    category: 'Stylize',
    description: 'Burns a hole through the layer, with a glowing rim',
    slot: 'filter',
    params: [
      p('Burn', 0, 0, 100, 0.5, '%'),
      p('Scale', 20, 1, 200, 0.5, '%'),
      p('Rim Width', 6, 0.5, 50, 0.5, '%'),
      p('Evolution', 0, -100, 100, 0.1, ''),
      p('Evolution Speed', 0, -10, 10, 0.05, ''),
    ],
    colors: [c('Rim Colour', '#ff8c1a')],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Moulded Relief',
    category: 'Stylize',
    description: 'Lights the layer as a moulded relief',
    slot: 'filter',
    params: [
      p('Bump Height', 400, -2000, 2000, 1, '%'),
      p('Spread', 2, 1, 32, 0.5, 'px'),
      p('Light Angle', 135, 0, 360, 1, 'deg'),
      p('Light Elevation', 45, 0, 90, 1, 'deg'),
      p('Shine', 80, 0, 400, 1, '%'),
      p('Ambient', 50, 0, 200, 1, '%'),
      spaceParam(),
    ],
    colors: [],
    render: (v, col) => {
      return 'contrast(1.2)';
    },
  },
  {
    name: 'Channel Threshold',
    category: 'Stylize',
    description: 'A separate threshold on each channel',
    slot: 'filter',
    params: [
      p('Red Threshold', 50, 0, 100, 0.5, '%'),
      p('Green Threshold', 50, 0, 100, 0.5, '%'),
      p('Blue Threshold', 50, 0, 100, 0.5, '%'),
      p('Softness', 2, 0.1, 50, 0.1, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'contrast(4)';
    },
  },
  {
    name: 'Brush Strokes',
    category: 'Stylize',
    description: 'Daubs the picture into short directional strokes',
    slot: 'filter',
    params: [
      p('Brush Size', 6, 0.5, 64, 0.5, 'px'),
      p('Stroke Angle', 45, 0, 360, 1, 'deg'),
      p('Randomness', 30, 0, 100, 0.5, '%'),
      p('Stroke Density', 40, 1, 400, 1, ''),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
      spaceParam(),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(1px)';
    },
  },
  {
    name: 'Colour Key',
    category: 'Keying',
    description: 'Drops pixels near a colour, measured in RGB',
    slot: 'filter',
    params: [
      p('Tolerance', 15, 0, 100, 0.5, '%'),
      p('Edge Feather', 10, 0.1, 100, 0.5, '%'),
      choice('Invert', 0, ['No', 'Yes']),
      choice('View', 0, ['Result', 'Matte']),
    ],
    colors: [c('Key Colour', '#00ff00')],
    render: (v, col) => {
      return 'opacity(1)';
    },
  },
  {
    name: 'Luma Key',
    category: 'Keying',
    description: 'Keys on brightness alone',
    slot: 'filter',
    params: [
      p('Threshold', 15, 0, 100, 0.5, '%'),
      p('Edge Feather', 10, 0.1, 100, 0.5, '%'),
      choice('Invert', 0, ['No', 'Yes']),
      choice('View', 0, ['Result', 'Matte']),
    ],
    colors: [c('Key Colour', '#000000')],
    render: (v, col) => {
      return 'opacity(1)';
    },
  },
  {
    name: 'Linear Colour Key',
    category: 'Keying',
    description: 'Keys on chroma, so shading in the backing does not reopen it',
    slot: 'filter',
    params: [
      p('Matching Tolerance', 15, 0, 100, 0.5, '%'),
      p('Matching Softness', 10, 0.1, 100, 0.5, '%'),
      choice('Invert', 0, ['No', 'Yes']),
      choice('View', 0, ['Result', 'Matte']),
    ],
    colors: [c('Key Colour', '#00ff00')],
    render: (v, col) => {
      return 'opacity(1)';
    },
  },
  {
    name: 'Colour Range',
    category: 'Keying',
    description: 'Keys in a luminance/chroma space, tolerant of exposure drift',
    slot: 'filter',
    params: [
      p('Fuzziness', 20, 0, 100, 0.5, '%'),
      p('Softness', 10, 0.1, 100, 0.5, '%'),
      choice('Invert', 0, ['No', 'Yes']),
      choice('View', 0, ['Result', 'Matte']),
    ],
    colors: [c('Key Colour', '#0000ff')],
    render: (v, col) => {
      return 'opacity(1)';
    },
  },
  {
    name: 'Extract',
    category: 'Keying',
    description: 'Keeps a band of one channel and drops the rest',
    slot: 'filter',
    params: [
      choice('Channel', 0, ['Luminance', 'Red', 'Green', 'Blue', 'Alpha']),
      p('Black Point', 0, 0, 100, 0.5, ''),
      p('White Point', 100, 0, 100, 0.5, ''),
      p('Black Softness', 5, 0.1, 100, 0.5, ''),
      p('White Softness', 5, 0.1, 100, 0.5, ''),
      choice('Invert', 0, ['No', 'Yes']),
    ],
    colors: [],
    render: (v, col) => {
      return 'opacity(1)';
    },
  },
  {
    name: 'Spill Suppressor',
    category: 'Keying',
    description: 'Takes a backing colour out of the edges it crept into',
    slot: 'filter',
    params: [
      p('Suppression', 100, 0, 100, 0.5, '%'),
      choice('Preserve Luminance', 1, ['No', 'Yes']),
    ],
    colors: [c('Colour to Suppress', '#00ff00')],
    render: (v, col) => {
      return 'saturate(0.9)';
    },
  },
  {
    name: 'Matte Shrink',
    category: 'Matte',
    description: 'Grows or shrinks the matte',
    slot: 'filter',
    params: [p('Choke Matte', 2, -100, 100, 0.5, 'px')],
    colors: [],
    render: (v, col) => {
      return 'opacity(1)';
    },
  },
  {
    name: 'Matte Choke',
    category: 'Matte',
    description: 'Chokes the matte and softens it in one pass',
    slot: 'filter',
    params: [
      p('Choke', 4, -100, 100, 0.5, 'px'),
      p('Softness', 40, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'opacity(1)';
    },
  },
  {
    name: 'Shift Channels',
    category: 'Channel',
    description: 'Routes any input channel into any output channel',
    slot: 'filter',
    params: [
      choice('Red From', 0, [
        'Red',
        'Green',
        'Blue',
        'Alpha',
        'Luminance',
        'Full On',
        'Full Off',
      ]),
      choice('Green From', 1, [
        'Red',
        'Green',
        'Blue',
        'Alpha',
        'Luminance',
        'Full On',
        'Full Off',
      ]),
      choice('Blue From', 2, [
        'Red',
        'Green',
        'Blue',
        'Alpha',
        'Luminance',
        'Full On',
        'Full Off',
      ]),
      choice('Alpha From', 3, [
        'Red',
        'Green',
        'Blue',
        'Alpha',
        'Luminance',
        'Full On',
        'Full Off',
      ]),
    ],
    colors: [],
    render: (v, col) => {
      return 'saturate(1)';
    },
  },
  {
    name: 'Erode & Dilate',
    category: 'Channel',
    description: 'Erodes or dilates a channel',
    slot: 'filter',
    params: [
      choice('Operation', 0, ['Minimum', 'Maximum']),
      p('Radius', 2, 0, 64, 0.5, 'px'),
      choice('Channel', 0, ['RGBA', 'RGB', 'Alpha', 'Red', 'Green', 'Blue']),
      choice('Direction', 0, ['Both', 'Horizontal', 'Vertical']),
    ],
    colors: [],
    render: (v, col) => {
      return 'contrast(1.1)';
    },
  },
  {
    name: 'Arithmetic',
    category: 'Channel',
    description: 'Combines the layer with a constant colour',
    slot: 'filter',
    params: [
      choice('Operator', 2, [
        'Add',
        'Subtract',
        'Multiply',
        'Divide',
        'Max',
        'Min',
        'Difference',
        'Screen',
      ]),
      choice('Clipping', 1, ['Wrap', 'Clip']),
      choice('Operate on Alpha', 0, ['No', 'Yes']),
    ],
    colors: [c('Operand', '#808080')],
    render: (v, col) => {
      return 'contrast(1)';
    },
  },
  {
    name: 'Solid Composite',
    category: 'Channel',
    description: 'Puts a solid colour behind the layer',
    slot: 'filter',
    params: [
      p('Source Opacity', 100, 0, 100, 0.5, '%'),
      p('Solid Opacity', 100, 0, 100, 0.5, '%'),
    ],
    colors: [c('Colour', '#000000')],
    render: (v, col) => {
      return `drop-shadow(0 0 0 ${col[0]})`;
    },
  },
  {
    name: 'Unmatte',
    category: 'Channel',
    description: 'Undoes a premultiply against a known background',
    slot: 'filter',
    params: [],
    colors: [c('Background Colour', '#ffffff')],
    render: (v, col) => {
      return 'opacity(1)';
    },
  },
  {
    name: 'Bevel Edges',
    category: 'Perspective',
    description: "Bevels the layer's rectangular edge",
    slot: 'filter',
    params: [
      p('Edge Thickness', 5, 0.1, 50, 0.1, '%'),
      p('Light Angle', 135, 0, 360, 1, 'deg'),
      p('Light Intensity', 50, 0, 200, 0.5, '%'),
      spaceParam(),
    ],
    colors: [],
    render: (v, col) => {
      return 'contrast(1.1)';
    },
  },
  {
    name: 'Radial Shadow',
    category: 'Perspective',
    description: 'A shadow from a point light, so it spreads as it falls',
    slot: 'filter',
    params: [
      p('Light Source X', 50, -200, 300, 0.5, '%'),
      p('Light Source Y', -20, -200, 300, 0.5, '%'),
      p('Projection Distance', 20, 0, 200, 0.5, '%'),
      p('Softness', 2, 0, 50, 0.1, '%'),
      p('Opacity', 100, 0, 100, 0.5, '%'),
      choice('Render', 0, ['Regular', 'Shadow Only']),
    ],
    colors: [c('Shadow Colour', 'rgba(0,0,0,0.6)')],
    render: (v, col) => {
      return `drop-shadow(0 ${n(v[2] * 0.4)}px ${n(v[3] * 2)}px ${col[0]})`;
    },
  },
  {
    name: 'Sphere Wrap',
    category: 'Perspective',
    description: 'Wraps the layer onto a lit sphere',
    slot: 'filter',
    params: [
      p('Radius', 40, 1, 150, 0.5, '%'),
      p('Rotation', 0, -360, 360, 1, 'deg'),
      p('Tilt', 0, -100, 100, 0.5, '%'),
      p('Light Intensity', 70, 0, 200, 0.5, '%'),
      p('Ambient', 35, 0, 200, 0.5, '%'),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Cylinder Wrap',
    category: 'Perspective',
    description: 'Wraps the layer onto a lit cylinder',
    slot: 'filter',
    params: [
      p('Radius', 40, 1, 150, 0.5, '%'),
      p('Rotation', 0, -360, 360, 1, 'deg'),
      p('Light Intensity', 70, 0, 200, 0.5, '%'),
      p('Ambient', 35, 0, 200, 0.5, '%'),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'blur(0px)';
    },
  },
  {
    name: 'Spotlight',
    category: 'Perspective',
    description: 'Lays a cone of light over the layer',
    slot: 'filter',
    params: [
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
      p('Direction', 90, 0, 360, 1, 'deg'),
      p('Cone Angle', 60, 1, 360, 1, 'deg'),
      p('Reach', 60, 1, 200, 0.5, '%'),
      p('Softness', 50, 0, 100, 0.5, '%'),
      p('Intensity', 100, 0, 400, 1, '%'),
      p('Ambient', 20, 0, 200, 0.5, '%'),
      spaceParam(),
    ],
    colors: [c('Colour', '#ffffff')],
    render: (v, col) => {
      return 'brightness(1.1)';
    },
  },
  {
    name: 'Block Dissolve',
    category: 'Transition',
    description: 'Dissolves in blocks rather than in pixels',
    slot: 'maskImage',
    params: [
      p('Completion', 0, 0, 100, 0.5, '%'),
      p('Block Width', 24, 1, 400, 1, ''),
      p('Block Height', 14, 1, 400, 1, ''),
      p('Softness', 2, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return `linear-gradient(90deg, transparent ${n(v[0])}%, #000 ${n(Math.min(v[0] + v[3], 100))}%)`;
    },
  },
  {
    name: 'Tile Wipe',
    category: 'Transition',
    description: 'Every tile opening at once',
    slot: 'maskImage',
    params: [
      p('Completion', 0, 0, 100, 0.5, '%'),
      p('Tiles', 6, 1, 100, 1, ''),
      p('Softness', 2, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return `linear-gradient(#000 ${n(v[0])}%, transparent ${n(v[0])}%)`;
    },
  },
  {
    name: 'Zigzag Wipe',
    category: 'Transition',
    description: 'Interlocking teeth closing from both sides',
    slot: 'maskImage',
    params: [
      p('Completion', 0, 0, 100, 0.5, '%'),
      p('Teeth', 6, 1, 100, 1, ''),
      p('Softness', 1, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return `linear-gradient(90deg, #000 ${n(v[0])}%, transparent ${n(v[0])}%)`;
    },
  },
  {
    name: 'Shrink Wipe',
    category: 'Transition',
    description: 'The picture shrinking away towards a centre',
    slot: 'maskImage',
    params: [
      p('Completion', 0, 0, 100, 0.5, '%'),
      p('Softness', 2, 0, 100, 0.5, '%'),
      p('Centre X', 50, -50, 150, 0.5, '%'),
      p('Centre Y', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return `radial-gradient(circle, transparent ${n(v[0])}%, #000 ${n(v[0])}%)`;
    },
  },
  {
    name: 'Raked Wipe',
    category: 'Transition',
    description: 'A raked edge sweeping across',
    slot: 'maskImage',
    params: [
      p('Completion', 0, 0, 100, 0.5, '%'),
      p('Direction', 90, 0, 360, 1, 'deg'),
      p('Softness', 2, 0, 100, 0.5, '%'),
      spaceParam(),
    ],
    colors: [],
    render: (v, col) => {
      return `linear-gradient(${n(v[1])}deg, transparent ${n(v[0])}%, #000 ${n(v[0])}%)`;
    },
  },
  {
    name: 'Twist Wipe',
    category: 'Transition',
    description: 'The layer winding onto itself about a vertical axis',
    slot: 'maskImage',
    params: [
      p('Completion', 0, 0, 100, 0.5, '%'),
      p('Softness', 2, 0, 100, 0.5, '%'),
      p('Axis Position', 50, -50, 150, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return `linear-gradient(90deg, #000 ${n(100 - v[0])}%, transparent ${n(100 - v[0])}%)`;
    },
  },
  {
    name: 'Gradient Wipe',
    category: 'Transition',
    description: 'Dissolves along a generated gradient',
    slot: 'maskImage',
    params: [
      p('Transition Completion', 0, 0, 100, 0.5, '%'),
      p('Transition Softness', 10, 0.1, 100, 0.5, '%'),
      choice('Gradient', 0, ['Fractal', 'Linear', 'Radial']),
      p('Scale', 30, 1, 400, 0.5, '%'),
      p('Angle', 90, 0, 360, 1, 'deg'),
      p('Complexity', 4, 1, 8, 1, ''),
      spaceParam(),
    ],
    colors: [],
    render: (v, col) => {
      return `linear-gradient(${n(v[4])}deg, transparent ${n(v[0])}%, #000 ${n(Math.min(v[0] + v[1], 100))}%)`;
    },
  },
  {
    name: 'Log Converter',
    category: 'Utility',
    description: 'Log to linear and back, with the film curve between',
    slot: 'filter',
    params: [
      choice('Conversion', 0, ['Log to Linear', 'Linear to Log']),
      p('Black Point', 95, 0, 1023, 1, ''),
      p('White Point', 685, 0, 1023, 1, ''),
      p('Gamma', 1.7, 0.1, 10, 0.01, ''),
    ],
    colors: [],
    render: (v, col) => {
      return `brightness(${n(1 / Math.max(v[3], 0.1))})`;
    },
  },
  {
    name: 'Highlight Compression',
    category: 'Utility',
    description: 'A soft shoulder that pulls highlights back under one',
    slot: 'filter',
    params: [p('Amount', 100, 0, 400, 1, '%')],
    colors: [],
    render: (v, col) => {
      return `contrast(${n(1 - v[0] / 800)})`;
    },
  },
  {
    name: 'Highlight Recovery',
    category: 'Utility',
    description: 'Recovers clipped highlights towards white',
    slot: 'filter',
    params: [
      p('Threshold', 85, 0, 100, 0.5, '%'),
      p('Amount', 100, 0, 200, 0.5, '%'),
      p('Desaturate', 100, 0, 100, 0.5, '%'),
    ],
    colors: [],
    render: (v, col) => {
      return 'brightness(0.95)';
    },
  },
  // The two whose Rust bodies branch, written out by hand.
  {
    name: 'Long Shadow',
    category: 'Stylize',
    description: 'A flat shadow trailing off the layer',
    slot: 'boxShadow',
    params: [
      p('Length', 24, 0, 200, 1, 'px'),
      p('Angle', 45, 0, 360, 1, 'deg'),
      p('Fade', 0, 0, 100, 1, '%'),
      spaceParam(),
    ],
    colors: [c('Colour', 'rgba(0,0,0,0.35)')],
    // Solid shadows stacked one pixel apart, because CSS has no "extrude" and
    // a stack of hard offsets is what one actually looks like. The step count
    // is capped so a long shadow cannot quietly cost a hundred shadows' worth
    // of compositing.
    render: (v, col) => {
      const length = Math.max(v[0], 0);
      const angle = (v[1] * Math.PI) / 180;
      const steps = clamp(Math.round(length), 0, 48);
      if (steps === 0) return '0 0 0 transparent';
      const stride = length / steps;
      const out = [];
      for (let i = 1; i <= steps; i++) {
        const d = stride * i;
        out.push(
          `${n(d * Math.cos(angle))}px ${n(d * Math.sin(angle))}px 0 ${col[0]}`,
        );
      }
      return out.join(', ');
    },
  },
  {
    name: 'Ramp',
    category: 'Generate',
    description: 'A two-stop gradient, linear or radial',
    slot: 'backgroundImage',
    params: [
      choice('Ramp Shape', 0, ['Linear', 'Radial']),
      p('Start X', 50, -50, 150, 0.5, '%'),
      p('Start Y', 0, -50, 150, 0.5, '%'),
      p('End X', 50, -50, 150, 0.5, '%'),
      p('End Y', 100, -50, 150, 0.5, '%'),
      p('Ramp Scatter', 0, 0, 20, 0.1, '%'),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [c('Start Colour', '#000000'), c('End Colour', '#ffffff')],
    render: (v, col) =>
      v[0] >= 0.5
        ? `radial-gradient(circle at ${n(v[1])}% ${n(v[2])}%, ${col[0]}, ${col[1]})`
        : `linear-gradient(180deg, ${col[0]}, ${col[1]})`,
  },
];

export const CATEGORIES = [...new Set(CATALOG.map((d) => d.category))];

export const effectDef = (name) => CATALOG.find((d) => d.name === name);

// A fresh instance of an effect, with every parameter at its default.
let nextEffectId = 1;
export function makeEffect(name) {
  const def = effectDef(name);
  if (!def) return null;
  return {
    id: `fx${nextEffectId++}`,
    name,
    enabled: true,
    // Parameter index -> value, or a keyframe track once the stopwatch is on.
    values: def.params.map((param) => param.value),
    tracks: {},
    colors: def.colors.map((colour) => colour.value),
  };
}
