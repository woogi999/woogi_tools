// The texture engine: one texture set per layered material, holding the
// texel map of the object it's painted on, the composited canvases the
// renderer samples, and caches of whatever its generators produced.
//
// Only what changed is redone: a brush dab recomposites its rectangle; a
// layer's settings recomposite the whole set but reuse cached generator
// output; a new mesh rebuilds the texel map and the generators.
//
// Generators (and the occlusion and curvature some of them read) run in
// the background, in chunks, at up to GEN_SIZE² texels, then are spread
// over the full texture. A layer waiting for its generator simply isn't
// drawn yet; it appears as soon as it's ready.

import {
  surface,
  texelMap,
  buildBVH,
  bakeAO,
  bakeCurvature,
  bakeNormal,
  bakePosition,
  bakeThickness,
  bakeWorldNormal,
  bakeID,
  toImageBytes,
} from './bake';
import {
  composite,
  runGenerator,
  GENERATORS,
  layerFieldKey,
  paintBuffers,
  maskBuffer,
} from './texture';

const GEN_SIZE = 512;
const AO_SIZE = 256;
const CHUNK = 24576;

const tick = () => new Promise((r) => setTimeout(r, 0));

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

export class TextureSet {
  constructor(matId, size) {
    this.matId = matId;
    this.size = size;
    this.map = null;
    this.gmap = null;
    this.key = null;
    this.fields = new Map();
    this.aux = {};
    this.auxState = null;
    this.version = 0;
    this.canvases = {
      color: canvas(size),
      orm: canvas(size),
      height: canvas(size),
    };
    this.out = null;
  }

  // Generators run on a smaller map when the texture is big.
  get genMap() {
    if (!this.map) return null;
    if (!this.gmap)
      this.gmap =
        this.map.size > GEN_SIZE ? texelMap(this.map.surf, GEN_SIZE) : this.map;
    return this.gmap;
  }
}

export class TextureEngine {
  constructor({ pixels, images, onUpdate }) {
    this.pixels = pixels; // Map: layerId → paint buffers, `${id}:mask` → mask buffer
    this.images = images; // (textureId) → Promise<HTMLImageElement>
    this.onUpdate = onUpdate ?? (() => {});
    this.sets = new Map();
  }

  // Makes sure the material's set exists and is bound to `mesh` (the
  // evaluated mesh of the object it's painted on) and material slot.
  bind(mat, objectId, mesh, slot) {
    let set = this.sets.get(mat.id);
    const size = mat.texSize ?? 1024;
    if (!set || set.size !== size) {
      set = new TextureSet(mat.id, size);
      this.sets.set(mat.id, set);
    }
    const key = `${objectId}|${slot}`;
    if (set.map && set.key === key && set.mesh === mesh) return set;
    set.key = key;
    set.mesh = mesh;
    set.objectId = objectId;
    const surf = surface(mesh, { slot });
    set.map = surf.count ? texelMap(surf, size) : null;
    set.gmap = null;
    set.fields.clear();
    set.aux = {};
    set.auxState = null;
    set.bakedAO = null;
    return set;
  }

  get(matId) {
    return this.sets.get(matId) ?? null;
  }

  drop(matId) {
    this.sets.delete(matId);
  }

  // Paint buffers for a layer (made on first use).
  layerPixels(layerId, size) {
    let px = this.pixels.get(layerId);
    if (!px || px.size !== size) {
      const fresh = paintBuffers(size);
      if (px) resample(px, fresh);
      px = fresh;
      this.pixels.set(layerId, px);
    }
    return px;
  }

  maskPixels(layerId, size) {
    const key = `${layerId}:mask`;
    let px = this.pixels.get(key);
    if (!px || px.size !== size) {
      px = maskBuffer(size);
      this.pixels.set(key, px);
    }
    return px;
  }

  // Per-texel values for a fill layer's source or a generated mask: the
  // data when it's ready, `false` while it's being worked out, `null` when
  // the layer doesn't need one.
  field(set, layer, which) {
    const key = layerFieldKey(layer, which);
    if (!key || !set.map) return null;
    const hit = set.fields.get(key);
    if (hit) return hit.data ?? false;
    if (which === 'fill' && layer.fill.mode === 'image') {
      this.loadImageField(set, key, layer.fill.image);
      return false;
    }
    const spec = which === 'mask' ? layer.mask.gen : layer.fill.gen;
    this.computeField(set, key, spec);
    return false;
  }

  async computeField(set, key, spec) {
    const uses = GENERATORS[spec?.type]?.uses ?? [];
    const entry = { data: null, uses };
    set.fields.set(key, entry);
    const map = set.map;
    const gmap = set.genMap;
    if (uses.length) await this.computeAux(set);
    if (set.fields.get(key) !== entry || set.map !== map) return;
    const out = new Float32Array(gmap.size * gmap.size);
    const N = out.length;
    for (let from = 0; from < N; from += CHUNK) {
      runGenerator(gmap, spec, set.aux, {
        from,
        to: Math.min(N, from + CHUNK),
        out,
      });
      await tick();
      if (set.fields.get(key) !== entry || set.map !== map) return;
    }
    entry.data = gmap === map ? out : spread(out, gmap, map);
    this.onUpdate(set.matId);
  }

  async loadImageField(set, key, textureId) {
    if (set.fields.has(key) || !textureId) return;
    const entry = { data: null };
    set.fields.set(key, entry);
    try {
      const img = await this.images(textureId);
      const c = canvas(set.size);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, set.size, set.size);
      entry.data = ctx.getImageData(0, 0, set.size, set.size).data;
      this.onUpdate(set.matId);
    } catch {
      set.fields.delete(key);
    }
  }

  // Ambient occlusion and curvature on the generator map, for generators
  // that follow the shape (dirt, rust, edge wear). Worked out once per
  // mesh and shared by every generator that asks.
  computeAux(set) {
    if (set.auxState) return set.auxState;
    const map = set.map;
    const gmap = set.genMap;
    set.auxState = (async () => {
      const curvature = await bakeCurvature(gmap);
      if (set.map !== map) return;
      const small = gmap.size > AO_SIZE ? texelMap(map.surf, AO_SIZE) : gmap;
      const ao = await bakeAO(small, buildBVH(map.surf), { samples: 16 });
      if (set.map !== map) return;
      set.aux = {
        curvature,
        ao: small === gmap ? ao : spread(ao, small, gmap, 1),
      };
    })();
    return set.auxState;
  }

  // Composites the material's layers into its canvases (all of it, or a
  // rectangle), and says so.
  composite(mat, set, region = null) {
    if (!set) return;
    const size = set.size;
    set.out = composite(mat, {
      size,
      pixels: this.pixels,
      fields: (layer, which) => this.field(set, layer, which),
      ao: set.bakedAO ?? null,
      region,
      out: set.out,
    });
    const [x0, y0, x1, y1] = region ?? [0, 0, size - 1, size - 1];
    for (const name of ['color', 'orm', 'height']) {
      const ctx = set.canvases[name].getContext('2d');
      ctx.putImageData(
        new ImageData(set.out[name], size, size),
        0,
        0,
        x0,
        y0,
        x1 - x0 + 1,
        y1 - y0 + 1,
      );
    }
    set.version++;
  }

  // Runs one baker over a material's texel map at full size. High-poly
  // sources for normal maps come as an extra mesh in the same space.
  async bake(set, kind, { high = null, samples = 32, progress } = {}) {
    const map = set.map;
    if (!map)
      throw new Error('Nothing to bake: the material isn’t on any faces.');
    let values;
    let channels = 1;
    if (kind === 'ao')
      values = await bakeAO(map, buildBVH(map.surf), { samples, progress });
    else if (kind === 'thickness')
      values = await bakeThickness(map, buildBVH(map.surf), {
        samples: Math.max(8, samples >> 1),
        progress,
      });
    else if (kind === 'curvature')
      values = await bakeCurvature(map, { progress });
    else if (kind === 'normal') {
      values = await bakeNormal(map, high ? buildBVH(surface(high)) : null, {
        progress,
      });
      channels = 3;
    } else if (kind === 'position') {
      values = await bakePosition(map, { progress });
      channels = 3;
    } else if (kind === 'worldNormal') {
      values = await bakeWorldNormal(map, { progress });
      channels = 3;
    } else if (kind === 'id') {
      values = await bakeID(map, { progress });
      channels = 3;
    } else throw new Error(`Unknown bake "${kind}"`);
    const fill = kind === 'normal' ? [128, 128, 255, 255] : null;
    const bytes = toImageBytes(map, values, channels, { fill });
    const c = canvas(map.size);
    c.getContext('2d').putImageData(
      new ImageData(bytes, map.size, map.size),
      0,
      0,
    );
    // A proper occlusion bake also darkens the material's own AO channel.
    if (kind === 'ao') set.bakedAO = values;
    return c;
  }
}

// Spreads values from a smaller texel map over a bigger one by UV,
// bilinearly, using only covered texels (so islands don't bleed together).
function spread(values, small, big, empty = 0) {
  const out = new Float32Array(big.size * big.size);
  const r = small.size / big.size;
  const S = small.size;
  for (let y = 0; y < big.size; y++) {
    const gy = (y + 0.5) * r - 0.5;
    const y0 = Math.max(0, Math.min(S - 1, Math.floor(gy)));
    const y1 = Math.min(S - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, gy - y0));
    for (let x = 0; x < big.size; x++) {
      const i = y * big.size + x;
      if (big.tri[i] < 0) continue;
      const gx = (x + 0.5) * r - 0.5;
      const x0 = Math.max(0, Math.min(S - 1, Math.floor(gx)));
      const x1 = Math.min(S - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, gx - x0));
      let sum = 0;
      let wsum = 0;
      const take = (sx, sy, w) => {
        const j = sy * S + sx;
        if (small.tri[j] >= 0 && w > 0) {
          sum += values[j] * w;
          wsum += w;
        }
      };
      take(x0, y0, (1 - fx) * (1 - fy));
      take(x1, y0, fx * (1 - fy));
      take(x0, y1, (1 - fx) * fy);
      take(x1, y1, fx * fy);
      out[i] = wsum > 0 ? sum / wsum : empty;
    }
  }
  return out;
}

// Keeps a layer's paint when its texture size changes (nearest neighbour).
function resample(from, to) {
  const r = from.size / to.size;
  for (let y = 0; y < to.size; y++)
    for (let x = 0; x < to.size; x++) {
      const j = (Math.floor(y * r) * from.size + Math.floor(x * r)) * 4;
      const i = (y * to.size + x) * 4;
      for (let k = 0; k < 4; k++) {
        to.color[i + k] = from.color[j + k];
        to.pbr[i + k] = from.pbr[j + k];
      }
    }
}
