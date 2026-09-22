// The blurs, and the neighbourhood effects that were standing in for
// themselves with a plain `blur()`.
//
// CSS has exactly one blur and it is isotropic, so every blur in the catalogue
// that is *not* a gaussian — a streak along an angle, a spin about a centre, a
// box, an edge-preserving one — came out of the CSS fallback looking identical
// to all the others. Telling Directional Blur from Radial Blur by looking at
// them was impossible, which is the same as not having either.
//
// These sample the neighbourhood properly. They are the honest cost of the
// effect: a fixed tap count, chosen so a full-frame layer stays interactive.

export const BLUR_SHADERS = {
  // A straight line of taps along one angle: the streak a moving object
  // leaves, and the thing CSS most obviously cannot do.
  'directional-blur': `
void main() {
  float length_ = uParams[0].x;
  float angle = radians(uParams[0].y);
  if (length_ < 0.5) { fragColour = tapAt(vUv); return; }
  vec2 step_ = vec2(cos(angle), sin(angle)) * texel() * length_;
  // The streak runs two lengths end to end over 24 gaps; each tap reads a mip
  // level wide enough to cover its own gap, so the smear is continuous rather
  // than twenty-five copies of the layer in a line.
  float lod = lodFor(length_ * 2.0 / 24.0);
  vec4 sum = vec4(0.0);
  float weight = 0.0;
  for (int i = -12; i <= 12; i++) {
    float t = float(i) / 12.0;
    float w = exp(-t * t * 1.6);
    sum += tapBoxLod(vUv + step_ * t, lod) * w;
    weight += w;
  }
  fragColour = sum / max(weight, 0.0001);
}
`,

  // Spin turns the taps about a centre; zoom pushes them along the radius.
  // One shader, because they differ only in which way the tap walks.
  'radial-blur': `
void main() {
  float amount = uParams[0].x;
  float zoom = uParams[0].y;
  vec2 centre = uParams[0].zw;
  if (amount < 0.5) { fragColour = tapAt(vUv); return; }

  vec2 aspect = boxAspect();
  vec2 p = (vUv - centre) * aspect;
  float r = length(p);
  float a = atan(p.y, p.x);
  // How far apart the taps land at this pixel, in pixels. It grows with the
  // distance from the centre, which is why a radial blur is sharp in the
  // middle and smeared at the rim, and why one fixed level would be wrong.
  float reach = r * amount * 0.01 * uSize.y;
  float lod = lodFor(reach * 2.0 / 20.0);
  vec4 sum = vec4(0.0);
  float weight = 0.0;
  for (int i = -10; i <= 10; i++) {
    float t = float(i) / 10.0;
    vec2 at;
    if (zoom > 0.5) {
      at = centre + p * (1.0 + t * amount * 0.01) / aspect;
    } else {
      float turn = a + t * amount * 0.01;
      at = centre + vec2(cos(turn), sin(turn)) * r / aspect;
    }
    float w = exp(-t * t * 1.4);
    sum += tapBoxLod(at, lod) * w;
    weight += w;
  }
  fragColour = sum / max(weight, 0.0001);
}
`,

  // Separate horizontal and vertical radii in one pass. A box kernel, which is
  // what Box Blur and Axial Blur both actually are.
  'box-blur': `
void main() {
  vec2 radiusPx = max(uParams[0].xy, vec2(0.0));
  float iterations = max(uParams[0].z, 1.0);
  // Repeating a box blur approaches a gaussian; widening the kernel by the
  // square root of the count is the cheap way to the same reach.
  radiusPx *= sqrt(iterations);
  if (radiusPx.x < 0.5 && radiusPx.y < 0.5) { fragColour = tapAt(vUv); return; }
  vec2 radius = radiusPx * texel();
  float lod = lodFor(max(radiusPx.x, radiusPx.y) / 6.0);
  vec4 sum = vec4(0.0);
  float weight = 0.0;
  for (int y = -6; y <= 6; y++) {
    for (int x = -6; x <= 6; x++) {
      vec2 d = vec2(float(x), float(y)) / 6.0;
      // Box in shape, softened at the rim so the blur does not end in a
      // visible square.
      float w = exp(-dot(d, d) * 0.9);
      sum += tapBoxLod(vUv + d * radius, lod) * w;
      weight += w;
    }
  }
  fragColour = sum / max(weight, 0.0001);
}
`,

  // Edge-preserving: a neighbour only counts if its colour is close enough to
  // the pixel's own. Smooths a gradient and leaves a hard edge alone, which is
  // what makes it a skin blur rather than a gaussian.
  'bilateral-blur': `
void main() {
  float radiusPx = max(uParams[0].x, 0.0) * 4.0;
  float threshold = max(uParams[0].y / 100.0, 0.0001);
  float edgeOnly = uParams[0].z;
  vec4 here = unpremul(tapAt(vUv));
  if (radiusPx < 0.5) { fragColour = tapAt(vUv); return; }
  vec2 radius = radiusPx * texel();
  // Half a gap, because a tonal test run on an over-averaged tap stops being
  // able to tell an edge from a gradient, the thing this blur exists to keep.
  float lod = lodFor(radiusPx / 10.0);

  vec4 sum = vec4(0.0);
  float weight = 0.0;
  for (int y = -5; y <= 5; y++) {
    for (int x = -5; x <= 5; x++) {
      vec2 d = vec2(float(x), float(y)) / 5.0;
      vec2 at = clamp(vUv + d * radius, vec2(0.0), vec2(1.0));
      vec4 c = unpremul(tapLod(at, lod));
      float spatial = exp(-dot(d, d) * 2.0);
      float tonal = exp(-pow(distance(c.rgb, here.rgb) / threshold, 2.0));
      float w = spatial * tonal;
      sum += c * w;
      weight += w;
    }
  }
  vec4 smoothed = sum / max(weight, 0.0001);
  if (edgeOnly > 0.5) {
    // What the blur removed is the detail; showing it is the "edge only" view.
    vec3 detail = abs(here.rgb - smoothed.rgb) * 4.0;
    fragColour = repremul(vec4(clamp(detail, vec3(0.0), vec3(1.0)), here.a));
    return;
  }
  fragColour = repremul(vec4(smoothed.rgb, here.a));
}
`,

  // Blur the picture, then add back what the blur removed. A real unsharp
  // mask, rather than the contrast bump CSS was doing.
  'unsharp-mask': `
void main() {
  float amount = uParams[0].x / 100.0;
  float radiusPx = max(uParams[0].y, 0.0001) * 2.0;
  float threshold = uParams[0].z / 255.0;
  vec2 radius = radiusPx * texel();
  float lod = lodFor(radiusPx / 4.0);
  vec4 here = unpremul(tapAt(vUv));
  vec4 sum = vec4(0.0);
  float weight = 0.0;
  for (int y = -4; y <= 4; y++) {
    for (int x = -4; x <= 4; x++) {
      vec2 d = vec2(float(x), float(y)) / 4.0;
      float w = exp(-dot(d, d) * 2.0);
      vec2 at = clamp(vUv + d * radius, vec2(0.0), vec2(1.0));
      sum += unpremul(tapLod(at, lod)) * w;
      weight += w;
    }
  }
  vec3 blurred = (sum / max(weight, 0.0001)).rgb;
  vec3 detail = here.rgb - blurred;
  // Below the threshold it is noise rather than detail, and sharpening noise
  // is the whole reason the knob exists.
  vec3 gated = mix(vec3(0.0), detail, step(vec3(threshold), abs(detail)));
  fragColour = repremul(vec4(clamp(here.rgb + gated * amount, vec3(0.0), vec3(1.0)), here.a));
}
`,

  // A polygonal iris, so a bright point becomes the shape of the aperture
  // rather than a round smudge. The highlight gain is what makes bokeh read as
  // bokeh: bright areas bloom, the rest just softens.
  'bokeh-blur': `
void main() {
  float radiusPx = max(uParams[0].x, 0.0) * 2.0;
  float blades = max(uParams[0].y, 3.0);
  float rotation = radians(uParams[0].z);
  float gain = max(uParams[0].w, 1.0);
  float threshold = uParams[1].x / 100.0;
  if (radiusPx < 0.5) { fragColour = tapAt(vUv); return; }
  float radius = radiusPx * texel().x;
  float lod = lodFor(radiusPx / 7.0);

  vec4 sum = vec4(0.0);
  float weight = 0.0;
  for (int i = 0; i < 48; i++) {
    float t = (float(i) + 0.5) / 48.0;
    float a = t * TAU * 6.0 + rotation;
    // Walk out in a spiral and snap the radius to the polygon's edge, which
    // is what gives the aperture its shape.
    float ring = sqrt(t);
    float wedge = TAU / blades;
    float edge = cos(wedge * 0.5) / max(cos(mod(a, wedge) - wedge * 0.5), 0.2);
    vec2 at = vUv + vec2(cos(a), sin(a)) * ring * edge * radius;
    if (any(lessThan(at, vec2(0.0))) || any(greaterThan(at, vec2(1.0)))) continue;
    vec4 c = unpremul(tapLod(at, lod));
    float bright = luma(c.rgb) > threshold ? gain : 1.0;
    sum += c * bright;
    weight += bright;
  }
  fragColour = repremul(sum / max(weight, 0.0001));
}
`,

  // The median of the neighbourhood, which removes specks without softening
  // an edge the way an average does. Approximated on a fixed ring.
  median: `
void main() {
  float radiusPx = max(uParams[0].x, 0.0) * 2.0;
  float threshold = uParams[0].y / 100.0;
  vec4 here = unpremul(tapAt(vUv));
  if (radiusPx < 0.5) { fragColour = tapAt(vUv); return; }
  float radius = radiusPx * texel().x;
  float lod = lodFor(radiusPx / 4.0);

  // A true median needs a sort; the midpoint of the extremes is close enough
  // at these radii and costs one pass instead of nine.
  vec3 lo = vec3(1.0);
  vec3 hi = vec3(0.0);
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) / 12.0 * TAU;
    vec2 at = clamp(vUv + vec2(cos(a), sin(a)) * radius, vec2(0.0), vec2(1.0));
    vec3 c = unpremul(tapLod(at, lod)).rgb;
    lo = min(lo, c);
    hi = max(hi, c);
    sum += c;
    n += 1.0;
  }
  vec3 mid = clamp(sum / n, lo, hi);
  // Above the threshold the pixel is kept, so only the specks are replaced.
  float speck = step(threshold, distance(here.rgb, mid));
  fragColour = repremul(vec4(mix(here.rgb, mid, threshold > 0.0 ? speck : 1.0), here.a));
}
`,

  // Square blocks, which is what Pixelate and Mosaic both are; the block count
  // is the only thing that differs.
  mosaic: `
void main() {
  vec2 blocks = max(uParams[0].xy, vec2(1.0));
  float sharp = uParams[0].z;
  vec2 cell = floor(vUv * blocks);
  vec2 centre = (cell + 0.5) / blocks;
  if (sharp > 0.5) { fragColour = tapAt(centre); return; }
  // Averaging the block reads better on fine detail than snapping to whatever
  // colour happened to be in the middle of it.
  vec4 sum = vec4(0.0);
  for (int y = 0; y < 3; y++)
    for (int x = 0; x < 3; x++)
      sum += tapAt((cell + (vec2(float(x), float(y)) + 0.5) / 3.0) / blocks);
  fragColour = sum / 9.0;
}`,

  // The channels pulled apart along an angle, the way a cheap lens does it.
  'chromatic-aberration': `
void main() {
  float amount = uParams[0].x * texel().x;
  float angle = radians(uParams[0].y);
  vec2 shift = vec2(cos(angle), sin(angle)) * amount;
  vec4 r = unpremul(tapAt(clamp(vUv + shift, vec2(0.0), vec2(1.0))));
  vec4 g = unpremul(tapAt(vUv));
  vec4 b = unpremul(tapAt(clamp(vUv - shift, vec2(0.0), vec2(1.0))));
  fragColour = repremul(vec4(r.r, g.g, b.b, g.a));
}`,

  // A sobel gradient: where the picture changes fastest is where its edges are.
  'find-edges': `
void main() {
  vec2 t = texel() * max(uParams[0].x, 1.0);
  float invert = uParams[0].y;
  float perChannel = uParams[0].z;
  float blend = uParams[0].w;

  vec3 gx = vec3(0.0);
  vec3 gy = vec3(0.0);
  float kx[9];
  kx[0] = -1.0; kx[1] = 0.0; kx[2] = 1.0;
  kx[3] = -2.0; kx[4] = 0.0; kx[5] = 2.0;
  kx[6] = -1.0; kx[7] = 0.0; kx[8] = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 c = unpremul(tapAt(clamp(vUv + vec2(float(x), float(y)) * t, vec2(0.0), vec2(1.0)))).rgb;
      int i = (y + 1) * 3 + (x + 1);
      gx += c * kx[i];
      gy += c * kx[(x + 1) * 3 + (y + 1)];
    }
  }
  vec3 edge = sqrt(gx * gx + gy * gy);
  if (perChannel < 0.5) edge = vec3(luma(edge));
  if (invert > 0.5) edge = 1.0 - edge;
  vec4 here = unpremul(tapAt(vUv));
  fragColour = repremul(vec4(mix(clamp(edge, vec3(0.0), vec3(1.0)), here.rgb, blend), here.a));
}`,

  // A directional gradient rendered as light and shade: the picture as if it
  // were stamped into metal.
  emboss: `
void main() {
  float angle = radians(uParams[0].x);
  vec2 t = texel() * max(uParams[0].y, 0.0001) * 2.0;
  float contrast = uParams[0].z / 100.0;
  float blend = uParams[0].w;
  float colour = uParams[1].x;

  vec2 d = vec2(cos(angle), sin(angle)) * t;
  vec3 a = unpremul(tapAt(clamp(vUv + d, vec2(0.0), vec2(1.0)))).rgb;
  vec3 b = unpremul(tapAt(clamp(vUv - d, vec2(0.0), vec2(1.0)))).rgb;
  vec3 relief = (a - b) * contrast;
  vec4 here = unpremul(tapAt(vUv));
  // Grey plus the gradient is the classic emboss; keeping the colour is the
  // variant the catalogue lists separately.
  vec3 out_ = colour > 0.5 ? here.rgb + relief : vec3(0.5) + vec3(luma(relief));
  fragColour = repremul(vec4(mix(clamp(out_, vec3(0.0), vec3(1.0)), here.rgb, blend), here.a));
}`,

  // Flat bands of colour with the edges drawn back in.
  cartoon: `
void main() {
  float steps = max(uParams[0].x, 2.0);
  vec2 t = texel() * max(uParams[0].y, 1.0);
  float threshold = uParams[0].z / 100.0;
  float edgeOpacity = uParams[0].w / 100.0;

  vec4 here = unpremul(tapAt(vUv));
  vec3 banded = floor(here.rgb * steps + 0.5) / steps;
  // One sobel pass for the outline.
  float gx = 0.0;
  float gy = 0.0;
  for (int i = -1; i <= 1; i++) {
    gx += luma(unpremul(tapAt(clamp(vUv + vec2(t.x, float(i) * t.y), vec2(0.0), vec2(1.0)))).rgb);
    gx -= luma(unpremul(tapAt(clamp(vUv - vec2(t.x, float(i) * t.y), vec2(0.0), vec2(1.0)))).rgb);
    gy += luma(unpremul(tapAt(clamp(vUv + vec2(float(i) * t.x, t.y), vec2(0.0), vec2(1.0)))).rgb);
    gy -= luma(unpremul(tapAt(clamp(vUv - vec2(float(i) * t.x, t.y), vec2(0.0), vec2(1.0)))).rgb);
  }
  float edge = smoothstep(threshold, threshold * 2.0 + 0.01, sqrt(gx * gx + gy * gy));
  fragColour = repremul(vec4(banded * (1.0 - edge * edgeOpacity), here.a));
}`,

  // Short strokes along an angle, jittered per cell so the brush does not read
  // as a comb.
  'brush-strokes': `
void main() {
  float size = max(uParams[0].x, 0.0001) * texel().x * 2.0;
  float angle = radians(uParams[0].y);
  float randomness = uParams[0].z / 100.0;
  float blend = uParams[0].w;

  vec2 cell = floor(vUv / max(size, 0.0001));
  float jitter = (hash21(cell) - 0.5) * randomness * TAU;
  vec2 dir = vec2(cos(angle + jitter), sin(angle + jitter)) * size;
  vec4 sum = vec4(0.0);
  for (int i = -3; i <= 3; i++) {
    vec2 at = clamp(vUv + dir * (float(i) / 3.0), vec2(0.0), vec2(1.0));
    sum += tapAt(at);
  }
  fragColour = mix(sum / 7.0, tapAt(vUv), blend);
}`,

  // Flat steps per channel. CSS has no posterize at all.
  posterize: `
void main() {
  vec4 c = unpremul(tapAt(vUv));
  float steps = max(uParams[0].x, 2.0);
  fragColour = repremul(vec4(floor(c.rgb * steps + 0.5) / steps, c.a));
}`,

  // A real sharpen rather than a contrast bump.
  sharpen: `
void main() {
  float amount = max(uParams[0].x - 1.0, 0.0) * 2.0;
  vec2 t = texel();
  vec4 here = unpremul(tapAt(vUv));
  vec3 around =
    unpremul(tapAt(clamp(vUv + vec2(t.x, 0.0), vec2(0.0), vec2(1.0)))).rgb +
    unpremul(tapAt(clamp(vUv - vec2(t.x, 0.0), vec2(0.0), vec2(1.0)))).rgb +
    unpremul(tapAt(clamp(vUv + vec2(0.0, t.y), vec2(0.0), vec2(1.0)))).rgb +
    unpremul(tapAt(clamp(vUv - vec2(0.0, t.y), vec2(0.0), vec2(1.0)))).rgb;
  vec3 v = here.rgb + (here.rgb * 4.0 - around) * amount * 0.25;
  fragColour = repremul(vec4(clamp(v, vec3(0.0), vec3(1.0)), here.a));
}`,
};
