// The colour, keying, channel and stylize shaders, ported from Ferrite's WGSL.
//
// Split from `shaders.js` only because that file was getting long: the distort
// group is all about *where* a pixel comes from, and this one is all about
// *what colour it is when it arrives*. `COLOUR_COMMON` holds the colour-space
// helpers those need and the distort ones do not.
//
// Every one of these unpremultiplies, does its arithmetic on straight colour,
// and repremultiplies — the pipeline holds premultiplied pixels, and doing
// maths on a premultiplied value quietly darkens everything that is not fully
// opaque.

export const COLOUR_COMMON = `
vec3 rgbToHsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  if (d < 1e-6) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / max(2.0 - mx - mn, 1e-6) : d / max(mx + mn, 1e-6);
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}

float hueChannel(float p, float q, float t) {
  float x = fract(t);
  if (x < 1.0 / 6.0) return p + (q - p) * 6.0 * x;
  if (x < 0.5) return q;
  if (x < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - x) * 6.0;
  return p;
}

vec3 hslToRgb(vec3 hsl) {
  if (hsl.y < 1e-6) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    hueChannel(p, q, hsl.x + 1.0 / 3.0),
    hueChannel(p, q, hsl.x),
    hueChannel(p, q, hsl.x - 1.0 / 3.0)
  );
}

// The shorter way round the wheel: hue is a circle, so 0.98 and 0.02 are
// neighbours rather than opposites.
float hueDistance(float a, float b) {
  float d = abs(fract(a) - fract(b));
  return min(d, 1.0 - d);
}
`;

export const COLOUR_SHADERS = {
  levels: `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  float inBlack = uParams[0].x;
  float inWhite = uParams[0].y;
  float gamma = max(uParams[0].z, 0.0001);
  float outBlack = uParams[0].w;
  float outWhite = uParams[1].x;
  // Which channels this instance touches: RGB together, or one alone. The
  // per-channel form is how a colour cast gets pulled out of a picture.
  float channel = uParams[1].y;

  float span = max(inWhite - inBlack, 0.0001);
  vec3 v = clamp((c.rgb - inBlack) / span, vec3(0.0), vec3(1.0));
  v = pow(v, vec3(1.0 / gamma));
  v = outBlack + v * (outWhite - outBlack);

  vec3 result = v;
  if (channel >= 0.5 && channel < 1.5) result = vec3(v.r, c.g, c.b);
  else if (channel >= 1.5 && channel < 2.5) result = vec3(c.r, v.g, c.b);
  else if (channel >= 2.5 && channel < 3.5) result = vec3(c.r, c.g, v.b);

  float a = c.a;
  if (channel >= 3.5) {
    float av = clamp((c.a - inBlack) / span, 0.0, 1.0);
    a = outBlack + pow(av, 1.0 / gamma) * (outWhite - outBlack);
    result = c.rgb;
  }
  fragColour = repremul(vec4(clamp(result, vec3(0.0), vec3(1.0)), clamp(a, 0.0, 1.0)));
}`,

  'hue-saturation': `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  float hueShift = uParams[0].x / 360.0;
  float sat = uParams[0].y;
  float light = uParams[0].z;
  float colorize = uParams[0].w;
  float colorizeHue = uParams[1].x / 360.0;
  float colorizeSat = uParams[1].y;
  // A width of half a turn or more is every hue, which is the master control;
  // anything less is one of the six ranges the dialog lists down its side.
  float bandCentre = uParams[1].z / 360.0;
  float bandWidth = uParams[1].w;
  float bandFeather = max(uParams[2].x, 0.0001);

  vec3 hsl = rgbToHsl(c.rgb);
  if (colorize > 0.5) {
    // Colorize throws the original hue away and keeps only the luminance,
    // which is what makes it a tinting control rather than a shifting one.
    hsl = vec3(colorizeHue, colorizeSat, hsl.z);
  } else {
    float weight = 1.0;
    if (bandWidth < 0.5) {
      float d = hueDistance(hsl.x, bandCentre);
      weight = 1.0 - smoothstep(bandWidth, bandWidth + bandFeather, d);
    }
    hsl.x = fract(hsl.x + hueShift * weight);
    hsl.y = clamp(hsl.y * mix(1.0, sat, weight), 0.0, 1.0);
    hsl.z = clamp(hsl.z + light * weight, 0.0, 1.0);
  }
  fragColour = repremul(vec4(hslToRgb(hsl), c.a));
}`,

  'brightness-contrast': `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  vec3 v = c.rgb + uParams[0].x;
  v = (v - 0.5) * (1.0 + uParams[0].y) + 0.5;
  fragColour = repremul(vec4(clamp(v, vec3(0.0), vec3(1.0)), c.a));
}`,

  exposure: `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  // Stops, the way a camera counts them: each one doubles the light.
  vec3 v = c.rgb * pow(2.0, uParams[0].x);
  fragColour = repremul(vec4(clamp(v, vec3(0.0), vec3(1.0)), c.a));
}`,

  fade: `
void main() { fragColour = tapAt(vUv) * clamp(uParams[0].x, 0.0, 1.0); }`,

  'colour-balance': `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  vec3 hsl = rgbToHsl(c.rgb);
  hsl.x = fract(hsl.x + uParams[0].x / 360.0);
  hsl.y = clamp(hsl.y * uParams[0].y, 0.0, 1.0);
  hsl.z = clamp(hsl.z * uParams[0].z, 0.0, 1.0);
  fragColour = repremul(vec4(hslToRgb(hsl), c.a));
}`,

  'channel-mixer': `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  vec3 v = vec3(
    dot(c.rgb, uParams[0].xyz) + uParams[0].w,
    dot(c.rgb, uParams[1].xyz) + uParams[1].w,
    dot(c.rgb, uParams[2].xyz) + uParams[2].w
  );
  fragColour = repremul(vec4(clamp(v, vec3(0.0), vec3(1.0)), c.a));
}`,

  'gamma-pedestal-gain': `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  vec3 gamma = max(uParams[0].xyz, vec3(0.0001));
  vec3 v = pow(clamp(c.rgb, vec3(0.0), vec3(1.0)), 1.0 / gamma);
  v = uParams[1].xyz + v * uParams[2].xyz;
  fragColour = repremul(vec4(clamp(v, vec3(0.0), vec3(1.0)), c.a));
}`,

  'channel-phase': `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  vec3 v = c.rgb + uParams[0].xyz;
  v = uParams[0].w > 0.5 ? clamp(v, vec3(0.0), vec3(1.0)) : fract(v + 1.0);
  fragColour = repremul(vec4(v, c.a));
}`,

  convolve: `
void main() {
  vec2 t = texel() * max(uParams[2].w, 1.0);
  float divisor = uParams[2].y;
  float offset = uParams[2].z;
  float k[9];
  k[0] = uParams[0].x; k[1] = uParams[0].y; k[2] = uParams[0].z;
  k[3] = uParams[0].w; k[4] = uParams[1].x; k[5] = uParams[1].y;
  k[6] = uParams[1].z; k[7] = uParams[1].w; k[8] = uParams[2].x;

  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float w = k[(y + 1) * 3 + (x + 1)];
      sum += unpremul(tapAt(vUv + vec2(float(x), float(y)) * t)).rgb * w;
      total += w;
    }
  }
  // A divisor of zero means "divide by the sum of the kernel", which is what
  // stops a blur kernel from also brightening the picture.
  float d = abs(divisor) < 0.0001 ? (abs(total) < 0.0001 ? 1.0 : total) : divisor;
  vec4 c = unpremul(tapAt(vUv));
  fragColour = repremul(vec4(clamp(sum / d + offset, vec3(0.0), vec3(1.0)), c.a));
}`,

  'hue-replace': `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  float fromHue = uParams[0].x / 360.0;
  float tolerance = uParams[0].y / 360.0;
  float softness = max(uParams[0].z / 360.0, 0.0001);
  float amount = uParams[0].w;
  float satTolerance = uParams[1].x;
  float invert = uParams[1].y;

  vec3 hsl = rgbToHsl(c.rgb);
  float d = hueDistance(hsl.x, fromHue);
  float weight = 1.0 - smoothstep(tolerance, tolerance + softness, d);
  if (hsl.y < satTolerance) weight = 0.0;
  if (invert > 0.5) weight = 1.0 - weight;
  weight *= amount;

  vec3 target = rgbToHsl(uColours[0].rgb);
  vec3 shifted = vec3(target.x, mix(hsl.y, target.y, weight), hsl.z);
  fragColour = repremul(vec4(mix(c.rgb, hslToRgb(shifted), weight), c.a));
}`,

  colorama: `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  float phase = uParams[0].x;
  float repetitions = max(uParams[0].y, 0.0001);
  float blend = uParams[0].z;
  float drivenByHue = uParams[0].w;

  vec3 hsl = rgbToHsl(c.rgb);
  float t = fract((drivenByHue > 0.5 ? hsl.x : hsl.z) * repetitions + phase);
  // Three stops around a loop, so the ramp meets itself without a seam.
  vec3 ramp = t < 1.0 / 3.0
    ? mix(uColours[0].rgb, uColours[1].rgb, t * 3.0)
    : (t < 2.0 / 3.0
      ? mix(uColours[1].rgb, uColours[2].rgb, (t - 1.0 / 3.0) * 3.0)
      : mix(uColours[2].rgb, uColours[0].rgb, (t - 2.0 / 3.0) * 3.0));
  fragColour = repremul(vec4(mix(ramp, c.rgb, blend), c.a));
}`,

  'selective-color': `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  float which = uParams[0].x;
  float absolute = uParams[0].y;
  vec4 cmyk = uParams[1];

  vec3 hsl = rgbToHsl(c.rgb);
  // The nine ranges the dialog lists: six hues, then whites, neutrals, blacks.
  float weight;
  if (which < 5.5) {
    weight = 1.0 - smoothstep(0.0, 0.16, hueDistance(hsl.x, which / 6.0));
    weight *= smoothstep(0.1, 0.35, hsl.y);
  } else if (which < 6.5) weight = smoothstep(0.7, 0.95, hsl.z);
  else if (which < 7.5) weight = 1.0 - smoothstep(0.0, 0.35, hsl.y);
  else weight = 1.0 - smoothstep(0.05, 0.3, hsl.z);

  vec3 delta = vec3(-cmyk.x, -cmyk.y, -cmyk.z) - cmyk.w;
  vec3 v = c.rgb + delta * weight * (absolute > 0.5 ? vec3(1.0) : c.rgb);
  fragColour = repremul(vec4(clamp(v, vec3(0.0), vec3(1.0)), c.a));
}`,

  key: `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  float tolerance = uParams[0].x;
  float feather = max(uParams[0].y, 0.0001);
  float invert = uParams[0].z;
  float matteOnly = uParams[0].w;
  float byLuma = uParams[1].x;

  float d = byLuma > 0.5
    ? abs(luma(c.rgb) - luma(uColours[0].rgb))
    : distance(c.rgb, uColours[0].rgb);
  // Inside the tolerance it is gone, outside it is kept, and the feather is
  // the band between — which is the whole of what a key is.
  float keep = smoothstep(tolerance, tolerance + feather, d);
  if (invert > 0.5) keep = 1.0 - keep;
  if (matteOnly > 0.5) { fragColour = vec4(vec3(keep), 1.0); return; }
  fragColour = repremul(vec4(c.rgb, c.a * keep));
}`,

  extract: `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  float channel = uParams[0].x;
  float black = uParams[0].y;
  float white = uParams[0].z;
  float blackSoft = max(uParams[0].w, 0.0001);
  float whiteSoft = max(uParams[1].x, 0.0001);
  float invert = uParams[1].y;

  float v = channel < 0.5 ? luma(c.rgb)
    : (channel < 1.5 ? c.r : (channel < 2.5 ? c.g : (channel < 3.5 ? c.b : c.a)));
  float keep = smoothstep(black, black + blackSoft, v)
             * (1.0 - smoothstep(white - whiteSoft, white, v));
  if (invert > 0.5) keep = 1.0 - keep;
  fragColour = repremul(vec4(c.rgb, c.a * keep));
}`,

  choke: `
void main() {
  // Shrinking a matte is an erode and growing it is a dilate; one shader, and
  // the sign of the amount picks which.
  float amount = uParams[0].x;
  vec2 t = texel();
  float steps = min(abs(amount), 8.0);
  if (steps < 0.5) { fragColour = tapAt(vUv); return; }
  float a = tapAt(vUv).a;
  for (float i = 1.0; i <= 8.0; i += 1.0) {
    if (i > steps) break;
    for (int k = 0; k < 8; k++) {
      float ang = float(k) / 8.0 * TAU;
      vec2 at = vUv + vec2(cos(ang), sin(ang)) * t * i;
      float s = (any(lessThan(at, vec2(0.0))) || any(greaterThan(at, vec2(1.0))))
        ? 0.0 : tapAt(at).a;
      a = amount > 0.0 ? min(a, s) : max(a, s);
    }
  }
  vec4 c = unpremul(tapAt(vUv));
  fragColour = repremul(vec4(c.rgb, a));
}`,

  unmatte: `
void main() {
  vec4 c = tapAt(vUv);
  if (c.a < 0.0001) { fragColour = vec4(0.0); return; }
  // Undo a composite against a known background: what is left is the colour
  // the layer had before it was matted onto it.
  vec3 straight = (c.rgb - uColours[0].rgb * (1.0 - c.a)) / c.a;
  fragColour = repremul(vec4(clamp(straight, vec3(0.0), vec3(1.0)), c.a));
}`,

  'shift-channels': `
float pick(vec4 c, float which) {
  if (which < 0.5) return c.r;
  if (which < 1.5) return c.g;
  if (which < 2.5) return c.b;
  if (which < 3.5) return c.a;
  if (which < 4.5) return luma(c.rgb);
  return which < 5.5 ? 1.0 : 0.0;
}
void main() {
  vec4 c = unpremul(tapAt(vUv));
  fragColour = repremul(vec4(
    pick(c, uParams[0].x),
    pick(c, uParams[0].y),
    pick(c, uParams[0].z),
    pick(c, uParams[0].w)
  ));
}`,

  arithmetic: `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  float op = uParams[0].x;
  float clip = uParams[0].y;
  float onAlpha = uParams[0].z;
  vec3 b = uColours[0].rgb;

  vec3 v;
  if (op < 0.5) v = c.rgb + b;
  else if (op < 1.5) v = c.rgb - b;
  else if (op < 2.5) v = c.rgb * b;
  else if (op < 3.5) v = c.rgb / max(b, vec3(0.0001));
  else if (op < 4.5) v = max(c.rgb, b);
  else if (op < 5.5) v = min(c.rgb, b);
  else if (op < 6.5) v = abs(c.rgb - b);
  else v = 1.0 - (1.0 - c.rgb) * (1.0 - b);

  v = clip > 0.5 ? clamp(v, vec3(0.0), vec3(1.0)) : fract(v + 1.0);
  float a = onAlpha > 0.5 ? clamp(c.a * uColours[0].a, 0.0, 1.0) : c.a;
  fragColour = repremul(vec4(v, a));
}`,

  strobe: `
void main() {
  float period = max(uParams[0].x, 0.0001);
  float duration = clamp(uParams[0].y, 0.0, 1.0);
  float flashes = uParams[0].z;
  float random = uParams[0].w;
  float intensity = uParams[1].x;
  float seconds = uTime / 1000.0;

  float cycle = random > 0.5
    ? hash21(vec2(floor(seconds / period), 3.7))
    : fract(seconds / period);
  vec4 c = tapAt(vUv);
  if (cycle >= duration) { fragColour = c; return; }
  fragColour = flashes > 0.5
    ? mix(c, repremul(vec4(uColours[0].rgb, max(c.a, 0.0))), intensity)
    : c * (1.0 - intensity);
}`,

  kaleida: `
void main() {
  float sides = max(uParams[0].x, 2.0);
  float rotation = radians(uParams[0].y);
  float size = max(uParams[0].z, 0.0001);
  vec2 centre = uParams[1].xy;

  vec2 aspect = boxAspect();
  vec2 p = (vUv - centre) * aspect;
  float a = atan(p.y, p.x) + rotation;
  float r = length(p) / size;
  // Fold the angle into one wedge and mirror alternate wedges, which is what
  // makes the seams meet instead of simply repeating.
  float wedge = TAU / sides;
  a = mod(a, wedge);
  a = abs(a - wedge * 0.5);
  fragColour = sampleBox(centre + vec2(cos(a), sin(a)) * r / aspect);
}`,

  'hex-tile': `
void main() {
  float size = max(uParams[0].x / 100.0, 0.0001);
  float rotation = radians(uParams[0].y);
  vec2 centre = uParams[1].xy;
  vec2 aspect = boxAspect();
  vec2 p = (vUv - centre) * aspect / size;
  float c = cos(rotation);
  float s = sin(rotation);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  // Fold into the hexagon's kaleidoscopic sixth.
  vec2 k = vec2(0.866025404, 0.5);
  p = abs(p);
  p -= 2.0 * min(dot(k, p), 0.0) * k;
  fragColour = sampleBox(centre + (p * size) / aspect);
}`,

  'block-load': `
void main() {
  float blocks = max(uParams[0].x, 1.0);
  float progress = clamp(uParams[0].y, 0.0, 1.0);
  // Each block keeps a fixed place in the queue, so the reveal is stable from
  // frame to frame rather than boiling.
  if (hash21(floor(vUv * blocks)) > progress) { fragColour = vec4(0.0); return; }
  fragColour = tapAt(vUv);
}`,

  'burn-film': `
void main() {
  float progress = clamp(uParams[0].x, 0.0, 1.0);
  float scale = max(uParams[0].y, 0.0001);
  float edge = max(uParams[0].z, 0.0001);
  float burn = fbm(vUv * scale, 4.0, 0.5, 2.0, 0.0) - progress;
  if (burn < 0.0) { fragColour = vec4(0.0); return; }
  vec4 c = tapAt(vUv);
  // A hot rim where the picture is about to go.
  fragColour = mix(c, repremul(vec4(uColours[0].rgb, c.a)), 1.0 - smoothstep(0.0, edge, burn));
}`,

  'roughen-edges': `
void main() {
  float amount = uParams[0].x;
  float scale = max(uParams[0].y, 0.0001);
  float evolution = uParams[0].z;
  vec4 c = tapAt(vUv);
  float n = fbm(vUv * scale + evolution, 4.0, 0.5, 2.0, 1.0);
  // Eat into the alpha rather than the colour, so the shape frays and the
  // picture inside it is left alone.
  float a = clamp(c.a - (1.0 - n) * amount, 0.0, 1.0);
  fragColour = vec4(unpremul(c).rgb * a, a);
}`,

  scatter: `
void main() {
  float amount = uParams[0].x;
  float grain = max(uParams[0].y, 1.0);
  vec2 cell = floor(vUv / (texel() * grain));
  vec2 jitter = vec2(hash21(cell), hash21(cell + 19.7)) - 0.5;
  fragColour = sampleBox(vUv + jitter * amount);
}`,

  glass: `
void main() {
  float amount = uParams[0].x;
  float scale = max(uParams[0].y, 0.0001);
  vec2 p = vUv * scale;
  // Refract through a bumpy surface: the gradient of a noise field stands in
  // for the surface normal, and the normal is what bends the ray.
  float h = valueNoise(p);
  float hx = valueNoise(p + vec2(0.05, 0.0));
  float hy = valueNoise(p + vec2(0.0, 0.05));
  fragColour = sampleBox(vUv + vec2(hx - h, hy - h) * amount);
}`,

  repetile: `
void main() {
  vec2 tiles = max(uParams[0].xy, vec2(1.0));
  vec2 cell = vUv * tiles;
  vec2 within = fract(cell);
  if (uParams[0].z > 0.5) {
    vec2 index = floor(cell);
    if (mod(index.x, 2.0) >= 1.0) within.x = 1.0 - within.x;
    if (mod(index.y, 2.0) >= 1.0) within.y = 1.0 - within.y;
  }
  fragColour = tapAt(within);
}`,

  'channel-blur': `
void main() {
  // Per-channel radii, so a soft red and a sharp blue can come off the same
  // picture. One kernel at the widest radius; each channel then takes the
  // blurred version in the proportion its own radius asks for.
  vec4 radii = max(uParams[0], vec4(0.0));
  float widest = max(max(radii.r, radii.g), max(radii.b, radii.a));
  vec4 sharp = unpremul(tapAt(vUv));
  if (widest < 0.5) { fragColour = tapAt(vUv); return; }
  vec2 radius = widest * texel();
  float lod = lodFor(widest / 5.0);
  vec4 sum = vec4(0.0);
  float weight = 0.0;
  for (int i = -5; i <= 5; i++) {
    for (int j = -5; j <= 5; j++) {
      vec2 d = vec2(float(i), float(j)) / 5.0;
      float w = exp(-dot(d, d) * 2.0);
      vec2 at = clamp(vUv + d * radius, vec2(0.0), vec2(1.0));
      sum += unpremul(tapLod(at, lod)) * w;
      weight += w;
    }
  }
  vec4 blurred = sum / max(weight, 0.0001);
  fragColour = repremul(mix(sharp, blurred, clamp(radii / max(widest, 0.0001), vec4(0.0), vec4(1.0))));
}
`,
};
