// Real dice and a real coin for the Dice Roll and Coin Toss pages, drawn with
// three.js so they tumble and land instead of shuffling numbers. Loaded lazily
// like the games' scenes, and the pages keep a flat fallback for when WebGL
// isn't there.
//
//   createDiceScene(canvas)  .roll(values, sides) tumbles one die per value and
//                            settles each with its number on top
//   createCoinScene(canvas)  .toss(heads) flips the coin and lands it heads or
//                            tails up; .setLabels(heads, tails) writes the sides

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  MeshBasicMaterial,
  CanvasTexture,
  SRGBColorSpace,
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  Quaternion,
  CylinderGeometry,
  CircleGeometry,
  Group,
  MathUtils,
  TetrahedronGeometry,
  BoxGeometry,
  OctahedronGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
} from 'three';
import { rendererOptions } from './perf';

const UP = new Vector3(0, 1, 0);
const AWAY = new Vector3(0, 0, -1);
const ROLL_MS = 1300;
const FLIP_MS = 1400;
const GRAVITY = 26;
const SPACING = 2.4;

// ─── Shapes ─────────────────────────────────────────────────────────────
// Each die is a list of flat faces. The Platonic solids come from three.js and
// are regrouped from triangles into polygons; the ten-sided die is built by
// hand, since it isn't one.

const roundKey = (v) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;

// Polygons from a triangle soup: triangles that face the same way and touch
// belong to one face, and its corners are put in order around the centre.
function facesFromGeometry(geometry) {
  const soup = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = soup.getAttribute('position');
  const groups = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const normal = new Vector3()
      .subVectors(b, a)
      .cross(new Vector3().subVectors(c, a))
      .normalize();
    let face = groups.find((g) => g.normal.dot(normal) > 0.9999);
    if (!face) {
      face = { normal, points: new Map() };
      groups.push(face);
    }
    for (const v of [a, b, c]) face.points.set(roundKey(v), v.clone());
  }
  return groups.map(({ normal, points }) =>
    orderPolygon([...points.values()], normal),
  );
}

function orderPolygon(points, normal) {
  const centre = points
    .reduce((sum, p) => sum.add(p), new Vector3())
    .divideScalar(points.length);
  const ref = points[0].clone().sub(centre).normalize();
  const side = new Vector3().crossVectors(normal, ref);
  const ordered = points
    .map((p) => {
      const d = p.clone().sub(centre);
      return { p, angle: Math.atan2(d.dot(side), d.dot(ref)) };
    })
    .sort((x, y) => x.angle - y.angle)
    .map((x) => x.p);
  return { points: ordered, normal: normal.clone(), centre };
}

// A pentagonal trapezohedron: ten kites, five meeting at each tip, with the
// ring between them zigzagging up and down. That height is the one that makes
// every kite flat.
function tenSided() {
  const h = (1 - Math.cos(Math.PI / 5)) / (1 + Math.cos(Math.PI / 5));
  const ring = Array.from({ length: 10 }, (_, k) => {
    const t = (k * Math.PI) / 5;
    return new Vector3(Math.cos(t), k % 2 ? -h : h, Math.sin(t));
  });
  const top = new Vector3(0, 1, 0);
  const bottom = new Vector3(0, -1, 0);
  const faces = [];
  for (let i = 0; i < 5; i++) {
    const a = ring[2 * i];
    const b = ring[(2 * i + 1) % 10];
    const c = ring[(2 * i + 2) % 10];
    faces.push(kite(top, a, b, c));
    const d = ring[(2 * i + 3) % 10];
    faces.push(kite(bottom, b, c, d));
  }
  return faces;
}

function kite(apex, a, b, c) {
  const points = [apex, a, b, c];
  const centre = points
    .reduce((sum, p) => sum.add(p), new Vector3())
    .divideScalar(4);
  let normal = new Vector3()
    .subVectors(a, apex)
    .cross(new Vector3().subVectors(b, apex))
    .normalize();
  if (normal.dot(centre) < 0) normal = normal.negate();
  return orderPolygon(points, normal);
}

const SHAPES = {
  4: () => facesFromGeometry(new TetrahedronGeometry(1.15)),
  6: () => facesFromGeometry(new BoxGeometry(1.2, 1.2, 1.2)),
  8: () => facesFromGeometry(new OctahedronGeometry(1.05)),
  10: () => tenSided(),
  12: () => facesFromGeometry(new DodecahedronGeometry(0.95)),
  20: () => facesFromGeometry(new IcosahedronGeometry(1)),
};
// The die that shows a given number of sides: its own shape where there is one,
// otherwise the nearest one up, filled with the numbers that fit.
export function shapeFor(sides) {
  if (SHAPES[sides]) return sides;
  if (sides <= 6) return 6;
  if (sides <= 8) return 8;
  if (sides <= 10) return 10;
  if (sides <= 12) return 12;
  return 20;
}
// How big the number can be on each face shape, as a share of the face's
// bounding box: a triangle has far less room in its middle than a square.
const FONT_SHARE = { 4: 0.3, 6: 0.5, 8: 0.3, 10: 0.32, 12: 0.4, 20: 0.28 };

// One geometry per shape, with a material group per face so each can carry
// its own number, and a texture basis per face so the number stands upright.
function buildDie(faces) {
  const geometry = new BufferGeometry();
  const positions = [];
  const normals = [];
  const uvs = [];
  const bases = [];
  let start = 0;
  faces.forEach((face, index) => {
    const { points, normal, centre } = face;
    // "Up" on the face's texture: as close to straight up as the face allows.
    const ref = Math.abs(normal.dot(UP)) > 0.9 ? AWAY : UP;
    const up = ref
      .clone()
      .sub(normal.clone().multiplyScalar(ref.dot(normal)))
      .normalize();
    const right = new Vector3().crossVectors(up, normal);
    const flat = points.map((p) => {
      const d = p.clone().sub(centre);
      return [d.dot(right), d.dot(up)];
    });
    const radius = Math.max(
      ...flat.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]),
    );
    const uv = flat.map(([x, y]) => [
      0.5 + x / (2 * radius),
      0.5 + y / (2 * radius),
    ]);
    for (let i = 1; i < points.length - 1; i++) {
      for (const j of [0, i, i + 1]) {
        positions.push(points[j].x, points[j].y, points[j].z);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(uv[j][0], uv[j][1]);
      }
    }
    const count = (points.length - 2) * 3;
    geometry.addGroup(start, count, index);
    start += count;
    // The corners in texture space too, for numbers that sit at the corners.
    bases.push({
      normal,
      up,
      corners: points.map((p, j) => ({
        point: p,
        x: flat[j][0] / radius,
        y: flat[j][1] / radius,
      })),
    });
  });
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  const vertices = [];
  for (const f of faces)
    for (const p of f.points)
      if (!vertices.some((v) => v.distanceTo(p) < 1e-4)) vertices.push(p);
  return { geometry, bases, vertices };
}

// The turn that puts face `index` flat on top with its number facing the camera.
function restingQuaternion(bases, index) {
  const { normal, up } = bases[index];
  const lift = new Quaternion().setFromUnitVectors(normal, UP);
  const turned = up.clone().applyQuaternion(lift);
  turned.y = 0;
  const spin =
    turned.lengthSq() > 1e-6
      ? new Quaternion().setFromUnitVectors(turned.normalize(), AWAY)
      : new Quaternion();
  return spin.multiply(lift);
}

// The turn that stands the die on the face opposite corner `tip`, so that
// corner points straight up: how a four-sided die actually lands.
function tipUpQuaternion(tip, bases) {
  const lift = new Quaternion().setFromUnitVectors(tip.clone().normalize(), UP);
  // Then turned so one of the sloping faces looks straight at the camera.
  const facing = bases
    .map((b) => b.normal.clone().applyQuaternion(lift))
    .filter((n) => n.y > 0.1)
    .map((n) => new Vector3(n.x, 0, n.z).normalize())[0];
  const spin = facing
    ? new Quaternion().setFromUnitVectors(facing, new Vector3(0, 0, 1))
    : new Quaternion();
  return spin.multiply(lift);
}

// ─── Textures ───────────────────────────────────────────────────────────

const PIPS = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.28, 0.28],
    [0.5, 0.5],
    [0.72, 0.72],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.5, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  6: [
    [0.28, 0.26],
    [0.72, 0.26],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.74],
    [0.72, 0.74],
  ],
};

function faceTexture(value, { bg, fg, share, pips, underline }) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = fg;
  if (pips && PIPS[value]) {
    for (const [x, y] of PIPS[value]) {
      ctx.beginPath();
      ctx.arc(x * size, y * size, size * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const text = String(value);
    const scale = text.length > 2 ? 0.7 : text.length > 1 ? 0.85 : 1;
    const px = Math.round(size * share * 2 * scale);
    ctx.font = `700 ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + px * 0.04);
    // A 6 and a 9 are the same thing upside down: a line says which way is up.
    if (underline && (value === 6 || value === 9)) {
      const w = ctx.measureText(text).width;
      ctx.fillRect(
        size / 2 - w / 2,
        size / 2 + px * 0.5,
        w,
        Math.max(2, px * 0.07),
      );
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// A four-sided die's face: one number by each corner, turned to read from
// that corner, since the number at the top is the one that counts.
function cornerTexture(corners, { bg, fg }) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const paint = canvas.getContext('2d');
  paint.fillStyle = bg;
  paint.fillRect(0, 0, size, size);
  paint.fillStyle = fg;
  const px = Math.round(size * 0.26);
  paint.font = `700 ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  paint.textAlign = 'center';
  paint.textBaseline = 'middle';
  for (const { value, x, y } of corners) {
    // Two thirds of the way out from the middle, the top of the number
    // towards the corner (the canvas's y runs the other way from the face's).
    const cx = size / 2 + x * 0.62 * (size / 2);
    const cy = size / 2 - y * 0.62 * (size / 2);
    // eslint-disable-next-line warp-drive/no-legacy-request-patterns -- a canvas state push, not a data request
    paint.save();
    paint.translate(cx, cy);
    paint.rotate(Math.atan2(x, y));
    paint.fillText(String(value), 0, 0);
    paint.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// The page's own colours, so the dice match the theme like the flat ones did.
function themeColors(canvas) {
  const style = getComputedStyle(canvas);
  const read = (name, fallback) =>
    style.getPropertyValue(name).trim() || fallback;
  return { bg: read('--text', '#ffffff'), fg: read('--bg', '#111111') };
}

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.dataset.motion === 'reduce';

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const smooth = (t) => {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

// ─── Shared stage ───────────────────────────────────────────────────────

function createStage(canvas, { fov, eye, look }) {
  const options = rendererOptions(1.5);
  const renderer = new WebGLRenderer({
    canvas,
    antialias: options.antialias,
    alpha: true,
    powerPreference: 'default',
  });
  renderer.setPixelRatio(options.pixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  const camera = new PerspectiveCamera(fov, 1, 0.1, 50);
  camera.position.copy(eye);
  camera.lookAt(look);
  scene.add(camera);
  scene.add(new HemisphereLight(0xffffff, 0x777777, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(2, 6, 3);
  scene.add(sun);

  let frame = null;
  let running = false;
  const animations = new Set();
  let last = 0;
  const render = () => renderer.render(scene, camera);
  const loop = (now) => {
    frame = null;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    for (const step of animations)
      if (step(now, dt) === false) animations.delete(step);
    render();
    if (animations.size) frame = requestAnimationFrame(loop);
    else {
      running = false;
      last = 0;
    }
  };
  const animate = (step) => {
    animations.add(step);
    if (!running) {
      running = true;
      frame = requestAnimationFrame(loop);
    }
  };
  const resize = () => {
    const width = canvas.clientWidth || 300;
    const height = canvas.clientHeight || 200;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!running) render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  return {
    renderer,
    scene,
    camera,
    animate,
    render: () => {
      if (!running) render();
    },
    dispose() {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      animations.clear();
      renderer.dispose();
    },
  };
}

// A soft dark disc under something in the air, so it reads as above the table.
function makeShadow(radius) {
  const mesh = new Mesh(
    new CircleGeometry(radius, 24),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  return mesh;
}

function placeShadow(shadow, x, y, z, base) {
  shadow.position.set(x, 0.01, z);
  const lift = Math.max(0, y - base);
  shadow.scale.setScalar(1 / (1 + lift * 0.35));
  shadow.material.opacity = 0.2 / (1 + lift * 0.6);
}

// ─── Dice ───────────────────────────────────────────────────────────────

export function createDiceScene(canvas) {
  const stage = createStage(canvas, {
    fov: 38,
    eye: new Vector3(0, 7.5, 5.6),
    look: new Vector3(0, 0.4, 0),
  });
  const dice = new Group();
  stage.scene.add(dice);
  const built = new Map(); // shape -> { geometry, bases }
  let live = []; // the dice on the table now
  let generation = 0;

  const shapeOf = (shape) => {
    if (!built.has(shape)) built.set(shape, buildDie(SHAPES[shape]()));
    return built.get(shape);
  };

  // Where each die sits: a loose grid, widest along the screen, and the camera
  // backs off so the whole spread fits.
  function layout(count) {
    const aspect = stage.camera.aspect;
    const cols = Math.max(
      1,
      Math.min(count, Math.ceil(Math.sqrt(count * aspect * 1.1))),
    );
    const rows = Math.ceil(count / cols);
    const spots = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? count - row * cols : cols;
      spots.push([
        (col - (inRow - 1) / 2) * SPACING,
        (row - (rows - 1) / 2) * SPACING,
      ]);
    }
    const width = cols * SPACING + 0.6;
    const depth = rows * SPACING + 0.6;
    const half = Math.tan(MathUtils.degToRad(stage.camera.fov / 2));
    const pitch = Math.atan2(7.5, 5.6);
    const distance = Math.max(
      5.5,
      width / 2 / (half * aspect) + 1,
      ((depth / 2) * Math.sin(pitch)) / half + 3,
    );
    stage.camera.position.set(
      0,
      Math.sin(pitch) * distance,
      Math.cos(pitch) * distance,
    );
    stage.camera.lookAt(0, 0.4, 0);
    return spots;
  }

  function clear() {
    for (const die of live) {
      dice.remove(die.mesh, die.shadow);
      for (const m of die.mesh.material) {
        m.map?.dispose();
        m.dispose();
      }
      die.shadow.material.dispose();
      die.shadow.geometry.dispose();
    }
    live = [];
  }

  // The numbers on a die's faces: the rolled one plus whatever else fits, all
  // different where the die has enough sides for that.
  function faceValues(sides, count, value) {
    const values = [];
    const pool = Array.from({ length: sides }, (_, i) => i + 1).filter(
      (v) => v !== value,
    );
    for (let i = 0; i < count - 1; i++) {
      if (!pool.length) values.push(1 + Math.floor(Math.random() * sides));
      else
        values.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    values.splice(Math.floor(Math.random() * count), 0, value);
    return values;
  }

  return {
    // Rolls one die per value; resolves once they have all come to rest.
    roll(values, sides) {
      const id = ++generation;
      clear();
      const { bg, fg } = themeColors(canvas);
      const shape = shapeFor(sides);
      const { geometry, bases, vertices } = shapeOf(shape);
      const spots = layout(values.length);
      const calm = reducedMotion();
      const pips = sides === 6;
      const underline = shape !== 6 && sides > 6;
      const share = FONT_SHARE[shape];
      live = values.map((value, i) => {
        let materials;
        let rest;
        if (shape === 4) {
          // Numbers live on the corners, and the one pointing up is the roll.
          const numbers = faceValues(sides, vertices.length, value);
          const tip = vertices[numbers.indexOf(value)];
          materials = bases.map(
            (b) =>
              new MeshStandardMaterial({
                map: cornerTexture(
                  b.corners.map((c) => ({
                    ...c,
                    value:
                      numbers[
                        vertices.findIndex((v) => v.distanceTo(c.point) < 1e-4)
                      ],
                  })),
                  { bg, fg },
                ),
                roughness: 0.55,
                metalness: 0.05,
              }),
          );
          rest = tipUpQuaternion(tip, bases);
        } else {
          const faces = faceValues(sides, bases.length, value);
          materials = faces.map(
            (v) =>
              new MeshStandardMaterial({
                map: faceTexture(v, { bg, fg, share, pips, underline }),
                roughness: 0.55,
                metalness: 0.05,
              }),
          );
          rest = restingQuaternion(bases, faces.indexOf(value));
        }
        const mesh = new Mesh(geometry, materials);
        const shadow = makeShadow(0.75);
        dice.add(mesh, shadow);
        const [x, z] = spots[i];
        // How high the centre sits once it's down: whichever corner is lowest.
        const base = -Math.min(
          ...vertices.map((v) => v.clone().applyQuaternion(rest).y),
        );
        return { mesh, shadow, x, z, rest, base };
      });
      if (calm) {
        for (const die of live) {
          die.mesh.position.set(die.x, die.base, die.z);
          die.mesh.quaternion.copy(die.rest);
          placeShadow(die.shadow, die.x, die.base, die.z, die.base);
        }
        stage.render();
        return Promise.resolve();
      }
      const started = performance.now();
      const bodies = live.map((die) => {
        const angle = Math.random() * Math.PI * 2;
        const throwDistance = 2.5 + Math.random() * 1.5;
        return {
          die,
          from: [
            die.x + Math.cos(angle) * throwDistance,
            die.z + Math.sin(angle) * throwDistance,
          ],
          y: 2.5 + Math.random() * 1.5,
          vy: -1 - Math.random() * 3,
          free: new Quaternion().random(),
          spin: new Vector3(
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20,
          ),
        };
      });
      return new Promise((resolve) => {
        const q = new Quaternion();
        const axis = new Vector3();
        stage.animate((now, dt) => {
          if (id !== generation) return false;
          const t = Math.min(1, (now - started) / ROLL_MS);
          for (const body of bodies) {
            const { die } = body;
            const slide = easeOut(t);
            const x = body.from[0] + (die.x - body.from[0]) * slide;
            const z = body.from[1] + (die.z - body.from[1]) * slide;
            // A drop with a couple of bounces, dying away as the roll ends.
            body.vy -= GRAVITY * dt;
            body.y += body.vy * dt;
            if (body.y < die.base) {
              body.y = die.base;
              body.vy = t > 0.75 ? 0 : -body.vy * 0.42;
              body.spin.multiplyScalar(0.55);
            }
            // Tumbling freely, then pulled onto the rolled face.
            const speed = body.spin.length() * (1 - t * 0.6);
            if (speed > 1e-4) {
              axis.copy(body.spin).normalize();
              q.setFromAxisAngle(axis, speed * dt);
              body.free.premultiply(q);
            }
            const settle = smooth((t - 0.5) / 0.5);
            die.mesh.quaternion.copy(body.free).slerp(die.rest, settle);
            die.mesh.position.set(x, body.y, z);
            placeShadow(die.shadow, x, body.y, z, die.base);
          }
          if (t >= 1) {
            for (const die of live) {
              die.mesh.position.set(die.x, die.base, die.z);
              die.mesh.quaternion.copy(die.rest);
              placeShadow(die.shadow, die.x, die.base, die.z, die.base);
            }
            resolve();
            return false;
          }
          return true;
        });
      });
    },
    // Takes the dice off the table.
    clear() {
      generation++;
      clear();
      stage.render();
    },
    dispose() {
      generation++;
      clear();
      for (const { geometry } of built.values()) geometry.dispose();
      stage.dispose();
    },
  };
}

// ─── Coin ───────────────────────────────────────────────────────────────

function coinFace(label, { light, dark, ink, underside = false }) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const shine = ctx.createRadialGradient(
    size * 0.35,
    size * 0.3,
    10,
    size / 2,
    size / 2,
    size * 0.7,
  );
  shine.addColorStop(0, light);
  shine.addColorStop(1, dark);
  ctx.fillStyle = shine;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Long names shrink, and wrap onto a second line if they have a space.
  const words = String(label).toUpperCase().trim().split(/\s+/);
  const lines =
    words.length > 1 && label.length > 7
      ? [
          words.slice(0, Math.ceil(words.length / 2)).join(' '),
          words.slice(Math.ceil(words.length / 2)).join(' '),
        ]
      : [words.join(' ')];
  const longest = Math.max(...lines.map((l) => l.length));
  const px = Math.round(
    Math.min(56, (size * 0.62) / Math.max(3, longest * 0.62)),
  );
  ctx.font = `800 ${px}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  // A cylinder's caps are mapped a quarter turn round from the way the
  // canvas draws (the underside the other way), so the label is turned to
  // read upright from the front once that side is up.
  ctx.translate(size / 2, size / 2);
  ctx.rotate(underside ? -Math.PI / 2 : Math.PI / 2);
  lines.forEach((line, i) =>
    ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * px * 1.1),
  );
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const HEADS_LOOK = { light: '#ffe27a', dark: '#b8860b', ink: '#5a3d00' };
const TAILS_LOOK = {
  light: '#eeeeee',
  dark: '#7d7d7d',
  ink: '#2b2b2b',
  underside: true,
};

export function createCoinScene(canvas) {
  const stage = createStage(canvas, {
    fov: 36,
    eye: new Vector3(0, 3.4, 3.8),
    look: new Vector3(0, 0.3, 0),
  });
  const holder = new Group();
  // Turned round so the words on both sides read the right way up from here.
  holder.rotation.y = Math.PI;
  const thickness = 0.14;
  const geometry = new CylinderGeometry(1, 1, thickness, 56);
  const edge = new MeshStandardMaterial({
    color: 0xd4af37,
    roughness: 0.35,
    metalness: 0.6,
  });
  const heads = new MeshStandardMaterial({ roughness: 0.3, metalness: 0.45 });
  const tails = new MeshStandardMaterial({ roughness: 0.3, metalness: 0.45 });
  const coin = new Mesh(geometry, [edge, heads, tails]);
  coin.rotation.order = 'XZY';
  const shadow = makeShadow(1.05);
  holder.add(coin);
  stage.scene.add(holder, shadow);
  const rest = thickness / 2;
  coin.position.y = rest;
  let angle = 0; // how far the coin has flipped so far, in half turns of π
  let generation = 0;

  const setLabels = (headsLabel, tailsLabel) => {
    heads.map?.dispose();
    tails.map?.dispose();
    heads.map = coinFace(headsLabel, HEADS_LOOK);
    tails.map = coinFace(tailsLabel, TAILS_LOOK);
    heads.needsUpdate = tails.needsUpdate = true;
    stage.render();
  };
  setLabels('Heads', 'Tails');

  return {
    setLabels,
    // Flips the coin and lands it with the winning side up; resolves when it's down.
    toss(headsUp) {
      const id = ++generation;
      const current = Math.round(angle / Math.PI) % 2;
      const wanted = headsUp ? 0 : 1;
      const halfTurns = 8 + ((wanted - current + 2) % 2);
      const from = angle;
      const to = angle + halfTurns * Math.PI;
      angle = to;
      if (reducedMotion()) {
        coin.rotation.set(to, 0, 0);
        coin.position.y = rest;
        placeShadow(shadow, 0, rest, 0, rest);
        stage.render();
        return Promise.resolve();
      }
      const started = performance.now();
      return new Promise((resolve) => {
        stage.animate((now) => {
          if (id !== generation) return false;
          const t = Math.min(1, (now - started) / FLIP_MS);
          // Up in an arc, spinning fastest at the top, with a little wobble.
          const height = rest + 2.6 * 4 * t * (1 - t);
          const spun = from + (to - from) * (1 - Math.pow(1 - t, 2.2));
          coin.rotation.set(
            spun,
            0,
            Math.sin(t * Math.PI) * 0.28 * Math.sin(t * 7),
          );
          coin.position.y = height;
          placeShadow(shadow, 0, height, 0, rest);
          if (t >= 1) {
            coin.rotation.set(to, 0, 0);
            coin.position.y = rest;
            placeShadow(shadow, 0, rest, 0, rest);
            resolve();
            return false;
          }
          return true;
        });
      });
    },
    dispose() {
      generation++;
      geometry.dispose();
      for (const m of [edge, heads, tails]) {
        m.map?.dispose();
        m.dispose();
      }
      shadow.geometry.dispose();
      shadow.material.dispose();
      stage.dispose();
    },
  };
}
