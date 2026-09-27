// Seeded 3D noise for the Displace modifier and the material generators.
// Everything is sampled at a point in 3D rather than at a UV, which is what
// keeps procedural wear and grain seamless across UV seams.
//
// Lattice values come from a shuffled table per seed (as in Perlin's
// noise), which is several times quicker than hashing integers.

const tables = new Map();

function table(seed) {
  let t = tables.get(seed);
  if (t) return t;
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  let s = (seed * 2654435761 + 1) >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) vals[i] = next();
  t = { perm, vals };
  if (tables.size > 64) tables.clear();
  tables.set(seed, t);
  return t;
}

// A value in [0, 1) for an integer lattice point.
export function hash3(x, y, z, seed = 0) {
  const { perm, vals } = table(seed);
  return vals[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Value noise in [0, 1).
export function noise3(x, y, z, seed = 0) {
  const { perm, vals } = table(seed);
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const u = fade(x - xi),
    v = fade(y - yi),
    w = fade(z - zi);
  const X = xi & 255,
    Y = yi & 255,
    Z = zi & 255;
  const a = perm[X] + Y,
    b = perm[X + 1] + Y;
  const aa = perm[a] + Z,
    ab = perm[a + 1] + Z,
    ba = perm[b] + Z,
    bb = perm[b + 1] + Z;
  const c000 = vals[perm[aa]],
    c100 = vals[perm[ba]],
    c010 = vals[perm[ab]],
    c110 = vals[perm[bb]];
  const c001 = vals[perm[aa + 1]],
    c101 = vals[perm[ba + 1]],
    c011 = vals[perm[ab + 1]],
    c111 = vals[perm[bb + 1]];
  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

// Fractal sum of octaves, normalised back to [0, 1].
export function fbm3(
  x,
  y,
  z,
  octaves = 4,
  seed = 0,
  lacunarity = 2,
  gain = 0.5,
) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise3(x * f + o * 17.3, y * f, z * f, seed) * amp;
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

// Ridged noise: sharp creases where plain noise crosses its middle.
export function ridged3(x, y, z, octaves = 4, seed = 0) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    const n =
      1 - Math.abs(noise3(x * f + o * 31.7, y * f, z * f, seed) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// A few numbers per lattice cell from one table lookup: seedCell() seeds a
// shared generator from the cell's value and rand() draws from it, so
// features need one lookup (and no allocation) rather than one each.
let cellState = 1;

export function seedCell(x, y, z, seed = 0) {
  cellState =
    (hash3(x, y, z, seed) * 4294967296 +
      ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791))) >>>
      0 || 1;
}

export function rand() {
  cellState ^= cellState << 13;
  cellState ^= cellState >>> 17;
  cellState ^= cellState << 5;
  return (cellState >>> 0) / 4294967296;
}

// Cellular (Worley) noise: distances to the nearest and second-nearest
// feature points, and a random value for the nearest cell.
export function worley3(x, y, z, seed = 0) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  let f1 = Infinity;
  let f2 = Infinity;
  let id = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const cx = xi + dx,
          cy = yi + dy,
          cz = zi + dz;
        seedCell(cx, cy, cz, seed);
        const px = cx + rand() - x;
        const py = cy + rand() - y;
        const pz = cz + rand() - z;
        const d = Math.sqrt(px * px + py * py + pz * pz);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = rand();
        } else if (d < f2) f2 = d;
      }
  return { f1, f2, id };
}

// A small seeded generator for anything that needs a stream of numbers.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
