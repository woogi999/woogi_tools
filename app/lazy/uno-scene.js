/* eslint-disable warp-drive/no-legacy-request-patterns -- ctx.save() here is the canvas API, not a data request */
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  Group,
  Mesh,
  SphereGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  ConeGeometry,
  TorusGeometry,
  BoxGeometry,
  PlaneGeometry,
  RingGeometry,
  MeshToonMaterial,
  MeshBasicMaterial,
  ShaderMaterial,
  CanvasTexture,
  DataTexture,
  RedFormat,
  NearestFilter,
  SRGBColorSpace,
  BackSide,
  DoubleSide,
  Color,
  Vector3,
  MathUtils,
} from 'three';
import { drawFace, normaliseAvatar, avatarKey } from '../utils/avatar';

// The 3D Uno table: doodle-style avatars around a round table, the draw and
// discard piles in the middle, and little animations for everything that
// happens (cards flying, Uno! shouts, hands swapping). Your own cards stay
// in the 2D hand on the page; this only draws what everyone can see.
//
// Kept light on purpose: a handful of low-poly shapes per avatar, textures
// drawn once on small canvases and cached, one renderer, and no loaders,
// post-processing or physics. It's loaded with a dynamic import, so three.js
// is only downloaded once someone opens Uno.

const UNO_COLORS = { red: '#E5484D', yellow: '#F2B90D', green: '#30A46C', blue: '#3E7BE0' };
const INK = '#141414';
const TABLE_RADIUS = 3.1;
const SEAT_RADIUS = 3.85;
const AVATAR_SCALE = 1.2;
const DECK_POS = new Vector3(-0.85, 0.2, 0);
const PILE_POS = new Vector3(0.55, 0.2, 0);
const SYMBOLS = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4' };
const CARD_W = 0.62;
const CARD_H = 0.93;

// ─── Shared materials & textures ──────────────────────────────────────

function toonGradient() {
  const texture = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
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

class Kit {
  gradient = toonGradient();
  outline = outlineMaterial(0.018);
  outlineThin = outlineMaterial(0.01);
  toons = new Map();
  textures = new Map();
  geometries = new Map();

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
    return this.texture(key, 128, 192, (ctx, w, h) => drawCard(ctx, w, h, card));
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

function drawCard(ctx, w, h, card) {
  const r = 14;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, r);
  ctx.fill();
  const inset = 7;
  ctx.beginPath();
  ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, r - 5);
  if (!card) {
    ctx.fillStyle = '#141414';
    ctx.fill();
  } else if (!card.color) {
    ctx.save();
    ctx.clip();
    const cx = w / 2;
    const cy = h / 2;
    const quads = [UNO_COLORS.red, UNO_COLORS.yellow, UNO_COLORS.green, UNO_COLORS.blue];
    quads.forEach((color, i) => {
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

  // The tilted white oval.
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
  if (!card) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-0.32);
    ctx.font = 'italic 800 36px Moderustic, sans-serif';
    ctx.fillStyle = '#F2B90D';
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 5;
    ctx.strokeText('Uno', 0, 2);
    ctx.fillText('Uno', 0, 2);
    ctx.restore();
    return;
  }
  const symbol = SYMBOLS[card.value] ?? card.value;
  ctx.font = `800 ${symbol.length > 1 ? 50 : 62}px Moderustic, sans-serif`;
  ctx.fillStyle = card.color ? (card.color === 'yellow' ? '#B58600' : UNO_COLORS[card.color]) : '#141414';
  ctx.fillText(symbol, w / 2, h / 2 + 3);
  ctx.font = '800 26px Moderustic, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeText(symbol, 26, 28);
  ctx.fillText(symbol, 26, 28);
}

// Per-mesh materials (faces, cards) belong to one object; toon materials,
// geometries and textures are shared and stay cached in the kit.
function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.isMesh && obj.material?.isMeshBasicMaterial) obj.material.dispose();
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

const HEAD_R = 0.46;

function faceTexture(kit, avatar, blink) {
  return kit.texture(`face:${avatarKey(avatar)}:${blink}`, 256, 256, (ctx, w) => drawFace(ctx, avatar, w, { blink }));
}

// A head-and-torso doodle person, facing +z, standing on y = 0.
export function buildAvatar(avatarInput, kit) {
  const avatar = normaliseAvatar(avatarInput);
  const group = new Group();
  const skin = kit.toon(avatar.skin);
  const hair = kit.toon(avatar.hairColor);
  const shirt = kit.toon(avatar.shirt);

  const body = withOutline(new Mesh(kit.geometry('body', () => new CapsuleGeometry(0.42, 0.42, 4, 14)), shirt), kit);
  body.position.y = 0.72;
  body.scale.set(1, 1, 0.8);
  group.add(body);

  const head = new Group();
  // Turn first, then nod, then tilt: how a head actually looks around.
  head.rotation.order = 'YXZ';
  head.position.y = 1.62;
  group.add(head);
  head.add(withOutline(new Mesh(kit.geometry('head', () => new SphereGeometry(HEAD_R, 28, 18)), skin), kit));

  // The face is a patch of sphere just in front of the head, so the 2D drawing wraps round it.
  const faceGeometry = kit.geometry('face', () => new SphereGeometry(HEAD_R * 1.012, 20, 16, Math.PI / 2 - 0.85, 1.7, Math.PI / 2 - 0.78, 1.56));
  const faceOpen = new MeshBasicMaterial({ map: faceTexture(kit, avatar, 0), transparent: true, alphaTest: 0.35, depthWrite: false });
  const face = new Mesh(faceGeometry, faceOpen);
  face.renderOrder = 1;
  head.add(face);
  group.userData.face = face;
  group.userData.faceOpen = faceOpen;
  group.userData.faceClosed = new MeshBasicMaterial({ map: faceTexture(kit, avatar, 1), transparent: true, alphaTest: 0.35, depthWrite: false });
  group.userData.head = head;
  group.userData.body = body;

  const add = (geometry, material, position, rotation, scale, parent = head, thin = true) => {
    const mesh = withOutline(new Mesh(geometry, material), kit, thin);
    if (position) mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    if (scale) mesh.scale.set(...scale);
    parent.add(mesh);
    return mesh;
  };

  const cap = (thetaLength, radius = 1.1) => kit.geometry(`cap:${thetaLength}:${radius}`, () => new SphereGeometry(HEAD_R * radius, 24, 12, 0, Math.PI * 2, 0, thetaLength));
  const backCap = (thetaLength, radius = 1.07) => kit.geometry(`back:${thetaLength}:${radius}`, () => new SphereGeometry(HEAD_R * radius, 20, 12, Math.PI, Math.PI, 0, thetaLength));

  switch (avatar.hair) {
    case 'bowl':
      add(cap(Math.PI * 0.42), hair);
      add(backCap(Math.PI * 0.66), hair);
      break;
    case 'long':
      add(cap(Math.PI * 0.4), hair);
      add(backCap(Math.PI * 0.86, 1.12), hair, [0, -0.02, -0.02], null, [1.08, 1.15, 1]);
      break;
    case 'bun':
      add(cap(Math.PI * 0.4), hair);
      add(backCap(Math.PI * 0.6), hair);
      add(kit.geometry('bun', () => new SphereGeometry(0.19, 14, 10)), hair, [0, 0.42, -0.24]);
      break;
    case 'spiky': {
      add(cap(Math.PI * 0.38), hair);
      add(backCap(Math.PI * 0.55), hair);
      const cone = kit.geometry('spike', () => new ConeGeometry(0.13, 0.38, 6));
      for (let i = 0; i < 7; i++) {
        const around = (i / 7) * Math.PI * 2;
        const tilt = 0.55;
        const dir = new Vector3(Math.sin(around) * Math.sin(tilt), Math.cos(tilt), Math.cos(around) * Math.sin(tilt) - 0.25).normalize();
        const spike = add(cone, hair, dir.clone().multiplyScalar(HEAD_R * 1.05).toArray());
        spike.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
      }
      add(cone, hair, [0, HEAD_R * 1.12, 0]);
      break;
    }
    case 'curly': {
      const puff = kit.geometry('puff', () => new SphereGeometry(0.17, 12, 8));
      for (let i = 0; i < 9; i++) {
        const around = (i / 9) * Math.PI * 2;
        add(puff, hair, [Math.sin(around) * 0.33, 0.3, Math.cos(around) * 0.3 - 0.04]);
      }
      add(puff, hair, [0, 0.46, -0.02], null, [1.3, 1, 1.3]);
      break;
    }
    case 'mohawk':
      for (let i = 0; i < 5; i++) {
        const t = -0.9 + i * 0.45;
        add(kit.geometry('mohawk', () => new BoxGeometry(0.09, 0.26, 0.2)), hair, [0, Math.cos(t) * HEAD_R + 0.06, Math.sin(t) * HEAD_R], [t, 0, 0]);
      }
      break;
    default:
      break;
  }

  switch (avatar.extra) {
    case 'bow': {
      const pink = kit.toon('#FF6B8B');
      const wing = kit.geometry('bow', () => new ConeGeometry(0.11, 0.2, 4));
      add(wing, pink, [0.2, 0.44, 0.08], [0, 0, Math.PI / 2]);
      add(wing, pink, [0.42, 0.36, 0.08], [0, 0, -Math.PI / 2]);
      break;
    }
    case 'cap':
      add(cap(Math.PI * 0.44, 1.14), shirt);
      add(kit.geometry('brim', () => new CylinderGeometry(0.3, 0.3, 0.04, 20)), shirt, [0, 0.2, 0.36], null, [1, 1, 0.9]);
      break;
    case 'halo': {
      const halo = new Mesh(kit.geometry('halo', () => new TorusGeometry(0.28, 0.035, 8, 28)), kit.toon('#F5C518'));
      halo.position.set(0, 0.7, 0);
      halo.rotation.x = Math.PI / 2;
      head.add(halo);
      break;
    }
    default:
      break;
  }

  // Arms reaching forward to hold cards.
  for (const side of [-1, 1]) {
    const arm = add(kit.geometry('arm', () => new CapsuleGeometry(0.1, 0.38, 3, 8)), shirt, [side * 0.44, 0.92, 0.22], [1.15, 0, side * -0.35], null, group);
    add(kit.geometry('hand', () => new SphereGeometry(0.11, 10, 8)), skin, [0, -0.28, 0], null, null, arm);
  }
  return group;
}

// ─── Animation helpers ────────────────────────────────────────────────

const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

class Tweens {
  list = [];

  add(duration, update, { delay = 0, done } = {}) {
    this.list.push({ start: performance.now() + delay, duration, update, done });
  }

  get busy() {
    return this.list.length > 0;
  }

  tick(now) {
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

// ─── Pooling ──────────────────────────────────────────────────────────

// Meshes that come and go all game (flying cards, the discard pile, the fans
// in everyone's hands, speech bubbles, confetti) are recycled instead of
// being created and thrown away each time: no garbage-collection hitches
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

// ─── The table scene ──────────────────────────────────────────────────

// How far you can look around with the mouse (world units the camera's aim shifts).
const LOOK_X = 0.85;
const LOOK_Y = 0.4;
const PARALLAX_X = 0.2;
const PARALLAX_Y = 0.1;
// How far other players' heads turn to follow where they're looking (radians).
const HEAD_YAW = 0.75;
const HEAD_PITCH = 0.35;
// Look updates older than this are stale; the avatar goes back to watching the game.
const LOOK_STALE_MS = 4000;
// The camera aims a little in front of the table's centre, so the table sits
// in the upper part of the view and your hand of cards has room below it.
const CAMERA_TARGET = new Vector3(0, 0.15, 1.15);

export function createUnoScene(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = SRGBColorSpace;

  const kit = new Kit();
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 60);
  const cameraBase = new Vector3(0, 6.4, 7.4);
  const aim = new Vector3().copy(CAMERA_TARGET);
  camera.position.copy(cameraBase);
  camera.lookAt(aim);

  scene.add(new HemisphereLight('#ffffff', '#6b6b7a', 1.6));
  const sun = new DirectionalLight('#ffffff', 1.6);
  sun.position.set(3, 8, 5);
  scene.add(sun);

  // Table: felt top, wooden rim, a pedestal.
  const table = new Group();
  scene.add(table);
  const felt = new Mesh(new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.12, 56), kit.toon('#2F6B55'));
  table.add(withOutline(felt, kit));
  const rim = new Mesh(new TorusGeometry(TABLE_RADIUS, 0.12, 10, 64), kit.toon('#7A5234'));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.05;
  table.add(withOutline(rim, kit, true));
  const leg = new Mesh(new CylinderGeometry(0.5, 0.9, 1.8, 20), kit.toon('#5E3F28'));
  leg.position.y = -0.95;
  table.add(leg);

  // A ring round the discard pile in the colour to match, with arrows showing the direction of play.
  const colorRing = new Mesh(new RingGeometry(0.78, 0.9, 48), new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide, transparent: true, opacity: 0.9 }));
  colorRing.rotation.x = -Math.PI / 2;
  colorRing.position.set(PILE_POS.x, 0.075, PILE_POS.z);
  scene.add(colorRing);
  const arrows = new Group();
  arrows.position.set(0, 0.08, 0);
  scene.add(arrows);
  const arrowMaterial = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 });
  const arrowGeometry = new ConeGeometry(0.1, 0.26, 3);
  const Y_AXIS = new Vector3(0, 1, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const arrow = new Mesh(arrowGeometry, arrowMaterial);
    arrow.position.set(Math.sin(a) * 2.35, 0, Math.cos(a) * 2.35);
    arrow.userData.angle = a;
    arrows.add(arrow);
  }
  // Each cone points along the circle, the way play is going.
  const pointArrows = (dir) => {
    for (const arrow of arrows.children) {
      arrow.rotation.set(Math.PI / 2, 0, 0);
      arrow.rotateOnWorldAxis(Y_AXIS, arrow.userData.angle - (dir * Math.PI) / 2);
    }
  };
  pointArrows(1);

  // Draw pile: a stack with a back on top.
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

  const pile = new Group();
  pile.position.copy(PILE_POS);
  scene.add(pile);

  const cardGeometry = new PlaneGeometry(CARD_W, CARD_H);
  const cards = new MeshPool(() => new Mesh(cardGeometry, new MeshBasicMaterial({ side: DoubleSide })));
  const takeCard = (card) => {
    const mesh = cards.acquire();
    mesh.material.map = kit.cardFace(card);
    return mesh;
  };
  const bubbleGeometry = new PlaneGeometry(1.3, 0.65);
  const bubbles = new MeshPool(() => new Mesh(bubbleGeometry, new MeshBasicMaterial({ transparent: true, depthTest: false })));
  const confettiGeometry = new PlaneGeometry(0.08, 0.14);
  const confettiBits = new MeshPool(() => new Mesh(confettiGeometry, new MeshBasicMaterial({ side: DoubleSide })));

  const turnDisc = new Mesh(new RingGeometry(0.45, 0.62, 40), new MeshBasicMaterial({ color: '#F5C518', transparent: true, opacity: 0.35 }));
  turnDisc.rotation.x = -Math.PI / 2;
  scene.add(turnDisc);

  // The labels are projected from the resting camera, so they don't swim as you look around.
  const restingCamera = camera.clone();

  const tweens = new Tweens();
  const seats = new Map(); // seat index -> { group, avatar, fan, count, key, phase, blinkAt, yaw, pitch }
  const looks = new Map(); // seat index -> { x, y, at } from that player's mouse
  const pointer = { x: 0, y: 0 };
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

  // Where seat k (0 = you, counting clockwise) sits, and which way it faces.
  const seatPosition = (k, n) => {
    const angle = -(k / n) * Math.PI * 2;
    return { angle, x: Math.sin(angle) * SEAT_RADIUS, z: Math.cos(angle) * SEAT_RADIUS };
  };
  const relative = (index) => (index - me + playerCount) % playerCount;
  const handPoint = (index) => {
    const k = relative(index);
    if (k === 0) return new Vector3(0, 2.2, 5.6); // you: just under the camera
    const { x, z } = seatPosition(k, playerCount);
    return new Vector3(x * 0.82, 1.1, z * 0.82);
  };

  function releaseFan(seat) {
    if (!seat.fan) return;
    for (const card of [...seat.fan.children]) cards.release(card);
    seat.fan.removeFromParent();
    seat.fan = null;
  }

  function buildFan(count) {
    const fan = new Group();
    const shown = Math.min(count, 10);
    for (let i = 0; i < shown; i++) {
      const card = takeCard(null);
      card.scale.setScalar(0.5);
      const spread = shown > 1 ? (i / (shown - 1) - 0.5) * 1.1 : 0;
      card.position.set(spread * 0.5, Math.cos(spread) * 0.08, i * 0.004);
      card.rotation.z = -spread * 0.7;
      fan.add(card);
    }
    fan.position.set(0, 1.12, 0.52);
    fan.rotation.x = -0.35;
    return fan;
  }

  function syncSeats(players) {
    const n = players.length;
    const rebuildAll = layoutKey !== `${n}:${me}`;
    layoutKey = `${n}:${me}`;
    for (const [index, seat] of seats) {
      if (rebuildAll || !players[index] || seat.key !== avatarKey(players[index].avatar) || index === me) {
        releaseFan(seat);
        scene.remove(seat.group);
        disposeGroup(seat.group);
        seats.delete(index);
      }
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
        avatar.position.y = -0.35;
        avatar.scale.setScalar(AVATAR_SCALE);
        group.add(avatar);
        scene.add(group);
        seat = { group, avatar, fan: null, count: -1, key: avatarKey(player.avatar), phase: Math.random() * 10, blinkAt: performance.now() + 1000 + Math.random() * 3000, yaw: 0, pitch: 0 };
        seats.set(index, seat);
      }
      const count = Math.min(player.count, 10);
      if (seat.count !== count) {
        releaseFan(seat);
        seat.fan = buildFan(player.count);
        seat.avatar.add(seat.fan);
        seat.count = count;
      }
    });
  }

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

  function flyCard(card, from, to, { delay = 0, faceUp = true, done } = {}) {
    const mesh = takeCard(faceUp ? card : null);
    mesh.visible = false;
    scene.add(mesh);
    const spin = (Math.random() - 0.5) * 1.2;
    tweens.add(
      420,
      (t) => {
        mesh.visible = true;
        const e = easeInOut(t);
        mesh.position.lerpVectors(from, to, e);
        mesh.position.y += Math.sin(t * Math.PI) * 0.9;
        mesh.rotation.set(MathUtils.lerp(-0.4, -Math.PI / 2, e), 0, spin * (1 - e));
        mesh.scale.setScalar(MathUtils.lerp(faceUp ? 0.9 : 0.55, 1, e));
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

  function bubble(index, text, color = '#ffffff') {
    const k = relative(index);
    const mesh = bubbles.acquire();
    mesh.material.map = kit.texture(`bubble:${text}:${color}`, 256, 128, (ctx, w, h) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.roundRect(8, 8, w - 16, h - 36, 30);
      ctx.moveTo(w / 2 - 18, h - 30);
      ctx.lineTo(w / 2, h - 6);
      ctx.lineTo(w / 2 + 18, h - 30);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = 'italic 800 52px Moderustic, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, (h - 28) / 2 + 4);
    });
    mesh.material.needsUpdate = true;
    mesh.renderOrder = 10;
    let base;
    if (k === 0) {
      base = new Vector3(0, 1.6, 2.6);
    } else {
      const { x, z } = seatPosition(k, playerCount);
      base = new Vector3(x, 2.75, z);
    }
    mesh.position.copy(base);
    scene.add(mesh);
    tweens.add(
      1500,
      (t) => {
        mesh.quaternion.copy(camera.quaternion);
        const pop = t < 0.15 ? easeOut(t / 0.15) : t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1;
        mesh.scale.setScalar(Math.max(0.001, pop));
        mesh.position.y = base.y + t * 0.3;
      },
      { done: () => bubbles.release(mesh) },
    );
  }

  function hop(index, times = 1) {
    const seat = seats.get(index);
    if (!seat) return;
    tweens.add(420 * times, (t) => {
      seat.avatar.position.y = -0.35 + Math.abs(Math.sin(t * Math.PI * times)) * 0.35;
    });
  }

  function confetti() {
    const colors = Object.values(UNO_COLORS);
    for (let i = 0; i < 70; i++) {
      const mesh = confettiBits.acquire();
      mesh.material.color.set(colors[i % 4]);
      const start = new Vector3((Math.random() - 0.5) * 5, 4 + Math.random() * 2, (Math.random() - 0.5) * 4);
      const drift = new Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5);
      const spin = new Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      mesh.position.copy(start);
      scene.add(mesh);
      tweens.add(
        1800 + Math.random() * 900,
        (t) => {
          mesh.position.set(start.x + drift.x * t, start.y - t * 4.4, start.z + drift.z * t);
          mesh.rotation.set(spin.x * t, spin.y * t, spin.z * t);
        },
        { delay: Math.random() * 400, done: () => confettiBits.release(mesh) },
      );
    }
  }

  function playEvent(event, fresh) {
    switch (event.type) {
      case 'play': {
        const from = handPoint(event.player);
        const to = PILE_POS.clone().add(new Vector3(0, 0.05, 0));
        flyCard(event.card, from, to, { done: () => setTopCard(event.card) });
        if (seats.has(event.player)) hop(event.player);
        break;
      }
      case 'draw':
        for (let i = 0; i < Math.min(event.count, 6); i++) flyCard(null, DECK_POS.clone().add(new Vector3(0, 0.2, 0)), handPoint(event.player), { faceUp: false, delay: i * 90 });
        break;
      case 'uno':
        bubble(event.player, 'Uno!', '#F2B90D');
        hop(event.player);
        break;
      case 'skip':
        bubble(event.player, '⊘', '#ffffff');
        break;
      case 'swap':
        for (const [a, b] of [[event.a, event.b], [event.b, event.a]]) for (let i = 0; i < 4; i++) flyCard(null, handPoint(a), handPoint(b), { faceUp: false, delay: i * 70 });
        bubble(event.a, '⇄', '#ffffff');
        break;
      case 'rotate':
        for (let p = 0; p < playerCount; p++) flyCard(null, handPoint(p), handPoint((p + event.direction + playerCount) % playerCount), { faceUp: false });
        break;
      case 'win':
        hop(event.player, 4);
        bubble(event.player, 'Win!', '#ffffff');
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
    const target = k === 0 ? new Vector3(0, 1.5, SEAT_RADIUS) : (() => {
      const { x, z } = seatPosition(k, playerCount);
      return new Vector3(x, 1.5, z);
    })();
    toward.subVectors(target, seat.group.position);
    // Into the seat's own frame, where +z is straight at the table's centre.
    toward.applyAxisAngle(Y_AXIS, -seat.group.rotation.y);
    return { yaw: MathUtils.clamp(Math.atan2(toward.x, toward.z), -HEAD_YAW, HEAD_YAW), pitch: 0.05 };
  }

  // ─── Public API ────────────────────────────────────────────────────

  function setView(next) {
    const newGame = next.gameId !== gameId;
    gameId = next.gameId;
    me = next.you;
    playerCount = next.players.length;
    if (next.direction !== direction) pointArrows(next.direction);
    direction = next.direction;
    turn = next.turn;
    winner = next.winner;
    syncSeats(next.players);
    colorRing.material.color.set(UNO_COLORS[next.color] ?? '#ffffff');

    if (newGame) {
      // Nothing to animate from: show the table as it is.
      while (pile.children.length) cards.release(pile.children[0]);
      lastTopId = null;
      looks.clear();
      setTopCard(next.top);
      lastEventId = next.events[next.events.length - 1]?.id ?? null;
      return;
    }
    const fresh = next.events.filter((e) => lastEventId === null || e.id > lastEventId);
    lastEventId = next.events[next.events.length - 1]?.id ?? lastEventId;
    let playedTop = false;
    fresh.forEach((event) => {
      if (event.type === 'play' && event.card.id === next.top.id) playedTop = true;
      playEvent(event, true);
    });
    if (!playedTop) setTopCard(next.top);
  }

  // Your own mouse, from -1 to 1 across the view: the camera glances that way.
  function setPointer(x, y) {
    pointer.x = MathUtils.clamp(x, -1, 1);
    pointer.y = MathUtils.clamp(y, -1, 1);
  }

  // Another player's mouse: their avatar turns its head to match.
  function setLook(index, x, y) {
    looks.set(index, { x: MathUtils.clamp(Number(x) || 0, -1, 1), y: MathUtils.clamp(Number(y) || 0, -1, 1), at: performance.now() });
  }

  // Screen positions (CSS pixels within the canvas) for the HTML labels. Uses
  // the canvas's layout size, not its on-screen rect, so labels stay put when
  // the whole page is zoomed down in picture-in-picture.
  function anchors() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const project = (v) => {
      const p = v.clone().project(restingCamera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    };
    const seatsOut = [];
    for (let index = 0; index < playerCount; index++) {
      const k = relative(index);
      if (k === 0) continue;
      const { x, z } = seatPosition(k, playerCount);
      // Just above the avatar's head.
      seatsOut.push({ index, ...project(new Vector3(x, 2.45, z)) });
    }
    return { seats: seatsOut, deck: project(DECK_POS), pile: project(PILE_POS) };
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Narrow screens pull the camera back so every seat stays in view.
    const narrow = Math.max(0, 1.4 - camera.aspect);
    cameraBase.set(0, 6.6 + narrow * 3.4, 7.6 + narrow * 4.4);
    camera.updateProjectionMatrix();
    restingCamera.copy(camera);
    restingCamera.position.copy(cameraBase);
    restingCamera.lookAt(CAMERA_TARGET);
    restingCamera.updateMatrixWorld();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const visibility = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
  visibility.observe(canvas);
  resize();

  const lookGoal = new Vector3();
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    if (!running || !visible) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tweens.tick(now);
    arrows.rotation.y -= dt * 0.5 * direction;

    // Glance toward the mouse, easing in, with a touch of parallax.
    const ease = 1 - Math.exp(-dt * 6);
    lookGoal.set(CAMERA_TARGET.x + pointer.x * LOOK_X, CAMERA_TARGET.y - pointer.y * LOOK_Y, CAMERA_TARGET.z);
    aim.lerp(lookGoal, ease);
    camera.position.lerp(lookGoal.set(cameraBase.x - pointer.x * PARALLAX_X, cameraBase.y + pointer.y * PARALLAX_Y, cameraBase.z), ease);
    camera.lookAt(aim);

    for (const [index, seat] of seats) {
      const t = now / 1000 + seat.phase;
      const { body, head, face, faceOpen, faceClosed } = seat.avatar.userData;
      body.scale.y = 1 + Math.sin(t * 2) * 0.02;

      const look = looks.get(index);
      const goal = look && now - look.at < LOOK_STALE_MS ? { yaw: -look.x * HEAD_YAW, pitch: look.y * HEAD_PITCH } : autoLook(index, seat);
      const headEase = 1 - Math.exp(-dt * 7);
      seat.yaw += (goal.yaw - seat.yaw) * headEase;
      seat.pitch += (goal.pitch - seat.pitch) * headEase;
      head.rotation.set(seat.pitch, seat.yaw, Math.sin(t * 1.3) * 0.05);

      if (now > seat.blinkAt + 140) seat.blinkAt = now + 2000 + Math.random() * 3000;
      face.material = now > seat.blinkAt ? faceClosed : faceOpen;
    }

    if (playerCount) {
      const k = relative(winner ?? turn);
      const { x, z } = seatPosition(k, playerCount);
      const target = k === 0 ? new Vector3(0, 0.07, TABLE_RADIUS - 0.8) : new Vector3(x * 0.62, 0.07, z * 0.62);
      turnDisc.position.lerp(target, 1 - Math.exp(-dt * 10));
      turnDisc.material.opacity = 0.28 + Math.sin(now / 250) * 0.08;
    }
    renderer.render(scene, camera);
  });

  return {
    setView,
    setPointer,
    setLook,
    anchors,
    resize,
    dispose() {
      running = false;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      visibility.disconnect();
      for (const seat of seats.values()) releaseFan(seat);
      cards.dispose();
      bubbles.dispose();
      confettiBits.dispose();
      disposeGroup(scene);
      scene.traverse((obj) => obj.isMesh && obj.geometry.dispose());
      for (const geometry of [cardGeometry, bubbleGeometry, confettiGeometry]) geometry.dispose();
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
  camera.position.set(0, 1.55, 4.3);
  camera.lookAt(0, 1.15, 0);
  scene.add(new HemisphereLight('#ffffff', '#6b6b7a', 1.7));
  const sun = new DirectionalLight('#ffffff', 1.5);
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
    avatar.rotation.y = Math.sin(angle) * 0.9;
    avatar.userData.body.scale.y = 1 + Math.sin(now / 500) * 0.02;
    avatar.userData.head.rotation.z = Math.sin(now / 800) * 0.06;
    const blinking = now > blinkAt;
    if (now > blinkAt + 140) blinkAt = now + 1800 + Math.random() * 2500;
    avatar.userData.face.material = blinking ? avatar.userData.faceClosed : avatar.userData.faceOpen;
    renderer.render(scene, camera);
  });

  return {
    setAvatar(next) {
      const nextKey = avatarKey(next);
      if (nextKey === key) return;
      key = nextKey;
      if (avatar) {
        scene.remove(avatar);
        disposeGroup(avatar);
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
      kit.dispose();
      renderer.dispose();
    },
  };
}
