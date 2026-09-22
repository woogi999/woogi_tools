// The effect shaders, ported from Ferrite's WGSL (`ferrite-gpu/src/shaders.rs`).
//
// Two simplifications the browser port gets for free. Ferrite draws every node
// into a shared surface and carries a `node_box` so a shader can work out
// which part of it belongs to the layer; here each layer is already painted
// into its own surface, exactly its own size, so `box_uv` and `from_box_uv`
// collapse to identity and the whole indirection disappears. And Ferrite's
// `fx.params[i]` is a `vec4` array, which is what `uParams` is here, so the
// parameter packing carries over unchanged.
//
// Every distortion works the same way round, and it is worth saying once
// because it is the thing that looks backwards on first reading: the shader is
// handed the pixel it is *writing* and has to decide where that came from. So
// the maths is the inverse of the description: a bulge that magnifies samples
// *closer* to its own centre than it was asked.

import { COLOUR_COMMON, COLOUR_SHADERS } from './shaders-colour.js';
import { BLUR_SHADERS } from './shaders-blur.js';

const DISTORT_COMMON = `
const float TAU = 6.28318530718;

vec2 texel() { return 1.0 / max(uSize, vec2(1.0)); }

// Box coordinates scaled so that a distance means the same in x and y. A
// twirl, a bulge or a spin is round on screen or it is wrong, and a layer is
// almost never square.
vec2 boxAspect() { return vec2(uSize.x / max(uSize.y, 1.0), 1.0); }

vec4 tapAt(vec2 uv) { return texture(uTex, uv); }

// Each tap covers the ground between itself and the next one.
//
// A blur with a fixed number of taps spread over a wide radius does not blur,
// it *copies*: the gaps between the taps are several pixels wide, so what you
// see is a row of ghosts of the picture rather than a smear of it. That is the
// afterimage look, and no amount of reweighting the taps removes it, because
// the pixels in the gaps were never read.
//
// Reading from a mip level whose texels are as wide as the gap fixes it at the
// source: every tap is then already an average of the ground it stands on, the
// gaps are covered, and the ghosts close up. It is also cheaper than the tap
// count it replaces.
float lodFor(float gapInTexels) {
  return clamp(log2(max(gapInTexels, 1.0)), 0.0, 8.0);
}

vec4 tapLod(vec2 uv, float lod) { return textureLod(uTex, uv, lod); }

// The same, but nothing outside the layer's box, as sampleBox does, so a
// blur fades off the edge instead of dragging the edge pixel outward.
vec4 tapBoxLod(vec2 uv, float lod) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))))
    return vec4(0.0);
  return textureLod(uTex, uv, lod);
}

// Read the input at a place in the layer's box; nothing outside it.
//
// A warp that reaches past the edge has to find transparency there. Letting
// the sampler clamp instead drags the edge pixel outward into a streak, which
// is the single most recognisable way a distortion looks wrong.
vec4 sampleBox(vec2 b) {
  if (any(lessThan(b, vec2(0.0))) || any(greaterThan(b, vec2(1.0))))
    return vec4(0.0);
  return texture(uTex, b);
}

vec4 unpremul(vec4 c) {
  return vec4(c.a <= 0.0 ? vec3(0.0) : c.rgb / max(c.a, 0.0001), c.a);
}

vec4 repremul(vec4 c) { return vec4(c.rgb * c.a, c.a); }

// Value noise, and the fractal sum of it that every grain, cloud and
// turbulence effect is built from. One implementation, shared: three hash
// functions differing in the last digit would make the same settings look
// different from one effect to the next.
float hash21(vec2 p) {
  vec2 q = fract(p * vec2(0.1031, 0.1030));
  q += dot(q, q.yx + 33.33);
  return fract((q.x + q.y) * q.x);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, float octaves, float gain, float lacunarity, float ridged) {
  float sum = 0.0;
  float amp = 1.0;
  float total = 0.0;
  float freq = 1.0;
  int count = int(clamp(octaves, 1.0, 8.0));
  for (int i = 0; i < 8; i++) {
    if (i >= count) break;
    float n = valueNoise(p * freq);
    if (ridged > 0.5) n = abs(n * 2.0 - 1.0);
    sum += n * amp;
    total += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / max(total, 0.0001);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

const DISTORT_SHADERS = {
  // ── Bulge / Spherical Warp ────────────────────────────────────────────
  // Two profiles: a quadratic dome, which is what Bulge does, and the
  // spherical cap a lens actually has. They differ most at the rim, and that
  // difference is the whole reason After Effects ships both.
  bulge: `
void main() {
  vec2 centre = uParams[0].xy;
  vec2 radius = max(uParams[0].zw, vec2(0.0001));
  float height = uParams[1].x;
  float taper = max(uParams[1].y, 0.0001);
  float spherical = uParams[1].z;

  vec2 here = vUv;
  vec2 n = (here - centre) / radius;
  float d = length(n);
  if (d >= 1.0 || abs(height) < 0.0001) { fragColour = tapAt(vUv); return; }
  float lift = 1.0 - d * d;
  if (spherical > 0.5) lift = sqrt(max(1.0 - d * d, 0.0));
  float factor = 1.0 - height * pow(lift, taper);
  fragColour = sampleBox(centre + (here - centre) * factor);
}`,

  // ── Twirl ─────────────────────────────────────────────────────────────
  twirl: `
void main() {
  vec2 centre = uParams[0].xy;
  float radius = max(uParams[0].z, 0.0001);
  float angle = radians(uParams[0].w);

  vec2 aspect = boxAspect();
  vec2 here = vUv;
  vec2 p = (here - centre) * aspect;
  float d = length(p) / radius;
  if (d >= 1.0) { fragColour = tapAt(vUv); return; }
  // Squared falloff, so the twist eases out of the untouched picture rather
  // than meeting it at a crease.
  float t = angle * pow(1.0 - d, 2.0);
  float s = sin(t);
  float c = cos(t);
  vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  fragColour = sampleBox(centre + r / aspect);
}`,

  // ── Ripple ────────────────────────────────────────────────────────────
  ripple: `
void main() {
  vec2 centre = uParams[0].xy;
  float radius = max(uParams[0].z, 0.0001);
  float amplitude = uParams[0].w;
  // Authored as a wave width, because that is a distance an operator can see
  // on the layer; the shader wants how many waves that is.
  float frequency = 1.0 / max(uParams[1].x, 0.0001);
  float phase = uParams[1].y;
  float symmetric = uParams[1].z;

  vec2 aspect = boxAspect();
  vec2 p = (vUv - centre) * aspect;
  float d = length(p);
  if (d < 1e-5 || d > radius) { fragColour = tapAt(vUv); return; }
  float falloff = 1.0 - d / radius;
  float w = sin(d * frequency * TAU - phase) * amplitude * falloff;
  if (symmetric < 0.5) w = max(w, 0.0);
  fragColour = sampleBox(centre + normalize(p) * (d + w) / aspect);
}`,

  // ── Wave Warp ─────────────────────────────────────────────────────────
  'wave-warp': `
float waveAt(float t, float shape) {
  float x = fract(t);
  if (shape < 0.5) return sin(x * TAU);
  if (shape < 1.5) return x < 0.5 ? 1.0 : -1.0;
  if (shape < 2.5) return 1.0 - 4.0 * abs(x - 0.5);
  if (shape < 3.5) return x * 2.0 - 1.0;
  return valueNoise(vec2(t, 0.0)) * 2.0 - 1.0;
}
void main() {
  float shape = uParams[0].x;
  float amplitude = uParams[0].y;
  float width = max(uParams[0].z, 0.0001);
  float phase = uParams[0].w;
  float vertical = uParams[1].x;

  vec2 here = vUv;
  float along = vertical > 0.5 ? here.y : here.x;
  float w = waveAt(along / width + phase, shape) * amplitude;
  vec2 shifted = vertical > 0.5 ? vec2(here.x + w, here.y) : vec2(here.x, here.y + w);
  fragColour = sampleBox(shifted);
}`,

  // ── Noise Warp ────────────────────────────────────────────────────────
  'noise-warp': `
void main() {
  float amount = uParams[0].x;
  float scale = max(uParams[0].y, 0.0001);
  float evolution = uParams[0].z;
  float complexity = uParams[0].w;

  vec2 p = vUv * scale;
  float dx = fbm(p + vec2(evolution, 0.0), complexity, 0.5, 2.0, 0.0) - 0.5;
  float dy = fbm(p + vec2(0.0, evolution + 11.3), complexity, 0.5, 2.0, 0.0) - 0.5;
  fragColour = sampleBox(vUv + vec2(dx, dy) * amount);
}`,

  // ── Mirror ────────────────────────────────────────────────────────────
  mirror: `
void main() {
  vec2 centre = uParams[0].xy;
  float angle = radians(uParams[0].z);
  vec2 n = vec2(cos(angle), sin(angle));
  vec2 aspect = boxAspect();
  vec2 p = (vUv - centre) * aspect;
  // Anything on the far side of the line is read from its reflection.
  float side = dot(p, n);
  if (side > 0.0) p -= 2.0 * side * n;
  fragColour = sampleBox(centre + p / aspect);
}`,

  // ── Offset ────────────────────────────────────────────────────────────
  // Wraps rather than clipping: this is the effect you use to make a texture
  // tile, so the edge that leaves one side has to arrive at the other.
  offset: `
void main() {
  vec2 shift = uParams[0].xy;
  fragColour = tapAt(fract(vUv + shift + 1.0));
}`,

  // ── Polar Coordinates ─────────────────────────────────────────────────
  polar: `
void main() {
  float amount = clamp(uParams[0].x, 0.0, 1.0);
  float toPolar = uParams[0].y;
  vec2 aspect = boxAspect();
  vec2 centred = (vUv - 0.5) * aspect;

  vec2 mapped;
  if (toPolar > 0.5) {
    float r = length(centred) * 2.0;
    float a = atan(centred.y, centred.x) / TAU + 0.5;
    mapped = vec2(a, r);
  } else {
    float a = (vUv.x - 0.5) * TAU;
    float r = vUv.y * 0.5;
    mapped = vec2(0.5, 0.5) + vec2(cos(a), sin(a)) * r / aspect;
  }
  fragColour = sampleBox(mix(vUv, mapped, amount));
}`,

  // ── Magnify ───────────────────────────────────────────────────────────
  magnify: `
void main() {
  vec2 centre = uParams[0].xy;
  float radius = max(uParams[0].z, 0.0001);
  float factor = max(uParams[0].w, 0.0001);
  float feather = clamp(uParams[1].x, 0.0, 1.0);

  vec2 aspect = boxAspect();
  vec2 p = (vUv - centre) * aspect;
  float d = length(p) / radius;
  if (d >= 1.0) { fragColour = tapAt(vUv); return; }
  float blend = feather <= 0.0 ? 1.0 : smoothstep(1.0, 1.0 - feather, d);
  vec2 pulled = p / mix(1.0, factor, blend);
  fragColour = sampleBox(centre + pulled / aspect);
}`,

  // ── Lens Distortion / Fisheye ─────────────────────────────────────────
  // One shader for both: barrel and pincushion are the same polynomial with
  // the sign of the coefficient flipped, and a fisheye is a strong barrel.
  optics: `
void main() {
  float k1 = uParams[0].x;
  float k2 = uParams[0].y;
  float zoom = max(uParams[0].z, 0.0001);

  vec2 aspect = boxAspect();
  vec2 p = (vUv - 0.5) * aspect / zoom;
  float r2 = dot(p, p);
  vec2 pulled = p * (1.0 + k1 * r2 + k2 * r2 * r2);
  fragColour = sampleBox(0.5 + pulled / aspect);
}`,

  // ── Grid Twist ────────────────────────────────────────────────────────
  griddler: `
void main() {
  float tiles = max(uParams[0].x, 1.0);
  float angle = radians(uParams[0].y);
  float scale = uParams[0].z;

  vec2 cell = vUv * tiles;
  vec2 index = floor(cell);
  vec2 within = fract(cell) - 0.5;
  // Alternate the turn per cell so the grid reads as a weave rather than as
  // the whole picture rotating.
  float flip = mod(index.x + index.y, 2.0) < 0.5 ? 1.0 : -1.0;
  float t = angle * flip;
  float s = sin(t);
  float c = cos(t);
  vec2 turned = vec2(within.x * c - within.y * s, within.x * s + within.y * c);
  turned *= scale;
  fragColour = sampleBox((index + turned + 0.5) / tiles);
}`,

  // ── Shear ─────────────────────────────────────────────────────────────
  slant: `
void main() {
  float amount = uParams[0].x;
  float vertical = uParams[0].y;
  vec2 here = vUv;
  vec2 shifted = vertical > 0.5
    ? vec2(here.x, here.y + (here.x - 0.5) * amount)
    : vec2(here.x + (here.y - 0.5) * amount, here.y);
  fragColour = sampleBox(shifted);
}`,

  // ── Tile Repeat / Seamless Tile ───────────────────────────────────────
  tiler: `
void main() {
  vec2 tiles = max(uParams[0].xy, vec2(1.0));
  float mirrored = uParams[0].z;
  vec2 cell = vUv * tiles;
  vec2 within = fract(cell);
  if (mirrored > 0.5) {
    vec2 index = floor(cell);
    // Every other tile is flipped, which is what makes the seam vanish.
    if (mod(index.x, 2.0) >= 1.0) within.x = 1.0 - within.x;
    if (mod(index.y, 2.0) >= 1.0) within.y = 1.0 - within.y;
  }
  fragColour = tapAt(within);
}`,

  // ── Band Bend ─────────────────────────────────────────────────────────
  bend: `
void main() {
  float amount = uParams[0].x;
  float centre = uParams[0].y;
  float width = max(uParams[0].z, 0.0001);
  float vertical = uParams[0].w;

  vec2 here = vUv;
  float along = vertical > 0.5 ? here.x : here.y;
  float falloff = exp(-pow((along - centre) / width, 2.0));
  vec2 shifted = vertical > 0.5
    ? vec2(here.x, here.y + amount * falloff)
    : vec2(here.x + amount * falloff, here.y);
  fragColour = sampleBox(shifted);
}`,

  // ── Warp ──────────────────────────────────────────────────────────────
  // An arc, an arch or a flag: one horizontal displacement whose profile is
  // chosen by a mode, as After Effects' Warp does.
  warp: `
void main() {
  float mode = uParams[0].x;
  float bend = uParams[0].y;
  float horizontal = uParams[0].z;
  float vertical = uParams[0].w;

  vec2 here = vUv;
  float t = here.y * 2.0 - 1.0;
  float profile = mode < 0.5
    ? 1.0 - t * t                      // arc
    : (mode < 1.5 ? t * t              // arch
    : sin(here.y * TAU));              // flag
  vec2 shifted = here + vec2(profile * bend + horizontal, vertical);
  fragColour = sampleBox(shifted);
}`,

  // ── Corner Pin ────────────────────────────────────────────────────────
  // The inverse of a bilinear map onto the four corners, solved by a few
  // Newton steps: cheaper than inverting the homography and accurate to well
  // under a pixel over a layer-sized quad.
  'corner-pin': `
vec2 forward(vec2 uv, vec2 tl, vec2 tr, vec2 br, vec2 bl) {
  return mix(mix(tl, tr, uv.x), mix(bl, br, uv.x), uv.y);
}
void main() {
  vec2 tl = uParams[0].xy;
  vec2 tr = uParams[0].zw;
  vec2 br = uParams[1].xy;
  vec2 bl = uParams[1].zw;

  vec2 guess = vUv;
  for (int i = 0; i < 12; i++) {
    vec2 err = forward(guess, tl, tr, br, bl) - vUv;
    vec2 dU = mix(tr - tl, br - bl, guess.y);
    vec2 dV = mix(bl - tl, br - tr, guess.x);
    float det = dU.x * dV.y - dU.y * dV.x;
    if (abs(det) < 1e-8) break;
    guess -= vec2(err.x * dV.y - err.y * dV.x, dU.x * err.y - dU.y * err.x) / det;
  }
  fragColour = sampleBox(guess);
}`,

  // ── Tear ──────────────────────────────────────────────────────────────
  split: `
void main() {
  float at = uParams[0].x;
  float shift = uParams[0].y;
  float vertical = uParams[0].z;
  vec2 here = vUv;
  float along = vertical > 0.5 ? here.x : here.y;
  float side = along < at ? -1.0 : 1.0;
  vec2 shifted = vertical > 0.5
    ? vec2(here.x, here.y + shift * side)
    : vec2(here.x + shift * side, here.y);
  fragColour = sampleBox(shifted);
}`,

  // ── Twin Attractors ───────────────────────────────────────────────────
  // Two points that pull the picture towards them, falling off with distance.
  'flo-motion': `
void main() {
  vec2 a = uParams[0].xy;
  vec2 b = uParams[0].zw;
  float pullA = uParams[1].x;
  float pullB = uParams[1].y;

  vec2 aspect = boxAspect();
  vec2 p = vUv * aspect;
  vec2 da = p - a * aspect;
  vec2 db = p - b * aspect;
  vec2 shift = da * (pullA / max(dot(da, da), 0.0004))
             + db * (pullB / max(dot(db, db), 0.0004));
  fragColour = sampleBox((p - shift) / aspect);
}`,

  // ── Displace ──────────────────────────────────────────────────────────
  // Ferrite displaces by another layer; here there is no second layer to hand
  // in, so the picture's own luminance drives it, which is what the effect
  // does when its map is set to itself.
  displace: `
void main() {
  float amount = uParams[0].x;
  float scale = max(uParams[0].y, 0.0001);
  vec2 p = vUv * scale;
  float dx = fbm(p, 3.0, 0.5, 2.0, 0.0) - 0.5;
  float dy = fbm(p + 7.7, 3.0, 0.5, 2.0, 0.0) - 0.5;
  float l = luma(unpremul(tapAt(vUv)).rgb) - 0.5;
  fragColour = sampleBox(vUv + vec2(dx, dy) * amount * (0.5 + l));
}`,

  // ── Sphere Wrap / Cylinder Wrap ───────────────────────────────────────
  'sphere-wrap': `
void main() {
  float amount = clamp(uParams[0].x, 0.0, 1.0);
  float cylinder = uParams[0].y;
  vec2 aspect = boxAspect();
  vec2 p = (vUv - 0.5) * 2.0 * aspect;
  float r2 = dot(p, p);
  if (r2 > 1.0) { fragColour = cylinder > 0.5 ? tapAt(vUv) : vec4(0.0); return; }
  // Project the flat picture onto the surface and read back where it lands.
  vec2 wrapped = cylinder > 0.5
    ? vec2(asin(clamp(p.x, -1.0, 1.0)) / (TAU * 0.25) * 0.5 + 0.5, vUv.y)
    : vec2(
        asin(clamp(p.x, -1.0, 1.0)) / (TAU * 0.25) * 0.5 + 0.5,
        asin(clamp(p.y, -1.0, 1.0)) / (TAU * 0.25) * 0.5 + 0.5
      );
  fragColour = sampleBox(mix(vUv, wrapped, amount));
}`,
};

// One helper library and one shader table, whichever file a body lives in.
export const COMMON = DISTORT_COMMON + COLOUR_COMMON;
export const SHADERS = {
  ...DISTORT_SHADERS,
  ...COLOUR_SHADERS,
  ...BLUR_SHADERS,
};
