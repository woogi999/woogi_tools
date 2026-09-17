import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  Group,
  Mesh,
  InstancedMesh,
  Object3D,
  BufferGeometry,
  BufferAttribute,
  PlaneGeometry,
  CylinderGeometry,
  SphereGeometry,
  DodecahedronGeometry,
  CircleGeometry,
  RingGeometry,
  OctahedronGeometry,
  DoubleSide,
  ShaderMaterial,
  MeshToonMaterial,
  MeshBasicMaterial,
  CanvasTexture,
  Sprite,
  SpriteMaterial,
  Points,
  Color,
  Fog,
  Vector2,
  NearestFilter,
  LinearFilter,
  SRGBColorSpace,
  DataTexture,
  RedFormat,
  UnsignedByteType,
  Float32BufferAttribute,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { AvatarKit, withOutline, moodFace, reachArms } from './avatar-model';
import { rendererOptions, createGovernor, tabHidden } from './perf';
import { createElement, Bot } from 'sketchyicons';

// The tropical island the 3D arcade games (Snake, Minesweeper) are played on:
// a renderer and loop, a toon sea whose waves move in a shader, a sand island
// with a checkered playing field, palms and rocks, plus the small effects both
// games share (particles, tweens, name tags, avatar reactions).

export const INK = '#141414';
const SKY = '#9adcf2';

export const reducedMotion = () =>
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
export const easeOut = (t) => 1 - (1 - t) ** 3;
export const easeOutBack = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

// A tiny seeded random, so decorations land in the same places on every device.
export function seeded(seed) {
  let s = Math.floor(seed) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

// ─── Stage: renderer, camera, lights and the frame loop ───────────────

export function createStage(canvas, { fov = 42 } = {}) {
  const phone = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const options = rendererOptions(phone ? 1.25 : 1.5);
  const renderer = new WebGLRenderer({
    canvas,
    antialias: options.antialias,
    powerPreference: 'default',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  const governor = createGovernor(renderer, { max: options.pixelRatio });
  const scene = new Scene();
  scene.background = new Color(SKY);
  scene.fog = new Fog(SKY, 150, 340);
  // A near plane well away from the camera keeps depth precision for the far-off large maps (no flickering ground).
  const camera = new PerspectiveCamera(fov, 1, 0.5, 520);
  scene.add(new HemisphereLight('#ffffff', '#5f8fa0', 1.9));
  const sun = new DirectionalLight('#fff4dc', 1.7);
  sun.position.set(-8, 16, 10);
  scene.add(sun);
  const kit = new AvatarKit();

  let onFrame = null;
  let last = performance.now();
  let frame = 0;
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const loop = (now) => {
    frame = requestAnimationFrame(loop);
    const dtMs = now - last;
    last = now;
    // Minimised to a pill, scrolled away or in a hidden tab: nothing to draw.
    if (tabHidden() || !canvas.isConnected || canvas.offsetParent === null)
      return;
    governor.frame(dtMs, now);
    onFrame?.(Math.min(0.1, dtMs / 1000), now);
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);

  return {
    renderer,
    scene,
    camera,
    kit,
    phone,
    calm: reducedMotion(),
    onFrame(fn) {
      onFrame = fn;
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      const seen = new Set();
      scene.traverse((obj) => {
        for (const thing of [
          obj.geometry,
          ...(Array.isArray(obj.material) ? obj.material : [obj.material]),
        ]) {
          if (!thing || seen.has(thing)) continue;
          seen.add(thing);
          if (thing.map && !seen.has(thing.map)) {
            seen.add(thing.map);
            thing.map.dispose();
          }
          thing.dispose?.();
        }
      });
      kit.dispose();
      renderer.dispose();
    },
  };
}

// ─── Tweens ────────────────────────────────────────────────────────────

export class Tweens {
  list = [];

  add(duration, update, { delay = 0, done } = {}) {
    this.list.push({
      start: performance.now() + delay,
      duration,
      update,
      done,
    });
  }

  tick(now) {
    if (!this.list.length) return;
    const running = this.list;
    this.list = [];
    const alive = running.filter((tween) => {
      if (now < tween.start) return true;
      const t = Math.min(1, (now - tween.start) / tween.duration);
      tween.update(t);
      if (t < 1) return true;
      tween.done?.();
      return false;
    });
    this.list = alive.concat(this.list);
  }
}

// ─── The sea ───────────────────────────────────────────────────────────

// One patch of water that follows the camera, rather than a fixed square that
// runs out: a plane this size always reaches past the far plane, so the water
// meets the horizon instead of ending in a band of sky colour.
//
// The waves are worked out from the WORLD position, not the mesh's own: with
// the local position the whole wave pattern travelled with the mesh, so every
// time it followed the camera the crests jumped and the sea appeared to
// shudder. The shallows and the foam come from the terrain's own shore
// distance, baked into a texture, so the surf breaks on the island's actual
// coastline, round every islet and inside every pond, rather than on a shape
// worked out separately that could disagree with the sand.
const SEA_SIZE = 460;
const SEA_SEGMENTS = 160;
const SHORE_RANGE = 8; // the texture holds shore distances of -8 .. +8 units

function shoreTexture(field) {
  const data = new Uint8Array(field.nx * field.nz);
  for (let i = 0; i < data.length; i++) {
    const d = field.shore[i] / (SHORE_RANGE * 2) + 0.5;
    data[i] = Math.round(Math.max(0, Math.min(1, d)) * 255);
  }
  const texture = new DataTexture(
    data,
    field.nx,
    field.nz,
    RedFormat,
    UnsignedByteType,
  );
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createSea(field) {
  const geometry = new PlaneGeometry(
    SEA_SIZE,
    SEA_SIZE,
    SEA_SEGMENTS,
    SEA_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);
  const shore = shoreTexture(field);
  const material = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      uShore: { value: shore },
      uOrigin: { value: new Vector2(field.originX, field.originZ) },
      uSpan: { value: new Vector2(field.spanX, field.spanZ) },
      deep: { value: new Color('#1b86c4') },
      shallow: { value: new Color('#4fdbe0') },
      foam: { value: new Color('#ffffff') },
      fogColor: { value: new Color(SKY) },
    },
    vertexShader: `
      uniform float time;
      varying vec3 vWorld;
      varying float vWave;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float w = sin(world.x * 0.42 + time * 1.3) * 0.09
                + cos(world.z * 0.36 + time * 1.05) * 0.09
                + sin((world.x + world.z) * 0.9 + time * 2.1) * 0.035;
        world.y += w;
        vWave = w;
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform float time;
      uniform sampler2D uShore;
      uniform vec2 uOrigin;
      uniform vec2 uSpan;
      uniform vec3 deep;
      uniform vec3 shallow;
      uniform vec3 foam;
      uniform vec3 fogColor;
      varying vec3 vWorld;
      varying float vWave;

      // How far this pixel is out to sea from the nearest coast, negative on
      // land. Past the edge of the baked field it is simply open water.
      float toShore(vec2 p) {
        vec2 uv = (p - uOrigin) / uSpan;
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))))
          return ${SHORE_RANGE.toFixed(1)};
        return texture2D(uShore, uv).r * ${(SHORE_RANGE * 2).toFixed(1)} - ${SHORE_RANGE.toFixed(1)};
      }

      void main() {
        float d = max(toShore(vWorld.xz), 0.0);
        vec3 c = mix(shallow, deep, smoothstep(0.3, 7.0, d));
        c = mix(c, c * 1.1 + 0.05, step(0.11, vWave) * 0.7);
        float surf = 0.45 + 0.25 * sin(time * 1.7 + vWorld.x * 0.3 + vWorld.z * 0.2);
        float shore = 1.0 - smoothstep(0.0, surf, d);
        float ripple = step(0.82, fract(d * 0.5 - time * 0.18))
                     * (1.0 - smoothstep(0.6, 5.0, d)) * 0.5;
        c = mix(c, foam, clamp(shore + ripple, 0.0, 1.0));
        float dist = distance(cameraPosition, vWorld);
        // Only the last of the distance hazes towards the sky, so the water
        // reaches the horizon instead of fading out a few islands away.
        c = mix(c, fogColor, smoothstep(150.0, 340.0, dist));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.y = SEA_LEVEL;
  mesh.raycast = () => {};
  // Drawn before everything else and never occluding it: it is the backdrop.
  mesh.renderOrder = -1;
  // It is always under the camera, so there is nothing to cull it against.
  mesh.frustumCulled = false;
  return {
    mesh,
    update(seconds, camera) {
      material.uniforms.time.value = seconds;
      if (!camera) return;
      // Following exactly is safe now the waves are worked out in world space:
      // the surface stays put while the mesh slides along underneath it.
      mesh.position.x = camera.position.x;
      mesh.position.z = camera.position.z;
    },
    dispose() {
      shore.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}

// ─── The island ────────────────────────────────────────────────────────

// `deep` is the drowned shelf furthest out, `wet` the wet sand the surf runs
// over and `sand` the dry beach: three bands, so the coast has depth to it.
export const THEMES = {
  meadow: {
    tiles: ['#95d46c', '#86c75f'],
    lip: '#6dab4a',
    sand: '#f3dea4',
    deep: '#b39a5e',
    wet: '#d6ba7a',
  },
  palms: {
    tiles: ['#f6e4ae', '#ecd699'],
    lip: '#d9bd7c',
    sand: '#f3dea4',
    deep: '#b39a5e',
    wet: '#d6ba7a',
  },
  lagoon: {
    tiles: ['#a1dc78', '#92d06c'],
    lip: '#74b150',
    sand: '#f3dea4',
    deep: '#b39a5e',
    wet: '#d6ba7a',
  },
  reef: {
    tiles: ['#f4e1a8', '#e9d293'],
    lip: '#d5b977',
    sand: '#f0d89a',
    deep: '#ab8d55',
    wet: '#cfb070',
  },
  autumn: {
    tiles: ['#e8964a', '#d9853d'],
    lip: '#b8672e',
    sand: '#e9cfa3',
    deep: '#a4855c',
    wet: '#c9a877',
  },
  snow: {
    tiles: ['#e9f3fb', '#d9e8f4'],
    lip: '#a9bccb',
    sand: '#f4f8fb',
    deep: '#a9b9c6',
    wet: '#cddbe6',
  },
  atoll: {
    tiles: ['#8fd6a0', '#7fc891'],
    lip: '#63a877',
    sand: '#f6e6b8',
    deep: '#b5a06a',
    wet: '#dcc489',
  },
  coves: {
    tiles: ['#9ad96f', '#8bcc62'],
    lip: '#6fae4c',
    sand: '#f1dca2',
    deep: '#b09858',
    wet: '#d4b877',
  },
  desert: {
    tiles: ['#d9a15f', '#cc9452'],
    lip: '#b07a3e',
    sand: '#f0cf8e',
    deep: '#a87a44',
    wet: '#d4ab66',
  },
};

// Which squares are which arrives either as an array (from the games) or as
// one string (from the editor, where a single value is cheap to compare
// against the last one). A string needs reading as characters, not as flags:
// '0' is perfectly truthy, which is what used to make cut-out squares do
// nothing at all.
export function maskReader(mask) {
  if (!mask) return null;
  if (typeof mask === 'string') return (i) => mask[i] === '1';
  return (i) => Boolean(mask[i]);
}

// The checkered field, painted only on the squares that are part of the
// board. A square left out is painted as nothing, so whatever the terrain put
// there (sand, or the sea) shows through.
function checkerTexture(width, depth, [a, b], mask) {
  const px = 16;
  const canvas = document.createElement('canvas');
  canvas.width = width * px;
  canvas.height = depth * px;
  const ctx = canvas.getContext('2d');
  const on = maskReader(mask);
  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) {
      if (on && !on(y * width + x)) continue;
      ctx.fillStyle = (x + y) % 2 ? b : a;
      ctx.fillRect(x * px, y * px, px, px);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  return texture;
}

export function makePalm(kit, { height = 2.4, lean = 0.3, turn = 0 } = {}) {
  const palm = new Group();
  const trunk = kit.geometry(
    'palm-trunk',
    () => new CylinderGeometry(0.1, 0.14, 1, 7),
  );
  const segments = 5;
  let top = null;
  for (let i = 0; i < segments; i++) {
    const t = (i + 0.5) / segments;
    const seg = new Mesh(trunk, kit.toon(i % 2 ? '#9c6b40' : '#8a5c35'));
    seg.scale.set(1 - t * 0.25, (height / segments) * 1.08, 1 - t * 0.25);
    seg.position.set(lean * t * t * height, t * height, 0);
    seg.rotation.z = -Math.atan(2 * lean * t);
    palm.add(withOutline(seg, kit, true));
    top = [lean * height, height];
  }
  const frond = kit.geometry('palm-frond', () => new SphereGeometry(1, 8, 5));
  for (let i = 0; i < 7; i++) {
    const holder = new Group();
    holder.position.set(top[0], top[1], 0);
    holder.rotation.y = (i / 7) * Math.PI * 2 + 0.3;
    const leaf = new Mesh(frond, kit.toon(i % 2 ? '#3d9e4a' : '#4cba57'));
    leaf.scale.set(0.26, 0.05, 0.85);
    leaf.position.set(0, -0.12, 0.72);
    leaf.rotation.x = 0.42;
    holder.add(withOutline(leaf, kit, true));
    palm.add(holder);
  }
  const nut = kit.geometry('coconut', () => new SphereGeometry(0.11, 8, 6));
  for (let i = 0; i < 3; i++) {
    const coconut = new Mesh(nut, kit.toon('#6b4424'));
    const a = (i / 3) * Math.PI * 2;
    coconut.position.set(
      top[0] + Math.cos(a) * 0.13,
      top[1] - 0.14,
      Math.sin(a) * 0.13,
    );
    palm.add(coconut);
  }
  palm.rotation.y = turn;
  return palm;
}

export function makeRock(
  kit,
  { size = 0.45, color = '#9aa4ad', seed = 1 } = {},
) {
  const rand = seeded(seed * 97 + 13);
  const rock = new Mesh(
    kit.geometry('rock', () => new DodecahedronGeometry(1, 0)),
    kit.toon(color),
  );
  rock.scale.set(
    size * (0.9 + rand() * 0.4),
    size * (0.6 + rand() * 0.3),
    size * (0.9 + rand() * 0.4),
  );
  rock.rotation.set(rand() * 0.5, rand() * Math.PI, rand() * 0.5);
  rock.position.y = rock.scale.y * 0.45;
  return withOutline(rock, kit, true);
}

export function makeBush(kit, seed = 1) {
  const rand = seeded(seed * 53 + 5);
  const bush = new Group();
  const ball = kit.geometry('bush', () => new SphereGeometry(0.3, 10, 8));
  for (let i = 0; i < 3; i++) {
    const part = new Mesh(ball, kit.toon(i === 1 ? '#57b95a' : '#48a64d'));
    part.position.set(
      (i - 1) * 0.28,
      0.2 + (i === 1 ? 0.1 : 0),
      (rand() - 0.5) * 0.2,
    );
    part.scale.setScalar(0.8 + rand() * 0.5);
    bush.add(withOutline(part, kit, true));
  }
  return bush;
}

function makeStarfish(kit, color) {
  const star = new Mesh(
    kit.geometry('starfish', () => new CylinderGeometry(0.16, 0.16, 0.04, 5)),
    kit.toon(color),
  );
  return star;
}

// A cell's centre in world space, for a board `width` × `depth` squares centred on the origin.
export const cellToWorld = (width, depth, x, y) => [
  x - width / 2 + 0.5,
  y - depth / 2 + 0.5,
];

// The island: a rounded sand block rising out of the sea, the checkered field on top,

// ─── The terrain ───────────────────────────────────────────────────────
//
// The island is a heightfield worked out from the squares themselves rather
// than a slab with a field laid on top. Every square that is land pulls a
// beach up around it, so the coast is wherever the land stops: one island for
// a plain board, several if the board is cut in two, a pond wherever a water
// square was dug. The same field gives the sea its shoreline, so the surf and
// the sand can never disagree about where the water starts.
//
//   const field = terrainField({ width, depth, land, water, seed });
//   field.heightAt(x, z)   the ground's height in world units
//   field.shore[i]         how far out to sea sample i is (negative on land)
//
// `land` is which squares have island under them and `water` which are dug
// out as ponds, each as an array of booleans or a string of '1's and '0's.

export const SEA_LEVEL = -0.62;
// How far the dry sand reaches past the land on average, and the least it may.
export const ISLAND_MARGIN = 3;
export const MIN_BEACH = 1.6;
// The beach inside the board's footprint, round anything you cut out of it.
const INNER_BEACH = 0.9;
const RES = 4; // samples per square
const PAD = 8; // how far past the board the field reaches

// The coast in profile: sand at the top, a wet shelf just proud of the sea,
// then down into the deep. `t` is distance from the land as a share of the
// beach's width, so t = 1 is the waterline.
const COAST = [
  [0.35, 0],
  [0.72, -0.46],
  [1, SEA_LEVEL],
  [1.45, -1.3],
  [2.2, -2.4],
];
function coastHeight(t) {
  if (t <= COAST[0][0]) return COAST[0][1];
  for (let i = 1; i < COAST.length; i++) {
    const [t0, h0] = COAST[i - 1];
    const [t1, h1] = COAST[i];
    if (t <= t1) return h0 + ((t - t0) / (t1 - t0)) * (h1 - h0);
  }
  return COAST[COAST.length - 1][1];
}

// A pond is a pit sunk into the land: the bottom of the water square, then a
// short bank back up to the sand. The bank crosses the waterline a little way
// outside the square, so one water square shows water and not just a hole.
const POND_BANK = 0.42;
const POND_FLOOR = -1.1;
const pondHeight = (dWater) => {
  const u = Math.max(0, Math.min(1, dWater / POND_BANK));
  return POND_FLOOR + u * u * (3 - 2 * u) * (0 - POND_FLOOR);
};
// Where the pond's bank meets the water, in units out from the square.
const POND_SHORE = POND_BANK * 0.33;

// Squared Euclidean distance transform (Felzenszwalb and Huttenlocher), one
// dimension at a time: linear in the number of samples, which is what lets
// the field be rebuilt while someone paints. "Nowhere" is a big finite number
// rather than Infinity: the parabola intersection below is a difference of two
// of them, and Infinity minus Infinity is NaN, which never compares and so
// never lets the loop finish.
const NOWHERE = 1e12;
function edt1d(f, n, out, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s > z[k]) break;
      k--;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    out[q] = (q - p) * (q - p) + f[p];
  }
}

function edt2d(grid, nx, nz) {
  const big = Math.max(nx, nz);
  const f = new Float64Array(big);
  const out = new Float64Array(big);
  const v = new Int32Array(big);
  const z = new Float64Array(big + 1);
  const result = new Float32Array(nx * nz);
  // Along each column, then along each row of that.
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < nz; y++) f[y] = grid[y * nx + x];
    edt1d(f, nz, out, v, z);
    for (let y = 0; y < nz; y++) result[y * nx + x] = out[y];
  }
  for (let y = 0; y < nz; y++) {
    for (let x = 0; x < nx; x++) f[x] = result[y * nx + x];
    edt1d(f, nx, out, v, z);
    for (let x = 0; x < nx; x++) result[y * nx + x] = out[x];
  }
  return result;
}

export function terrainField({
  width,
  depth,
  land = null,
  water = null,
  seed = 1,
}) {
  const onLand = maskReader(land);
  const onWater = maskReader(water);
  const halfW = width / 2;
  const halfD = depth / 2;
  const spanX = width + PAD * 2;
  const spanZ = depth + PAD * 2;
  const nx = spanX * RES + 1;
  const nz = spanZ * RES + 1;
  const originX = -halfW - PAD;
  const originZ = -halfD - PAD;

  const landIn = new Float32Array(nx * nz).fill(NOWHERE);
  const waterIn = new Float32Array(nx * nz).fill(NOWHERE);
  let anyWater = false;
  for (let iz = 0; iz < nz; iz++) {
    const z = originZ + iz / RES;
    const cz = Math.floor(z + halfD);
    for (let ix = 0; ix < nx; ix++) {
      const x = originX + ix / RES;
      const cx = Math.floor(x + halfW);
      if (cx < 0 || cz < 0 || cx >= width || cz >= depth) continue;
      const i = cz * width + cx;
      const k = iz * nx + ix;
      if (!onLand || onLand(i)) landIn[k] = 0;
      if (onWater?.(i)) {
        waterIn[k] = 0;
        anyWater = true;
      }
    }
  }
  const dLand = edt2d(landIn, nx, nz);
  const dWater = anyWater ? edt2d(waterIn, nx, nz) : null;

  // The beach is wider in some places than others, which is all it takes for
  // the coast to read as a coast rather than a rounded-off grid. That is the
  // outer beach. Inside the board's own footprint the sand hugs the land
  // instead, so a channel you cut through the board is sea and not filled in
  // by the beach from either side: anything wider than a square goes under.
  const rand = seeded(seed);
  const a = rand() * Math.PI * 2;
  const b = rand() * Math.PI * 2;
  const c = rand() * Math.PI * 2;
  const outerMargin = (x, z) =>
    Math.max(
      MIN_BEACH,
      ISLAND_MARGIN *
        (1 +
          0.4 * Math.sin(x * 0.55 + a) * Math.sin(z * 0.47 + b) +
          0.2 * Math.sin((x - z) * 0.33 + c)),
    );
  const margin = (x, z) => {
    // How far outside the board's rectangle this is (negative inside it).
    const dRect = Math.max(Math.abs(x) - halfW, Math.abs(z) - halfD);
    const u = Math.max(0, Math.min(1, (dRect + 3) / 4));
    return (
      INNER_BEACH + (outerMargin(x, z) - INNER_BEACH) * u * u * (3 - 2 * u)
    );
  };

  const height = new Float32Array(nx * nz);
  const shore = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    const z = originZ + iz / RES;
    for (let ix = 0; ix < nx; ix++) {
      const x = originX + ix / RES;
      const k = iz * nx + ix;
      const d = Math.sqrt(dLand[k]) / RES;
      const m = margin(x, z);
      let h = coastHeight(d / m);
      let out = d - m;
      if (dWater) {
        const dw = Math.sqrt(dWater[k]) / RES;
        h = Math.min(h, pondHeight(dw));
        out = Math.max(out, POND_SHORE - dw);
      }
      height[k] = h;
      shore[k] = out;
    }
  }

  const sample = (arr, x, z) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - originX) * RES));
    const fz = Math.max(0, Math.min(nz - 1.001, (z - originZ) * RES));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const k = iz * nx + ix;
    return (
      arr[k] * (1 - tx) * (1 - tz) +
      arr[k + 1] * tx * (1 - tz) +
      arr[k + nx] * (1 - tx) * tz +
      arr[k + nx + 1] * tx * tz
    );
  };

  return {
    width,
    depth,
    nx,
    nz,
    res: RES,
    originX,
    originZ,
    spanX,
    spanZ,
    height,
    shore,
    heightAt: (x, z) => sample(height, x, z),
    shoreAt: (x, z) => sample(shore, x, z),
  };
}

// The island's ground, as one mesh coloured by height: sand, the wet shelf,
// and the deep.
function terrainMesh(kit, field, t) {
  const geometry = new PlaneGeometry(
    field.spanX,
    field.spanZ,
    field.nx - 1,
    field.nz - 1,
  );
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(
    field.originX + field.spanX / 2,
    0,
    field.originZ + field.spanZ / 2,
  );
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const sand = new Color(t.sand);
  const wet = new Color(t.wet);
  const deep = new Color(t.deep ?? t.wet);
  for (let i = 0; i < position.count; i++) {
    const h = field.heightAt(position.getX(i), position.getZ(i));
    position.setY(i, h);
    const c = h > -0.3 ? sand : h > -0.85 ? wet : deep;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new Mesh(
    geometry,
    new MeshToonMaterial({ vertexColors: true, gradientMap: kit.gradient }),
  );
  mesh.raycast = () => {};
  return mesh;
}

export function buildIsland(
  kit,
  {
    width,
    depth,
    theme = 'meadow',
    walls = true,
    seed = 1,
    mask = null,
    land = null,
    water = null,
  },
) {
  const t = THEMES[theme] ?? THEMES.meadow;
  const group = new Group();
  const rand = seeded(seed);

  // The ground, and the shore distances the sea reads from it.
  const field = terrainField({ width, depth, land: land ?? mask, water, seed });
  group.userData.terrain = field;
  group.add(terrainMesh(kit, field, t));

  const board = new Mesh(
    new PlaneGeometry(width, depth),
    new MeshToonMaterial({
      map: checkerTexture(width, depth, t.tiles, mask),
      gradientMap: kit.gradient,
      // Squares off the board are drawn as nothing, so the ground shows through.
      transparent: Boolean(mask),
    }),
  );
  board.rotation.x = -Math.PI / 2;
  board.position.y = 0.021;
  group.add(board);

  const halfW = width / 2;
  const halfD = depth / 2;
  if (walls) {
    // Wooden posts and rails along the edge of the board: the outer rectangle
    // for a plain one, and round every island of squares for a shaped one,
    // since that edge is the one the rules stop you at.
    const on = maskReader(mask) ?? (() => true);
    const playable = (x, y) =>
      x >= 0 && y >= 0 && x < width && y < depth && on(y * width + x);
    const posts = new Map();
    const rails = [];
    for (let y = 0; y < depth; y++)
      for (let x = 0; x < width; x++) {
        if (!playable(x, y)) continue;
        const [cx, cz] = cellToWorld(width, depth, x, y);
        for (const [dx, dy] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ]) {
          if (playable(x + dx, y + dy)) continue;
          const along = dx === 0;
          const px = cx + dx * 0.75;
          const pz = cz + dy * 0.75;
          rails.push([px, pz, along ? 1.1 : 0.1, along ? 0.1 : 1.1]);
          for (const side of [-0.5, 0.5]) {
            const sx = along ? px + side : px;
            const sz = along ? pz : pz + side;
            posts.set(`${sx.toFixed(2)},${sz.toFixed(2)}`, [sx, sz]);
          }
        }
      }
    const postGeometry = kit.geometry(
      'fence-post',
      () => new RoundedBoxGeometry(0.18, 0.55, 0.18, 2, 0.05),
    );
    const dummy = new Object3D();
    const postMesh = new InstancedMesh(
      postGeometry,
      kit.toon('#a8744a'),
      Math.max(1, posts.size),
    );
    [...posts.values()].forEach(([x, z], i) => {
      dummy.position.set(x, 0.2, z);
      dummy.updateMatrix();
      postMesh.setMatrixAt(i, dummy.matrix);
    });
    postMesh.count = posts.size;
    group.add(postMesh);
    const railMesh = new InstancedMesh(
      kit.geometry(
        'fence-rail',
        () => new RoundedBoxGeometry(1, 0.1, 1, 1, 0.03),
      ),
      kit.toon('#c08a5a'),
      Math.max(1, rails.length),
    );
    rails.forEach(([x, z, sx, sz], i) => {
      dummy.position.set(x, 0.36, z);
      dummy.scale.set(sx, 1, sz);
      dummy.updateMatrix();
      railMesh.setMatrixAt(i, dummy.matrix);
    });
    railMesh.count = rails.length;
    group.add(railMesh);
  } else {
    // Wrap-around: glowing dashes instead of a fence, since the edges lead back in.
    const dash = new PlaneGeometry(0.45, 0.12);
    const material = new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.75,
    });
    const spots = [];
    for (let x = 0; x < width; x++)
      spots.push(
        [x - halfW + 0.5, -halfD - 0.18, 0],
        [x - halfW + 0.5, halfD + 0.18, 0],
      );
    for (let z = 0; z < depth; z++)
      spots.push(
        [-halfW - 0.18, z - halfD + 0.5, 1],
        [halfW + 0.18, z - halfD + 0.5, 1],
      );
    const dashes = new InstancedMesh(dash, material, spots.length);
    const dummy = new Object3D();
    spots.forEach(([x, z, side], i) => {
      dummy.position.set(x, 0.03, z);
      dummy.rotation.set(-Math.PI / 2, 0, side ? Math.PI / 2 : 0);
      dummy.updateMatrix();
      dashes.setMatrixAt(i, dummy.matrix);
    });
    group.add(dashes);
  }

  // Palms, rocks, bushes and starfish scattered on the beach: wherever there is
  // dry sand that is not part of the board, which for a shaped island can be
  // anywhere at all.
  const on = maskReader(mask);
  const onBoard = (x, z) => {
    const cx = Math.floor(x + width / 2);
    const cz = Math.floor(z + depth / 2);
    if (cx < 0 || cz < 0 || cx >= width || cz >= depth) return false;
    return !on || on(cz * width + cx);
  };
  const beachSpot = () => {
    for (let tries = 0; tries < 40; tries++) {
      const x = field.originX + 3 + rand() * (field.spanX - 6);
      const z = field.originZ + 3 + rand() * (field.spanZ - 6);
      if (field.heightAt(x, z) > -0.05 && !onBoard(x, z)) return [x, z];
    }
    return null;
  };
  const extras = Math.round((width + depth) / 3.5) + 4;
  for (let i = 0; i < extras; i++) {
    const spot = beachSpot();
    if (!spot) break;
    const [x, z] = spot;
    const roll = rand();
    const thing =
      roll < 0.3
        ? makeRock(kit, { size: 0.3 + rand() * 0.3, seed: i + seed })
        : roll < 0.55
          ? makeBush(kit, i + seed)
          : roll < 0.85
            ? makePalm(kit, {
                height: 2.8 + rand() * 1.4,
                lean: 0.25 + rand() * 0.2,
                turn: rand() * 6,
              })
            : makeStarfish(kit, rand() < 0.5 ? '#ff8a65' : '#ffb74d');
    thing.position.x = x;
    thing.position.z = z;
    if (roll >= 0.85) thing.position.y = 0.02;
    group.add(thing);
  }

  // Little islets out at sea, for something to look at.
  const far = Math.max(width, depth) * 0.75 + 12;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rand() * 0.8;
    const islet = new Group();
    const mound = new Mesh(
      kit.geometry(
        'islet',
        () => new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      ),
      kit.toon(t.sand),
    );
    const r = 1.6 + rand() * 1.8;
    mound.scale.set(r, 0.5 + rand() * 0.4, r * (0.7 + rand() * 0.4));
    islet.add(withOutline(mound, kit, true));
    if (rand() < 0.8) {
      const palm = makePalm(kit, {
        height: 2.6 + rand() * 1.2,
        lean: 0.3,
        turn: rand() * 6,
      });
      palm.position.y = mound.scale.y * 0.7;
      islet.add(palm);
    }
    islet.position.set(
      Math.cos(a) * far * (1 + rand() * 0.5),
      -0.7,
      Math.sin(a) * far * (1 + rand() * 0.5),
    );
    group.add(islet);
  }
  return group;
}

// An obstacle standing on a square of the field.
export function makeObstacle(kit, kind, seed) {
  if (kind === 'palm') {
    const g = new Group();
    const mound = new Mesh(
      kit.geometry(
        'palm-mound',
        () => new CylinderGeometry(0.34, 0.44, 0.16, 10),
      ),
      kit.toon('#d9bd7c'),
    );
    mound.position.y = 0.08;
    g.add(withOutline(mound, kit, true));
    // A palm you can't pass through has to look like one. The old 1.5 scaled
    // to 0.8 stood about a snake high, which read as scenery rather than a
    // wall; at roughly twice that it reads as something in the way from any
    // camera angle, and the trunk leans less so the fronds don't overhang the
    // squares either side of the one it actually blocks.
    const palm = makePalm(kit, { height: 3.1, lean: 0.1, turn: seed });
    g.add(palm);
    return g;
  }
  // Water is not a thing standing on a square: it is a pit dug into the
  // terrain with the sea in it (see terrainField), so there is nothing to make.
  if (kind === 'water') return null;
  return makeRock(kit, { size: 0.42, seed });
}

// ─── Particles ─────────────────────────────────────────────────────────

// One fixed buffer of round specks (puffs of dust, sparks, apple juice),
// fading and shrinking as they go. Dead ones swap with the last live one.
export class Particles {
  constructor(capacity = 500) {
    this.capacity = capacity;
    this.count = 0;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.alphas = new Float32Array(capacity);
    this.sizes = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.velocity = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new BufferAttribute(this.positions, 3),
    );
    this.geometry.setAttribute('pcolor', new BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('alpha', new BufferAttribute(this.alphas, 1));
    this.geometry.setAttribute('psize', new BufferAttribute(this.sizes, 1));
    this.geometry.setDrawRange(0, 0);
    this.material = new ShaderMaterial({
      uniforms: { scale: { value: 400 } },
      vertexShader: `
        attribute vec3 pcolor;
        attribute float alpha;
        attribute float psize;
        uniform float scale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = pcolor;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vColor * (1.0 - d * 0.5), vAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    this.color = new Color();
  }

  emit(
    origin,
    count,
    colors,
    {
      speed = 2,
      up = 2,
      life = 0.8,
      gravity = 6,
      size = 0.25,
      spread = 0.2,
    } = {},
  ) {
    for (let n = 0; n < count && this.count < this.capacity; n++) {
      const i = this.count++;
      const angle = Math.random() * Math.PI * 2;
      const power = speed * (0.35 + Math.random() * 0.65);
      this.positions.set(
        [
          origin.x + (Math.random() - 0.5) * spread,
          origin.y + Math.random() * spread * 0.5,
          origin.z + (Math.random() - 0.5) * spread,
        ],
        i * 3,
      );
      this.velocity.set(
        [
          Math.cos(angle) * power,
          up * (0.4 + Math.random()),
          Math.sin(angle) * power,
        ],
        i * 3,
      );
      this.color.set(colors[n % colors.length]);
      this.colors.set([this.color.r, this.color.g, this.color.b], i * 3);
      this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.life[i] = this.maxLife[i];
      this.gravity[i] = gravity;
      this.baseSize[i] = size * (0.6 + Math.random() * 0.8);
    }
  }

  tick(dt, camera, renderer) {
    this.material.uniforms.scale.value =
      renderer.getDrawingBufferSize(TMP_SIZE).y /
      (2 * Math.tan((camera.fov * Math.PI) / 360));
    if (!this.count && !this.drawn) return;
    const p = this.positions;
    const v = this.velocity;
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.count--;
        if (i !== this.count) {
          const last = this.count;
          p.copyWithin(i * 3, last * 3, last * 3 + 3);
          v.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.colors.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.gravity[i] = this.gravity[last];
          this.baseSize[i] = this.baseSize[last];
        }
        i--;
        continue;
      }
      const k = i * 3;
      v[k + 1] -= this.gravity[i] * dt;
      v[k] *= 0.97;
      v[k + 2] *= 0.97;
      p[k] += v[k] * dt;
      p[k + 1] = Math.max(0.02, p[k + 1] + v[k + 1] * dt);
      p[k + 2] += v[k + 2] * dt;
      const fade = this.life[i] / this.maxLife[i];
      this.alphas[i] = Math.min(1, fade * 1.6);
      this.sizes[i] = this.baseSize[i] * (0.4 + fade * 0.6);
    }
    this.geometry.setDrawRange(0, this.count);
    for (const name of ['position', 'pcolor', 'alpha', 'psize'])
      this.geometry.attributes[name].needsUpdate = true;
    this.drawn = this.count > 0;
  }
}

const TMP_SIZE = new Vector2();

// ─── Name tags ─────────────────────────────────────────────────────────

// The site's sketchy robot icon as an image a name tag canvas can draw (it loads once, asynchronously).
let botIcon = null;
const botIconWaiters = new Set();
function loadBotIcon() {
  if (botIcon) return;
  botIcon = new Image();
  botIcon.onload = () => {
    for (const redraw of botIconWaiters) redraw();
    botIconWaiters.clear();
  };
  const svg = createElement(Bot, {
    width: 64,
    height: 64,
    stroke: INK,
    'stroke-width': 2.4,
  });
  botIcon.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
}

export function nameTag(text, color, { bot = false } = {}) {
  if (bot) loadBotIcon();
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 80;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(
    new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  sprite.renderOrder = 20;
  sprite.scale.set(1.6, 0.4, 1);
  sprite.userData.ownTexture = true;
  let drawnKey = '';
  const draw = (label, extra = '') => {
    const key = `${label}|${extra}`;
    if (key === drawnKey) return;
    drawnKey = key;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 320, 80);
    ctx.font = '800 34px Moderustic, sans-serif';
    const full = extra ? `${label} · ${extra}` : label;
    const icon =
      bot && botIcon?.complete && botIcon.naturalWidth ? botIcon : null;
    if (bot && !icon)
      botIconWaiters.add(() => ((drawnKey = ''), draw(label, extra)));
    let size = 34;
    const iconSpace = icon ? 40 : 0;
    while (ctx.measureText(full).width > 250 - iconSpace && size > 16) {
      size -= 2;
      ctx.font = `800 ${size}px Moderustic, sans-serif`;
    }
    const w = Math.min(310, ctx.measureText(full).width + 64 + iconSpace);
    const x = (320 - w) / 2;
    ctx.beginPath();
    ctx.roundRect(x, 12, w, 56, 28);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 28, 40, 10, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (icon) ctx.drawImage(icon, x + 44, 22, 36, 36);
    ctx.fillText(full, x + 46 + iconSpace, 42);
    texture.needsUpdate = true;
  };
  draw(text);
  return { sprite, draw: (extra) => draw(text, extra) };
}

// ─── Avatar reactions ──────────────────────────────────────────────────

// Like Woono's emotes: a face, a bit of body language, sometimes a hop. `holder`
// is anything with an `avatar` (from buildAvatar); the reaction is layered on
// top of whatever pose the game set that frame.
const EMOTES = {
  joy: { ms: 900 },
  cheer: { ms: 2600 },
  stunned: { ms: 1800 },
  shocked: { ms: 900 },
  smug: { ms: 1300 },
  sad: { ms: 3200 },
  angry: { ms: 1300 },
};

export function startEmote(holder, kind, delay = 0) {
  if (!EMOTES[kind] || !holder?.avatar) return;
  holder.emote = {
    kind,
    start: performance.now() + delay,
    ms: EMOTES[kind].ms,
  };
}

// One frame of the current reaction. Returns how high to lift the avatar (a hop).
export function playEmote(holder, kit, now) {
  const e = holder.emote;
  const { head, face, faceOpen } = holder.avatar.userData;
  // Reactions nudge the head from straight ahead every frame, so start from straight ahead
  // every frame too (otherwise the nudges pile up and the head stays twisted).
  head.rotation.set(0, 0, 0);
  if (!e || now < e.start) return 0;
  const t = (now - e.start) / e.ms;
  if (t >= 1) {
    face.material = faceOpen;
    holder.emote = null;
    return 0;
  }
  face.material = moodFace(holder.avatar, kit, e.kind);
  const s = (now - e.start) / 1000;
  const fade = 1 - t;
  switch (e.kind) {
    case 'joy':
      reachArms(holder.avatar, [
        [-0.34, 1.0 + Math.sin(s * 14) * 0.06, 0.05],
        [0.34, 1.0 - Math.sin(s * 14) * 0.06, 0.05],
      ]);
      return Math.sin(t * Math.PI) * 0.35;
    case 'cheer': {
      const pump = Math.abs(Math.sin(s * 9));
      reachArms(holder.avatar, [
        [-0.3, 0.95 + pump * 0.1, 0.08],
        [0.3, 0.95 + (1 - pump) * 0.1, 0.08],
      ]);
      return Math.abs(Math.sin(s * 6)) * 0.3;
    }
    case 'stunned':
      head.rotation.z += Math.sin(s * 14) * 0.25 * fade;
      head.rotation.x += Math.cos(s * 14) * 0.14 * fade;
      return 0;
    case 'shocked':
      head.rotation.x -= 0.25 * fade;
      return Math.sin(Math.min(1, t * 3) * Math.PI) * 0.15;
    case 'smug':
      head.rotation.z -= 0.2 * Math.min(1, t * 5);
      return 0;
    case 'sad':
      head.rotation.x += 0.45 * Math.min(1, t * 3);
      return 0;
    case 'angry':
      holder.avatar.position.x += Math.sin(s * 55) * 0.03 * fade;
      return 0;
    default:
      return 0;
  }
}

// Arms and legs straight, swinging as they walk (amount 0 stands still).
export function swingLimbs(avatar, phase, amount) {
  const { arms, legs } = avatar.userData;
  arms?.forEach((shoulder, i) => {
    const side = i === 0 ? -1 : 1;
    const { arm, hand, reach } = shoulder.userData;
    shoulder.quaternion.identity();
    shoulder.rotation.set(
      Math.sin(phase) * amount * side,
      0,
      side * 0.14,
      'XYZ',
    );
    if (arm.userData.baseY !== undefined) arm.position.y = arm.userData.baseY;
    arm.scale.y = 1;
    hand.position.y = -reach;
  });
  legs?.forEach((hip, i) => {
    hip.rotation.set(Math.sin(phase) * amount * (i === 0 ? 1 : -1), 0, 0);
  });
}

// A soft dark blob under something, so it reads as standing on the ground.
export function blobShadow(kit, radius = 0.4) {
  const shadow = new Mesh(
    kit.geometry('blob-shadow', () => new CircleGeometry(1, 20)),
    (kit.shadowMaterial ??= new MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })),
  );
  shadow.userData.sharedMaterial = true;
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.setScalar(radius);
  shadow.renderOrder = 2;
  return shadow;
}

// ─── Shockwaves and dizzy stars ───────────────────────────────────────

// Flat rings that spread across the ground and fade: a boost, a blast. Recycled.
export class Shockwaves {
  free = [];

  constructor(scene, tweens) {
    this.scene = scene;
    this.tweens = tweens;
    this.geometry = new RingGeometry(0.8, 1, 40);
    this.geometry.rotateX(-Math.PI / 2);
  }

  add(
    x,
    y,
    z,
    color,
    { size = 3, duration = 520, delay = 0, thickness = 1 } = {},
  ) {
    const mesh =
      this.free.pop() ??
      new Mesh(
        this.geometry,
        new MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
    mesh.material.color.set(color);
    mesh.material.opacity = 0;
    mesh.position.set(x, y, z);
    mesh.renderOrder = 11;
    this.scene.add(mesh);
    this.tweens.add(
      duration,
      (t) => {
        const e = easeOut(t);
        mesh.scale.set(0.2 + e * size, 1, 0.2 + e * size * thickness);
        mesh.material.opacity = 0.9 * (1 - t);
      },
      {
        delay,
        done: () => {
          mesh.removeFromParent();
          this.free.push(mesh);
        },
      },
    );
  }
}

// Little stars circling someone's head while they're dazed.
export function dizzyStars(kit) {
  const group = new Group();
  const star = kit.geometry(
    'dizzy-star',
    () => new OctahedronGeometry(0.09, 0),
  );
  for (let i = 0; i < 3; i++) {
    const mesh = new Mesh(star, kit.toon('#ffd84d'));
    mesh.add(new Mesh(star, kit.outlineThin));
    group.add(mesh);
  }
  group.visible = false;
  group.userData.update = (now) => {
    group.children.forEach((mesh, i) => {
      const a = now / 260 + (i / 3) * Math.PI * 2;
      mesh.position.set(
        Math.cos(a) * 0.32,
        Math.sin(a * 2) * 0.05,
        Math.sin(a) * 0.32,
      );
      mesh.rotation.set(now / 200, now / 300, 0);
    });
  };
  return group;
}
