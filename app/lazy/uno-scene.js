/* eslint-disable warp-drive/no-legacy-request-patterns -- ctx.save() here is the canvas API, not a data request */
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  Group,
  Mesh,
  Sprite,
  SpriteMaterial,
  Points,
  PointsMaterial,
  BufferGeometry,
  BufferAttribute,
  SphereGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  ConeGeometry,
  TorusGeometry,
  BoxGeometry,
  PlaneGeometry,
  RingGeometry,
  CircleGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  MeshToonMaterial,
  MeshBasicMaterial,
  ShaderMaterial,
  CanvasTexture,
  DataTexture,
  RedFormat,
  NearestFilter,
  SRGBColorSpace,
  AdditiveBlending,
  BackSide,
  DoubleSide,
  Color,
  Vector2,
  Vector3,
  Euler,
  Quaternion,
  Raycaster,
  MathUtils,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createElement, Bot, Crown } from 'sketchyicons';
import config from 'woogi-tools/config/environment';
import { drawFace, normaliseAvatar, avatarKey, hairStyle, hairline, hairBumps, headTaper } from '../utils/avatar';

// The 3D Woono table, seen through your own avatar's eyes. Everyone else sits
// round the table as chibi doodles (or robots, for the computer), your cards
// are real cards held in front of the camera, and the labels that matter
// (names, the draw pile, stacked draws) are sprites that always face you.
//
// Kept light on purpose: a handful of low-poly shapes per avatar, textures
// drawn once on small canvases and cached, one renderer, no loaders,
// post-processing or physics. Effects draw from fixed pools (one particle
// buffer, recycled rings, cards and pop-ups), so nothing is allocated while a
// game is running. It's loaded with a dynamic import, so three.js is only
// downloaded once someone opens Woono.

const UNO_COLORS = { red: '#E5484D', yellow: '#F2B90D', green: '#30A46C', blue: '#3E7BE0' };
const INK = '#141414';
const TABLE_RADIUS = 2.9;
const SEAT_RADIUS = 3.65;
const AVATAR_SCALE = 1.3;
const AVATAR_Y = -0.3;
const DECK_POS = new Vector3(-0.75, 0.2, -0.1);
const PILE_POS = new Vector3(0.5, 0.2, -0.1);
const SYMBOLS = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4' };
const CARD_W = 0.62;
const CARD_H = 0.93;
const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3 };
const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'];
const Y_AXIS = new Vector3(0, 1, 0);

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';

// ─── Shared materials & textures ──────────────────────────────────────

function toonGradient() {
  // Two soft bands: flat, sketchbook-style shading.
  const texture = new DataTexture(new Uint8Array([150, 215, 255]), 3, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

// Inverted-hull outline: the back faces of each mesh, pushed out along their normals, in ink.
function outlineMaterial(thickness) {
  return new ShaderMaterial({
    uniforms: { thickness: { value: thickness }, color: { value: new Color(INK) } },
    vertexShader: 'uniform float thickness; void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal); p.xyz += n * thickness; gl_Position = projectionMatrix * p; }',
    fragmentShader: 'uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }',
    side: BackSide,
  });
}

// The site's own doodle, used as the art on the back of every card.
const BACK_ART_URL = `${config.rootURL ?? '/'}favicon.png`;

class Kit {
  gradient = toonGradient();
  outline = outlineMaterial(0.024);
  outlineThin = outlineMaterial(0.013);
  toons = new Map();
  textures = new Map();
  geometries = new Map();
  backArt = null;

  constructor() {
    const image = new Image();
    image.onload = () => {
      this.backArt = image;
      // Repaint the card back if it was already drawn without the picture.
      const back = this.textures.get('card:back');
      if (back) {
        drawCard(back.image.getContext('2d'), back.image.width, back.image.height, null, image);
        back.needsUpdate = true;
      }
    };
    image.src = BACK_ART_URL;
  }

  toon(color) {
    if (!this.toons.has(color)) this.toons.set(color, new MeshToonMaterial({ color: new Color(color), gradientMap: this.gradient }));
    return this.toons.get(color);
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

  cardFace(card) {
    const key = card ? `card:${card.color ?? 'wild'}:${card.value}` : 'card:back';
    return this.texture(key, 160, 240, (ctx, w, h) => drawCard(ctx, w, h, card, this.backArt));
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

function drawCard(ctx, w, h, card, backArt) {
  const r = w * 0.1;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, r);
  ctx.fill();
  const inset = w * 0.055;
  ctx.beginPath();
  ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, r * 0.65);
  if (!card) {
    ctx.fillStyle = '#141414';
    ctx.fill();
  } else if (!card.color) {
    ctx.save();
    ctx.clip();
    const cx = w / 2;
    const cy = h / 2;
    [UNO_COLORS.red, UNO_COLORS.yellow, UNO_COLORS.green, UNO_COLORS.blue].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, h, -Math.PI / 2 + (i * Math.PI) / 2, (i * Math.PI) / 2);
      ctx.fill();
    });
    ctx.restore();
  } else {
    ctx.fillStyle = UNO_COLORS[card.color];
    ctx.fill();
  }

  // The tilted oval.
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.32);
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.4, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = card ? '#fff' : UNO_COLORS.red;
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const unit = w / 128;
  if (!card) {
    // The back: the site's doodle in a white medallion, and the name underneath.
    const cx = w / 2;
    const cy = h / 2 - 6 * unit;
    const rr = w * 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 4 * unit;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (backArt) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rr - 3 * unit, 0, Math.PI * 2);
      ctx.clip();
      const size = rr * 2 * 0.92;
      ctx.drawImage(backArt, cx - size / 2, cy - size / 2, size, size);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(w / 2, h * 0.8);
    ctx.rotate(-0.12);
    ctx.font = `italic 800 ${26 * unit}px Moderustic, sans-serif`;
    ctx.fillStyle = '#F2B90D';
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 5 * unit;
    ctx.strokeText('Woono', 0, 0);
    ctx.fillText('Woono', 0, 0);
    ctx.restore();
    return;
  }
  const symbol = SYMBOLS[card.value] ?? card.value;
  ctx.font = `800 ${(symbol.length > 1 ? 50 : 62) * unit}px Moderustic, sans-serif`;
  ctx.fillStyle = card.color ? (card.color === 'yellow' ? '#B58600' : UNO_COLORS[card.color]) : '#141414';
  ctx.fillText(symbol, w / 2, h / 2 + 3 * unit);
  ctx.font = `800 ${26 * unit}px Moderustic, sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3 * unit;
  for (const [x, y, turn] of [[26, 28, 0], [102, 164, Math.PI]]) {
    ctx.save();
    ctx.translate(x * unit, y * unit);
    ctx.rotate(turn);
    ctx.strokeText(symbol, 0, 0);
    ctx.fillText(symbol, 0, 0);
    ctx.restore();
  }
}

// Per-mesh materials (faces, cards, labels) belong to one object; toon
// materials, geometries and textures are shared and stay cached in the kit.
function disposeGroup(group) {
  group.traverse((obj) => {
    if ((obj.isMesh || obj.isSprite) && (obj.material?.isMeshBasicMaterial || obj.material?.isSpriteMaterial) && !obj.userData.sharedMaterial) {
      if (obj.userData.ownTexture) obj.material.map?.dispose();
      obj.material.dispose();
    }
    obj.userData.faceOpen?.dispose();
    obj.userData.faceClosed?.dispose();
  });
}

function withOutline(mesh, kit, thin = false) {
  const hull = new Mesh(mesh.geometry, thin ? kit.outlineThin : kit.outline);
  hull.raycast = () => {};
  mesh.add(hull);
  return mesh;
}

// ─── Avatars ──────────────────────────────────────────────────────────

const HEAD_R = 0.5;
const HEAD_Y = 1.24;

function faceTexture(kit, avatar, blink) {
  return kit.texture(`face:${avatarKey(avatar)}:${blink}`, 256, 256, (ctx, w) => drawFace(ctx, avatar, w, { blink }));
}

// Narrows a sphere-based geometry towards the chin, the same way the portrait does.
function taper(geometry) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const k = headTaper(position.getY(i), HEAD_R);
    position.setX(i, position.getX(i) * k);
    position.setZ(i, position.getZ(i) * (0.5 + k * 0.5));
  }
  geometry.computeBoundingSphere();
  return geometry;
}

// One sphere for the whole hairdo. Vertices below the style's hairline are
// pulled up onto the hairline itself and sunk inside the head, the further
// below the deeper: the hair ends on exactly that curve (not on the sphere's
// grid), with a short lip underneath that reads as its thickness.
function hairGeometry(style) {
  const outer = HEAD_R * style.volume;
  const inner = HEAD_R * 0.86;
  const lift = (style.lift ?? 0) * HEAD_R;
  const geometry = new SphereGeometry(outer, 96, 56);
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize();
    let polar = Math.acos(MathUtils.clamp(v.y, -1, 1));
    const azimuth = Math.atan2(v.x, v.z);
    const reach = hairline(style, azimuth);
    const below = MathUtils.clamp((polar - reach) / 0.12, 0, 1);
    polar = Math.min(polar, reach);
    const radius = MathUtils.lerp(outer * hairBumps(style, azimuth, polar), inner, below);
    v.set(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
    normal.setXYZ(i, v.x, v.y, v.z);
    v.multiplyScalar(radius);
    position.setXYZ(i, v.x, v.y + lift * (1 - below), v.z);
  }
  return taper(geometry);
}

// A point on the (tapered) hair surface, for hanging extra pieces on.
function onHair(style, azimuth, polar, out = 0) {
  const radius = HEAD_R * style.volume + out;
  const y = Math.cos(polar) * radius;
  const k = headTaper(y, HEAD_R);
  return new Vector3(Math.sin(polar) * Math.sin(azimuth) * radius * k, y + (style.lift ?? 0) * HEAD_R, Math.sin(polar) * Math.cos(azimuth) * radius * (0.5 + k * 0.5));
}

// A chibi anime person, facing +z, standing on y = 0.
function buildHuman(avatar, kit, group) {
  const skin = kit.toon(avatar.skin);
  const hair = kit.toon(avatar.hairColor);
  const shirt = kit.toon(avatar.shirt);
  const pants = kit.toon(avatar.pants);
  const shoes = kit.toon('#26262C');
  const metal = kit.toon('#D9DDE3');
  const gold = kit.toon('#E3C15A');

  const add = (geometry, material, parent, { position, rotation, scale, thin = true, outline = true } = {}) => {
    const mesh = new Mesh(geometry, material);
    if (outline) withOutline(mesh, kit, thin);
    if (position) mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    if (scale) mesh.scale.set(...scale);
    parent.add(mesh);
    return mesh;
  };
  // A cone pointing along `dir`, for spikes, tufts and horns.
  const spike = (geometry, material, parent, position, dir, scale) => {
    const mesh = add(geometry, material, parent, { position: position.toArray(), scale });
    mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.normalize());
    return mesh;
  };

  // Legs and shoes, hips, then a short torso.
  const leg = kit.geometry('leg', () => new CapsuleGeometry(0.075, 0.18, 4, 10));
  const shoe = kit.geometry('shoe', () => new SphereGeometry(0.1, 12, 8));
  for (const side of [-1, 1]) {
    add(leg, pants, group, { position: [side * 0.1, 0.2, 0] });
    add(shoe, shoes, group, { position: [side * 0.1, 0.06, 0.04], scale: [0.85, 0.6, 1.2] });
  }
  add(kit.geometry('hips', () => new CapsuleGeometry(0.19, 0.04, 4, 14)), pants, group, { position: [0, 0.38, 0], scale: [1, 1, 0.8], thin: false });
  const body = add(kit.geometry('torso', () => new CapsuleGeometry(0.2, 0.2, 6, 16)), shirt, group, { position: [0, 0.6, 0], scale: [1, 1, 0.82], thin: false });

  switch (avatar.neck) {
    case 'scarf':
      add(kit.geometry('scarf', () => new TorusGeometry(0.17, 0.07, 8, 20)), kit.toon('#C23B3B'), group, { position: [0, 0.8, 0], rotation: [Math.PI / 2, 0, 0] });
      add(kit.geometry('scarf-tail', () => new CapsuleGeometry(0.05, 0.18, 4, 8)), kit.toon('#C23B3B'), group, { position: [0.1, 0.66, 0.17], rotation: [0.2, 0, 0.15] });
      break;
    case 'tie':
      add(kit.geometry('tie', () => new ConeGeometry(0.06, 0.26, 4)), kit.toon('#C23B3B'), group, { position: [0, 0.64, 0.175], rotation: [Math.PI + 0.12, Math.PI / 4, 0], scale: [1, 1, 0.35] });
      break;
    case 'choker':
      add(kit.geometry('choker', () => new TorusGeometry(0.13, 0.025, 6, 20)), kit.toon('#1B1B1B'), group, { position: [0, 0.82, 0], rotation: [Math.PI / 2, 0, 0] });
      break;
    default:
      break;
  }

  const head = new Group();
  // Turn first, then nod, then tilt: how a head actually looks around.
  head.rotation.order = 'YXZ';
  head.position.y = HEAD_Y;
  group.add(head);
  add(kit.geometry('head', () => taper(new SphereGeometry(HEAD_R, 36, 26))), skin, head, { thin: false });
  const ear = kit.geometry('ear', () => new SphereGeometry(0.1, 12, 8));
  const piercings = new Set(avatar.piercings);
  for (const side of [-1, 1]) {
    add(ear, skin, head, { position: [side * HEAD_R * 0.9, -0.06, 0.02], scale: [0.5, 0.95, 0.75] });
    if (piercings.has('ear-studs')) add(kit.geometry('stud', () => new SphereGeometry(0.022, 8, 6)), metal, head, { position: [side * HEAD_R * 0.95, -0.14, 0.06], outline: false });
    if (piercings.has('ear-hoops')) add(kit.geometry('hoop', () => new TorusGeometry(0.045, 0.011, 6, 16)), gold, head, { position: [side * HEAD_R * 0.95, -0.19, 0.05], rotation: [0, Math.PI / 2, 0], outline: false });
  }

  // The face is a patch of sphere just in front of the head, so the 2D drawing wraps round it.
  const faceGeometry = kit.geometry('face-tapered', () => taper(new SphereGeometry(HEAD_R * 1.01, 24, 18, Math.PI / 2 - 0.85, 1.7, Math.PI / 2 - 0.78, 1.56)));
  const face = new Mesh(faceGeometry, new MeshBasicMaterial({ map: faceTexture(kit, avatar, 0), transparent: true, alphaTest: 0.35, depthWrite: false }));
  face.renderOrder = 1;
  head.add(face);

  const style = hairStyle(avatar.hair);
  const volume = style.none ? 1 : style.volume;
  const crownY = HEAD_R * volume + (style.lift ?? 0) * HEAD_R;
  if (!style.none) {
    add(kit.geometry(`hair:${style.id}`, () => hairGeometry(style)), hair, head, { thin: false });
    const cone = kit.geometry('hair-spike', () => new ConeGeometry(0.1, 0.34, 6));
    if (style.tufts) {
      // Choppy ends sticking out from the edge of the hair, round the sides and back.
      const { count, from, to, length } = style.tufts;
      for (let i = 0; i < count; i++) {
        for (const side of [-1, 1]) {
          if (i === 0 && side === 1 && from === 1) continue;
          const azimuth = side * Math.PI * MathUtils.lerp(from, to, count > 1 ? i / (count - 1) : 0);
          const polar = hairline(style, azimuth) - 0.08;
          const at = onHair(style, azimuth, polar, -0.03);
          const out = at.clone().setY(0).normalize();
          spike(cone, hair, head, at, out.multiplyScalar(0.7).add(new Vector3(0, -1, 0)), [0.8, length / 0.34, 0.45]);
        }
      }
    }
    if (style.crown) {
      for (let i = 0; i < 6; i++) {
        const azimuth = (i / 6) * Math.PI * 2 + 0.3;
        const at = onHair(style, azimuth, 0.55, -0.04);
        spike(cone, hair, head, at, at.clone().normalize().add(new Vector3(0, 0.6, -0.4)), [0.9, 1.1, 0.5]);
      }
    }
    if (style.fin) {
      // A mohawk: a row of flattened spikes from the forehead to the nape, tallest in the middle.
      for (let i = 0; i < 7; i++) {
        const polar = -0.55 + i * 0.36;
        const at = new Vector3(0, Math.cos(polar) * HEAD_R * 0.98, Math.sin(polar) * HEAD_R * 0.98);
        const height = 0.9 + Math.sin((i / 6) * Math.PI) * 0.7;
        spike(cone, hair, head, at, at.clone().normalize().add(new Vector3(0, 0, -0.35)), [0.45, height, 1.3]);
      }
    }
    if (style.quiff) add(kit.geometry('quiff', () => new SphereGeometry(0.26, 18, 12)), hair, head, { position: [0.02, crownY - 0.04, 0.22], scale: [1.2, 0.75, 1] });
    if (style.curtain) add(kit.geometry('curtain', () => new CapsuleGeometry(0.42, 0.42, 6, 16)), hair, head, { position: [0, -0.36, -0.2], scale: [1.05, 1, 0.5] });
    if (style.locks) for (const side of [-1, 1]) add(kit.geometry('lock', () => new CapsuleGeometry(0.075, 0.42, 4, 8)), hair, head, { position: [side * 0.42, -0.28, 0.14] });
    if (style.ponytail) {
      add(kit.geometry('hair-tie', () => new SphereGeometry(0.08, 10, 8)), shirt, head, { position: [0, 0.1, -0.52] });
      add(kit.geometry('tail', () => new CapsuleGeometry(0.12, 0.42, 4, 10)), hair, head, { position: [0, -0.22, -0.64], rotation: [0.35, 0, 0] });
    }
    if (style.twintails) {
      for (const side of [-1, 1]) {
        add(kit.geometry('hair-tie', () => new SphereGeometry(0.08, 10, 8)), shirt, head, { position: [side * 0.44, 0.02, -0.22] });
        add(kit.geometry('twintail', () => new CapsuleGeometry(0.12, 0.5, 4, 10)), hair, head, { position: [side * 0.52, -0.38, -0.26], rotation: [0.15, 0, side * 0.18] });
      }
    }
    if (style.braid) {
      const bead = kit.geometry('braid', () => new SphereGeometry(0.1, 12, 8));
      for (let i = 0; i < 5; i++) add(bead, hair, head, { position: [0, -0.1 - i * 0.14, -0.5 - i * 0.03], scale: [1 - i * 0.08, 0.9, 0.9] });
      add(kit.geometry('hair-tie', () => new SphereGeometry(0.08, 10, 8)), shirt, head, { position: [0, -0.78, -0.62], scale: [0.7, 0.7, 0.7] });
    }
    if (style.bun) add(kit.geometry('bun', () => new SphereGeometry(0.2, 14, 10)), hair, head, { position: [0, 0.45, -0.32] });
    if (style.buns) for (const side of [-1, 1]) add(kit.geometry('bun-small', () => new SphereGeometry(0.17, 14, 10)), hair, head, { position: [side * 0.3, 0.44, -0.02] });
  }
  if (avatar.ahoge && !style.none) {
    const strand = kit.geometry(`ahoge:${crownY.toFixed(3)}`, () => new TubeGeometry(new CatmullRomCurve3([new Vector3(0, crownY - 0.04, 0.04), new Vector3(0.01, crownY + 0.14, 0.07), new Vector3(0.1, crownY + 0.27, 0.03), new Vector3(0.2, crownY + 0.22, -0.03)]), 16, 0.03, 6));
    add(strand, hair, head);
  }

  const top = crownY;
  switch (avatar.hat) {
    case 'bow': {
      const pink = kit.toon('#FF6B8B');
      const wing = kit.geometry('bow', () => new ConeGeometry(0.11, 0.2, 4));
      add(wing, pink, head, { position: [0.18, top - 0.02, 0.12], rotation: [0, 0, Math.PI / 2] });
      add(wing, pink, head, { position: [0.4, top - 0.1, 0.12], rotation: [0, 0, -Math.PI / 2] });
      break;
    }
    case 'cap':
      add(kit.geometry(`cap:${volume}`, () => new SphereGeometry(HEAD_R * volume * 1.05, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42)), shirt, head);
      add(kit.geometry('brim', () => new CylinderGeometry(0.3, 0.3, 0.04, 20)), shirt, head, { position: [0, 0.22, 0.42], scale: [1, 1, 0.9] });
      break;
    case 'beanie':
      add(kit.geometry(`beanie:${volume}`, () => new SphereGeometry(HEAD_R * volume * 1.07, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.46)), kit.toon('#E5484D'), head);
      add(kit.geometry(`beanie-cuff:${volume}`, () => new TorusGeometry(HEAD_R * volume * 0.98, 0.06, 8, 28)), kit.toon('#B8333A'), head, { position: [0, 0.12, 0], rotation: [Math.PI / 2, 0, 0] });
      add(kit.geometry('pompom', () => new SphereGeometry(0.1, 12, 8)), kit.toon('#F2F2F2'), head, { position: [0, top + 0.1, 0] });
      break;
    case 'cat-ears':
    case 'horns': {
      const horn = avatar.hat === 'horns';
      const geometry = kit.geometry(horn ? 'horn' : 'cat-ear', () => new ConeGeometry(horn ? 0.07 : 0.14, horn ? 0.3 : 0.28, horn ? 8 : 4));
      for (const side of [-1, 1]) {
        const at = onHair(style.none ? { volume: 1, lift: 0 } : style, side * 0.6, 0.55, -0.03);
        spike(geometry, horn ? kit.toon('#E8E1CF') : hair, head, at, new Vector3(side * (horn ? 0.6 : 0.35), 1, horn ? 0.3 : 0), [1, 1, horn ? 1 : 0.5]);
      }
      break;
    }
    case 'crown': {
      const goldCrown = kit.toon('#F2C230');
      add(kit.geometry('crown-band', () => new CylinderGeometry(0.2, 0.22, 0.1, 16, 1, true)), goldCrown, head, { position: [0, top + 0.02, 0] });
      const point = kit.geometry('crown-point', () => new ConeGeometry(0.05, 0.12, 4));
      for (let i = 0; i < 5; i++) {
        const t = (i / 5) * Math.PI * 2;
        add(point, goldCrown, head, { position: [Math.sin(t) * 0.2, top + 0.12, Math.cos(t) * 0.2] });
      }
      break;
    }
    case 'halo': {
      const halo = new Mesh(kit.geometry('halo', () => new TorusGeometry(0.28, 0.035, 8, 28)), kit.toon('#F5C518'));
      halo.position.set(0, top + 0.2, 0);
      halo.rotation.x = Math.PI / 2;
      head.add(halo);
      break;
    }
    case 'headband':
      add(kit.geometry(`headband:${volume}`, () => new TorusGeometry(HEAD_R * volume * 0.99, 0.035, 8, 32, Math.PI)), kit.toon('#E5484D'), head, { position: [0, 0.12, 0], rotation: [0, 0, 0] });
      break;
    case 'flower': {
      const petal = kit.geometry('petal', () => new SphereGeometry(0.055, 10, 8));
      const center = onHair(style.none ? { volume: 1, lift: 0 } : style, 0.6, 0.42, 0.02);
      for (let i = 0; i < 5; i++) {
        const t = (i / 5) * Math.PI * 2;
        add(petal, kit.toon('#FFB3C7'), head, { position: [center.x + Math.cos(t) * 0.07, center.y + Math.sin(t) * 0.07, center.z], outline: false });
      }
      add(kit.geometry('petal-center', () => new SphereGeometry(0.04, 8, 6)), kit.toon('#F2C230'), head, { position: [center.x, center.y, center.z + 0.03] });
      break;
    }
    case 'headphones': {
      const dark = kit.toon('#3A3A44');
      add(kit.geometry(`band:${volume}`, () => new TorusGeometry(HEAD_R * volume + 0.03, 0.035, 8, 24, Math.PI)), dark, head);
      const cup = kit.geometry('cup', () => new CylinderGeometry(0.14, 0.14, 0.1, 16));
      for (const side of [-1, 1]) add(cup, dark, head, { position: [side * (HEAD_R * volume + 0.02), 0, 0], rotation: [0, 0, Math.PI / 2] });
      break;
    }
    default:
      break;
  }

  // Arms hang from the shoulders; the pivot sits at the shoulder so they swing from there.
  const arms = [];
  const arm = kit.geometry('arm', () => new CapsuleGeometry(0.065, 0.2, 4, 8));
  const hand = kit.geometry('hand', () => new SphereGeometry(0.075, 10, 8));
  for (const side of [-1, 1]) {
    const shoulder = new Group();
    shoulder.position.set(side * 0.24, 0.74, 0);
    shoulder.rotation.set(-1.0, 0, side * 0.3);
    group.add(shoulder);
    add(arm, shirt, shoulder, { position: [0, -0.12, 0] });
    add(hand, skin, shoulder, { position: [0, -0.28, 0] });
    arms.push(shoulder);
  }
  return { head, body, face, arms, handHeight: 0.62 };
}

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
  const torso = add(kit.geometry('robot-torso', () => new RoundedBoxGeometry(0.62, 0.55, 0.46, 3, 0.1)), body, group, { position: [0, 0.56, 0], thin: false });
  const light = new Mesh(kit.geometry('robot-light', () => new CircleGeometry(0.06, 16)), glow);
  light.position.set(0.12, 0.08, 0.235);
  torso.add(light);

  const head = new Group();
  head.rotation.order = 'YXZ';
  head.position.y = HEAD_Y;
  group.add(head);

  let top = 0.41;
  let faceZ = 0.43;
  let halfWidth = 0.48;
  const faceOpen = faceTexture(kit, avatar, 0);
  let face;
  if (avatar.head === 'dome') {
    add(kit.geometry('robot-dome', () => new SphereGeometry(HEAD_R, 28, 20)), metal, head, { scale: [1.05, 0.92, 1], thin: false });
    face = new Mesh(kit.geometry('face', () => new SphereGeometry(HEAD_R * 1.01, 24, 18, Math.PI / 2 - 0.85, 1.7, Math.PI / 2 - 0.78, 1.56)), new MeshBasicMaterial({ map: faceOpen, transparent: true, alphaTest: 0.35, depthWrite: false }));
    face.scale.set(1.05, 0.92, 1);
    top = 0.46;
    halfWidth = 0.52;
  } else {
    const tv = avatar.head === 'tv';
    const size = tv ? [1.12, 0.78, 0.8] : [0.95, 0.82, 0.86];
    add(kit.geometry(`robot-${avatar.head}`, () => new RoundedBoxGeometry(...size, 4, 0.14)), metal, head, { thin: false });
    face = new Mesh(kit.geometry(`robot-screen-${avatar.head}`, () => new PlaneGeometry(size[0] * 0.94, size[1] * 1.05)), new MeshBasicMaterial({ map: faceOpen, transparent: true, alphaTest: 0.35, depthWrite: false }));
    faceZ = size[2] / 2 + 0.006;
    top = size[1] / 2;
    halfWidth = size[0] / 2;
    face.position.z = faceZ;
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
    shoulder.position.set(side * 0.37, 0.74, 0);
    shoulder.rotation.set(-1.0, 0, side * 0.3);
    group.add(shoulder);
    add(armGeometry, dark, shoulder, { position: [0, -0.13, 0] });
    add(handGeometry, metal, shoulder, { position: [0, -0.28, 0] });
    arms.push(shoulder);
  }
  group.userData.glow = glow;
  group.userData.antenna = ball;
  return { head, body: torso, face, arms, handHeight: 0.62 };
}

export function buildAvatar(avatarInput, kit) {
  const avatar = normaliseAvatar(avatarInput);
  const group = new Group();
  const parts = avatar.type === 'robot' ? buildRobot(avatar, kit, group) : buildHuman(avatar, kit, group);
  Object.assign(group.userData, parts, {
    robot: avatar.type === 'robot',
    faceOpen: parts.face.material,
    faceClosed: new MeshBasicMaterial({ map: faceTexture(kit, avatar, 1), transparent: true, alphaTest: 0.35, depthWrite: false }),
  });
  return group;
}

function disposeAvatar(group) {
  disposeGroup(group);
  group.userData.glow?.dispose();
}

// ─── Animation helpers ────────────────────────────────────────────────

const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

class Tweens {
  list = [];

  add(duration, update, { delay = 0, done } = {}) {
    this.list.push({ start: performance.now() + delay, duration, update, done });
  }

  tick(now) {
    if (!this.list.length) return;
    this.list = this.list.filter((tween) => {
      if (now < tween.start) return true;
      const t = Math.min(1, (now - tween.start) / tween.duration);
      tween.update(t);
      if (t < 1) return true;
      tween.done?.();
      return false;
    });
  }
}

// Meshes that come and go all game (flying cards, the discard pile, the fans
// in everyone's hands, pop-ups, rings, confetti) are recycled instead of being
// created and thrown away each time: no garbage-collection hitches
// mid-animation, and no new GPU material per card.
class MeshPool {
  free = [];
  all = [];

  constructor(create) {
    this.create = create;
  }

  acquire() {
    const mesh = this.free.pop() ?? this.track(this.create());
    mesh.visible = true;
    return mesh;
  }

  track(mesh) {
    this.all.push(mesh);
    return mesh;
  }

  release(mesh) {
    mesh.removeFromParent();
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.setScalar(1);
    mesh.renderOrder = 0;
    this.free.push(mesh);
  }

  dispose() {
    for (const mesh of this.all) mesh.material.dispose();
    this.free = [];
    this.all = [];
  }
}

// One fixed buffer of glowing specks for every burst: sparks when a card
// lands, fireworks when someone wins. Dead particles swap with the last live
// one, so updating only ever touches the live ones.
class Particles {
  constructor(capacity, texture) {
    this.capacity = capacity;
    this.count = 0;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.base = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);
    this.material = new PointsMaterial({ size: 0.16, map: texture, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    this.color = new Color();
  }

  emit(origin, count, colors, { speed = 2, up = 1.5, life = 0.9, gravity = 4, spread = 0.1 } = {}) {
    for (let n = 0; n < count && this.count < this.capacity; n++) {
      const i = this.count++;
      const angle = Math.random() * Math.PI * 2;
      const power = speed * (0.35 + Math.random() * 0.65);
      this.positions.set([origin.x + (Math.random() - 0.5) * spread, origin.y, origin.z + (Math.random() - 0.5) * spread], i * 3);
      this.velocity.set([Math.cos(angle) * power, up * (0.5 + Math.random()), Math.sin(angle) * power], i * 3);
      this.color.set(colors[n % colors.length]);
      this.base.set([this.color.r, this.color.g, this.color.b], i * 3);
      this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.life[i] = this.maxLife[i];
      this.gravity[i] = gravity;
    }
  }

  tick(dt) {
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
          this.base.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.gravity[i] = this.gravity[last];
        }
        i--;
        continue;
      }
      const k = i * 3;
      v[k + 1] -= this.gravity[i] * dt;
      v[k] *= 0.985;
      v[k + 2] *= 0.985;
      p[k] += v[k] * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += v[k + 2] * dt;
      // Additive blending: fading to black fades out.
      const fade = this.life[i] / this.maxLife[i];
      this.colors[k] = this.base[k] * fade;
      this.colors[k + 1] = this.base[k + 1] * fade;
      this.colors[k + 2] = this.base[k + 2] * fade;
    }
    this.geometry.setDrawRange(0, this.count);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.drawn = this.count > 0;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ─── Billboards ───────────────────────────────────────────────────────

function pill(ctx, x, y, w, h, fill, stroke, lineWidth = 6) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// A sprite with its own small canvas, redrawn only when what it shows changes.
class Label {
  constructor(width, height, scale) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.sprite = new Sprite(new SpriteMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false }));
    this.sprite.renderOrder = 15;
    this.aspect = width / height;
    this.baseScale = scale;
    this.sprite.scale.set(scale * this.aspect, scale, 1);
    this.key = '';
  }

  draw(key, paint) {
    if (key === this.key) return;
    this.key = key;
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    paint(ctx, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  setScale(multiplier) {
    this.sprite.scale.set(this.baseScale * this.aspect * multiplier, this.baseScale * multiplier, 1);
  }

  dispose() {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}

// The site's own sketchy icons, as images the tag canvases can draw. They
// load asynchronously; `onReady` redraws whatever was drawn without them.
const ICONS = {};
function loadIcons(onReady) {
  let pending = 0;
  for (const [name, node] of Object.entries({ bot: Bot, crown: Crown })) {
    const svg = createElement(node, { width: 64, height: 64, stroke: INK, 'stroke-width': 2.4 });
    const image = new Image();
    pending++;
    image.onload = () => {
      ICONS[name] = image;
      if (--pending === 0) onReady();
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  }
}

function drawNameTag(ctx, w, h, { name, count, turn, uno, winner, bot }) {
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const fill = winner ? '#F2B90D' : turn ? '#FFF3B0' : '#FFFFFF';
  const pillH = h * 0.62;
  pill(ctx, 6, 6, w - 12, pillH, fill, turn || winner ? '#F2B90D' : INK, turn ? 9 : 5);
  ctx.fillStyle = INK;
  const icons = [winner && ICONS.crown, bot && ICONS.bot].filter(Boolean);
  const iconSize = 40;
  const iconSpace = icons.length * (iconSize + 6);
  let size = 38;
  ctx.font = `800 ${size}px Moderustic, sans-serif`;
  while (ctx.measureText(name).width > w - 50 - iconSpace && size > 18) {
    size -= 2;
    ctx.font = `800 ${size}px Moderustic, sans-serif`;
  }
  const textWidth = ctx.measureText(name).width;
  const start = (w - textWidth - iconSpace) / 2;
  const middle = 6 + pillH / 2;
  icons.forEach((icon, i) => ctx.drawImage(icon, start + i * (iconSize + 6), middle - iconSize / 2, iconSize, iconSize));
  ctx.textAlign = 'left';
  ctx.fillText(name, start + iconSpace, middle + 2);
  ctx.textAlign = 'center';
  // The card count hangs underneath, red when they're down to one.
  const badge = uno ? `${count} · WOONO!` : `${count} ${count === 1 ? 'card' : 'cards'}`;
  ctx.font = '800 26px Moderustic, sans-serif';
  const bw = ctx.measureText(badge).width + 34;
  pill(ctx, (w - bw) / 2, h * 0.64, bw, h * 0.32, uno ? UNO_COLORS.red : INK, null);
  ctx.fillStyle = '#fff';
  ctx.fillText(badge, w / 2, h * 0.64 + (h * 0.32) / 2 + 1);
}

function drawBanner(ctx, w, h, text, fill, color = '#fff') {
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  pill(ctx, 8, 8, w - 16, h - 16, fill, INK, 7);
  ctx.font = `italic 800 ${Math.round(h * 0.5)}px Moderustic, sans-serif`;
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2 + 3);
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  return texture;
}

// ─── The table scene ──────────────────────────────────────────────────

// Where your eyes are, and how far you can turn them (radians).
const EYE = new Vector3(0, 1.85, SEAT_RADIUS + 0.35);
const LOOK_TARGET = new Vector3(0, 0.4, 0.1);
// The part of the circle other players sit on, in radians round from your seat.
const SEAT_ARC = [Math.PI * 0.5, Math.PI * 1.5];
const LOOK_YAW = 0.95;
const LOOK_PITCH = 0.42;
// How far other players' heads turn to follow where they're looking (radians).
const HEAD_YAW = 0.75;
const HEAD_PITCH = 0.35;
// Look updates older than this are stale; the avatar goes back to watching the game.
const LOOK_STALE_MS = 4000;
// Your hand, in front of the camera.
const HAND_DEPTH = 1.3;
const HAND_CARD_SCALE = 0.5;
const FAN_RADIUS = 1.7;

const sortHand = (hand) => [...hand].sort((a, b) => (COLOR_ORDER[a.color] ?? 9) - (COLOR_ORDER[b.color] ?? 9) || VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value));

export function createUnoScene(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  const calm = reducedMotion();

  const kit = new Kit();
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.05, 60);
  camera.rotation.order = 'YXZ';
  camera.position.copy(EYE);
  const basePitch = -Math.atan2(EYE.y - LOOK_TARGET.y, EYE.z - LOOK_TARGET.z);
  camera.rotation.set(basePitch, 0, 0);
  scene.add(camera);

  scene.add(new HemisphereLight('#ffffff', '#7a7a8c', 1.7));
  const sun = new DirectionalLight('#ffffff', 1.5);
  sun.position.set(3, 8, 5);
  scene.add(sun);

  // Table: felt top, wooden rim, a pedestal, and a soft shadow on the floor.
  const table = new Group();
  scene.add(table);
  const feltMaterial = new MeshToonMaterial({ color: new Color('#2F6B55'), gradientMap: kit.gradient });
  const feltColor = new Color('#2F6B55');
  const felt = new Mesh(new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.12, 56), feltMaterial);
  table.add(withOutline(felt, kit));
  const rim = new Mesh(new TorusGeometry(TABLE_RADIUS, 0.12, 10, 64), kit.toon('#7A5234'));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.05;
  table.add(withOutline(rim, kit, true));
  const leg = new Mesh(new CylinderGeometry(0.5, 0.9, 1.8, 20), kit.toon('#5E3F28'));
  leg.position.y = -0.95;
  table.add(leg);
  const glow = glowTexture();
  const shadow = new Mesh(new CircleGeometry(TABLE_RADIUS * 1.5, 40), new MeshBasicMaterial({ map: glow, color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.84;
  scene.add(shadow);

  // A ring round the discard pile in the colour to match, with arrows showing the direction of play.
  const colorRing = new Mesh(new RingGeometry(0.72, 0.84, 48), new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide, transparent: true, opacity: 0.9 }));
  colorRing.rotation.x = -Math.PI / 2;
  colorRing.position.set(PILE_POS.x, 0.075, PILE_POS.z);
  scene.add(colorRing);
  const arrows = new Group();
  arrows.position.set(0, 0.08, 0);
  scene.add(arrows);
  const arrowMaterial = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 });
  const arrowGeometry = new ConeGeometry(0.1, 0.26, 3);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const arrow = new Mesh(arrowGeometry, arrowMaterial);
    arrow.position.set(Math.sin(a) * 2.2, 0, Math.cos(a) * 2.2);
    arrow.userData.angle = a;
    arrows.add(arrow);
  }
  const pointArrows = (dir) => {
    for (const arrow of arrows.children) {
      arrow.rotation.set(Math.PI / 2, 0, 0);
      arrow.rotateOnWorldAxis(Y_AXIS, arrow.userData.angle - (dir * Math.PI) / 2);
    }
  };
  pointArrows(1);

  // Draw pile: a stack with a back on top, plus a glowing ring when you can draw.
  const deck = new Group();
  deck.position.copy(DECK_POS);
  scene.add(deck);
  const deckBox = new Mesh(new BoxGeometry(CARD_W, 0.3, CARD_H), kit.toon('#f4f4f4'));
  deckBox.position.y = -0.03;
  deck.add(withOutline(deckBox, kit, true));
  const deckTop = new Mesh(new PlaneGeometry(CARD_W, CARD_H), new MeshBasicMaterial({ map: kit.cardFace(null) }));
  deckTop.rotation.x = -Math.PI / 2;
  deckTop.position.y = 0.125;
  deck.add(deckTop);
  const drawRing = new Mesh(new RingGeometry(0.62, 0.76, 48), new MeshBasicMaterial({ color: '#FFD84D', transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }));
  drawRing.rotation.x = -Math.PI / 2;
  drawRing.position.set(DECK_POS.x, 0.08, DECK_POS.z);
  scene.add(drawRing);
  const drawLabel = new Label(320, 110, 0.36);
  drawLabel.sprite.position.set(DECK_POS.x, 0.95, DECK_POS.z);
  scene.add(drawLabel.sprite);
  const stackLabel = new Label(300, 110, 0.4);
  stackLabel.sprite.position.set(PILE_POS.x, 1.05, PILE_POS.z);
  scene.add(stackLabel.sprite);

  const pile = new Group();
  pile.position.copy(PILE_POS);
  scene.add(pile);

  const cardGeometry = new PlaneGeometry(CARD_W, CARD_H);
  const cards = new MeshPool(() => new Mesh(cardGeometry, new MeshBasicMaterial({ side: DoubleSide })));
  const takeCard = (card) => {
    const mesh = cards.acquire();
    mesh.material.map = kit.cardFace(card);
    mesh.material.color.set('#ffffff');
    if (mesh.material.depthTest === false) {
      mesh.material.depthTest = true;
      mesh.material.transparent = false;
      mesh.material.needsUpdate = true;
    }
    return mesh;
  };
  const popupGeometry = new PlaneGeometry(1.4, 0.55);
  const popups = new MeshPool(() => new Mesh(popupGeometry, new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false })));
  const confettiGeometry = new PlaneGeometry(0.08, 0.14);
  const confettiBits = new MeshPool(() => new Mesh(confettiGeometry, new MeshBasicMaterial({ side: DoubleSide })));
  const ringGeometry = new RingGeometry(0.8, 1, 48);
  const rings = new MeshPool(() => new Mesh(ringGeometry, new MeshBasicMaterial({ transparent: true, side: DoubleSide, depthWrite: false })));
  const particles = new Particles(calm ? 200 : 700, glow);
  scene.add(particles.points);

  const turnDisc = new Mesh(new RingGeometry(0.45, 0.62, 40), new MeshBasicMaterial({ color: '#F5C518', transparent: true, opacity: 0.35 }));
  turnDisc.rotation.x = -Math.PI / 2;
  scene.add(turnDisc);

  // Your hand rides along with the camera, low in the view.
  const hand = new Group();
  hand.position.set(0, -0.62, -HAND_DEPTH);
  camera.add(hand);
  const handCards = new Map(); // card id -> mesh
  const glowGeometry = new PlaneGeometry(CARD_W * 1.12, CARD_H * 1.08);

  const tweens = new Tweens();
  const seats = new Map(); // seat index -> { group, avatar, fan, count, key, phase, blinkAt, yaw, pitch, tag }
  const looks = new Map(); // seat index -> { x, y, at } from that player's look
  const pointer = { x: 0, y: 0, active: false };
  const look = { yaw: 0, pitch: 0, dragYaw: 0, dragPitch: 0 };
  const gyro = { on: false, yaw: 0, pitch: 0, reference: null };
  let view = null;
  let layoutKey = '';
  let me = 0;
  let playerCount = 0;
  let gameId = null;
  let lastEventId = null;
  let lastTopId = null;
  let direction = 1;
  let turn = 0;
  let winner = null;
  let running = true;
  let visible = true;
  let hoverId = null;
  let selectedId = null;
  let hoverDeck = false;
  let shake = 0;
  let arrowBoost = 0;
  let feltFlash = 0;
  const flashColor = new Color();
  let wasMyTurn = false;
  let handFlash = 0;

  // Where seat k (0 = you, counting clockwise) sits, and which way it faces.
  // Everyone else shares the far side of the table, so no one sits right
  // beside you, out of view.
  const seatPosition = (k, n) => {
    const angle = k === 0 ? 0 : -(SEAT_ARC[0] + ((k - 0.5) / (n - 1)) * (SEAT_ARC[1] - SEAT_ARC[0]));
    return { angle, x: Math.sin(angle) * SEAT_RADIUS, z: Math.cos(angle) * SEAT_RADIUS };
  };
  const relative = (index) => (index - me + playerCount) % playerCount;
  const handPoint = (index) => {
    const k = relative(index);
    if (k === 0) return hand.getWorldPosition(new Vector3());
    const { x, z } = seatPosition(k, playerCount);
    return new Vector3(x * 0.84, 0.95, z * 0.84);
  };
  const headPoint = (index, lift = 0) => {
    const k = relative(index);
    if (k === 0) return camera.localToWorld(new Vector3(0, 0.35 + lift, -3.6));
    const { x, z } = seatPosition(k, playerCount);
    return new Vector3(x, AVATAR_Y + (HEAD_Y + 0.8) * AVATAR_SCALE + lift, z);
  };

  function releaseFan(seat) {
    if (!seat.fan) return;
    for (const card of [...seat.fan.children]) cards.release(card);
    seat.fan.removeFromParent();
    seat.fan = null;
  }

  function buildFan(count, height) {
    const fan = new Group();
    const shown = Math.min(count, 10);
    for (let i = 0; i < shown; i++) {
      const card = takeCard(null);
      card.scale.setScalar(0.42);
      const spread = shown > 1 ? (i / (shown - 1) - 0.5) * 1.1 : 0;
      card.position.set(spread * 0.42, Math.cos(spread) * 0.07, i * 0.004);
      card.rotation.z = -spread * 0.7;
      fan.add(card);
    }
    fan.position.set(0, height + 0.08, 0.42);
    fan.rotation.x = -0.35;
    return fan;
  }

  function removeSeat(index, seat) {
    releaseFan(seat);
    seat.tag.dispose();
    scene.remove(seat.group);
    disposeAvatar(seat.avatar);
    seats.delete(index);
  }

  function syncSeats(players) {
    const n = players.length;
    const rebuildAll = layoutKey !== `${n}:${me}`;
    layoutKey = `${n}:${me}`;
    for (const [index, seat] of seats) {
      if (rebuildAll || !players[index] || seat.key !== avatarKey(players[index].avatar) || index === me) removeSeat(index, seat);
    }
    players.forEach((player, index) => {
      const k = relative(index);
      if (k === 0) return;
      let seat = seats.get(index);
      if (!seat) {
        const { angle, x, z } = seatPosition(k, n);
        const group = new Group();
        group.position.set(x, 0, z);
        // Face the middle of the table.
        group.rotation.y = angle + Math.PI;
        const avatar = buildAvatar(player.avatar, kit);
        avatar.position.y = AVATAR_Y;
        avatar.scale.setScalar(AVATAR_SCALE);
        group.add(avatar);
        scene.add(group);
        const tag = new Label(360, 150, 0.42);
        const top = headPoint(index);
        tag.sprite.position.copy(top);
        tag.homeY = top.y;
        // Far seats get slightly bigger tags, so every name stays readable.
        tag.setScale(0.8 + top.distanceTo(EYE) * 0.07);
        scene.add(tag.sprite);
        seat = { group, avatar, fan: null, count: -1, key: avatarKey(player.avatar), phase: Math.random() * 10, blinkAt: performance.now() + 1000 + Math.random() * 3000, yaw: 0, pitch: 0, tag, hop: 0 };
        seats.set(index, seat);
      }
      const count = Math.min(player.count, 10);
      if (seat.count !== count) {
        releaseFan(seat);
        seat.fan = buildFan(player.count, seat.avatar.userData.handHeight);
        seat.avatar.add(seat.fan);
        seat.count = count;
      }
      updateTag(index, player);
    });
  }

  function updateTag(index, player) {
    const seat = seats.get(index);
    if (!seat) return;
    seat.player = player;
    const state = { name: player.name, count: player.count, bot: player.kind === 'bot', uno: player.count === 1, turn: winner === null && turn === index, winner: winner === index };
    seat.tag.draw(JSON.stringify(state), (ctx, w, h) => drawNameTag(ctx, w, h, state));
  }

  // Once the icons have loaded, redraw every tag that was drawn without them.
  loadIcons(() => {
    if (!running) return;
    for (const [index, seat] of seats) {
      seat.tag.key = '';
      if (seat.player) updateTag(index, seat.player);
    }
  });

  function setTopCard(card) {
    if (!card || card.id === lastTopId) return;
    lastTopId = card.id;
    const mesh = takeCard(card);
    mesh.rotation.set(-Math.PI / 2, 0, (Math.random() - 0.5) * 0.6);
    pile.add(mesh);
    // Only the last few cards are real meshes; the rest of the pile is implied.
    while (pile.children.length > 6) cards.release(pile.children[0]);
    pile.children.forEach((child, i) => (child.position.y = i * 0.006));
  }

  function flyCard(card, from, to, { delay = 0, faceUp = true, done, startRotation = null } = {}) {
    const mesh = takeCard(faceUp ? card : null);
    mesh.visible = false;
    scene.add(mesh);
    const spin = (Math.random() - 0.5) * 1.2;
    const tilt = startRotation ?? -0.4;
    tweens.add(
      440,
      (t) => {
        mesh.visible = true;
        const e = easeInOut(t);
        mesh.position.lerpVectors(from, to, e);
        mesh.position.y += Math.sin(t * Math.PI) * 0.9;
        mesh.rotation.set(MathUtils.lerp(tilt, -Math.PI / 2, e), 0, spin * (1 - e));
        mesh.scale.setScalar(MathUtils.lerp(faceUp ? 0.8 : 0.5, 1, e));
      },
      {
        delay,
        done: () => {
          cards.release(mesh);
          done?.();
        },
      },
    );
  }

  // A word or symbol that pops up over someone (or in front of you) and floats away.
  function popup(index, text, fill, { color = '#fff', lift = 0, big = false } = {}) {
    const mesh = popups.acquire();
    mesh.material.map = kit.texture(`popup:${text}:${fill}:${color}`, 360, 140, (ctx, w, h) => drawBanner(ctx, w, h, text, fill, color));
    mesh.material.needsUpdate = true;
    mesh.renderOrder = 16;
    const base = headPoint(index, lift);
    mesh.position.copy(base);
    scene.add(mesh);
    const size = big ? 1.5 : 1;
    tweens.add(
      1500,
      (t) => {
        mesh.quaternion.copy(camera.quaternion);
        const pop = t < 0.15 ? easeOut(t / 0.15) * 1.15 : t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1 + Math.max(0, 0.3 - t);
        mesh.scale.setScalar(Math.max(0.001, pop * size));
        mesh.position.y = base.y + t * 0.35;
      },
      { done: () => popups.release(mesh) },
    );
  }

  // A flat ring that spreads out across the table and fades.
  function shockwave(position, color, { size = 1.6, duration = 520, delay = 0 } = {}) {
    const mesh = rings.acquire();
    mesh.material.color.set(color);
    mesh.material.opacity = 0;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(position.x, 0.09, position.z);
    mesh.renderOrder = 11;
    scene.add(mesh);
    tweens.add(
      duration,
      (t) => {
        const e = easeOut(t);
        mesh.scale.setScalar(0.2 + e * size);
        mesh.material.opacity = 0.85 * (1 - t);
      },
      { delay, done: () => rings.release(mesh) },
    );
  }

  const burst = (position, colors, count, options) => particles.emit(position, calm ? Math.ceil(count / 3) : count, colors, options);

  function hop(index, times = 1) {
    const seat = seats.get(index);
    if (!seat) return;
    tweens.add(420 * times, (t) => {
      seat.avatar.position.y = AVATAR_Y + Math.abs(Math.sin(t * Math.PI * times)) * 0.35;
    });
  }

  function confetti() {
    const colors = Object.values(UNO_COLORS);
    const total = calm ? 24 : 80;
    for (let i = 0; i < total; i++) {
      const mesh = confettiBits.acquire();
      mesh.material.color.set(colors[i % 4]);
      const start = new Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 2, (Math.random() - 0.5) * 5);
      const drift = new Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5);
      const spin = new Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      mesh.position.copy(start);
      scene.add(mesh);
      tweens.add(
        1800 + Math.random() * 900,
        (t) => {
          mesh.position.set(start.x + drift.x * t, start.y - t * 4.6, start.z + drift.z * t);
          mesh.rotation.set(spin.x * t, spin.y * t, spin.z * t);
        },
        { delay: Math.random() * 400, done: () => confettiBits.release(mesh) },
      );
    }
    // Fireworks over the table.
    for (let i = 0; i < (calm ? 1 : 4); i++) {
      tweens.add(1, () => {}, {
        delay: 250 + i * 380,
        done: () => {
          const at = new Vector3((Math.random() - 0.5) * 3, 2.4 + Math.random(), (Math.random() - 0.5) * 2.5);
          burst(at, [colors[i % 4], '#ffffff'], 70, { speed: 2.6, up: 1.2, life: 1.1, gravity: 2.5, spread: 0.05 });
        },
      });
    }
  }

  const addShake = (amount) => {
    if (!calm) shake = Math.min(0.12, shake + amount);
  };

  // Cards that left your hand this update, remembered for a moment so a played one flies from where it was.
  const leftHand = new Map();

  function playEvent(event, fresh) {
    switch (event.type) {
      case 'play': {
        const card = event.card;
        const color = UNO_COLORS[event.color] ?? '#ffffff';
        const mine = relative(event.player) === 0;
        const from = mine && leftHand.has(card.id) ? leftHand.get(card.id) : handPoint(event.player);
        const to = PILE_POS.clone().add(new Vector3(0, 0.05, 0));
        const special = ['draw2', 'wild4', 'wild', 'skip', 'reverse'].includes(card.value);
        flyCard(card, from, to, {
          startRotation: mine ? 0.2 : -0.4,
          done: () => {
            setTopCard(card);
            shockwave(PILE_POS, color, { size: special ? 2.4 : 1.4 });
            burst(to, card.color ? [color, '#ffffff'] : Object.values(UNO_COLORS), special ? 60 : 24, { speed: special ? 2.4 : 1.4, up: 1.6, life: 0.8 });
            if (!card.color) {
              // A wild paints the table in the chosen colour for a moment.
              feltFlash = 1;
              flashColor.set(color);
              shockwave(PILE_POS, color, { size: 4.5, duration: 900, delay: 90 });
            }
            if (card.value === 'wild4') addShake(0.09);
            else if (card.value === 'draw2') addShake(0.05);
          },
        });
        if (seats.has(event.player)) hop(event.player);
        if (card.value === 'draw2' || card.value === 'wild4') tweens.add(1, () => {}, { delay: 380, done: () => popup(event.player, SYMBOLS[card.value], card.value === 'wild4' ? '#ffffff' : color, { lift: 0.5, color: card.value === 'wild4' ? INK : '#fff' }) });
        break;
      }
      case 'draw':
        for (let i = 0; i < Math.min(event.count, 6); i++) flyCard(null, DECK_POS.clone().add(new Vector3(0, 0.2, 0)), handPoint(event.player), { faceUp: false, delay: i * 90 });
        if (event.count >= 2 && fresh) popup(event.player, `+${event.count}`, UNO_COLORS.red, { big: event.count >= 4 });
        break;
      case 'uno': {
        popup(event.player, 'Woono!', '#F2B90D', { color: INK, big: true });
        hop(event.player);
        const at = relative(event.player) === 0 ? handPoint(event.player) : headPoint(event.player, -0.6);
        burst(at, ['#F2B90D', '#ffffff', UNO_COLORS.red], 50, { speed: 1.8, up: 2, life: 0.9, gravity: 3 });
        break;
      }
      case 'skip': {
        popup(event.player, '⊘ Skip', '#ffffff', { color: UNO_COLORS.red });
        const k = relative(event.player);
        if (k !== 0) {
          const { x, z } = seatPosition(k, playerCount);
          shockwave(new Vector3(x * 0.62, 0, z * 0.62), UNO_COLORS.red, { size: 1.2 });
        }
        break;
      }
      case 'reverse':
        arrowBoost = 1;
        shockwave(new Vector3(0, 0, 0), '#ffffff', { size: 3.2, duration: 700 });
        break;
      case 'swap':
        for (const [a, b] of [[event.a, event.b], [event.b, event.a]]) for (let i = 0; i < 4; i++) flyCard(null, handPoint(a), handPoint(b), { faceUp: false, delay: i * 70 });
        popup(event.a, '⇄ Swap', '#ffffff', { color: INK });
        break;
      case 'rotate':
        arrowBoost = 1;
        for (let p = 0; p < playerCount; p++) flyCard(null, handPoint(p), handPoint((p + event.direction + playerCount) % playerCount), { faceUp: false });
        break;
      case 'challenge': {
        popup(event.player, 'Challenge!', '#ffffff', { color: INK, big: true });
        // Whoever was caught out (the +4 player if it worked, the challenger if not) gets the red flash.
        const loser = event.success ? event.offender : event.player;
        tweens.add(1, () => {}, {
          delay: 700,
          done: () => {
            popup(loser, event.success ? 'Caught!' : 'Nope!', event.success ? UNO_COLORS.green : UNO_COLORS.red, { lift: -0.3 });
            const at = relative(loser) === 0 ? handPoint(loser) : headPoint(loser, -0.8);
            burst(at, event.success ? [UNO_COLORS.green, '#ffffff'] : [UNO_COLORS.red, INK], 40, { speed: 1.6, up: 1.5 });
            if (relative(loser) === 0) addShake(0.06);
          },
        });
        break;
      }
      case 'timeout':
        popup(event.player, 'Time’s up!', UNO_COLORS.red);
        break;
      case 'win':
        hop(event.player, 4);
        popup(event.player, relative(event.player) === 0 ? 'You win!' : 'Winner!', '#F2B90D', { color: INK, big: true });
        if (fresh) confetti();
        break;
      default:
        break;
    }
  }

  // Where a seated avatar should look when its player isn't steering it:
  // at whoever's turn it is (down at its own cards when it's their own turn).
  const toward = new Vector3();
  function autoLook(index, seat) {
    const focus = winner ?? turn;
    if (focus === index) return { yaw: Math.sin(performance.now() / 1400 + seat.phase) * 0.15, pitch: 0.3 };
    const k = relative(focus);
    if (k === 0) toward.set(0, 1.5, SEAT_RADIUS);
    else {
      const { x, z } = seatPosition(k, playerCount);
      toward.set(x, 1.5, z);
    }
    toward.sub(seat.group.position);
    // Into the seat's own frame, where +z is straight at the table's centre.
    toward.applyAxisAngle(Y_AXIS, -seat.group.rotation.y);
    return { yaw: MathUtils.clamp(Math.atan2(toward.x, toward.z), -HEAD_YAW, HEAD_YAW), pitch: 0.05 };
  }

  // ─── Your hand ─────────────────────────────────────────────────────

  const handAim = new Vector3();
  let handHalfWidth = 1.2;

  // Hand cards carry a glow behind them; it goes before the card returns to the shared pool.
  function releaseHandCard(mesh) {
    mesh.userData.glow.removeFromParent();
    mesh.userData.glow.material.dispose();
    mesh.userData.glow = null;
    cards.release(mesh);
  }

  function syncHand(next) {
    const sorted = sortHand(next.hand);
    const ids = new Set(sorted.map((c) => c.id));
    leftHand.clear();
    for (const [id, mesh] of handCards) {
      if (ids.has(id)) continue;
      leftHand.set(id, mesh.getWorldPosition(new Vector3()));
      releaseHandCard(mesh);
      handCards.delete(id);
    }
    const n = sorted.length;
    // Spread the fan wider for more cards, but never past the edges of the view.
    const room = (handHalfWidth * 2) / hand.scale.x / FAN_RADIUS - 0.3;
    const spread = Math.min(n <= 1 ? 0 : 0.12 * (n - 1), MathUtils.clamp(room, 0.3, 1.5));
    sorted.forEach((card, i) => {
      let mesh = handCards.get(card.id);
      if (!mesh) {
        mesh = takeCard(card);
        mesh.material.depthTest = false;
        mesh.material.transparent = true;
        mesh.userData.cardId = card.id;
        const glowMesh = new Mesh(glowGeometry, new MeshBasicMaterial({ color: '#FFD84D', transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
        glowMesh.position.z = -0.002;
        glowMesh.raycast = () => {};
        mesh.add(glowMesh);
        mesh.userData.glow = glowMesh;
        // New cards slide in from off to the side, where the deck is.
        mesh.position.set(-handHalfWidth * 1.3, 0.4, 0);
        mesh.rotation.set(0, 0, 0.6);
        mesh.scale.setScalar(HAND_CARD_SCALE * 0.6);
        hand.add(mesh);
        handCards.set(card.id, mesh);
      }
      const angle = n > 1 ? (i / (n - 1) - 0.5) * spread : 0;
      mesh.userData.card = card;
      mesh.userData.angle = angle;
      mesh.userData.order = i;
      mesh.userData.home = new Vector3(Math.sin(angle) * FAN_RADIUS, Math.cos(angle) * FAN_RADIUS - FAN_RADIUS, i * 0.004);
    });
    refreshHandLook(next);
  }

  function refreshHandLook(next) {
    const playable = new Set(next.playable);
    for (const mesh of handCards.values()) {
      const can = playable.has(mesh.userData.cardId);
      mesh.userData.playable = can;
      mesh.material.color.set(can || next.winner !== null ? '#ffffff' : '#a3a3a3');
    }
  }

  function updateHand(dt, now) {
    const ease = 1 - Math.exp(-dt * 14);
    const myTurn = view && view.turn === view.you && view.winner === null;
    const pulse = 0.35 + Math.sin(now / 260) * 0.2;
    for (const mesh of handCards.values()) {
      const { home, angle, order, playable } = mesh.userData;
      const focused = mesh.userData.cardId === (selectedId ?? hoverId);
      const lift = focused ? 0.3 : playable ? 0.06 : 0;
      handAim.set(home.x - Math.sin(angle) * (focused ? -0.02 : 0), home.y + lift, home.z + (focused ? 0.12 : 0));
      mesh.position.lerp(handAim, ease);
      mesh.rotation.z += (-angle * (focused ? 0.4 : 1) - mesh.rotation.z) * ease;
      const scale = HAND_CARD_SCALE * (focused ? 1.18 : 1);
      mesh.scale.setScalar(mesh.scale.x + (scale - mesh.scale.x) * ease);
      mesh.renderOrder = focused ? 60 : 20 + order;
      mesh.userData.glow.renderOrder = mesh.renderOrder - 0.5;
      // Playable cards glow: on your turn, or out of turn when they're a jump-in.
      mesh.userData.glow.material.opacity = playable ? pulse + handFlash * 0.5 : myTurn ? handFlash * 0.4 : 0;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────

  function setView(next) {
    const newGame = next.gameId !== gameId;
    gameId = next.gameId;
    view = next;
    me = next.you;
    playerCount = next.players.length;
    if (next.direction !== direction) pointArrows(next.direction);
    direction = next.direction;
    turn = next.turn;
    winner = next.winner;
    syncSeats(next.players);
    colorRing.material.color.set(UNO_COLORS[next.color] ?? '#ffffff');
    if (!next.hand.some((c) => c.id === selectedId)) selectedId = null;

    if (newGame) {
      // Nothing to animate from: show the table as it is.
      while (pile.children.length) cards.release(pile.children[0]);
      for (const mesh of handCards.values()) releaseHandCard(mesh);
      handCards.clear();
      lastTopId = null;
      looks.clear();
      syncHand(next);
      setTopCard(next.top);
      lastEventId = next.events[next.events.length - 1]?.id ?? null;
      updateBillboards();
      return;
    }
    syncHand(next);
    const fresh = next.events.filter((e) => lastEventId === null || e.id > lastEventId);
    lastEventId = next.events[next.events.length - 1]?.id ?? lastEventId;
    let playedTop = false;
    fresh.forEach((event) => {
      if (event.type === 'play' && event.card.id === next.top.id) playedTop = true;
      playEvent(event, true);
    });
    if (!playedTop) setTopCard(next.top);
    leftHand.clear();

    const myTurn = next.turn === next.you && next.winner === null && next.swapPending === null;
    if (myTurn && !wasMyTurn) {
      handFlash = 1;
      shockwave(new Vector3(0, 0, TABLE_RADIUS - 0.8), '#F5C518', { size: 1.4 });
    }
    wasMyTurn = myTurn;
    updateBillboards();
  }

  function canDraw() {
    return Boolean(view) && view.turn === view.you && view.winner === null && view.swapPending === null && view.drawnCardId === null;
  }

  function updateBillboards() {
    if (!view) return;
    const ready = canDraw();
    const text = view.pendingDraw ? `Draw ${view.pendingDraw}` : 'Draw';
    drawLabel.draw(`${ready}:${text}`, (ctx, w, h) => ready && drawBanner(ctx, w, h, text, '#FFD84D', INK));
    drawLabel.sprite.visible = ready;
    const stacked = view.pendingDraw > 0 && view.winner === null;
    stackLabel.draw(`${view.pendingDraw}`, (ctx, w, h) => stacked && drawBanner(ctx, w, h, `+${view.pendingDraw} stacked`, UNO_COLORS.red));
    stackLabel.sprite.visible = stacked;
  }

  // Your mouse, from -1 to 1 across the view. Near the middle it barely
  // moves the camera, so picking a card doesn't swing the view about.
  function setPointer(x, y, active = true) {
    pointer.x = MathUtils.clamp(x, -1, 1);
    pointer.y = MathUtils.clamp(y, -1, 1);
    pointer.active = active;
  }

  // Touch dragging turns the view directly (in fractions of the view's size).
  function dragLook(dx, dy) {
    // Like grabbing the world: drag right and the view turns left.
    look.dragYaw = MathUtils.clamp(look.dragYaw + dx * 1.6, -LOOK_YAW, LOOK_YAW);
    look.dragPitch = MathUtils.clamp(look.dragPitch + dy * 1.0, -LOOK_PITCH, LOOK_PITCH);
  }

  // ─── Gyroscope ──────────────────────────────────────────────────────

  const deviceEuler = new Euler();
  const deviceQuat = new Quaternion();
  const screenTransform = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  const zAxis = new Vector3(0, 0, 1);
  const turnQuat = new Quaternion();
  const relativeQuat = new Quaternion();
  const relativeEuler = new Euler(0, 0, 0, 'YXZ');

  // The phone's orientation as a camera rotation (the maths behind three.js's
  // old DeviceOrientationControls), relative to how it was held when switched
  // on, so wherever you're facing counts as looking at the table.
  function setOrientation(alpha, beta, gamma, screenAngle = 0) {
    if (alpha === null || beta === null || gamma === null) return;
    deviceEuler.set(MathUtils.degToRad(beta), MathUtils.degToRad(alpha), -MathUtils.degToRad(gamma), 'YXZ');
    deviceQuat.setFromEuler(deviceEuler).multiply(screenTransform).multiply(turnQuat.setFromAxisAngle(zAxis, -MathUtils.degToRad(screenAngle)));
    if (!gyro.reference) gyro.reference = deviceQuat.clone().invert();
    relativeQuat.copy(gyro.reference).multiply(deviceQuat);
    relativeEuler.setFromQuaternion(relativeQuat, 'YXZ');
    gyro.yaw = MathUtils.clamp(relativeEuler.y, -LOOK_YAW, LOOK_YAW);
    gyro.pitch = MathUtils.clamp(relativeEuler.x, -LOOK_PITCH, LOOK_PITCH);
  }

  function setGyro(on) {
    gyro.on = on;
    gyro.reference = null;
    gyro.yaw = 0;
    gyro.pitch = 0;
  }

  function recenter() {
    gyro.reference = null;
    look.dragYaw = 0;
    look.dragPitch = 0;
  }

  // Where you're looking, from -1 to 1 (right and down are positive), for other players to see.
  function getLook() {
    return { x: -look.yaw / LOOK_YAW, y: -look.pitch / LOOK_PITCH };
  }

  // Another player's look: their avatar turns its head to match.
  function setLook(index, x, y) {
    looks.set(index, { x: MathUtils.clamp(Number(x) || 0, -1, 1), y: MathUtils.clamp(Number(y) || 0, -1, 1), at: performance.now() });
  }

  // ─── Picking ────────────────────────────────────────────────────────

  const raycaster = new Raycaster();
  const ndc = new Vector2();

  // What's under a point on the canvas (-1..1 each way): one of your cards, the draw pile, or nothing.
  function pick(x, y) {
    ndc.set(x, -y);
    raycaster.setFromCamera(ndc, camera);
    const handHits = raycaster.intersectObjects([...handCards.values()], false);
    if (handHits.length) {
      // Cards overlap: the one drawn on top wins, not the nearest.
      const top = handHits.reduce((best, hit) => (hit.object.renderOrder > best.object.renderOrder ? hit : best));
      return { type: 'card', id: top.object.userData.cardId, playable: Boolean(top.object.userData.playable) };
    }
    if (raycaster.intersectObjects([deckBox, deckTop, drawLabel.sprite], false).length) return { type: 'deck' };
    return null;
  }

  function setHover(x, y) {
    const hit = pick(x, y);
    hoverId = hit?.type === 'card' ? hit.id : null;
    hoverDeck = hit?.type === 'deck';
    return hit;
  }

  function clearHover() {
    hoverId = null;
    hoverDeck = false;
  }

  function setSelected(id) {
    selectedId = id;
  }

  // ─── Sizing ─────────────────────────────────────────────────────────

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Keep roughly 100° of the table in view across, however tall the screen is.
    const horizontal = MathUtils.degToRad(100);
    camera.fov = MathUtils.clamp(MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontal / 2) / camera.aspect)), 50, 84);
    camera.updateProjectionMatrix();
    const halfHeight = Math.tan(MathUtils.degToRad(camera.fov / 2)) * HAND_DEPTH;
    handHalfWidth = halfHeight * camera.aspect;
    // The hand sits along the bottom of the view, and shrinks on narrow screens.
    const fit = MathUtils.clamp(handHalfWidth / 1.25, 0.55, 1);
    hand.scale.setScalar(fit);
    hand.position.set(0, -halfHeight + 0.3 * fit, -HAND_DEPTH);
    if (view) syncHand(view);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const visibility = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
  visibility.observe(canvas);
  resize();

  let last = performance.now();
  const shakeOffset = new Vector3();
  const discTarget = new Vector3();
  renderer.setAnimationLoop((now) => {
    if (!running || !visible) {
      last = now;
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tweens.tick(now);
    particles.tick(dt);

    arrowBoost = Math.max(0, arrowBoost - dt * 1.2);
    arrows.rotation.y -= dt * (0.5 + arrowBoost * 6) * direction;
    arrowMaterial.opacity = 0.35 + arrowBoost * 0.5;
    handFlash = Math.max(0, handFlash - dt * 1.5);

    // Where you look: the gyroscope, or a touch drag, plus a glance toward the mouse near the edges.
    let yawGoal;
    let pitchGoal;
    if (gyro.on) {
      yawGoal = gyro.yaw;
      pitchGoal = gyro.pitch;
    } else {
      const edge = (v) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.35) / 0.65;
      yawGoal = MathUtils.clamp(look.dragYaw - (pointer.active ? edge(pointer.x) : 0) * LOOK_YAW, -LOOK_YAW, LOOK_YAW);
      pitchGoal = MathUtils.clamp(look.dragPitch - (pointer.active ? Math.min(0, edge(pointer.y)) : 0) * LOOK_PITCH, -LOOK_PITCH, LOOK_PITCH);
    }
    const lookEase = 1 - Math.exp(-dt * (gyro.on ? 12 : 5));
    look.yaw += (yawGoal - look.yaw) * lookEase;
    look.pitch += (pitchGoal - look.pitch) * lookEase;
    shake = Math.max(0, shake - dt * 0.35);
    if (shake > 0) shakeOffset.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0);
    else shakeOffset.set(0, 0, 0);
    camera.position.copy(EYE).add(shakeOffset);
    camera.rotation.set(basePitch + look.pitch, look.yaw, 0);

    updateHand(dt, now);

    for (const [index, seat] of seats) {
      const t = now / 1000 + seat.phase;
      const { body, head, face, faceOpen, faceClosed, arms, antenna, robot } = seat.avatar.userData;
      body.scale.y = 1 + Math.sin(t * 2) * (robot ? 0.01 : 0.02);
      arms[0].rotation.x = -1.0 + Math.sin(t * 1.7) * 0.05;
      arms[1].rotation.x = -1.0 + Math.sin(t * 1.7 + 1) * 0.05;
      if (antenna) antenna.position.x = Math.sin(t * 3) * 0.02;

      const their = looks.get(index);
      const goal = their && now - their.at < LOOK_STALE_MS ? { yaw: -their.x * HEAD_YAW, pitch: their.y * HEAD_PITCH } : autoLook(index, seat);
      const headEase = 1 - Math.exp(-dt * 7);
      seat.yaw += (goal.yaw - seat.yaw) * headEase;
      seat.pitch += (goal.pitch - seat.pitch) * headEase;
      head.rotation.set(seat.pitch, seat.yaw, Math.sin(t * 1.3) * 0.05);

      if (now > seat.blinkAt + 140) seat.blinkAt = now + 2000 + Math.random() * 3000;
      face.material = now > seat.blinkAt ? faceClosed : faceOpen;
      // Name tags bob gently, more when it's that player's turn.
      seat.tag.sprite.position.y = seat.tag.homeY + Math.sin(t * (turn === index ? 5 : 1.5)) * (turn === index ? 0.05 : 0.015);
    }

    if (playerCount) {
      const k = relative(winner ?? turn);
      const { x, z } = seatPosition(k, playerCount);
      if (k === 0) discTarget.set(0, 0.07, TABLE_RADIUS - 0.8);
      else discTarget.set(x * 0.62, 0.07, z * 0.62);
      turnDisc.position.lerp(discTarget, 1 - Math.exp(-dt * 10));
      turnDisc.material.opacity = 0.28 + Math.sin(now / 250) * 0.08;
    }

    const ready = canDraw();
    drawRing.material.opacity = ready ? 0.55 + Math.sin(now / 200) * 0.25 + (hoverDeck ? 0.2 : 0) : 0;
    drawRing.scale.setScalar(ready ? 1 + Math.sin(now / 200) * 0.05 + (hoverDeck ? 0.08 : 0) : 1);
    if (ready) drawLabel.setScale((1 + Math.sin(now / 200) * 0.05) * (hoverDeck ? 1.15 : 1));
    stackLabel.setScale(1 + Math.sin(now / 150) * 0.06);

    if (feltFlash > 0) {
      feltFlash = Math.max(0, feltFlash - dt * 1.4);
      feltMaterial.color.copy(feltColor).lerp(flashColor, feltFlash * 0.55);
    }
    renderer.render(scene, camera);
  });

  return {
    setView,
    setPointer,
    dragLook,
    setLook,
    getLook,
    setOrientation,
    setGyro,
    recenter,
    pick,
    setHover,
    clearHover,
    setSelected,
    resize,
    dispose() {
      running = false;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      visibility.disconnect();
      for (const [index, seat] of seats) removeSeat(index, seat);
      for (const mesh of handCards.values()) releaseHandCard(mesh);
      cards.dispose();
      popups.dispose();
      confettiBits.dispose();
      rings.dispose();
      particles.dispose();
      drawLabel.dispose();
      stackLabel.dispose();
      disposeGroup(scene);
      scene.traverse((obj) => obj.isMesh && obj.geometry.dispose());
      for (const geometry of [cardGeometry, popupGeometry, confettiGeometry, ringGeometry, glowGeometry]) geometry.dispose();
      feltMaterial.dispose();
      glow.dispose();
      kit.dispose();
      renderer.dispose();
    },
  };
}

// ─── Lobby preview: one avatar, slowly turning ─────────────────────────

export function createAvatarPreview(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  const kit = new Kit();
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.15, 5);
  camera.lookAt(0, 0.95, 0);
  scene.add(new HemisphereLight('#ffffff', '#7a7a8c', 1.8));
  const sun = new DirectionalLight('#ffffff', 1.4);
  sun.position.set(2, 5, 4);
  scene.add(sun);

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
    avatar.rotation.y = Math.sin(angle) * 0.9;
    body.scale.y = 1 + Math.sin(now / 500) * 0.02;
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
