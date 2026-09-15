import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  Group,
  Mesh,
  BufferGeometry,
  BufferAttribute,
  SphereGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  ConeGeometry,
  TorusGeometry,
  PlaneGeometry,
  CircleGeometry,
  LatheGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  MeshToonMaterial,
  MeshBasicMaterial,
  ShaderMaterial,
  CanvasTexture,
  DataTexture,
  RedFormat,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  BackSide,
  DoubleSide,
  FrontSide,
  Color,
  Vector2,
  Vector3,
  MathUtils,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { drawFace, normaliseAvatar, avatarKey, hairStyle, hairline, maxHairline, hairPoint, hairGrow, hairTop, headAt, headPoint, HEAD, HANG_FROM, FACE_SPAN } from '../utils/avatar';

// The 3D avatars: chibi people and computer robots, built from a handful of
// low-poly shapes with flat toon shading and ink outlines. Used by the Woono
// table, the avatar maker's turning preview, and the little portraits shown
// in lobbies (rendered once per look and cached).

const INK = '#141414';
const Y_AXIS = new Vector3(0, 1, 0);
export const HEAD_Y = 1.14;
const ROBOT_HEAD_R = 0.5;

// ─── Shared materials & textures ──────────────────────────────────────

export function toonGradient() {
  // Two soft bands: flat, sketchbook-style shading.
  const texture = new DataTexture(new Uint8Array([150, 215, 255]), 3, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

// Inverted-hull outline: the back faces of each mesh, pushed out along their normals, in ink.
export function outlineMaterial(thickness) {
  return new ShaderMaterial({
    uniforms: { thickness: { value: thickness }, color: { value: new Color(INK) } },
    vertexShader: 'uniform float thickness; void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal); p.xyz += n * thickness; gl_Position = projectionMatrix * p; }',
    fragmentShader: 'uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }',
    side: BackSide,
  });
}

// Materials, geometries and textures, made once and shared by every avatar built with the kit.
export class AvatarKit {
  gradient = toonGradient();
  outline = outlineMaterial(0.024);
  outlineThin = outlineMaterial(0.013);
  toons = new Map();
  textures = new Map();
  geometries = new Map();

  toon(color, { double = false, map = null } = {}) {
    const key = `${color}:${double}:${map?.uuid ?? ''}`;
    if (!this.toons.has(key)) this.toons.set(key, new MeshToonMaterial({ color: new Color(color), gradientMap: this.gradient, side: double ? DoubleSide : FrontSide, map }));
    return this.toons.get(key);
  }

  geometry(key, make) {
    if (!this.geometries.has(key)) this.geometries.set(key, make());
    return this.geometries.get(key);
  }

  texture(key, width, height, draw) {
    if (!this.textures.has(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      draw(canvas.getContext('2d'), width, height);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 4;
      this.textures.set(key, texture);
    }
    return this.textures.get(key);
  }

  dispose() {
    for (const m of this.toons.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    for (const g of this.geometries.values()) g.dispose();
    this.outline.dispose();
    this.outlineThin.dispose();
    this.gradient.dispose();
  }
}

// Per-mesh materials (faces, cards, labels) belong to one object; toon
// materials, geometries and textures are shared and stay cached in the kit.
export function disposeGroup(group) {
  group.traverse((obj) => {
    if ((obj.isMesh || obj.isSprite) && (obj.material?.isMeshBasicMaterial || obj.material?.isSpriteMaterial) && !obj.userData.sharedMaterial) {
      if (obj.userData.ownTexture) obj.material.map?.dispose();
      obj.material.dispose();
    }
    obj.userData.faceOpen?.dispose();
    obj.userData.faceClosed?.dispose();
    for (const material of obj.userData.moods?.values() ?? []) material.dispose();
  });
}

export function withOutline(mesh, kit, thin = false) {
  const hull = new Mesh(mesh.geometry, thin ? kit.outlineThin : kit.outline);
  hull.raycast = () => {};
  mesh.add(hull);
  return mesh;
}

function faceTexture(kit, avatar, blink) {
  return kit.texture(`face:${avatarKey(avatar)}:${blink}`, 256, 256, (ctx, w) => drawFace(ctx, avatar, w, { blink }));
}

const darker = (hex, amount = 0.72) => `#${new Color(hex).multiplyScalar(amount).getHexString()}`;

// ─── Head and hair ────────────────────────────────────────────────────

// The outward direction of the head's surface at a point on it.
function headNormal(x, y, z, grow, out = new Vector3()) {
  const p = HEAD.power;
  const g = (v, r) => (Math.sign(v) * Math.abs(v / r) ** (p - 1)) / r;
  return out.set(g(x, HEAD.x + grow), g(y, HEAD.y + grow), g(z, HEAD.z + grow)).normalize();
}

// Pushes every vertex of a unit sphere (or a piece of one) onto the squircle head.
function toHead(geometry, grow = 0) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize();
    const [x, y, z] = headPoint(v.x, v.y, v.z, grow);
    position.setXYZ(i, x, y, z);
    headNormal(x, y, z, grow, v);
    normal.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

// One shell for a hairdo, as a grid running round the head (columns) and
// down from the crown (rows). Rows past the hairline fold back under the
// hair's edge, which reads as its thickness, so the hair ends exactly on the
// hairline however long or jagged it is.
function hairGeometry(style) {
  const cols = 96;
  const rows = 72;
  const most = maxHairline(style) + 0.04;
  const count = (cols + 1) * (rows + 1);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const n = new Vector3();
  const lift = (style.lift ?? 0) * 0.5;
  for (let c = 0; c <= cols; c++) {
    const az = -Math.PI + (c / cols) * Math.PI * 2;
    const reach = hairline(style, az);
    for (let r = 0; r <= rows; r++) {
      const frac = (r / rows) * most;
      const at = Math.min(frac, reach);
      const below = MathUtils.clamp((frac - reach) / 0.04, 0, 1);
      const [x, y, z] = hairPoint(style, az, at);
      if (at > HANG_FROM) n.set(x, 0, z).normalize();
      else headNormal(x, y - lift, z, hairGrow(style, at), n);
      const i = (c * (rows + 1) + r) * 3;
      position[i] = x - n.x * below * 0.07;
      position[i + 1] = y - n.y * below * 0.07;
      position[i + 2] = z - n.z * below * 0.07;
      normal[i] = n.x;
      normal[i + 1] = n.y;
      normal[i + 2] = n.z;
    }
  }
  const index = [];
  const id = (c, r) => c * (rows + 1) + r;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      index.push(id(c, r), id(c, r + 1), id(c + 1, r));
      index.push(id(c, r + 1), id(c + 1, r + 1), id(c + 1, r));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

// ─── Clothes ──────────────────────────────────────────────────────────

// Body outlines as [radius, height] from the hem up; filled in evenly so patterns don't stretch.
const TORSO = [[0.245, 0.29], [0.24, 0.34], [0.228, 0.42], [0.215, 0.5], [0.205, 0.58], [0.198, 0.64], [0.18, 0.69], [0.14, 0.725], [0.07, 0.742]];
const DRESS = [[0.34, 0.12], [0.31, 0.2], [0.275, 0.3], [0.24, 0.4], [0.215, 0.5], [0.205, 0.58], [0.198, 0.64], [0.18, 0.69], [0.14, 0.725], [0.07, 0.742]];
const SKIRT = [[0.33, 0.14], [0.3, 0.2], [0.265, 0.28], [0.24, 0.34]];

function resample(points, steps) {
  const out = [];
  const from = points[0][1];
  const to = points[points.length - 1][1];
  let k = 0;
  for (let i = 0; i <= steps; i++) {
    const y = from + ((to - from) * i) / steps;
    while (k < points.length - 2 && points[k + 1][1] < y) k++;
    const [r0, y0] = points[k];
    const [r1, y1] = points[k + 1];
    out.push(new Vector2(MathUtils.lerp(r0, r1, MathUtils.clamp((y - y0) / (y1 - y0), 0, 1)), y));
  }
  return out;
}

// A solid of revolution; `caps` closes the bottom and top onto the axis.
function lathe(points, { scale = 1, caps = true, phiStart = 0, phiLength = Math.PI * 2, steps = 14 } = {}) {
  const profile = resample(points, steps).map((p) => new Vector2(p.x * scale, p.y));
  if (caps) {
    profile.unshift(new Vector2(0, profile[0].y));
    profile.push(new Vector2(0, profile[profile.length - 1].y + 0.004));
  }
  return new LatheGeometry(profile, 28, phiStart, phiLength);
}

// Stripes, spots, checks or a print on the front, in the accent colour.
function patternTexture(kit, a) {
  const texture = kit.texture(`pattern:${a.pattern}:${a.shirt}:${a.accent}`, 256, 128, (ctx, w, h) => {
    ctx.fillStyle = a.shirt;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = a.accent;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    switch (a.pattern) {
      case 'stripes':
        for (let y = 4; y < h; y += 22) ctx.fillRect(0, y, w, 10);
        break;
      case 'spots':
        for (let row = 0; row < 6; row++) {
          for (let col = 0; col < 12; col++) {
            ctx.beginPath();
            ctx.arc(((col + (row % 2) * 0.5) * w) / 12, 10 + row * 22, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      case 'checks':
        ctx.globalAlpha = 0.6;
        for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) if ((x + y) % 32 === 0) ctx.fillRect(x, y, 16, 16);
        break;
      case 'star':
      case 'heart':
        // The print sits on the chest, where the seam at u = 0 meets u = 1.
        for (const x of [0, w]) {
          ctx.beginPath();
          if (a.pattern === 'star') {
            for (let i = 0; i < 10; i++) {
              const radius = i % 2 ? 9 : 22;
              const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
              ctx.lineTo(x + Math.cos(angle) * radius * 0.5, h * 0.36 + Math.sin(angle) * radius);
            }
            ctx.closePath();
          } else {
            const y = h * 0.34;
            ctx.moveTo(x, y + 18);
            ctx.bezierCurveTo(x - 14, y + 2, x - 7, y - 12, x, y - 4);
            ctx.bezierCurveTo(x + 7, y - 12, x + 14, y + 2, x, y + 18);
          }
          ctx.fill();
          ctx.stroke();
        }
        break;
      default:
        break;
    }
  });
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

// ─── People ───────────────────────────────────────────────────────────

// A chibi person, facing +z, standing on y = 0: a big squircle head on a short
// straight body, with stubby arms and legs.
function buildHuman(avatar, kit, group) {
  const skin = kit.toon(avatar.skin);
  const shirt = kit.toon(avatar.shirt);
  const printed = avatar.pattern === 'plain' ? shirt : kit.toon('#FFFFFF', { map: patternTexture(kit, avatar) });
  const accent = kit.toon(avatar.accent);
  const pants = kit.toon(avatar.pants);
  const shoes = kit.toon(avatar.shoeColor);
  const hatColor = kit.toon(avatar.hatColor);
  const hairDouble = kit.toon(avatar.hairColor, { double: true });
  const hair = kit.toon(avatar.hairColor);
  const white = kit.toon('#F4F4F2');
  const dark = kit.toon('#26262C');
  const metal = kit.toon('#D9DDE3');
  const gold = kit.toon('#E3C15A');
  const pink = kit.toon('#FF9FB5');
  const red = kit.toon('#E5484D');

  const add = (geometry, material, parent, { position, rotation, scale, thin = true, outline = true } = {}) => {
    const mesh = new Mesh(geometry, material);
    if (outline) withOutline(mesh, kit, thin);
    if (position) mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    if (scale) mesh.scale.set(...scale);
    parent.add(mesh);
    return mesh;
  };
  // A shape pointing along `dir`, for spikes, ears and horns.
  const point = (geometry, material, parent, position, dir, scale) => {
    const mesh = add(geometry, material, parent, { position, scale });
    mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.clone().normalize());
    return mesh;
  };
  const sphere = (r, w = 12, h = 8) => kit.geometry(`sphere:${r}:${w}`, () => new SphereGeometry(r, w, h));

  const { top, bottom } = avatar;
  const dress = top === 'dress';

  // Legs and shoes.
  const trousers = bottom === 'trousers' && !dress;
  for (const side of [-1, 1]) {
    const x = side * 0.095;
    add(kit.geometry('leg', () => new CylinderGeometry(0.066, 0.06, 0.26, 12)), trousers ? pants : skin, group, { position: [x, 0.19, 0] });
    if (bottom === 'shorts' && !dress) add(kit.geometry('shorts-leg', () => new CylinderGeometry(0.09, 0.085, 0.1, 12)), pants, group, { position: [x, 0.27, 0] });
    switch (avatar.shoes) {
      case 'boots':
        add(kit.geometry('boot', () => new CylinderGeometry(0.08, 0.086, 0.15, 12)), shoes, group, { position: [x, 0.1, 0] });
        add(sphere(0.1), shoes, group, { position: [x, 0.045, 0.04], scale: [0.85, 0.5, 1.2] });
        break;
      case 'flats':
        add(sphere(0.1), shoes, group, { position: [x, 0.035, 0.03], scale: [0.72, 0.38, 1.12] });
        break;
      default:
        add(sphere(0.1), shoes, group, { position: [x, 0.055, 0.03], scale: [0.8, 0.55, 1.2] });
        add(kit.geometry('sole', () => new CylinderGeometry(0.085, 0.085, 0.025, 14)), white, group, { position: [x, 0.018, 0.035], scale: [0.95, 1, 1.4] });
    }
  }
  if (bottom === 'skirt' && !dress) add(kit.geometry('skirt', () => lathe(SKIRT, { steps: 6 })), pants, group, { scale: [1, 1, 0.84] });

  // The body: straight down with a slight flare at the hem.
  const bodyScale = [1, 1, 0.8];
  const innerColour = top === 'jacket' ? accent : printed;
  const body = add(kit.geometry(dress ? 'dress' : 'torso', () => lathe(dress ? DRESS : TORSO, { steps: 16 })), innerColour, group, { scale: bodyScale, thin: false });

  switch (top) {
    case 'hoodie':
      add(kit.geometry('hood', () => new TorusGeometry(0.14, 0.065, 8, 18)), shirt, group, { position: [0, 0.73, -0.1], rotation: [Math.PI / 2 - 0.5, 0, 0], scale: [1.15, 1, 1] });
      add(kit.geometry('pocket', () => new RoundedBoxGeometry(0.26, 0.1, 0.04, 2, 0.015)), shirt, group, { position: [0, 0.4, 0.185] });
      for (const side of [-1, 1]) add(kit.geometry('string', () => new CylinderGeometry(0.012, 0.012, 0.13, 6)), accent, group, { position: [side * 0.05, 0.62, 0.165] });
      break;
    case 'sweater':
      add(kit.geometry('turtleneck', () => new CylinderGeometry(0.12, 0.13, 0.09, 16)), shirt, group, { position: [0, 0.755, 0] });
      break;
    case 'jacket':
      add(kit.geometry('jacket', () => lathe(TORSO, { scale: 1.07, caps: false, phiStart: 0.34, phiLength: Math.PI * 2 - 0.68, steps: 16 })), kit.toon(avatar.shirt, { double: true }), group, { scale: bodyScale, thin: false });
      break;
    case 'sailor':
      add(kit.geometry('sailor-collar', () => lathe([[0.215, 0.6], [0.205, 0.65], [0.185, 0.695], [0.145, 0.73], [0.1, 0.748]], { scale: 1.06, caps: false, steps: 5 })), kit.toon(avatar.accent, { double: true }), group, { scale: bodyScale });
      for (const side of [-1, 1]) add(kit.geometry('bow-wing', () => new ConeGeometry(0.05, 0.1, 4)), red, group, { position: [side * 0.05, 0.62, 0.17], rotation: [0, 0, side * (Math.PI / 2)], scale: [1, 1, 0.4] });
      break;
    case 'overalls':
      add(kit.geometry('overall-band', () => lathe([[0.25, 0.285], [0.245, 0.34], [0.236, 0.4]], { scale: 1.03, caps: false, steps: 4 })), kit.toon(avatar.pants, { double: true }), group, { scale: bodyScale, thin: false });
      add(kit.geometry('bib', () => new RoundedBoxGeometry(0.22, 0.17, 0.035, 2, 0.012)), pants, group, { position: [0, 0.47, 0.18] });
      for (const side of [-1, 1]) {
        add(kit.geometry('strap', () => new RoundedBoxGeometry(0.04, 0.2, 0.02, 1, 0.006)), pants, group, { position: [side * 0.08, 0.62, 0.155], rotation: [-0.35, 0, 0] });
        add(sphere(0.018, 8, 6), gold, group, { position: [side * 0.08, 0.54, 0.2], outline: false });
      }
      break;
    default:
      break;
  }

  switch (avatar.neck) {
    case 'scarf':
      add(kit.geometry('scarf', () => new TorusGeometry(0.15, 0.06, 8, 20)), accent, group, { position: [0, 0.74, 0], rotation: [Math.PI / 2, 0, 0], scale: [1.1, 1, 1] });
      add(kit.geometry('scarf-tail', () => new CapsuleGeometry(0.045, 0.16, 4, 8)), accent, group, { position: [0.09, 0.6, 0.17], rotation: [0.2, 0, 0.15] });
      break;
    case 'tie':
      add(kit.geometry('tie', () => new ConeGeometry(0.055, 0.24, 4)), accent, group, { position: [0, 0.6, 0.172], rotation: [Math.PI + 0.1, Math.PI / 4, 0], scale: [1, 1, 0.35] });
      break;
    case 'bowtie':
      for (const side of [-1, 1]) add(kit.geometry('bow-wing', () => new ConeGeometry(0.05, 0.1, 4)), accent, group, { position: [side * 0.045, 0.7, 0.155], rotation: [0, 0, side * (Math.PI / 2)], scale: [1, 1, 0.4] });
      add(sphere(0.025, 8, 6), accent, group, { position: [0, 0.7, 0.16] });
      break;
    case 'choker':
    case 'bell':
      add(kit.geometry('choker', () => new TorusGeometry(0.15, 0.024, 6, 20)), avatar.neck === 'bell' ? red : dark, group, { position: [0, 0.712, 0], rotation: [Math.PI / 2, 0, 0], scale: [1, 0.85, 1] });
      if (avatar.neck === 'bell') add(sphere(0.045), gold, group, { position: [0, 0.655, 0.155] });
      break;
    case 'necklace':
      add(kit.geometry('necklace', () => new TorusGeometry(0.15, 0.01, 6, 24)), gold, group, { position: [0, 0.67, 0.03], rotation: [Math.PI / 2 - 0.45, 0, 0], scale: [1, 0.85, 1], outline: false });
      add(kit.geometry('gem', () => new ConeGeometry(0.04, 0.08, 4)), accent, group, { position: [0, 0.58, 0.18], rotation: [Math.PI, 0, 0] });
      break;
    case 'bandana':
      add(kit.geometry('bandana', () => new ConeGeometry(0.15, 0.2, 3)), accent, group, { position: [0, 0.63, 0.16], rotation: [Math.PI, 0, 0], scale: [1, 1, 0.3] });
      break;
    default:
      break;
  }

  switch (avatar.back) {
    case 'backpack':
      add(kit.geometry('backpack', () => new RoundedBoxGeometry(0.3, 0.32, 0.14, 3, 0.05)), accent, group, { position: [0, 0.5, -0.24], thin: false });
      add(kit.geometry('backpack-pocket', () => new RoundedBoxGeometry(0.2, 0.1, 0.05, 2, 0.02)), accent, group, { position: [0, 0.42, -0.32] });
      for (const side of [-1, 1]) add(kit.geometry('strap', () => new RoundedBoxGeometry(0.04, 0.2, 0.02, 1, 0.006)), accent, group, { position: [side * 0.1, 0.6, 0.155], rotation: [-0.35, 0, 0] });
      break;
    case 'wings':
      for (const side of [-1, 1]) {
        add(sphere(0.2, 16, 10), white, group, { position: [side * 0.24, 0.64, -0.24], rotation: [0, side * 0.5, side * -0.55], scale: [1.15, 0.6, 0.12] });
        add(sphere(0.2, 16, 10), white, group, { position: [side * 0.2, 0.5, -0.23], rotation: [0, side * 0.5, side * -0.3], scale: [0.8, 0.42, 0.12] });
      }
      break;
    case 'bat-wings':
      for (const side of [-1, 1]) add(kit.geometry('bat-wing', () => new ConeGeometry(0.2, 0.38, 3)), kit.toon('#3B2A4A'), group, { position: [side * 0.26, 0.6, -0.2], rotation: [0, 0, side * -1.1], scale: [1, 1, 0.12] });
      break;
    case 'cape':
      add(kit.geometry('cape', () => lathe([[0.34, 0.14], [0.3, 0.35], [0.255, 0.55], [0.215, 0.7], [0.15, 0.755]], { caps: false, phiStart: Math.PI / 2 + 0.2, phiLength: Math.PI - 0.4, steps: 10 })), kit.toon(avatar.accent, { double: true }), group, { scale: [1.05, 1, 0.9] });
      break;
    case 'cat-tail':
      add(kit.geometry('cat-tail', () => new TubeGeometry(new CatmullRomCurve3([new Vector3(0, 0.34, -0.18), new Vector3(0, 0.28, -0.4), new Vector3(0.05, 0.42, -0.52), new Vector3(0.12, 0.62, -0.5), new Vector3(0.1, 0.72, -0.42)]), 20, 0.035, 8)), hair, group);
      break;
    case 'fox-tail':
      add(kit.geometry('fox-tail', () => new CapsuleGeometry(0.12, 0.3, 6, 12)), hair, group, { position: [0, 0.42, -0.36], rotation: [-1.0, 0, 0] });
      add(sphere(0.1, 12, 10), white, group, { position: [0, 0.56, -0.58], scale: [1, 1.15, 1] });
      break;
    default:
      break;
  }

  // Arms hang from the shoulders; the pivot sits at the shoulder so they swing from there.
  const longSleeves = ['long', 'sweater', 'hoodie', 'jacket'].includes(top);
  const shortSleeves = ['tee', 'sailor', 'dress', 'overalls'].includes(top);
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new Group();
    shoulder.position.set(side * 0.215, 0.665, 0);
    shoulder.rotation.set(-1.0, 0, side * 0.3);
    group.add(shoulder);
    const arm = add(kit.geometry('arm', () => new CapsuleGeometry(0.05, 0.15, 4, 8)), longSleeves ? shirt : skin, shoulder, { position: [0, -0.1, 0] });
    if (shortSleeves) {
      add(kit.geometry('sleeve', () => new CylinderGeometry(0.068, 0.066, 0.09, 12)), shirt, shoulder, { position: [0, -0.035, 0] });
      // A rounded cap over the top of the shoulder, where the sleeve meets the body, so no skin pokes through.
      add(sphere(0.072, 12, 8), shirt, shoulder, { position: [0, 0.005, 0], scale: [1, 0.85, 1] });
    }
    const hand = add(sphere(0.06, 10, 8), skin, shoulder, { position: [0, -0.2, 0] });
    shoulder.userData = { arm, hand, reach: 0.2 };
    arms.push(shoulder);
  }

  // The head, with the face drawn onto a patch of its surface.
  const head = new Group();
  // Turn first, then nod, then tilt: how a head actually looks around.
  head.rotation.order = 'YXZ';
  head.position.y = HEAD_Y;
  group.add(head);
  add(kit.geometry('head', () => toHead(new SphereGeometry(1, 40, 28))), skin, head, { thin: false });
  const piercings = new Set(avatar.piercings);
  for (const side of [-1, 1]) {
    const x = side * (HEAD.x - 0.015);
    add(sphere(0.1), skin, head, { position: [x, -0.05, 0.02], scale: [0.45, 0.8, 0.62] });
    if (piercings.has('ear-studs')) add(sphere(0.02, 8, 6), metal, head, { position: [x + side * 0.04, -0.11, 0.05], outline: false });
    if (piercings.has('ear-hoops')) add(kit.geometry('hoop', () => new TorusGeometry(0.04, 0.01, 6, 16)), gold, head, { position: [x + side * 0.04, -0.15, 0.04], rotation: [0, Math.PI / 2, 0], outline: false });
    if (piercings.has('cartilage')) add(kit.geometry('hoop-small', () => new TorusGeometry(0.03, 0.008, 6, 14)), metal, head, { position: [x + side * 0.045, 0.03, 0], rotation: [0, Math.PI / 2, 0], outline: false });
  }
  const faceGeometry = kit.geometry('face', () => toHead(new SphereGeometry(1, 28, 20, Math.PI / 2 - FACE_SPAN.az, FACE_SPAN.az * 2, Math.PI / 2 - FACE_SPAN.polar, FACE_SPAN.polar * 2), 0.008));
  const face = new Mesh(faceGeometry, new MeshBasicMaterial({ map: faceTexture(kit, avatar, 0), transparent: true, alphaTest: 0.35, depthWrite: false }));
  face.renderOrder = 1;
  head.add(face);

  if (avatar.mask === 'fox') {
    const [x, y, z] = headAt(0.95, Math.PI * 0.4, 0.05);
    const mask = new Group();
    mask.position.set(x, y, z);
    mask.rotation.set(0, 0.95, 0.25);
    head.add(mask);
    add(sphere(0.18, 16, 12), white, mask, { scale: [1, 1.05, 0.45] });
    for (const side of [-1, 1]) {
      add(kit.geometry('fox-ear', () => new ConeGeometry(0.06, 0.13, 4)), white, mask, { position: [side * 0.1, 0.17, 0], rotation: [0, 0, side * -0.3], scale: [1, 1, 0.5] });
      add(sphere(0.022, 8, 6), red, mask, { position: [side * 0.07, 0.03, 0.08], scale: [1.6, 0.6, 0.5], outline: false });
    }
    add(sphere(0.025, 8, 6), dark, mask, { position: [0, -0.07, 0.085], outline: false });
  }

  const style = hairStyle(avatar.hair);
  const crown = hairTop(style);
  const surface = style.none ? { volume: 1, front: 1, side: 1, back: 1, none: true } : style;
  const on = (az, frac, out = 0) => hairPoint(surface, az, frac, out);
  if (!style.none) {
    // Shaved sides: stubble, somewhere between the skin and the hair colour.
    if (style.under) add(kit.geometry(`hair:${style.id}:under`, () => hairGeometry(style.under)), kit.toon(`#${new Color(avatar.skin).lerp(new Color(avatar.hairColor), 0.45).getHexString()}`, { double: true }), head);
    add(kit.geometry(`hair:${style.id}`, () => hairGeometry(style)), hairDouble, head, { thin: false });
    style.layers?.forEach((layer, i) => add(kit.geometry(`hair:${style.id}:${i}`, () => hairGeometry(layer)), hairDouble, head));
    const cone = kit.geometry('hair-spike', () => new ConeGeometry(0.1, 0.34, 6));
    if (style.crown) {
      for (let i = 0; i < 7; i++) {
        const az = (i / 7) * Math.PI * 2 + 0.3;
        const at = on(az, 0.17, -0.04);
        point(cone, hair, head, at, new Vector3(...at).normalize().add(new Vector3(0, 0.5, -0.35)), [0.9, 1.05, 0.5]);
      }
    }
    if (style.fin) {
      // A mohawk: one tall crest of overlapping blades from the forehead to the nape.
      for (let i = 0; i <= 10; i++) {
        const s = -1 + (i / 10) * 2;
        const at = on(s < 0 ? 0 : Math.PI, Math.abs(s) * (s < 0 ? 0.3 : 0.5), -0.05);
        const height = 0.8 + Math.cos((s * Math.PI) / 2.4) * 1.1;
        point(cone, hair, head, at, new Vector3(...at).normalize().add(new Vector3(0, 0.25, -0.3)), [0.28, height, 1.7]);
      }
    }
    if (style.quiff) add(sphere(0.24, 18, 12), hair, head, { position: [0.02, crown - 0.03, HEAD.z * 0.5], scale: [1.3, 0.78, 1.1] });
    const tie = (position, size = 1) => add(sphere(0.065, 10, 8), accent, head, { position, scale: [size, size, size] });
    if (style.ponytail) {
      const at = on(Math.PI, 0.36, 0.01);
      tie(at);
      add(kit.geometry('tail', () => new CapsuleGeometry(0.11, 0.4, 4, 10)), hair, head, { position: [0, at[1] - 0.3, at[2] - 0.12], rotation: [0.35, 0, 0] });
    }
    if (style.twintails) {
      for (const side of [-1, 1]) {
        const at = on(side * Math.PI * 0.62, 0.34, 0.01);
        tie(at);
        add(kit.geometry('twintail', () => new CapsuleGeometry(0.11, 0.48, 4, 10)), hair, head, { position: [at[0] + side * 0.1, at[1] - 0.34, at[2] - 0.02], rotation: [0.12, 0, side * 0.18] });
      }
    }
    if (style.braid) {
      const at = on(Math.PI, 0.56, -0.02);
      for (let i = 0; i < 5; i++) add(sphere(0.1, 12, 8), hair, head, { position: [0, at[1] - i * 0.13, at[2] - 0.02 - i * 0.02], scale: [1 - i * 0.08, 0.9, 0.9] });
      tie([0, at[1] - 0.66, at[2] - 0.12], 0.8);
    }
    if (style.bun) add(sphere(0.19, 14, 10), hair, head, { position: [0, crown - 0.04, -0.3] });
    if (style.buns) for (const side of [-1, 1]) add(sphere(0.16, 14, 10), hair, head, { position: [side * 0.3, crown - 0.08, -0.02] });
  }
  if (avatar.ahoge && !style.none) {
    const strand = kit.geometry(`ahoge:${crown.toFixed(3)}`, () => new TubeGeometry(new CatmullRomCurve3([new Vector3(0, crown - 0.04, 0.04), new Vector3(0.01, crown + 0.14, 0.07), new Vector3(0.1, crown + 0.27, 0.03), new Vector3(0.2, crown + 0.22, -0.03)]), 16, 0.03, 6));
    add(strand, hair, head);
  }

  buildHat(avatar, kit, head, { add, point, sphere, on, style, crown, hair, hatColor, white, dark, gold, pink });
  // Cards are held at the chest, low enough to clear the chin and far enough out to clear the belly.
  return { head, body, face, arms, hold: { y: 0.46, z: 0.27, grip: 0.09 } };
}

function buildHat(avatar, kit, head, { add, point, sphere, on, style, crown, hair, hatColor, white, dark, gold, pink }) {
  // Hats sit over the puffiest layer of hair.
  const grow = style.none ? 0 : Math.max(hairGrow(style, 0), ...(style.layers ?? []).map((layer) => hairGrow(layer, 0))) + (style.lift ?? 0) * 0.5;
  // A cap of the head's own shape, `down` (as a fraction of π) from the crown.
  const shell = (key, down, out) => kit.geometry(`shell:${key}:${grow.toFixed(3)}`, () => toHead(new SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI * down), grow + out));
  const band = (key, from, to, out) => kit.geometry(`band:${key}:${grow.toFixed(3)}`, () => toHead(new SphereGeometry(1, 32, 3, 0, Math.PI * 2, Math.PI * from, Math.PI * (to - from)), grow + out));
  const rim = (down, out) => headAt(0, Math.PI * down, grow + out);
  const front = HEAD.z + grow;

  switch (avatar.hat) {
    case 'cap': {
      add(shell('cap', 0.45, 0.035), hatColor, head);
      const [, y] = rim(0.45, 0.035);
      add(kit.geometry('brim', () => new CylinderGeometry(0.3, 0.3, 0.03, 20)), hatColor, head, { position: [0, y + 0.02, front + 0.12], rotation: [0.12, 0, 0], scale: [1, 1, 0.8] });
      add(sphere(0.035, 8, 6), hatColor, head, { position: [0, crown + 0.03, 0] });
      break;
    }
    case 'beanie':
      add(shell('beanie', 0.5, 0.05), hatColor, head, { thin: false });
      add(band('beanie-cuff', 0.38, 0.5, 0.08), kit.toon(darker(avatar.hatColor, 0.8)), head);
      add(sphere(0.1, 12, 10), white, head, { position: [0, crown + 0.12, 0] });
      break;
    case 'bucket': {
      add(shell('bucket', 0.44, 0.045), hatColor, head, { thin: false });
      const [, y] = rim(0.44, 0.045);
      add(kit.geometry('bucket-brim', () => new CylinderGeometry(HEAD.x + 0.02, HEAD.x + 0.2, 0.1, 32, 1, true)), kit.toon(avatar.hatColor, { double: true }), head, { position: [0, y - 0.03, 0], scale: [1 + grow, 1, (HEAD.z + 0.1) / (HEAD.x + 0.1) + grow] });
      break;
    }
    case 'pail': {
      // An actual bucket, upside down and jammed on, with its handle swung round the back.
      const [, y] = rim(0.42, 0.05);
      const depth = (HEAD.z + grow + 0.06) / (HEAD.x + grow + 0.06);
      const pail = new Group();
      pail.position.set(0, y - 0.02, 0);
      pail.rotation.z = 0.06;
      pail.scale.set(1, 1, depth);
      head.add(pail);
      const bottom = HEAD.x + grow + 0.06;
      const height = crown - y + 0.2;
      add(kit.geometry(`pail:${bottom.toFixed(3)}:${height.toFixed(3)}`, () => new CylinderGeometry(bottom * 0.78, bottom, height, 28, 1, true)), kit.toon(avatar.hatColor, { double: true }), pail, { position: [0, height / 2, 0], thin: false });
      add(kit.geometry(`pail-top:${bottom.toFixed(3)}`, () => new CircleGeometry(bottom * 0.78, 28)), hatColor, pail, { position: [0, height, 0], rotation: [-Math.PI / 2, 0, 0], outline: false });
      add(kit.geometry(`pail-lip:${bottom.toFixed(3)}`, () => new TorusGeometry(bottom, 0.025, 6, 32)), kit.toon(darker(avatar.hatColor, 0.8)), pail, { rotation: [Math.PI / 2, 0, 0] });
      const handle = new Group();
      handle.position.set(0, height * 0.45, 0);
      handle.rotation.x = -(Math.PI / 2 + 0.35);
      pail.add(handle);
      const reach = bottom * 0.9 + 0.02;
      add(kit.geometry(`pail-handle:${reach.toFixed(3)}`, () => new TorusGeometry(reach, 0.014, 6, 24, Math.PI)), kit.toon('#B8BEC8'), handle);
      for (const side of [-1, 1]) add(sphere(0.035, 8, 6), kit.toon('#B8BEC8'), pail, { position: [side * reach, height * 0.45, 0] });
      break;
    }
    case 'traffic-cone': {
      // Sits a little crooked, as a traffic cone on someone's head should.
      const orange = kit.toon('#FF7A1A');
      const cone = new Group();
      cone.position.set(0.02, crown - 0.02, 0);
      cone.rotation.set(-0.06, 0, -0.14);
      head.add(cone);
      const tall = 0.72;
      const base = 0.27;
      const radiusAt = (h) => base * (1 - h / tall);
      add(kit.geometry('cone-base', () => new RoundedBoxGeometry(0.62, 0.06, 0.62, 2, 0.02)), kit.toon('#E0600B'), cone, { position: [0, 0.03, 0], thin: false });
      add(kit.geometry('cone', () => new ConeGeometry(base, tall, 24)), orange, cone, { position: [0, 0.06 + tall / 2, 0], thin: false });
      for (const [from, to] of [[0.2, 0.3], [0.4, 0.48]]) {
        add(kit.geometry(`cone-stripe:${from}`, () => new CylinderGeometry(radiusAt(to) + 0.006, radiusAt(from) + 0.006, to - from, 24, 1, true)), white, cone, { position: [0, 0.06 + (from + to) / 2, 0], outline: false });
      }
      break;
    }
    case 'beret':
      add(sphere(0.5, 24, 12), hatColor, head, { position: [0.06, crown - 0.03, -0.02], rotation: [0, 0, -0.18], scale: [1.18 + grow, 0.32, 1.1 + grow], thin: false });
      add(kit.geometry('beret-stem', () => new CylinderGeometry(0.015, 0.02, 0.07, 6)), hatColor, head, { position: [0.02, crown + 0.14, -0.02] });
      break;
    case 'straw': {
      const straw = kit.toon('#E8C872');
      add(kit.geometry('straw-brim', () => new CylinderGeometry(0.8, 0.82, 0.03, 36)), straw, head, { position: [0, crown - 0.1, 0], thin: false });
      add(kit.geometry('straw-crown', () => new CylinderGeometry(0.34, 0.38, 0.2, 24)), straw, head, { position: [0, crown + 0.0, 0] });
      add(kit.geometry('straw-band', () => new CylinderGeometry(0.385, 0.385, 0.06, 24, 1, true)), kit.toon(avatar.hatColor, { double: true }), head, { position: [0, crown - 0.05, 0], outline: false });
      break;
    }
    case 'tophat':
      add(kit.geometry('tophat-brim', () => new CylinderGeometry(0.48, 0.48, 0.03, 32)), hatColor, head, { position: [0, crown - 0.04, 0], thin: false });
      add(kit.geometry('tophat', () => new CylinderGeometry(0.29, 0.27, 0.46, 24)), hatColor, head, { position: [0, crown + 0.2, 0], thin: false });
      add(kit.geometry('tophat-band', () => new CylinderGeometry(0.275, 0.275, 0.07, 24, 1, true)), dark, head, { position: [0, crown + 0.03, 0], outline: false });
      break;
    case 'witch':
      add(kit.geometry('witch-brim', () => new CylinderGeometry(0.62, 0.64, 0.03, 32)), hatColor, head, { position: [0, crown - 0.06, 0], thin: false });
      add(kit.geometry('witch-cone', () => new ConeGeometry(0.36, 0.74, 24)), hatColor, head, { position: [0, crown + 0.3, -0.04], rotation: [-0.2, 0, 0.12], thin: false });
      add(kit.geometry('witch-band', () => new CylinderGeometry(0.335, 0.35, 0.06, 24, 1, true)), gold, head, { position: [0, crown - 0.0, -0.01], rotation: [-0.03, 0, 0.02], outline: false });
      break;
    case 'party': {
      const tilt = -0.28;
      add(kit.geometry('party', () => new ConeGeometry(0.16, 0.42, 20)), hatColor, head, { position: [0.1, crown + 0.15, 0], rotation: [0, 0, tilt] });
      add(sphere(0.055, 10, 8), white, head, { position: [0.1 - Math.sin(tilt) * 0.22, crown + 0.15 + Math.cos(tilt) * 0.22, 0] });
      break;
    }
    case 'frog':
      add(shell('frog', 0.45, 0.04), hatColor, head, { thin: false });
      for (const side of [-1, 1]) {
        add(sphere(0.12, 14, 10), white, head, { position: [side * 0.2, crown + 0.05, 0.16] });
        add(sphere(0.05, 10, 8), dark, head, { position: [side * 0.2, crown + 0.07, 0.27], outline: false });
      }
      break;
    case 'cat-ears':
      for (const side of [-1, 1]) {
        point(kit.geometry('cat-ear', () => new ConeGeometry(0.15, 0.3, 4)), hair, head, on(side * 0.62, 0.2, -0.03), new Vector3(side * 0.35, 1, 0), [1, 1, 0.45]);
        point(kit.geometry('cat-ear-inner', () => new ConeGeometry(0.08, 0.18, 4)), pink, head, on(side * 0.56, 0.19, 0.03), new Vector3(side * 0.35, 1, 0.25), [1, 1, 0.3]);
      }
      break;
    case 'bear-ears':
      for (const side of [-1, 1]) {
        const at = on(side * 0.72, 0.24, 0.02);
        add(sphere(0.13, 14, 10), hair, head, { position: at, scale: [1, 1, 0.5] });
        add(sphere(0.07, 10, 8), pink, head, { position: [at[0], at[1], at[2] + 0.05], scale: [1, 1, 0.3], outline: false });
      }
      break;
    case 'bunny-ears':
      for (const side of [-1, 1]) {
        const at = on(side * 0.3, 0.1, 0);
        add(kit.geometry('bunny-ear', () => new CapsuleGeometry(0.07, 0.34, 4, 10)), hatColor, head, { position: [at[0] + side * 0.05, at[1] + 0.22, at[2]], rotation: [0, 0, side * -0.2], scale: [1, 1, 0.45] });
        add(kit.geometry('bunny-inner', () => new CapsuleGeometry(0.035, 0.26, 4, 8)), pink, head, { position: [at[0] + side * 0.05, at[1] + 0.22, at[2] + 0.03], rotation: [0, 0, side * -0.2], scale: [1, 1, 0.3], outline: false });
      }
      break;
    case 'horns':
      for (const side of [-1, 1]) point(kit.geometry('horn', () => new ConeGeometry(0.07, 0.3, 8)), kit.toon('#E8E1CF'), head, on(side * 0.55, 0.2, -0.03), new Vector3(side * 0.6, 1, 0.3), [1, 1, 1]);
      break;
    case 'crown': {
      const goldCrown = kit.toon('#F2C230');
      add(kit.geometry('crown-band', () => new CylinderGeometry(0.2, 0.22, 0.1, 16, 1, true)), kit.toon('#F2C230', { double: true }), head, { position: [0, crown + 0.02, 0] });
      for (let i = 0; i < 5; i++) {
        const t = (i / 5) * Math.PI * 2;
        add(kit.geometry('crown-point', () => new ConeGeometry(0.05, 0.12, 4)), goldCrown, head, { position: [Math.sin(t) * 0.2, crown + 0.12, Math.cos(t) * 0.2] });
      }
      break;
    }
    case 'halo': {
      const halo = new Mesh(kit.geometry('halo', () => new TorusGeometry(0.28, 0.035, 8, 28)), kit.toon('#F5C518'));
      halo.position.set(0, crown + 0.22, 0);
      halo.rotation.x = Math.PI / 2;
      head.add(halo);
      break;
    }
    case 'headband':
    case 'headphones': {
      const phones = avatar.hat === 'headphones';
      const out = phones ? 0.05 : 0.02;
      add(kit.geometry(`arch:${phones}`, () => new TorusGeometry(1, phones ? 0.04 : 0.035, 8, 32, Math.PI)), hatColor, head, { position: [0, 0, phones ? 0 : 0.08], scale: [HEAD.x + grow + out, HEAD.y + grow + out, 1] });
      if (phones) for (const side of [-1, 1]) add(kit.geometry('cup', () => new CylinderGeometry(0.14, 0.14, 0.1, 16)), dark, head, { position: [side * (HEAD.x + grow + 0.03), 0, 0], rotation: [0, 0, Math.PI / 2] });
      break;
    }
    case 'bow': {
      const at = on(0.5, 0.2, 0.03);
      for (const side of [-1, 1]) add(kit.geometry('hair-bow', () => new ConeGeometry(0.1, 0.18, 4)), hatColor, head, { position: [at[0] + side * 0.09, at[1], at[2]], rotation: [0, 0, side * (Math.PI / 2)] });
      add(sphere(0.04, 8, 6), hatColor, head, { position: at });
      break;
    }
    case 'flower': {
      const at = on(0.6, 0.3, 0.03);
      for (let i = 0; i < 5; i++) {
        const t = (i / 5) * Math.PI * 2;
        add(sphere(0.055, 10, 8), kit.toon('#FFB3C7'), head, { position: [at[0] + Math.cos(t) * 0.07, at[1] + Math.sin(t) * 0.07, at[2]], outline: false });
      }
      add(sphere(0.04, 8, 6), kit.toon('#F2C230'), head, { position: [at[0], at[1], at[2] + 0.03] });
      break;
    }
    case 'leaf':
      add(kit.geometry('leaf', () => new ConeGeometry(0.1, 0.28, 6)), kit.toon('#6DBE45'), head, { position: [0.04, crown + 0.1, 0.02], rotation: [0.2, 0, -0.5], scale: [1, 1, 0.25] });
      add(kit.geometry('leaf-stem', () => new CylinderGeometry(0.012, 0.012, 0.08, 5)), kit.toon('#4E8A30'), head, { position: [-0.03, crown - 0.0, 0.0], rotation: [0, 0, -0.5] });
      break;
    case 'clips':
      for (const [frac, tilt] of [[0.3, 0.5], [0.37, 0.25]]) {
        const at = on(-0.5, frac, 0.02);
        add(kit.geometry('clip', () => new RoundedBoxGeometry(0.12, 0.03, 0.02, 1, 0.008)), hatColor, head, { position: at, rotation: [0, -0.5, tilt] });
      }
      break;
    case 'goggles':
      add(band('goggles', 0.3, 0.38, 0.03), dark, head);
      for (const side of [-1, 1]) {
        const at = on(side * 0.28, 0.33, 0.07);
        const lens = point(kit.geometry('goggle', () => new CylinderGeometry(0.1, 0.1, 0.06, 18)), gold, head, at, new Vector3(...at).normalize(), [1, 1, 1]);
        add(kit.geometry('goggle-glass', () => new CircleGeometry(0.075, 18)), kit.toon('#7FC8E8'), lens, { position: [0, 0.031, 0], rotation: [-Math.PI / 2, 0, 0], outline: false });
      }
      break;
    default:
      break;
  }
}

// ─── Robots ───────────────────────────────────────────────────────────

// A small robot for computer players: boxy (or domed) head with a screen for
// a face, an antenna that glows in its accent colour, and a metal body.
function buildRobot(avatar, kit, group) {
  const metal = kit.toon(avatar.skin);
  const dark = kit.toon('#4B5260');
  const body = kit.toon(avatar.shirt);
  const glow = new MeshBasicMaterial({ color: new Color(avatar.hairColor) });

  const add = (geometry, material, parent, { position, rotation, scale, thin = true } = {}) => {
    const mesh = withOutline(new Mesh(geometry, material), kit, thin);
    if (position) mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    if (scale) mesh.scale.set(...scale);
    parent.add(mesh);
    return mesh;
  };

  const legGeometry = kit.geometry('robot-leg', () => new CylinderGeometry(0.07, 0.07, 0.26, 10));
  const footGeometry = kit.geometry('robot-foot', () => new RoundedBoxGeometry(0.18, 0.08, 0.24, 2, 0.03));
  for (const side of [-1, 1]) {
    add(legGeometry, dark, group, { position: [side * 0.14, 0.15, 0] });
    add(footGeometry, metal, group, { position: [side * 0.14, 0.04, 0.03] });
  }
  const torso = add(kit.geometry('robot-torso', () => new RoundedBoxGeometry(0.62, 0.55, 0.46, 3, 0.1)), body, group, { position: [0, 0.52, 0], thin: false });
  const light = new Mesh(kit.geometry('robot-light', () => new CircleGeometry(0.06, 16)), glow);
  light.position.set(0.12, 0.08, 0.235);
  torso.add(light);

  const head = new Group();
  head.rotation.order = 'YXZ';
  head.position.y = HEAD_Y;
  group.add(head);

  let top = 0.41;
  let halfWidth = 0.48;
  const faceOpen = faceTexture(kit, avatar, 0);
  let face;
  if (avatar.head === 'dome') {
    add(kit.geometry('robot-dome', () => new SphereGeometry(ROBOT_HEAD_R, 28, 20)), metal, head, { scale: [1.05, 0.92, 1], thin: false });
    face = new Mesh(kit.geometry('robot-face', () => new SphereGeometry(ROBOT_HEAD_R * 1.01, 24, 18, Math.PI / 2 - 0.85, 1.7, Math.PI / 2 - 0.78, 1.56)), new MeshBasicMaterial({ map: faceOpen, transparent: true, alphaTest: 0.35, depthWrite: false }));
    face.scale.set(1.05, 0.92, 1);
    top = 0.46;
    halfWidth = 0.52;
  } else {
    const tv = avatar.head === 'tv';
    const size = tv ? [1.12, 0.78, 0.8] : [0.95, 0.82, 0.86];
    add(kit.geometry(`robot-${avatar.head}`, () => new RoundedBoxGeometry(...size, 4, 0.14)), metal, head, { thin: false });
    face = new Mesh(kit.geometry(`robot-screen-${avatar.head}`, () => new PlaneGeometry(size[0] * 0.94, size[1] * 1.05)), new MeshBasicMaterial({ map: faceOpen, transparent: true, alphaTest: 0.35, depthWrite: false }));
    top = size[1] / 2;
    halfWidth = size[0] / 2;
    face.position.z = size[2] / 2 + 0.006;
  }
  face.renderOrder = 1;
  head.add(face);

  add(kit.geometry('robot-antenna', () => new CylinderGeometry(0.022, 0.022, 0.26, 6)), dark, head, { position: [0, top + 0.12, 0] });
  const ball = new Mesh(kit.geometry('robot-ball', () => new SphereGeometry(0.075, 12, 10)), glow);
  ball.position.set(0, top + 0.28, 0);
  head.add(withOutline(ball, kit, true));
  for (const side of [-1, 1]) add(kit.geometry('robot-bolt', () => new CylinderGeometry(0.1, 0.1, 0.08, 14)), dark, head, { position: [side * (halfWidth + 0.03), 0, 0], rotation: [0, 0, Math.PI / 2] });

  const arms = [];
  const armGeometry = kit.geometry('robot-arm', () => new CylinderGeometry(0.05, 0.05, 0.22, 8));
  const handGeometry = kit.geometry('robot-hand', () => new SphereGeometry(0.085, 10, 8));
  for (const side of [-1, 1]) {
    const shoulder = new Group();
    shoulder.position.set(side * 0.37, 0.7, 0);
    shoulder.rotation.set(-1.0, 0, side * 0.3);
    group.add(shoulder);
    const arm = add(armGeometry, dark, shoulder, { position: [0, -0.13, 0] });
    const hand = add(handGeometry, metal, shoulder, { position: [0, -0.28, 0] });
    shoulder.userData = { arm, hand, reach: 0.28 };
    arms.push(shoulder);
  }
  group.userData.glow = glow;
  group.userData.antenna = ball;
  return { head, body: torso, face, arms, hold: { y: 0.46, z: 0.34, grip: 0.12 } };
}

export function buildAvatar(avatarInput, kit) {
  const avatar = normaliseAvatar(avatarInput);
  const group = new Group();
  const parts = avatar.type === 'robot' ? buildRobot(avatar, kit, group) : buildHuman(avatar, kit, group);
  Object.assign(group.userData, parts, {
    avatar,
    moods: new Map(),
    robot: avatar.type === 'robot',
    faceOpen: parts.face.material,
    faceClosed: new MeshBasicMaterial({ map: faceTexture(kit, avatar, 1), transparent: true, alphaTest: 0.35, depthWrite: false }),
  });
  return group;
}

const ARM_DOWN = new Vector3(0, -1, 0);
const reachTo = new Vector3();

// Points one arm at a spot (in the avatar's own space) and stretches it to get
// there: chibi arms are too short to reach much on their own.
function reachArm(shoulder, x, y, z) {
  const { arm, hand, reach } = shoulder.userData;
  reachTo.set(x, y, z).sub(shoulder.position);
  const stretch = Math.max(0.6, reachTo.length() / reach);
  shoulder.quaternion.setFromUnitVectors(ARM_DOWN, reachTo.normalize());
  arm.position.y = (arm.userData.baseY ??= arm.position.y) * stretch;
  arm.scale.y = stretch;
  hand.position.y = -reach * stretch;
}

// Both hands to these spots: [[x, y, z] for the left hand, [x, y, z] for the right].
export function reachArms(group, [left, right]) {
  const [l, r] = group.userData.arms;
  reachArm(l, ...left);
  reachArm(r, ...right);
}

// Both hands on the card-holding spot in front of the chest (userData.hold),
// gripping either side of the bottom of the cards.
export function holdCards(group) {
  const { hold } = group.userData;
  reachArms(group, [
    [-hold.grip, hold.y + 0.02, hold.z + 0.035],
    [hold.grip, hold.y + 0.02, hold.z + 0.035],
  ]);
}

// Faces for the emotes: the avatar's own face with the eyes, brows and mouth swapped.
const MOODS = {
  stunned: { human: { eyes: 'dizzy', brows: 'worried', mouth: 'o' }, robot: { eyes: 'x', mouth: 'flat' } },
  angry: { human: { brows: 'angry', mouth: 'frown' }, robot: { eyes: 'x', mouth: 'flat' } },
  annoyed: { human: { eyes: 'sleepy', brows: 'angry', mouth: 'flat' }, robot: { eyes: 'sleepy', mouth: 'flat' } },
  shocked: { human: { eyes: 'shocked', brows: 'worried', mouth: 'o' }, robot: { eyes: 'blank', mouth: 'tiny' } },
  sad: { human: { eyes: 'sleepy', brows: 'worried', mouth: 'frown' }, robot: { eyes: 'sleepy', mouth: 'flat' } },
  smug: { human: { eyes: 'wink', mouth: 'smirk' }, robot: { eyes: 'happy', mouth: 'smile' } },
  joy: { human: { eyes: 'happy', brows: 'soft', mouth: 'grin' }, robot: { eyes: 'happy', mouth: 'grin' } },
  clap: { human: { eyes: 'happy', mouth: 'smile' }, robot: { eyes: 'happy', mouth: 'smile' } },
  cheer: { human: { eyes: 'happy', mouth: 'open' }, robot: { eyes: 'big', mouth: 'grin' } },
};

// The face material for a mood, made the first time it's needed and kept with the avatar.
export function moodFace(group, kit, mood) {
  const { avatar, moods } = group.userData;
  const overrides = MOODS[mood]?.[avatar.type === 'robot' ? 'robot' : 'human'];
  if (!overrides) return group.userData.faceOpen;
  if (!moods.has(mood)) moods.set(mood, new MeshBasicMaterial({ map: faceTexture(kit, { ...avatar, ...overrides }, 0), transparent: true, alphaTest: 0.35, depthWrite: false }));
  return moods.get(mood);
}

export function disposeAvatar(group) {
  disposeGroup(group);
  group.userData.glow?.dispose();
}

function lights(scene) {
  scene.add(new HemisphereLight('#ffffff', '#7a7a8c', 1.8));
  const sun = new DirectionalLight('#ffffff', 1.4);
  sun.position.set(2, 5, 4);
  scene.add(sun);
}

// ─── Avatar maker preview: one avatar, slowly turning ──────────────────

export function createAvatarPreview(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  const kit = new AvatarKit();
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.15, 4.6);
  camera.lookAt(0, 0.92, 0);
  lights(scene);

  let avatar = null;
  let key = '';
  let dragging = null;
  let angle = 0.35;
  let velocity = 0;

  const onDown = (event) => {
    dragging = event.clientX;
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event) => {
    if (dragging === null) return;
    velocity = (event.clientX - dragging) * 0.012;
    angle += velocity;
    dragging = event.clientX;
  };
  const onUp = () => (dragging = null);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

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

  let blinkAt = performance.now() + 2000;
  renderer.setAnimationLoop((now) => {
    if (!avatar) return;
    if (dragging === null) {
      velocity *= 0.92;
      angle += velocity + 0.004;
    }
    const { body, head, face, faceOpen, faceClosed, arms, antenna } = avatar.userData;
    // Swings most of the way round, so the back (tails, capes, backpacks) shows too.
    avatar.rotation.y = Math.sin(angle) * 1.9;
    body.scale.y = 1 + Math.sin(now / 500) * 0.015;
    head.rotation.z = Math.sin(now / 800) * 0.06;
    // Arms at rest by their sides here, with a little wave.
    arms[0].rotation.set(0, 0, -0.25 + Math.sin(now / 600) * 0.05);
    arms[1].rotation.set(0, 0, 0.25 - Math.sin(now / 600) * 0.05);
    if (antenna) antenna.position.x = Math.sin(now / 300) * 0.02;
    const blinking = now > blinkAt;
    if (now > blinkAt + 140) blinkAt = now + 1800 + Math.random() * 2500;
    face.material = blinking ? faceClosed : faceOpen;
    renderer.render(scene, camera);
  });

  return {
    setAvatar(next) {
      const nextKey = avatarKey(next);
      if (nextKey === key) return;
      key = nextKey;
      if (avatar) {
        scene.remove(avatar);
        disposeAvatar(avatar);
      }
      avatar = buildAvatar(next, kit);
      scene.add(avatar);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      if (avatar) disposeAvatar(avatar);
      kit.dispose();
      renderer.dispose();
    },
  };
}

// ─── Portraits: head and shoulders, rendered once per look ─────────────

let rig = null;
const portraits = new Map();
const MAX_PORTRAITS = 96;

function portraitRig() {
  if (rig) return rig;
  const renderer = new WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  lights(scene);
  const camera = new PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.2, 3.2);
  camera.lookAt(0, 1.12, 0);
  rig = { renderer, scene, camera, kit: new AvatarKit() };
  return rig;
}

// Paints the avatar's portrait onto a square canvas, at the canvas's own size.
// Throws if WebGL isn't available, so the caller can keep the flat drawing.
export function paintPortrait(target, avatarInput) {
  const size = target.width;
  const key = `${avatarKey(avatarInput)}@${size}`;
  let image = portraits.get(key);
  if (!image) {
    const { renderer, scene, camera, kit } = portraitRig();
    const avatar = buildAvatar(avatarInput, kit);
    avatar.rotation.y = 0.3;
    scene.add(avatar);
    renderer.setSize(size, size, false);
    renderer.render(scene, camera);
    scene.remove(avatar);
    disposeAvatar(avatar);
    image = document.createElement('canvas');
    image.width = size;
    image.height = size;
    image.getContext('2d').drawImage(renderer.domElement, 0, 0);
    portraits.set(key, image);
    if (portraits.size > MAX_PORTRAITS) portraits.delete(portraits.keys().next().value);
  }
  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0);
}
