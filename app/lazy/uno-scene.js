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
  CylinderGeometry,
  ConeGeometry,
  TorusGeometry,
  BoxGeometry,
  PlaneGeometry,
  RingGeometry,
  CircleGeometry,
  MeshToonMaterial,
  MeshBasicMaterial,
  CanvasTexture,
  SRGBColorSpace,
  AdditiveBlending,
  DoubleSide,
  Color,
  Vector2,
  Vector3,
  Euler,
  Quaternion,
  Raycaster,
  MathUtils,
} from 'three';
import { createElement, Bot, Crown } from 'sketchyicons';
import config from 'woogi-tools/config/environment';
import { avatarKey } from '../utils/avatar';
import { AvatarKit, HEAD_Y, buildAvatar, disposeAvatar, disposeGroup, holdCards, moodFace, reachArms, withOutline } from './avatar-model';

export { createAvatarPreview } from './avatar-model';

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
// The cards other players hold, as a fraction of a card on the table.
const SEAT_CARD_SCALE = 0.25;
const DECK_POS = new Vector3(-0.75, 0.2, -0.1);
const PILE_POS = new Vector3(0.5, 0.2, -0.1);
const SYMBOLS = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4', target2: '+2', target4: '+4', draw99: '+99' };
const TARGETED = new Set(['target2', 'target4']);
const CARD_W = 0.62;
const CARD_H = 0.93;
const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3 };
const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'];
const Y_AXIS = new Vector3(0, 1, 0);

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';

// ─── Shared materials & textures ──────────────────────────────────────

// The site's own doodle, used as the art on the back of every card.
const BACK_ART_URL = `${config.rootURL ?? '/'}favicon.png`;

class Kit extends AvatarKit {
  backArt = null;

  constructor() {
    super();
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

  cardFace(card) {
    const key = card ? `card:${card.color ?? 'wild'}:${card.value}` : 'card:back';
    return this.texture(key, 160, 240, (ctx, w, h) => drawCard(ctx, w, h, card, this.backArt));
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
  const ink = card.color ? (card.color === 'yellow' ? '#B58600' : UNO_COLORS[card.color]) : '#141414';
  if (TARGETED.has(card.value)) {
    // Targeted draw cards carry crosshairs behind the number.
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 4 * unit;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 34 * unit, 0, Math.PI * 2);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      ctx.moveTo(w / 2 + dx * 26 * unit, h / 2 + dy * 26 * unit);
      ctx.lineTo(w / 2 + dx * 44 * unit, h / 2 + dy * 44 * unit);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.font = `800 ${(symbol.length > 2 ? 40 : symbol.length > 1 ? 50 : 62) * unit}px Moderustic, sans-serif`;
  ctx.fillStyle = ink;
  ctx.fillText(symbol, w / 2, h / 2 + 3 * unit);
  ctx.font = `800 ${(symbol.length > 2 ? 20 : 26) * unit}px Moderustic, sans-serif`;
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
    // A `done` often starts a follow-up tween (a delayed pop-up, a shockwave),
    // which lands in the fresh list rather than being lost when this one is replaced.
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

function drawNameTag(ctx, w, h, { name, count, turn, uno, exposed, winner, bot }) {
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
  // The card count hangs underneath: red once they've said Woono, orange while they can still be called out.
  const badge = exposed ? `${count} · no Woono!` : uno ? `${count} · WOONO!` : `${count} ${count === 1 ? 'card' : 'cards'}`;
  ctx.font = '800 26px Moderustic, sans-serif';
  const bw = ctx.measureText(badge).width + 34;
  pill(ctx, (w - bw) / 2, h * 0.64, bw, h * 0.32, exposed ? '#E8740C' : uno ? UNO_COLORS.red : INK, null);
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
// How much the fan drops and tilts towards its ends. A full arc sends the
// outer cards of a big hand off the bottom of the screen, so it's kept shallow.
const FAN_CURVE = 0.28;
const FAN_TILT = 0.45;
// How high above your hand a card you've just drawn waits.
const CENTRE_Y = 0.78;

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

  // ─── Picking a wild's colour, or a target, right on the table ─────

  // Four coloured pads floating over the pile, facing you.
  const colorWheel = new Group();
  colorWheel.position.set(PILE_POS.x, 0.75, PILE_POS.z);
  colorWheel.visible = false;
  scene.add(colorWheel);
  const colorPads = Object.keys(UNO_COLORS).map((color, i) => {
    const start = Math.PI / 4 + (i * Math.PI) / 2 + 0.06;
    const pad = new Mesh(new RingGeometry(0.2, 0.6, 20, 1, start, Math.PI / 2 - 0.12), new MeshBasicMaterial({ color: UNO_COLORS[color], side: DoubleSide, depthTest: false, depthWrite: false, transparent: true }));
    const rim = new Mesh(new RingGeometry(0.18, 0.64, 20, 1, start - 0.03, Math.PI / 2 - 0.06), new MeshBasicMaterial({ color: INK, side: DoubleSide, depthTest: false, depthWrite: false, transparent: true }));
    rim.position.z = -0.002;
    rim.renderOrder = 41;
    rim.raycast = () => {};
    pad.add(rim);
    pad.renderOrder = 42;
    pad.userData = { color, angle: start + Math.PI / 4 - 0.06 };
    colorWheel.add(pad);
    return pad;
  });
  const pickLabel = new Label(360, 110, 0.3);
  pickLabel.sprite.visible = false;
  scene.add(pickLabel.sprite);

  // An arrow from the pile towards each player (you too), for aiming a targeted card.
  const targetArrows = new Group();
  targetArrows.visible = false;
  scene.add(targetArrows);
  const arrowShaft = new BoxGeometry(0.16, 0.07, 0.5);
  const arrowHead = new ConeGeometry(0.24, 0.36, 3);
  let arrowsKey = '';
  let pickHover = null; // { type: 'color', color } | { type: 'target', index }

  function buildArrows() {
    for (const arrow of [...targetArrows.children]) {
      arrow.userData.material.dispose();
      arrow.removeFromParent();
    }
    for (let index = 0; index < playerCount; index++) {
      const k = relative(index);
      const { x, z } = k === 0 ? { x: 0, z: SEAT_RADIUS } : seatPosition(k, playerCount);
      const material = new MeshToonMaterial({ color: new Color(UNO_COLORS.red), gradientMap: kit.gradient });
      const arrow = new Group();
      const shaft = withOutline(new Mesh(arrowShaft, material), kit, true);
      shaft.position.z = 0.25;
      const head = withOutline(new Mesh(arrowHead, material), kit, true);
      head.rotation.set(Math.PI / 2, 0, 0);
      head.scale.set(1, 1, 0.35);
      head.position.z = 0.66;
      arrow.add(shaft, head);
      // Aimed at their chest (at you, down towards your hand), so the far ones tilt up and stay easy to see.
      const start = new Vector3(PILE_POS.x, 0.55, PILE_POS.z);
      const direction = new Vector3(x, k === 0 ? 0.1 : 1.1, z).sub(start).normalize();
      arrow.rotation.order = 'YXZ';
      arrow.rotation.y = Math.atan2(direction.x, direction.z);
      arrow.rotation.x = -Math.asin(direction.y);
      arrow.userData = { index, material, direction, size: k === 0 ? 1 : 1.35, base: start.addScaledVector(direction, 0.95) };
      arrow.position.copy(arrow.userData.base);
      targetArrows.add(arrow);
    }
  }

  // Shows the colour wheel or the arrows when it's your pick.
  function syncPicker(next) {
    const choice = next.choice?.player === next.you && next.winner === null ? next.choice : null;
    colorWheel.visible = choice?.needs === 'color';
    if (choice?.needs === 'target' && arrowsKey !== `${playerCount}:${me}`) {
      arrowsKey = `${playerCount}:${me}`;
      buildArrows();
    }
    targetArrows.visible = choice?.needs === 'target';
    const text = choice ? (choice.needs === 'color' ? 'Pick a colour' : 'Who draws?') : '';
    pickLabel.draw(text, (ctx, w, h) => text && drawBanner(ctx, w, h, text, '#ffffff', INK));
    pickLabel.sprite.position.set(PILE_POS.x, choice?.needs === 'color' ? 1.55 : 1.05, PILE_POS.z);
    pickLabel.sprite.visible = Boolean(choice);
    if (!choice) pickHover = null;
  }

  function animatePicker(now, dt) {
    const ease = 1 - Math.exp(-dt * 14);
    if (colorWheel.visible) {
      colorWheel.quaternion.copy(camera.quaternion);
      colorWheel.position.y = 0.75 + Math.sin(now / 500) * 0.03;
      for (const pad of colorPads) {
        const hovered = pickHover?.type === 'color' && pickHover.color === pad.userData.color;
        const push = hovered ? 0.08 : 0;
        pad.position.x += (Math.cos(pad.userData.angle) * push - pad.position.x) * ease;
        pad.position.y += (Math.sin(pad.userData.angle) * push - pad.position.y) * ease;
        pad.scale.setScalar(pad.scale.x + ((hovered ? 1.1 : 1) - pad.scale.x) * ease);
      }
    }
    if (targetArrows.visible) {
      for (const arrow of targetArrows.children) {
        const { index, base, direction, material, size } = arrow.userData;
        const hovered = pickHover?.type === 'target' && pickHover.index === index;
        const nudge = Math.sin(now / 220 + index) * 0.06 + (hovered ? 0.2 : 0);
        arrow.position.copy(base).addScaledVector(direction, nudge);
        arrow.scale.setScalar(arrow.scale.x + (size * (hovered ? 1.25 : 1) - arrow.scale.x) * ease);
        material.color.set(hovered ? '#FFD84D' : UNO_COLORS.red);
      }
    }
  }

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

  // A card you just drew, face up above your hand until you play or keep it.
  const myCentre = new Mesh(new PlaneGeometry(CARD_W, CARD_H), new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }));
  myCentre.renderOrder = 70;
  myCentre.visible = false;
  myCentre.position.set(0, CENTRE_Y, 0.05);
  myCentre.scale.setScalar(HAND_CARD_SCALE * 1.35);
  const myCentreGlow = new Mesh(glowGeometry, new MeshBasicMaterial({ color: '#FFD84D', transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  myCentreGlow.position.z = -0.002;
  myCentreGlow.renderOrder = 69.5;
  myCentreGlow.raycast = () => {};
  myCentre.add(myCentreGlow);
  hand.add(myCentre);
  // Someone else's drawn card, face down in front of them.
  const theirCentre = new Mesh(new PlaneGeometry(CARD_W, CARD_H), new MeshBasicMaterial({ map: kit.cardFace(null), side: DoubleSide }));
  theirCentre.visible = false;
  theirCentre.scale.setScalar(0.7);
  scene.add(theirCentre);
  let centreWanted = null; // 'mine' | 'theirs' | null
  let centreRevealAt = 0;

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
    // Where their cards are held, at the chest.
    return new Vector3(x * 0.9, AVATAR_Y + 0.5 * AVATAR_SCALE, z * 0.9);
  };
  // Where a card someone just drew waits while they decide: over your hand for you, in front of their seat for others.
  const centrePoint = (index) => {
    const k = relative(index);
    if (k === 0) return hand.localToWorld(new Vector3(0, CENTRE_Y, 0.05));
    const { x, z } = seatPosition(k, playerCount);
    return new Vector3(x * 0.6, 0.85, z * 0.6);
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

  // The backs of someone's cards, fanned out from where their hands grip them.
  function buildFan(count, hold) {
    const fan = new Group();
    const shown = Math.min(count, 10);
    const spread = Math.min(1.0, 0.16 * (shown - 1));
    const height = CARD_H * SEAT_CARD_SCALE;
    for (let i = 0; i < shown; i++) {
      const card = takeCard(null);
      card.scale.setScalar(SEAT_CARD_SCALE);
      const turn = shown > 1 ? -(i / (shown - 1) - 0.5) * spread : 0;
      // Each card turns about a point near its bottom edge, like a hand of cards pinched at the base.
      card.position.set(-Math.sin(turn) * height * 0.38, Math.cos(turn) * height * 0.38, i * 0.004);
      card.rotation.z = turn;
      fan.add(card);
    }
    fan.position.set(0, hold.y, hold.z);
    fan.rotation.x = -0.3;
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
        holdCards(avatar);
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
        seat.fan = buildFan(player.count, seat.avatar.userData.hold);
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
    const state = { name: player.name, count: player.count, bot: player.kind === 'bot', uno: player.said && player.count === 1, exposed: player.exposed, turn: winner === null && turn === index, winner: winner === index };
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
  function popup(index, text, fill, { color = '#fff', lift = 0, big = false, scale = 1, delay = 0, duration = 1500 } = {}) {
    const mesh = popups.acquire();
    mesh.material.map = kit.texture(`popup:${text}:${fill}:${color}`, 360, 140, (ctx, w, h) => drawBanner(ctx, w, h, text, fill, color));
    mesh.material.needsUpdate = true;
    mesh.renderOrder = 16;
    mesh.scale.setScalar(0.001);
    let base = null;
    scene.add(mesh);
    const size = (big ? 1.5 : 1) * scale;
    tweens.add(
      duration,
      (t) => {
        // Placed when it appears, so one in front of you follows where you're looking by then.
        base ??= headPoint(index, lift);
        mesh.quaternion.copy(camera.quaternion);
        const pop = t < 0.15 ? easeOut(t / 0.15) * 1.15 : t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1 + Math.max(0, 0.3 - t);
        mesh.scale.setScalar(Math.max(0.001, pop * size));
        mesh.position.set(base.x, base.y + t * 0.35, base.z);
      },
      { delay, done: () => popups.release(mesh) },
    );
  }

  // ─── Emotes ─────────────────────────────────────────────────────────

  // How long each reaction lasts, and whether the arms let go of the cards for it.
  const EMOTES = {
    stunned: { ms: 1800 },
    angry: { ms: 1500 },
    annoyed: { ms: 1500 },
    shocked: { ms: 1300 },
    smug: { ms: 1300 },
    cheer: { ms: 1100, arms: true },
    joy: { ms: 4200, arms: true },
    clap: { ms: 3800, arms: true },
    sad: { ms: 3800 },
  };

  // Someone reacts to what just happened (your own seat has no avatar to show it).
  function emote(index, kind, delay = 0) {
    const spec = EMOTES[kind];
    if (!spec || index === null || index === undefined || !playerCount) return;
    const seat = seats.get(index);
    if (!seat || calm) return;
    endEmote(seat);
    seat.emote = { kind, start: performance.now() + delay, ms: spec.ms, arms: Boolean(spec.arms) };
  }

  function endEmote(seat) {
    if (!seat.emote) return;
    if (seat.emote.arms) {
      holdCards(seat.avatar);
      if (seat.fan) seat.fan.visible = true;
    }
    seat.avatar.position.x = 0;
    if (seat.emote.kind === 'joy') seat.avatar.position.y = AVATAR_Y;
    seat.avatar.rotation.z = 0;
    seat.avatar.userData.body.scale.x = 1;
    seat.emote = null;
  }

  // One frame of a reaction, layered over the idle animation. t runs 0 → 1.
  function playEmote(seat, now) {
    const e = seat.emote;
    if (!e || now < e.start) return;
    const t = (now - e.start) / e.ms;
    if (t >= 1) {
      endEmote(seat);
      return;
    }
    const { head, face, body } = seat.avatar.userData;
    const fade = 1 - t;
    const s = (now - e.start) / 1000;
    face.material = moodFace(seat.avatar, kit, e.kind);
    if (e.arms && seat.fan) seat.fan.visible = false;
    switch (e.kind) {
      case 'stunned':
        head.rotation.z += Math.sin(s * 14) * 0.22 * fade;
        head.rotation.x += Math.cos(s * 14) * 0.12 * fade;
        seat.avatar.rotation.z = Math.sin(s * 7) * 0.06 * fade;
        break;
      case 'angry':
        seat.avatar.position.x = Math.sin(s * 55) * 0.04 * fade;
        head.rotation.x += 0.15;
        break;
      case 'annoyed':
        head.rotation.y += Math.sin(s * 12) * 0.3 * fade;
        head.rotation.z += 0.12;
        break;
      case 'shocked':
        seat.avatar.userData.body.scale.x = 1 + Math.sin(Math.min(1, t * 4) * Math.PI) * 0.06;
        head.rotation.x -= 0.2 * fade;
        break;
      case 'smug':
        head.rotation.z += -0.2 * Math.min(1, t * 5);
        head.rotation.x -= 0.12;
        break;
      case 'sad':
        head.rotation.x += 0.45 * Math.min(1, t * 3);
        body.scale.y *= 0.95;
        break;
      case 'cheer': {
        const pump = Math.abs(Math.sin(s * 9));
        reachArms(seat.avatar, [
          [-0.2, 0.46, 0.3],
          [0.3, 0.95 + pump * 0.08, 0.08],
        ]);
        break;
      }
      case 'joy': {
        const wave = Math.sin(s * 10) * 0.08;
        reachArms(seat.avatar, [
          [-0.34 + wave, 1.0, 0.05],
          [0.34 - wave, 1.0, 0.05],
        ]);
        seat.avatar.position.y = AVATAR_Y + Math.abs(Math.sin(s * 6)) * 0.22;
        break;
      }
      case 'clap': {
        const apart = 0.03 + Math.abs(Math.sin(s * 8)) * 0.1;
        reachArms(seat.avatar, [
          [-apart, 0.66, 0.32],
          [apart, 0.66, 0.32],
        ]);
        break;
      }
      default:
        break;
    }
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

  // The events of one update, animated. Cards drawn because of a card that was just played wait for it to land.
  function playEvents(events, fresh) {
    const played = events.some((e) => e.type === 'play');
    const drewToCentre = events.some((e) => e.type === 'draw' && e.reason === 'centre');
    for (const event of events) playEvent(event, fresh, { afterPlay: played ? 450 : 0, afterCentre: drewToCentre ? 450 : 0 });
  }

  function playEvent(event, fresh, { afterPlay = 0, afterCentre = 0 } = {}) {
    switch (event.type) {
      case 'play': {
        const card = event.card;
        const color = UNO_COLORS[event.color] ?? '#ffffff';
        const mine = relative(event.player) === 0;
        const from = event.fromCentre ? centrePoint(event.player) : mine && leftHand.has(card.id) ? leftHand.get(card.id) : handPoint(event.player);
        const to = PILE_POS.clone().add(new Vector3(0, 0.05, 0));
        const special = card.value in SYMBOLS;
        flyCard(card, from, to, {
          startRotation: mine ? 0.2 : -0.4,
          done: () => {
            setTopCard(card);
            shockwave(PILE_POS, color, { size: special ? 2.4 : 1.4 });
            burst(to, card.color ? [color, '#ffffff'] : Object.values(UNO_COLORS), special ? 60 : 24, { speed: special ? 2.4 : 1.4, up: 1.6, life: 0.8 });
          },
        });
        if (seats.has(event.player)) hop(event.player);
        break;
      }
      case 'color':
        // The wild's colour is picked: the table flashes it.
        feltFlash = 1;
        flashColor.set(UNO_COLORS[event.color] ?? '#ffffff');
        shockwave(PILE_POS, UNO_COLORS[event.color] ?? '#ffffff', { size: 4.5, duration: 900 });
        break;
      case 'draw': {
        const deckTop = DECK_POS.clone().add(new Vector3(0, 0.2, 0));
        if (event.reason === 'centre') {
          // One card up into the middle, where its player decides what to do with it.
          flyCard(null, deckTop, centrePoint(event.player), { faceUp: false });
          centreRevealAt = performance.now() + 420;
          break;
        }
        const delay = event.reason === 'hit' ? afterPlay : 0;
        for (let i = 0; i < Math.min(event.count, 6); i++) flyCard(null, deckTop, handPoint(event.player), { faceUp: false, delay: delay + i * 90 });
        if (event.count >= 2 && fresh) popup(event.player, `+${event.count}`, event.count >= 99 ? INK : UNO_COLORS.red, { big: event.count >= 4, delay });
        if (event.reason === 'hit') {
          // The draw lands only once it's taken (or can't be answered): the hit, the shake, the reaction.
          emote(event.player, event.count >= 10 ? 'stunned' : event.count >= 4 ? 'angry' : 'annoyed', delay);
          if (relative(event.player) === 0) addShake(Math.min(0.12, 0.03 * Math.log2(event.count + 1)));
          else {
            const { x, z } = seatPosition(relative(event.player), playerCount);
            shockwave(new Vector3(x * 0.62, 0, z * 0.62), UNO_COLORS.red, { size: event.count >= 4 ? 1.6 : 1.1, delay });
          }
        }
        if (event.reason === 'callout') emote(event.player, 'shocked');
        break;
      }
      case 'keep':
        // The drawn card goes from the middle into their hand (yours glides in on its own).
        if (relative(event.player) !== 0) flyCard(null, centrePoint(event.player), handPoint(event.player), { faceUp: false, delay: afterCentre });
        break;
      case 'uno': {
        popup(event.player, 'Woono!', '#F2B90D', { color: INK, big: true });
        hop(event.player);
        emote(event.player, 'cheer');
        const at = relative(event.player) === 0 ? handPoint(event.player) : headPoint(event.player, -0.6);
        burst(at, ['#F2B90D', '#ffffff', UNO_COLORS.red], 50, { speed: 1.8, up: 2, life: 0.9, gravity: 3 });
        break;
      }
      case 'callout':
        popup(event.target, 'Caught!', '#E8740C', { big: true });
        emote(event.player, 'smug');
        break;
      case 'skip': {
        popup(event.player, '⊘ Skip', '#ffffff', { color: UNO_COLORS.red, delay: afterPlay });
        emote(event.player, 'annoyed', afterPlay);
        const k = relative(event.player);
        if (k !== 0) {
          const { x, z } = seatPosition(k, playerCount);
          shockwave(new Vector3(x * 0.62, 0, z * 0.62), UNO_COLORS.red, { size: 1.2, delay: afterPlay });
        }
        break;
      }
      case 'block':
        popup(event.player, '⊘ Blocked!', '#ffffff', { color: INK, big: true, delay: afterPlay });
        emote(event.player, 'smug', afterPlay);
        emote(event.from, 'shocked', afterPlay + 200);
        shockwave(PILE_POS, '#ffffff', { size: 3, duration: 700, delay: afterPlay });
        break;
      case 'reflect':
        arrowBoost = 1;
        popup(event.player, '⇄ Sent back!', '#ffffff', { color: INK, big: true, delay: afterPlay });
        emote(event.player, 'smug', afterPlay);
        emote(event.target, 'shocked', afterPlay + 250);
        if (event.kind === 'draw') for (let i = 0; i < 3; i++) flyCard(null, handPoint(event.player), handPoint(event.target), { faceUp: false, delay: afterPlay + i * 80 });
        break;
      case 'reverse':
        arrowBoost = 1;
        shockwave(new Vector3(0, 0, 0), '#ffffff', { size: 3.2, duration: 700 });
        break;
      case 'swap': {
        for (const [a, b] of [[event.a, event.b], [event.b, event.a]]) for (let i = 0; i < 4; i++) flyCard(null, handPoint(a), handPoint(b), { faceUp: false, delay: i * 70 });
        popup(event.a, '⇄ Swap', '#ffffff', { color: INK });
        emote(event.a, 'smug', 500);
        emote(event.b, 'angry', 500);
        break;
      }
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
        emote(loser, event.success ? 'shocked' : 'angry', 700);
        emote(event.success ? event.player : event.offender, 'smug', 700);
        break;
      }
      case 'timeout':
        popup(event.player, 'Time’s up!', UNO_COLORS.red);
        break;
      case 'win':
        popup(event.player, relative(event.player) === 0 ? 'You win!' : 'Winner!', '#F2B90D', { color: INK, big: true });
        if (fresh) {
          confetti();
          // The winner celebrates; everyone else claps, or sulks if they were close.
          emote(event.player, 'joy', 300);
          for (let p = 0; p < playerCount; p++) {
            if (p === event.player) continue;
            const count = p === me ? view?.hand.length : seats.get(p)?.player?.count;
            emote(p, count <= 2 ? 'sad' : 'clap', 700 + p * 120);
          }
        } else hop(event.player, 4);
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
  // How far a touch swipe has dragged the lifted card up, in hand units.
  let swipeLift = 0;

  // Hand cards carry a glow behind them; it goes before the card returns to the shared pool.
  function releaseHandCard(mesh) {
    mesh.userData.glow.removeFromParent();
    mesh.userData.glow.material.dispose();
    mesh.userData.glow = null;
    cards.release(mesh);
  }

  // `kept`: a card you just kept glides down from where it waited above the hand, after `keptDelay` ms.
  function syncHand(next, { kept = false, keptDelay = 0 } = {}) {
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
        if (kept) {
          mesh.position.set(0, CENTRE_Y, 0.05);
          mesh.rotation.set(0, 0, 0);
          mesh.scale.setScalar(HAND_CARD_SCALE * 1.35);
          mesh.userData.holdUntil = performance.now() + keptDelay;
        } else {
          // New cards slide in from off to the side, where the deck is.
          mesh.position.set(-handHalfWidth * 1.3, 0.4, 0);
          mesh.rotation.set(0, 0, 0.6);
          mesh.scale.setScalar(HAND_CARD_SCALE * 0.6);
        }
        hand.add(mesh);
        handCards.set(card.id, mesh);
      }
      const angle = n > 1 ? (i / (n - 1) - 0.5) * spread : 0;
      mesh.userData.card = card;
      mesh.userData.angle = angle;
      mesh.userData.order = i;
      mesh.userData.home = new Vector3(Math.sin(angle) * FAN_RADIUS, (Math.cos(angle) - 1) * FAN_RADIUS * FAN_CURVE, i * 0.004);
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
      mesh.renderOrder = focused ? 60 : 20 + order;
      // A kept card stays hidden until the drawn card has flown up to where it waits.
      mesh.visible = !(mesh.userData.holdUntil > now);
      if (!mesh.visible) continue;
      const lift = focused ? 0.3 : playable ? 0.06 : 0;
      handAim.set(home.x - Math.sin(angle) * (focused ? -0.02 : 0), home.y + lift + (focused ? swipeLift : 0), home.z + (focused ? 0.12 : 0));
      mesh.position.lerp(handAim, ease);
      mesh.rotation.z += (-angle * FAN_TILT * (focused ? 0.4 : 1) - mesh.rotation.z) * ease;
      const scale = HAND_CARD_SCALE * (focused ? 1.18 : 1);
      mesh.scale.setScalar(mesh.scale.x + (scale - mesh.scale.x) * ease);
      mesh.renderOrder = focused ? 60 : 20 + order;
      mesh.userData.glow.renderOrder = mesh.renderOrder - 0.5;
      // Playable cards glow: on your turn, or out of turn when they're a jump-in.
      mesh.userData.glow.material.opacity = playable ? pulse + handFlash * 0.5 : myTurn ? handFlash * 0.4 : 0;
    }

    // The card you drew, waiting above your hand; theirs, face down in front of them.
    const reveal = now >= centreRevealAt;
    myCentre.visible = centreWanted === 'mine' && reveal;
    theirCentre.visible = centreWanted === 'theirs' && reveal;
    if (myCentre.visible) {
      const focused = hoverId === myCentre.userData.cardId || selectedId === myCentre.userData.cardId;
      myCentre.scale.setScalar(myCentre.scale.x + (HAND_CARD_SCALE * (focused ? 1.5 : 1.35) - myCentre.scale.x) * ease);
      myCentre.position.y = CENTRE_Y + Math.sin(now / 400) * 0.02;
      myCentreGlow.material.opacity = myCentre.userData.playable ? pulse + 0.15 : 0;
    }
    if (theirCentre.visible) {
      theirCentre.position.y = 0.85 + Math.sin(now / 400) * 0.03;
      theirCentre.quaternion.copy(camera.quaternion);
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
      centreRevealAt = 0;
      syncCentre(next);
      syncPicker(next);
      for (const seat of seats.values()) endEmote(seat);
      updateBillboards();
      return;
    }
    const fresh = next.events.filter((e) => lastEventId === null || e.id > lastEventId);
    lastEventId = next.events[next.events.length - 1]?.id ?? lastEventId;
    const kept = fresh.some((e) => e.type === 'keep' && e.player === me);
    const drewToCentre = fresh.some((e) => e.type === 'draw' && e.reason === 'centre');
    syncHand(next, { kept, keptDelay: drewToCentre ? 450 : 0 });
    let playedTop = false;
    for (const event of fresh) if (event.type === 'play' && event.card.id === next.top.id) playedTop = true;
    playEvents(fresh, true);
    syncCentre(next);
    syncPicker(next);
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

  function syncCentre(next) {
    if (next.drawn && next.winner === null) {
      centreWanted = 'mine';
      myCentre.material.map = kit.cardFace(next.drawn);
      myCentre.material.needsUpdate = true;
      myCentre.userData.cardId = next.drawn.id;
      myCentre.userData.playable = next.playable.includes(next.drawn.id);
    } else if (next.drawnPending && next.winner === null && next.turn !== next.you) {
      centreWanted = 'theirs';
      theirCentre.position.copy(centrePoint(next.turn));
    } else {
      centreWanted = null;
    }
  }

  const canDraw = () => Boolean(view?.canDraw);

  function updateBillboards() {
    if (!view) return;
    const ready = canDraw();
    const pending = view.pending;
    const text = pending ? (pending.kind === 'draw' ? `Take ${pending.amount}` : 'Take the skip') : view.drewThisTurn ? 'Draw again' : 'Draw';
    drawLabel.draw(`${ready}:${text}`, (ctx, w, h) => ready && drawBanner(ctx, w, h, text, '#FFD84D', INK));
    drawLabel.sprite.visible = ready;
    const stacked = Boolean(pending) && view.winner === null;
    // Just the amount: who it's aimed at is on the turn marker and in the log.
    const label = pending ? (pending.kind === 'draw' ? `+${pending.amount}` : '⊘ Skip') : '';
    stackLabel.draw(label, (ctx, w, h) => stacked && drawBanner(ctx, w, h, label, UNO_COLORS.red));
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
    if (colorWheel.visible) {
      const hit = raycaster.intersectObjects(colorPads, false)[0];
      if (hit) return { type: 'color', color: hit.object.userData.color, playable: true };
    }
    if (targetArrows.visible) {
      const hit = raycaster.intersectObjects(targetArrows.children, true)[0];
      if (hit) return { type: 'target', index: hit.object.parent.userData.index, playable: true };
    }
    if (myCentre.visible && raycaster.intersectObject(myCentre, false).length) return { type: 'drawn', id: myCentre.userData.cardId, playable: Boolean(myCentre.userData.playable) };
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
    hoverId = hit?.type === 'card' || hit?.type === 'drawn' ? hit.id : null;
    pickHover = hit?.type === 'color' || hit?.type === 'target' ? hit : null;
    hoverDeck = hit?.type === 'deck';
    return hit;
  }

  function clearHover() {
    pickHover = null;
    hoverId = null;
    hoverDeck = false;
  }

  function setSelected(id) {
    selectedId = id;
  }

  // A swipe in progress pulls the lifted card up after the finger (0 to 1 of the way to playing it).
  function setSwipe(amount) {
    swipeLift = MathUtils.clamp(amount, 0, 1) * 0.35;
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
    hand.position.set(0, -halfHeight + 0.34 * fit, -HAND_DEPTH);
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
    animatePicker(now, dt);

    for (const [index, seat] of seats) {
      const t = now / 1000 + seat.phase;
      const { body, head, face, faceOpen, faceClosed, antenna, robot } = seat.avatar.userData;
      body.scale.y = 1 + Math.sin(t * 2) * (robot ? 0.01 : 0.02);
      if (antenna) antenna.position.x = Math.sin(t * 3) * 0.02;

      const their = looks.get(index);
      const goal = their && now - their.at < LOOK_STALE_MS ? { yaw: -their.x * HEAD_YAW, pitch: their.y * HEAD_PITCH } : autoLook(index, seat);
      const headEase = 1 - Math.exp(-dt * 7);
      seat.yaw += (goal.yaw - seat.yaw) * headEase;
      seat.pitch += (goal.pitch - seat.pitch) * headEase;
      head.rotation.set(seat.pitch, seat.yaw, Math.sin(t * 1.3) * 0.05);

      if (now > seat.blinkAt + 140) seat.blinkAt = now + 2000 + Math.random() * 3000;
      face.material = now > seat.blinkAt ? faceClosed : faceOpen;
      playEmote(seat, now);
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
    setSwipe,
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
      pickLabel.dispose();
      for (const arrow of targetArrows.children) arrow.userData.material.dispose();
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
