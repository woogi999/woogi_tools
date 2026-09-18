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
  BoxGeometry,
  SphereGeometry,
  ConeGeometry,
  CylinderGeometry,
  RingGeometry,
  CircleGeometry,
  MeshToonMaterial,
  MeshBasicMaterial,
  CanvasTexture,
  SRGBColorSpace,
  DoubleSide,
  Color,
  Vector2,
  Vector3,
  Plane,
  Raycaster,
  MathUtils,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import config from 'woogi-tools/config/environment';
import { avatarKey } from '../utils/avatar';
import { rendererOptions, createGovernor, tabHidden } from './perf';
import { sfx } from '../utils/sound';
import { BOARD, GROUPS, JAIL, money, isProperty } from '../utils/woonopoly';
import {
  AvatarKit,
  buildAvatar,
  disposeAvatar,
  moodFace,
  withOutline,
} from './avatar-model';

// The Woonopoly board in 3D: a square board on a wooden table, the players'
// avatars walking round it as their tokens, houses and hotels on the streets,
// two dice in the middle, and name tags and money pop-ups as sprites that
// always face the camera. Same doodle style as the Woono table: flat toon
// shading, ink outlines, textures painted once on canvases.
//
//   createWoonopolyScene(canvas, { onPick })
//     .setView(view)      the view from utils/woonopoly.js; animates what changed
//     .setPointer(space)  highlight a space (the one whose deed is open)
//     .dispose()

const INK = '#141414';
const SIZE = 10; // the board's side
const HALF = SIZE / 2;
const CORNER = (SIZE * 1.6) / 12.2;
const SQUARE = SIZE / 12.2;
const BOARD_Y = 0.07; // top of the board
const TEXTURE = 2048;
const AVATAR_SCALE = 0.42;
const STEP_MS = 130;
const ROLL_MS = 1100;
const CARD_MS = 1400;
const BACK_ART_URL = `${config.rootURL ?? '/'}favicon.png`;

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.dataset.motion === 'reduce';

// ─── Where every space is ──────────────────────────────────────────────

// The rectangle of a space on the board, in board units (x right, z towards the camera),
// and which way its text reads: 0 bottom row, 1 left column, 2 top row, 3 right column.
function rectOf(index) {
  const side = Math.floor(index / 10);
  const k = index % 10;
  if (k === 0) {
    const cx =
      side === 0 || side === 3 ? HALF - CORNER / 2 : -HALF + CORNER / 2;
    const cz =
      side === 0 || side === 1 ? HALF - CORNER / 2 : -HALF + CORNER / 2;
    return { x: cx, z: cz, w: CORNER, h: CORNER, side, corner: true };
  }
  const along = CORNER + (k - 0.5) * SQUARE;
  switch (side) {
    case 0:
      return {
        x: HALF - along,
        z: HALF - CORNER / 2,
        w: SQUARE,
        h: CORNER,
        side,
      };
    case 1:
      return {
        x: -HALF + CORNER / 2,
        z: HALF - along,
        w: CORNER,
        h: SQUARE,
        side,
      };
    case 2:
      return {
        x: -HALF + along,
        z: -HALF + CORNER / 2,
        w: SQUARE,
        h: CORNER,
        side,
      };
    default:
      return {
        x: HALF - CORNER / 2,
        z: -HALF + along,
        w: CORNER,
        h: SQUARE,
        side,
      };
  }
}
const RECTS = BOARD.map((_, i) => rectOf(i));

// Which space a point on the board is over, or -1 in the middle.
function spaceAt(x, z) {
  if (Math.abs(x) > HALF || Math.abs(z) > HALF) return -1;
  if (Math.abs(x) < HALF - CORNER && Math.abs(z) < HALF - CORNER) return -1;
  for (let i = 0; i < RECTS.length; i++) {
    const r = RECTS[i];
    if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.h / 2) return i;
  }
  return -1;
}

// Tokens on the same space stand in a little grid so they don't overlap.
const SLOTS = [
  [0, 0],
  [0.2, 0.12],
  [-0.2, 0.12],
  [0, -0.2],
  [0.2, -0.22],
  [-0.2, -0.22],
  [0.2, 0.3],
  [-0.2, 0.3],
];

function standingSpot(index, slot, inJail) {
  const r = RECTS[index];
  const [dx, dz] = SLOTS[slot % SLOTS.length];
  // Jail: inside the cell, in the corner; just visiting: along its outer edges.
  if (index === JAIL) {
    return inJail
      ? new Vector3(r.x + 0.18 + dx * 0.6, BOARD_Y, r.z - 0.18 + dz * 0.6)
      : new Vector3(r.x - 0.42 + dx * 0.5, BOARD_Y, r.z + 0.42 + dz * 0.5);
  }
  // Keep the token on the outer half of a street, off the colour band.
  const out = r.corner ? 0 : 0.18;
  switch (r.side) {
    case 0:
      return new Vector3(r.x + dx, BOARD_Y, r.z + out + dz * 0.6);
    case 1:
      return new Vector3(r.x - out + dz * 0.6, BOARD_Y, r.z + dx);
    case 2:
      return new Vector3(r.x + dx, BOARD_Y, r.z - out + dz * 0.6);
    default:
      return new Vector3(r.x + out + dz * 0.6, BOARD_Y, r.z + dx);
  }
}

// Tokens face out from the board, towards whoever is looking from that side.
const facing = (index) =>
  [0, Math.PI * 1.5, Math.PI, Math.PI * 0.5][RECTS[index].side];

// ─── Painting the board ────────────────────────────────────────────────

const px = (v) => ((v + HALF) / SIZE) * TEXTURE;

function ink(ctx, width = 4) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

function fitText(ctx, text, maxWidth, size, weight = 800) {
  let s = size;
  ctx.font = `${weight} ${s}px Moderustic, sans-serif`;
  while (ctx.measureText(text).width > maxWidth && s > 12) {
    s -= 1;
    ctx.font = `${weight} ${s}px Moderustic, sans-serif`;
  }
  return s;
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Little doodles for the special spaces, drawn in ink around (0, 0).
function doodle(ctx, kind, size) {
  ink(ctx, size * 0.06);
  ctx.fillStyle = '#fff';
  switch (kind) {
    case 'station': {
      // A boxy tram with two wheels.
      ctx.beginPath();
      ctx.roundRect(
        -size * 0.45,
        -size * 0.35,
        size * 0.9,
        size * 0.55,
        size * 0.1,
      );
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#8ED1F2';
      for (const x of [-0.28, 0.02]) {
        ctx.beginPath();
        ctx.roundRect(
          x * size,
          -size * 0.25,
          size * 0.24,
          size * 0.2,
          size * 0.04,
        );
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = INK;
      for (const x of [-0.25, 0.25]) {
        ctx.beginPath();
        ctx.arc(x * size, size * 0.3, size * 0.11, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'power': {
      ctx.fillStyle = '#F2D02B';
      ctx.beginPath();
      ctx.moveTo(size * 0.1, -size * 0.5);
      ctx.lineTo(-size * 0.3, size * 0.05);
      ctx.lineTo(0, size * 0.05);
      ctx.lineTo(-size * 0.1, size * 0.5);
      ctx.lineTo(size * 0.3, -size * 0.05);
      ctx.lineTo(0, -size * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'water': {
      ctx.fillStyle = '#8ED1F2';
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.5);
      ctx.bezierCurveTo(size * 0.45, 0, size * 0.4, size * 0.5, 0, size * 0.5);
      ctx.bezierCurveTo(
        -size * 0.4,
        size * 0.5,
        -size * 0.45,
        0,
        0,
        -size * 0.5,
      );
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'chance': {
      ctx.fillStyle = '#F28C28';
      ctx.font = `900 ${size}px Moderustic, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeText('?', 0, size * 0.05);
      ctx.fillText('?', 0, size * 0.05);
      break;
    }
    case 'chest': {
      ctx.fillStyle = '#8B5A2B';
      ctx.beginPath();
      ctx.roundRect(
        -size * 0.45,
        -size * 0.15,
        size * 0.9,
        size * 0.5,
        size * 0.08,
      );
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(
        -size * 0.45,
        -size * 0.4,
        size * 0.9,
        size * 0.3,
        size * 0.12,
      );
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#F2D02B';
      ctx.beginPath();
      ctx.roundRect(
        -size * 0.08,
        -size * 0.2,
        size * 0.16,
        size * 0.22,
        size * 0.04,
      );
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'tax': {
      ctx.fillStyle = '#F2D02B';
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = `900 ${size * 0.5}px Moderustic, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('₱', 0, size * 0.03);
      break;
    }
    case 'jail': {
      ctx.fillStyle = '#F28C28';
      ctx.beginPath();
      ctx.rect(-size * 0.45, -size * 0.45, size * 0.9, size * 0.9);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (const x of [-0.25, 0, 0.25]) {
        ctx.moveTo(x * size, -size * 0.45);
        ctx.lineTo(x * size, size * 0.45);
      }
      ctx.stroke();
      break;
    }
    case 'parking': {
      ctx.fillStyle = '#E5484D';
      ctx.beginPath();
      ctx.roundRect(-size * 0.5, -size * 0.2, size, size * 0.4, size * 0.12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#F2D02B';
      ctx.beginPath();
      ctx.roundRect(
        -size * 0.3,
        -size * 0.45,
        size * 0.6,
        size * 0.3,
        size * 0.1,
      );
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      for (const x of [-0.3, 0.3]) {
        ctx.beginPath();
        ctx.arc(x * size, size * 0.22, size * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'go': {
      ctx.fillStyle = '#E5484D';
      ctx.beginPath();
      ctx.moveTo(-size * 0.5, -size * 0.2);
      ctx.lineTo(size * 0.1, -size * 0.2);
      ctx.lineTo(size * 0.1, -size * 0.45);
      ctx.lineTo(size * 0.5, 0);
      ctx.lineTo(size * 0.1, size * 0.45);
      ctx.lineTo(size * 0.1, size * 0.2);
      ctx.lineTo(-size * 0.5, size * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'gotojail': {
      ctx.fillStyle = '#3E7BE0';
      ctx.beginPath();
      ctx.arc(0, -size * 0.1, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-size * 0.4, size * 0.45);
      ctx.lineTo(size * 0.4, size * 0.45);
      ctx.moveTo(-size * 0.25, size * 0.45);
      ctx.lineTo(-size * 0.25, size * 0.15);
      ctx.moveTo(size * 0.25, size * 0.45);
      ctx.lineTo(size * 0.25, size * 0.15);
      ctx.stroke();
      break;
    }
  }
}

function paintSpace(ctx, index) {
  const r = RECTS[index];
  const space = BOARD[index];
  const w = px(r.x + r.w / 2) - px(r.x - r.w / 2);
  const h = px(r.z + r.h / 2) - px(r.z - r.h / 2);
  ctx.save();
  ctx.translate(px(r.x), px(r.z));
  // Turn so the text reads from that side of the table.
  ctx.rotate([0, Math.PI / 2, Math.PI, -Math.PI / 2][r.side]);
  // After the turn, the square is `sw` wide and `sh` tall, with its inner (colour band) edge at the top.
  const sw = r.side % 2 ? h : w;
  const sh = r.side % 2 ? w : h;
  ctx.fillStyle = '#F4EFE1';
  ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
  ink(ctx, 5);
  ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  if (r.corner) {
    const kind = space.type;
    const label = {
      go: 'GO',
      jail: 'JAIL',
      parking: 'FREE PARKING',
      gotojail: 'GO TO JAIL',
    }[kind];
    ctx.save();
    ctx.translate(0, -sh * 0.12);
    doodle(ctx, kind, sw * 0.42);
    ctx.restore();
    const size = fitText(ctx, label, sw * 0.86, 44, 900);
    ctx.font = `900 ${size}px Moderustic, sans-serif`;
    ctx.fillStyle = INK;
    ctx.fillText(label, 0, sh * 0.34);
    if (kind === 'jail') {
      ctx.font = '700 22px Moderustic, sans-serif';
      ctx.fillText('just visiting', 0, sh * 0.45);
    }
    ctx.restore();
    return;
  }
  if (space.type === 'street') {
    ctx.fillStyle = GROUPS[space.group].color;
    ctx.fillRect(-sw / 2, -sh / 2, sw, sh * 0.22);
    ink(ctx, 5);
    ctx.strokeRect(-sw / 2, -sh / 2, sw, sh * 0.22);
  } else {
    const kind =
      space.type === 'station'
        ? 'station'
        : space.type === 'utility'
          ? space.name.includes('Power')
            ? 'power'
            : 'water'
          : space.type;
    ctx.save();
    ctx.translate(0, -sh * 0.12);
    doodle(ctx, kind, sw * 0.5);
    ctx.restore();
  }
  ctx.fillStyle = INK;
  const nameSize = fitText(ctx, space.name.toUpperCase(), sw * 0.9, 24, 800);
  ctx.font = `800 ${nameSize}px Moderustic, sans-serif`;
  const lines = wrap(ctx, space.name.toUpperCase(), sw * 0.9);
  const nameY = space.type === 'street' ? -sh * 0.12 : sh * 0.18;
  lines.forEach((line, i) =>
    ctx.fillText(
      line,
      0,
      nameY + (i - (lines.length - 1) / 2) * (nameSize + 4),
    ),
  );
  ctx.font = '700 24px Moderustic, sans-serif';
  if (space.price) ctx.fillText(money(space.price), 0, sh * 0.38);
  else if (space.type === 'tax')
    ctx.fillText(`pay ${money(space.amount)}`, 0, sh * 0.38);
  ctx.restore();
}

function paintBoard(canvas, art) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#B9D9A8';
  ctx.fillRect(0, 0, TEXTURE, TEXTURE);
  // A ring road runs round the inside of the squares, with a pavement either side.
  const edge = px(-HALF + CORNER);
  const far = px(HALF - CORNER);
  const road = (TEXTURE / SIZE) * 0.42;
  ctx.fillStyle = '#D8D3C4';
  ctx.fillRect(edge, edge, far - edge, far - edge);
  ctx.fillStyle = '#4A4A52';
  ctx.lineWidth = road;
  ctx.strokeStyle = '#4A4A52';
  ctx.strokeRect(
    edge + road * 0.9,
    edge + road * 0.9,
    far - edge - road * 1.8,
    far - edge - road * 1.8,
  );
  ctx.setLineDash([36, 28]);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#F2D02B';
  ctx.strokeRect(
    edge + road * 0.9,
    edge + road * 0.9,
    far - edge - road * 1.8,
    far - edge - road * 1.8,
  );
  ctx.setLineDash([]);
  // The park inside the road.
  const lawn = edge + road * 1.6;
  ctx.fillStyle = '#B9D9A8';
  ctx.fillRect(lawn, lawn, TEXTURE - lawn * 2, TEXTURE - lawn * 2);
  ctx.fillStyle = '#A5CD93';
  for (let i = 0; i < 40; i++) {
    const x = lawn + ((i * 977) % (TEXTURE - lawn * 2));
    const y = lawn + ((i * 613) % (TEXTURE - lawn * 2));
    ctx.beginPath();
    ctx.ellipse(x, y, 40, 22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Paths from the road to the fountain.
  ctx.strokeStyle = '#D8D3C4';
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.moveTo(TEXTURE / 2, lawn);
  ctx.lineTo(TEXTURE / 2, TEXTURE - lawn);
  ctx.moveTo(lawn, TEXTURE / 2);
  ctx.lineTo(TEXTURE - lawn, TEXTURE / 2);
  ctx.stroke();
  ctx.fillStyle = '#D8D3C4';
  ctx.beginPath();
  ctx.arc(TEXTURE / 2, TEXTURE / 2, 120, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < BOARD.length; i++) paintSpace(ctx, i);
  // The middle: the name at a jaunty angle, and the site's doodle.
  ctx.save();
  ctx.translate(TEXTURE / 2, TEXTURE * 0.31);
  ctx.rotate(-0.12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 120px Moderustic, sans-serif';
  ctx.fillStyle = '#E5484D';
  ctx.lineWidth = 16;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.strokeText('WOONOPOLY', 0, 0);
  ctx.fillText('WOONOPOLY', 0, 0);
  ctx.font = '700 40px Moderustic, sans-serif';
  ctx.fillStyle = INK;
  ctx.fillText('Woobux · pesos · friendships lost', 0, 92);
  ctx.restore();
  if (art) {
    const s = TEXTURE * 0.1;
    ctx.save();
    ctx.translate(TEXTURE * 0.66, TEXTURE * 0.64);
    ctx.rotate(0.2);
    ctx.drawImage(art, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
  // Card piles drawn on the board itself.
  for (const [x, z, label, fill] of [
    [-0.24, 0.22, 'CHANCE', '#F28C28'],
    [0.24, 0.22, 'TREASURE CHEST', '#8ED1F2'],
  ]) {
    ctx.save();
    ctx.translate(px(x * SIZE), px(z * SIZE));
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = fill;
    ink(ctx, 6);
    ctx.beginPath();
    ctx.roundRect(-150, -95, 300, 190, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 40px Moderustic, sans-serif';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
}

// ─── Dice ──────────────────────────────────────────────────────────────

const PIPS = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

function dieFace(kit, value) {
  return kit.texture(`die-${value}`, 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#fbfbf6';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = INK;
    for (const [x, y] of PIPS[value]) {
      ctx.beginPath();
      ctx.arc(w / 2 + x * 32, h / 2 + y * 32, 11, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// Face order on a BoxGeometry: +x, -x, +y, -y, +z, -z. Opposite faces add to seven.
const DIE_FACES = [1, 6, 2, 5, 3, 4];
// How to turn the die so `value` faces up.
const DIE_UP = {
  2: [0, 0, 0],
  5: [Math.PI, 0, 0],
  1: [0, 0, Math.PI / 2],
  6: [0, 0, -Math.PI / 2],
  3: [-Math.PI / 2, 0, 0],
  4: [Math.PI / 2, 0, 0],
};

// ─── Billboards ────────────────────────────────────────────────────────

function pill(ctx, x, y, w, h, fill, stroke, lineWidth = 6) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(h / 2, 28));
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

class Label {
  constructor(width, height, scale) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.sprite = new Sprite(
      new SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
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
    this.sprite.scale.set(
      this.baseScale * this.aspect * multiplier,
      this.baseScale * multiplier,
      1,
    );
  }

  dispose() {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}

function drawNameTag(ctx, w, h, { name, cash, color, turn, bankrupt, jail }) {
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const pillH = h * 0.56;
  pill(
    ctx,
    6,
    6,
    w - 12,
    pillH,
    turn ? '#FFF3B0' : '#FFFFFF',
    turn ? '#F2B90D' : INK,
    turn ? 9 : 5,
  );
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(34, 6 + pillH / 2, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  const size = 34;
  ctx.font = `800 ${size}px Moderustic, sans-serif`;
  let label = name;
  while (ctx.measureText(label).width > w - 90 && label.length > 3)
    label = `${label.slice(0, -2)}…`;
  ctx.textAlign = 'left';
  ctx.fillText(label, 56, 6 + pillH / 2 + 2);
  ctx.textAlign = 'center';
  const badge = bankrupt ? 'bankrupt' : jail ? `${cash} · in jail` : cash;
  ctx.font = '800 26px Moderustic, sans-serif';
  const bw = ctx.measureText(badge).width + 34;
  pill(
    ctx,
    (w - bw) / 2,
    h * 0.6,
    bw,
    h * 0.36,
    bankrupt ? '#6b6b73' : jail ? '#F28C28' : INK,
    null,
  );
  ctx.fillStyle = '#fff';
  ctx.fillText(badge, w / 2, h * 0.6 + (h * 0.36) / 2 + 1);
}

function drawPopup(ctx, w, h, text, fill) {
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  pill(ctx, 8, 8, w - 16, h - 16, fill, INK, 6);
  ctx.font = `900 ${Math.round(h * 0.5)}px Moderustic, sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.fillText(text, w / 2, h / 2 + 2);
}

function drawCard(ctx, w, h, { deck, text }) {
  const fill = deck === 'chance' ? '#F28C28' : '#8ED1F2';
  ctx.beginPath();
  ctx.roundRect(8, 8, w - 16, h - 16, 26);
  ctx.fillStyle = '#FBF8EE';
  ctx.fill();
  ink(ctx, 8);
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(8, 8, w - 16, 90, [26, 26, 0, 0]);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 44px Moderustic, sans-serif';
  ctx.fillText(deck === 'chance' ? 'CHANCE' : 'TREASURE CHEST', w / 2, 54);
  ctx.font = '700 34px Moderustic, sans-serif';
  const lines = wrap(ctx, text, w - 80);
  lines.forEach((line, i) =>
    ctx.fillText(
      line,
      w / 2,
      100 + (h - 110) / 2 + (i - (lines.length - 1) / 2) * 42,
    ),
  );
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
  return new CanvasTexture(canvas);
}

// ─── The scene ─────────────────────────────────────────────────────────

export function createWoonopolyScene(canvas, { onPick } = {}) {
  const phone = window.matchMedia?.('(pointer: coarse)').matches;
  const options = rendererOptions(phone ? 1.25 : 1.5);
  const renderer = new WebGLRenderer({
    canvas,
    antialias: options.antialias,
    alpha: true,
    powerPreference: 'default',
  });
  const governor = createGovernor(renderer, { max: options.pixelRatio });
  renderer.outputColorSpace = SRGBColorSpace;
  const calm = reducedMotion();

  const kit = new AvatarKit();
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 80);
  scene.add(camera);

  scene.add(new HemisphereLight('#ffffff', '#7a7a8c', 1.7));
  const sun = new DirectionalLight('#ffffff', 1.5);
  sun.position.set(4, 9, 6);
  scene.add(sun);

  // ── The table and board ──
  const table = new Mesh(
    new RoundedBoxGeometry(SIZE * 1.5, 0.5, SIZE * 1.5, 4, 0.2),
    kit.toon('#7A5234'),
  );
  table.position.y = -0.25;
  scene.add(withOutline(table, kit));
  const leg = new Mesh(
    new CylinderGeometry(1.2, 1.8, 3, 24),
    kit.toon('#5E3F28'),
  );
  leg.position.y = -2;
  scene.add(leg);
  const shadow = new Mesh(
    new CircleGeometry(SIZE * 1.1, 40),
    new MeshBasicMaterial({
      map: glowTexture(),
      color: '#000000',
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -3.49;
  scene.add(shadow);

  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = boardCanvas.height = TEXTURE;
  paintBoard(boardCanvas, null);
  const boardTexture = new CanvasTexture(boardCanvas);
  boardTexture.colorSpace = SRGBColorSpace;
  boardTexture.anisotropy = 8;
  const boardTop = new MeshToonMaterial({
    color: '#ffffff',
    map: boardTexture,
    gradientMap: kit.gradient,
  });
  const boardSide = kit.toon('#F4EFE1');
  const board = new Mesh(new BoxGeometry(SIZE, 0.14, SIZE), [
    boardSide,
    boardSide,
    boardTop,
    boardSide,
    boardSide,
    boardSide,
  ]);
  board.position.y = 0;
  scene.add(withOutline(board, kit, true));
  // The site's doodle lands on the board once it has loaded.
  const art = new Image();
  art.onload = () => {
    paintBoard(boardCanvas, art);
    boardTexture.needsUpdate = true;
  };
  art.src = BACK_ART_URL;

  // ── Camera ──
  // Two ways of watching: "follow" rides along behind whoever is moving (or
  // whose turn it is), swinging round the corners with them; "map" looks down
  // on the whole board. Dragging nudges either one, scrolling zooms.
  const orbit = { yaw: 0, pitch: 0.95, radius: 12.2 };
  const orbitGoal = { yaw: 0, pitch: 0.95, radius: 12.2 };
  const target = new Vector3(0, 0, 0.4);
  const targetGoal = new Vector3(0, 0, 0.4);
  let cameraMode = 'follow';
  // How far the pointer has dragged away from where the camera wants to be.
  const nudge = { yaw: 0, pitch: 0, radius: 0 };
  const MAP = { pitch: 1.2, radius: 13.5 };
  const FOLLOW = { pitch: 0.7, radius: 5.8 };

  function placeCamera() {
    camera.position.set(
      target.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.radius,
      target.y + Math.sin(orbit.pitch) * orbit.radius,
      target.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.radius,
    );
    camera.lookAt(target);
  }
  placeCamera();

  // The shortest way round to a yaw, so the camera never spins the long way.
  const nearestYaw = (from, to) =>
    from + Math.atan2(Math.sin(to - from), Math.cos(to - from));

  // Where the camera wants to be this frame, before the pointer's nudge.
  function aimCamera() {
    if (cameraMode === 'map') {
      targetGoal.set(0, 0, 0.3);
      orbitGoal.yaw = nearestYaw(orbit.yaw, mapYaw + nudge.yaw);
      orbitGoal.pitch = MathUtils.clamp(MAP.pitch + nudge.pitch, 0.5, 1.5);
      orbitGoal.radius = MathUtils.clamp(MAP.radius + nudge.radius, 6, 20);
      return;
    }
    // Follow whoever is walking, else whoever the game is waiting on.
    let token = null;
    for (const t of tokens.values()) if (t.walking) token = t;
    if (!token && view)
      token = tokens.get(view.actor >= 0 ? view.actor : view.turn) ?? null;
    if (!token || !token.group.visible) {
      targetGoal.set(0, 0, 0.3);
      orbitGoal.yaw = nearestYaw(orbit.yaw, nudge.yaw);
      orbitGoal.pitch = 0.95;
      orbitGoal.radius = 12.2;
      return;
    }
    const space = token.walking
      ? token.walking.path[Math.max(0, token.walking.k)]
      : token.at;
    const side = RECTS[space].side;
    // Look a little past the token towards the middle of the board, from outside it.
    const inward = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ][side];
    targetGoal.set(
      token.group.position.x + inward[0] * 0.9,
      0.25,
      token.group.position.z + inward[1] * 0.9,
    );
    orbitGoal.yaw = nearestYaw(orbit.yaw, facing(space) + nudge.yaw);
    orbitGoal.pitch = MathUtils.clamp(FOLLOW.pitch + nudge.pitch, 0.25, 1.4);
    orbitGoal.radius = MathUtils.clamp(FOLLOW.radius + nudge.radius, 2.5, 12);
  }
  let mapYaw = 0;

  // ── Highlight ring for the space whose deed is open, and one under the player to move ──
  const pickRing = new Mesh(
    new RingGeometry(0.3, 0.42, 40),
    new MeshBasicMaterial({
      color: '#FFD84D',
      transparent: true,
      opacity: 0,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  pickRing.rotation.x = -Math.PI / 2;
  pickRing.position.y = BOARD_Y + 0.01;
  scene.add(pickRing);
  const turnRing = new Mesh(
    new RingGeometry(0.24, 0.32, 32),
    new MeshBasicMaterial({
      color: '#F2B90D',
      transparent: true,
      opacity: 0.9,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  turnRing.rotation.x = -Math.PI / 2;
  turnRing.position.y = BOARD_Y + 0.012;
  turnRing.visible = false;
  scene.add(turnRing);

  // ── Dice ──
  const dice = [0, 1].map((k) => {
    const die = new Mesh(
      new RoundedBoxGeometry(0.36, 0.36, 0.36, 3, 0.06),
      DIE_FACES.map(
        (v) =>
          new MeshToonMaterial({
            map: dieFace(kit, v),
            gradientMap: kit.gradient,
          }),
      ),
    );
    die.position.set(-0.5 + k * 1.0, BOARD_Y + 0.18, 1.5);
    die.rotation.set(...DIE_UP[k + 3]);
    scene.add(withOutline(die, kit, true));
    return die;
  });
  let diceRoll = null; // { start, values, spin: [Vector3] }

  // ── The city: a building on every lot, growing with what's built on it ──
  // Each street's lot is the inner half of its square, with the building's
  // front facing the road the tokens walk along. Walls are one facade texture
  // per floor count (rows of windows), roofs take the street's colour.
  const wallColours = ['#F1EBDD', '#E8DCC8', '#DCE6EA', '#EFE3E3', '#E4EBDC'];
  const facade = (floors) =>
    kit.texture(`facade-${floors}`, 128, 64 * floors, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#5b6b7a';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      for (let row = 0; row < floors; row++)
        for (let col = 0; col < 3; col++) {
          const x = 14 + col * 38;
          const y = 14 + row * 64;
          ctx.fillRect(x, y, 24, 30);
          ctx.strokeRect(x, y, 24, 30);
          ctx.fillStyle = '#c9dfe9';
          ctx.fillRect(x + 3, y + 3, 8, 10);
          ctx.fillStyle = '#5b6b7a';
        }
    });
  const wallMaterial = (floors, tint) =>
    kit.toon(tint, { map: facade(floors) });
  const roofMaterial = (colour) => kit.toon(colour);
  const trunk = kit.toon('#6B4A2B');
  const leaves = kit.toon('#3E9E5B');
  const leavesDark = kit.toon('#2E7F47');
  const steel = kit.toon('#8C8C99');
  const dark = kit.toon('#26262b');
  const geo = (key, make) => kit.geometry(key, make);

  const box = (w, h, d, material, y = h / 2) => {
    const mesh = new Mesh(
      geo(`box-${w}-${h}-${d}`, () => new BoxGeometry(w, h, d)),
      material,
    );
    mesh.position.y = y;
    return withOutline(mesh, kit, true);
  };
  const cylinder = (rTop, rBottom, h, material, y = h / 2, sides = 12) => {
    const mesh = new Mesh(
      geo(
        `cyl-${rTop}-${rBottom}-${h}-${sides}`,
        () => new CylinderGeometry(rTop, rBottom, h, sides),
      ),
      material,
    );
    mesh.position.y = y;
    return withOutline(mesh, kit, true);
  };
  const cone = (r, h, material, y, sides = 4) => {
    const mesh = new Mesh(
      geo(`cone-${r}-${h}-${sides}`, () => new ConeGeometry(r, h, sides)),
      material,
    );
    mesh.position.y = y;
    mesh.rotation.y = sides === 4 ? Math.PI / 4 : 0;
    return withOutline(mesh, kit, true);
  };

  // Where a lot's building stands, facing the road: { x, z, rot }.
  function lotFrame(index) {
    const r = RECTS[index];
    if (r.corner)
      return {
        x: r.x,
        z: r.z,
        rot: [0, Math.PI / 2, Math.PI, -Math.PI / 2][r.side],
      };
    const inset = CORNER / 4 + 0.02;
    switch (r.side) {
      case 0:
        return { x: r.x, z: r.z - inset, rot: 0 };
      case 1:
        return { x: r.x + inset, z: r.z, rot: Math.PI / 2 };
      case 2:
        return { x: r.x, z: r.z + inset, rot: Math.PI };
      default:
        return { x: r.x - inset, z: r.z, rot: -Math.PI / 2 };
    }
  }

  // A street's building for its level: 0 an empty lot with a sign, 1 a shop,
  // 2-5 a block one floor taller per house, 6 a hotel tower.
  function streetBuilding(index, level, mortgaged) {
    const info = BOARD[index];
    const colour = mortgaged ? '#8a8a8a' : GROUPS[info.group].color;
    const g = new Group();
    if (level === 0) {
      const post = cylinder(0.015, 0.015, 0.26, trunk, 0.13, 6);
      post.position.set(0.18, 0, 0.12);
      g.add(post);
      const sign = box(0.22, 0.12, 0.02, kit.toon('#FBF8EE'), 0.3);
      sign.position.set(0.18, 0, 0.12);
      g.add(sign);
      return g;
    }
    const tint = wallColours[index % wallColours.length];
    if (level === 6) {
      const floors = 8;
      const h = floors * 0.16;
      const tower = box(0.5, h, 0.42, wallMaterial(floors, tint));
      g.add(tower);
      const cap = box(0.56, 0.05, 0.48, roofMaterial(colour), h + 0.025);
      g.add(cap);
      const spire = cylinder(0.01, 0.03, 0.3, steel, h + 0.2, 6);
      g.add(spire);
      const beacon = new Mesh(
        geo('beacon', () => new SphereGeometry(0.035, 8, 6)),
        kit.toon('#E5484D'),
      );
      beacon.position.y = h + 0.36;
      g.add(beacon);
      return g;
    }
    const floors = level;
    const h = floors * 0.16;
    const width = 0.58;
    const depth = 0.4;
    g.add(box(width, h, depth, wallMaterial(floors, tint)));
    if (floors <= 2) {
      g.add(cone(0.42, 0.18, roofMaterial(colour), h + 0.09));
    } else {
      g.add(
        box(width + 0.06, 0.05, depth + 0.06, roofMaterial(colour), h + 0.025),
      );
      const top = box(0.2, 0.1, 0.16, kit.toon(tint), h + 0.1);
      top.position.set(0.12, 0, -0.05);
      g.add(top);
    }
    // A shop sign over the door in the street's colour.
    const awning = box(0.32, 0.02, 0.1, roofMaterial(colour), 0.13);
    awning.position.z = depth / 2 + 0.04;
    g.add(awning);
    return g;
  }

  function stationBuilding() {
    const g = new Group();
    g.add(box(0.7, 0.24, 0.34, wallMaterial(1, '#F1EBDD')));
    g.add(box(0.78, 0.05, 0.42, kit.toon('#3A3A44'), 0.265));
    const tower = box(0.16, 0.5, 0.16, kit.toon('#F1EBDD'));
    tower.position.set(-0.24, 0, -0.06);
    g.add(tower);
    const clock = cone(0.13, 0.14, kit.toon('#3A3A44'), 0.57);
    clock.position.set(-0.24, 0, -0.06);
    g.add(clock);
    // A little tram on the platform.
    const tram = box(0.34, 0.14, 0.14, kit.toon('#E5484D'), 0.12);
    tram.position.set(0.14, 0, 0.3);
    g.add(tram);
    for (const x of [0.02, 0.26]) {
      const wheel = cylinder(0.035, 0.035, 0.16, dark, 0.04, 10);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0, 0.3);
      g.add(wheel);
    }
    return g;
  }

  function utilityBuilding(index) {
    const g = new Group();
    if (BOARD[index].name.includes('Power')) {
      g.add(box(0.5, 0.3, 0.36, wallMaterial(2, '#DCE6EA')));
      g.add(box(0.56, 0.04, 0.42, steel, 0.32));
      for (const x of [-0.12, 0.12]) {
        const chimney = cylinder(
          0.05,
          0.06,
          0.5,
          kit.toon('#B84A3E'),
          0.25,
          10,
        );
        chimney.position.set(x, 0, -0.06);
        g.add(chimney);
      }
      const bolt = cone(0.08, 0.16, kit.toon('#F2D02B'), 0.4, 3);
      bolt.position.set(0.18, 0, 0.1);
      g.add(bolt);
    } else {
      for (const [x, z] of [
        [-0.12, -0.12],
        [0.12, -0.12],
        [-0.12, 0.12],
        [0.12, 0.12],
      ]) {
        const leg = cylinder(0.02, 0.02, 0.4, steel, 0.2, 6);
        leg.position.set(x, 0, z);
        g.add(leg);
      }
      g.add(cylinder(0.24, 0.24, 0.26, kit.toon('#8ED1F2'), 0.5, 14));
      g.add(cone(0.26, 0.14, kit.toon('#3E7BE0'), 0.7, 14));
      const pump = box(0.3, 0.16, 0.2, wallMaterial(1, '#E4EBDC'), 0.08);
      pump.position.set(0.28, 0, 0.14);
      g.add(pump);
    }
    return g;
  }

  function cornerBuilding(index) {
    const g = new Group();
    switch (BOARD[index].type) {
      case 'go': {
        // An arch over the start line.
        for (const x of [-0.42, 0.42]) {
          const pillar = box(0.1, 0.5, 0.1, kit.toon('#E5484D'));
          pillar.position.set(x, 0, -0.25);
          g.add(pillar);
        }
        const beam = box(0.94, 0.1, 0.12, kit.toon('#E5484D'), 0.55);
        beam.position.z = -0.25;
        g.add(beam);
        break;
      }
      case 'jail': {
        // A cell in the corner, behind bars.
        const cell = box(0.5, 0.36, 0.5, wallMaterial(1, '#C9C4B8'));
        cell.position.set(0.3, 0, -0.3);
        g.add(cell);
        const roof = box(0.56, 0.05, 0.56, dark, 0.385);
        roof.position.set(0.3, 0, -0.3);
        g.add(roof);
        for (let i = 0; i < 4; i++) {
          const bar = cylinder(0.012, 0.012, 0.36, dark, 0.18, 6);
          bar.position.set(0.1 + i * 0.13, 0, -0.04);
          g.add(bar);
          const bar2 = cylinder(0.012, 0.012, 0.36, dark, 0.18, 6);
          bar2.position.set(0.04, 0, -0.1 - i * 0.13);
          g.add(bar2);
        }
        break;
      }
      case 'parking': {
        // A parked car.
        const body = box(0.5, 0.12, 0.26, kit.toon('#F2B90D'), 0.1);
        g.add(body);
        const cabin = box(0.26, 0.1, 0.22, kit.toon('#8ED1F2'), 0.21);
        cabin.position.x = -0.03;
        g.add(cabin);
        for (const [x, z] of [
          [-0.16, -0.14],
          [0.16, -0.14],
          [-0.16, 0.14],
          [0.16, 0.14],
        ]) {
          const wheel = cylinder(0.05, 0.05, 0.05, dark, 0.05, 10);
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(x, 0, z);
          g.add(wheel);
        }
        break;
      }
      default: {
        // Go To Jail: a police light on a post.
        const post = cylinder(0.02, 0.025, 0.5, steel, 0.25, 8);
        g.add(post);
        const light = new Mesh(
          geo('beacon', () => new SphereGeometry(0.035, 8, 6)),
          kit.toon('#3E7BE0'),
        );
        light.scale.setScalar(1.8);
        light.position.y = 0.56;
        g.add(light);
      }
    }
    return g;
  }

  // The park in the middle: trees, a fountain, benches.
  function tree(size) {
    const g = new Group();
    g.add(cylinder(0.03 * size, 0.04 * size, 0.2 * size, trunk, 0.1 * size, 6));
    g.add(cone(0.17 * size, 0.32 * size, leaves, 0.32 * size, 7));
    g.add(cone(0.13 * size, 0.26 * size, leavesDark, 0.5 * size, 7));
    return g;
  }
  const park = new Group();
  scene.add(park);
  // The same layout every game: a simple seeded pattern.
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const inner = HALF - CORNER - 0.55;
  for (let i = 0; i < 22; i++) {
    const t = tree(0.8 + rand() * 0.6);
    // Ring the lawn, leaving the middle for the name and the card piles.
    const a = (i / 22) * Math.PI * 2 + rand() * 0.2;
    const d = inner * (0.72 + rand() * 0.22);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.abs(x) > inner || Math.abs(z) > inner) continue;
    t.position.set(x, BOARD_Y, z);
    t.rotation.y = rand() * Math.PI;
    park.add(t);
  }
  const fountain = new Group();
  fountain.add(cylinder(0.42, 0.46, 0.08, kit.toon('#C9C4B8'), 0.04, 18));
  fountain.add(cylinder(0.36, 0.36, 0.03, kit.toon('#8ED1F2'), 0.09, 18));
  fountain.add(cylinder(0.06, 0.09, 0.3, kit.toon('#C9C4B8'), 0.2, 10));
  fountain.add(cylinder(0.18, 0.18, 0.03, kit.toon('#8ED1F2'), 0.36, 14));
  fountain.position.set(0, BOARD_Y, 0);
  fountain.scale.setScalar(0.9);
  park.add(fountain);

  // Buildings that never change: stations, utilities and the corners.
  const fixtures = new Group();
  scene.add(fixtures);
  BOARD.forEach((space, index) => {
    let building = null;
    if (space.type === 'station') building = stationBuilding();
    else if (space.type === 'utility') building = utilityBuilding(index);
    else if (RECTS[index].corner) building = cornerBuilding(index);
    if (!building) return;
    const { x, z, rot } = lotFrame(index);
    building.position.set(x, BOARD_Y, z);
    building.rotation.y = rot;
    fixtures.add(building);
  });

  // The streets' buildings and the owner markers, rebuilt whenever a deed changes hands or a house goes up.
  const markerGeometry = new CylinderGeometry(0.13, 0.13, 0.04, 20);
  const buildings = new Group();
  scene.add(buildings);
  const markers = new Group();
  scene.add(markers);
  let buildingsKey = '';

  function markerSpot(index) {
    const r = RECTS[index];
    const out = r.corner ? 0 : (r.side % 2 ? r.w : r.h) / 2 - 0.14;
    switch (r.side) {
      case 0:
        return [r.x + r.w / 2 - 0.16, r.z + out];
      case 1:
        return [r.x - out, r.z - r.h / 2 + 0.16];
      case 2:
        return [r.x - r.w / 2 + 0.16, r.z - out];
      default:
        return [r.x + out, r.z + r.h / 2 - 0.16];
    }
  }

  function refreshBuildings(view) {
    const key = Object.entries(view.props)
      .map(
        ([s, p]) =>
          `${s}:${p.owner ?? '-'}:${p.houses}:${p.mortgaged ? 'm' : ''}`,
      )
      .join('|');
    if (key === buildingsKey) return;
    buildingsKey = key;
    // Geometry and materials are shared through the kit, so a rebuild just swaps groups.
    for (const child of [...buildings.children]) buildings.remove(child);
    for (const child of [...markers.children]) {
      markers.remove(child);
      child.material.dispose();
    }
    for (const [s, prop] of Object.entries(view.props)) {
      const index = Number(s);
      if (BOARD[index].type === 'street') {
        const level =
          prop.owner === null ? 0 : prop.houses === 5 ? 6 : 1 + prop.houses;
        const building = streetBuilding(index, level, prop.mortgaged);
        const { x, z, rot } = lotFrame(index);
        building.position.set(x, BOARD_Y, z);
        building.rotation.y = rot;
        buildings.add(building);
      }
      if (prop.owner === null) continue;
      const player = view.players[prop.owner];
      const marker = new Mesh(
        markerGeometry,
        new MeshToonMaterial({
          color: new Color(player.color),
          gradientMap: kit.gradient,
          transparent: prop.mortgaged,
          opacity: prop.mortgaged ? 0.35 : 1,
        }),
      );
      const [mx, mz] = markerSpot(index);
      marker.position.set(mx, BOARD_Y + 0.02, mz);
      markers.add(withOutline(marker, kit, true));
    }
  }

  // ── Tokens ──
  // index -> { group, avatar, tag, key, at (space), inJail, walking }
  const tokens = new Map();
  const popups = Array.from({ length: 10 }, () => {
    const label = new Label(260, 90, 0.5);
    label.sprite.visible = false;
    scene.add(label.sprite);
    return { label, until: 0, from: new Vector3() };
  });
  const cardLabel = new Label(720, 400, 1.7);
  cardLabel.sprite.position.set(0, 1.9, 0.2);
  cardLabel.sprite.visible = false;
  scene.add(cardLabel.sprite);
  let cardUntil = 0;

  function slotOf(view, index) {
    // Tokens sharing a space line up in seat order.
    const me = view.players[index];
    let slot = 0;
    for (let i = 0; i < index; i++) {
      const p = view.players[i];
      if (!p.bankrupt && p.pos === me.pos && p.inJail === me.inJail) slot++;
    }
    return slot;
  }

  function popup(text, fill, at) {
    const free = popups.find((p) => !p.label.sprite.visible) ?? popups[0];
    free.label.draw(text + fill, (ctx, w, h) =>
      drawPopup(ctx, w, h, text, fill),
    );
    free.from.copy(at);
    free.label.sprite.position.copy(at);
    free.label.sprite.visible = true;
    free.label.sprite.material.opacity = 1;
    free.until = performance.now() + 1500;
  }

  // ── Animation timeline ──
  // Everything the last view brought: [{ at (ms from now), run }], sorted by time.
  let timeline = [];
  let lastEvent = null;
  let lastGame = null;
  let view = null;

  function schedule(at, run) {
    timeline.push({ at: performance.now() + at, run });
  }

  function tokenHeadTop(token) {
    return token.group.position
      .clone()
      .add(new Vector3(0, 1.9 * AVATAR_SCALE + 0.15, 0));
  }

  function walk(token, from, to, steps, slot) {
    // Hop one space at a time; backwards for a "go back" card.
    const path = [];
    const dir = steps < 0 ? -1 : 1;
    for (let k = 1; k <= Math.abs(steps); k++)
      path.push((from + dir * k + 40) % 40);
    if (!path.length) path.push(to);
    token.walking = {
      path,
      k: 0,
      start: performance.now(),
      slot,
      fromPos: token.group.position.clone(),
    };
  }

  function applyEvents(next) {
    const sameGame = lastGame === next.gameId;
    lastGame = next.gameId;
    const events = next.events ?? [];
    if (!sameGame) {
      lastEvent = events.at(-1)?.id ?? null;
      timeline = [];
      return 0;
    }
    const fresh = events.filter((e) => lastEvent === null || e.id > lastEvent);
    lastEvent = events.at(-1)?.id ?? lastEvent;
    let t = 0;
    for (const e of fresh) {
      switch (e.type) {
        case 'roll':
          schedule(t, () => {
            diceRoll = {
              start: performance.now(),
              values: e.dice,
              spin: dice.map(
                () =>
                  new Vector3(
                    Math.random() * 12 + 6,
                    Math.random() * 12 + 6,
                    Math.random() * 12 + 6,
                  ),
              ),
            };
            sfx('poly.dice');
          });
          t += calm ? 300 : ROLL_MS;
          break;
        case 'move': {
          const steps = Math.max(-40, Math.min(e.steps, 40));
          const from = e.from;
          const to = e.to;
          const playerIndex = e.player;
          schedule(t, () => {
            const tok = tokens.get(playerIndex);
            if (!tok) return;
            if (calm) {
              tok.at = to;
              tok.inJail = false;
              tok.group.position.copy(
                standingSpot(to, slotOf(view, playerIndex), false),
              );
              tok.group.rotation.y = facing(to);
              return;
            }
            walk(tok, from, to, steps, slotOf(view, playerIndex));
          });
          t += calm ? 200 : Math.abs(steps) * STEP_MS + 250;
          break;
        }
        case 'jail': {
          const playerIndex = e.player;
          schedule(t, () => {
            const tok = tokens.get(playerIndex);
            if (!tok) return;
            tok.walking = null;
            tok.at = JAIL;
            tok.inJail = true;
            tok.group.position.copy(
              standingSpot(JAIL, slotOf(view, playerIndex), true),
            );
            tok.group.rotation.y = 0;
            tok.mood = { face: 'sad', until: performance.now() + 4000 };
            sfx('poly.jail');
          });
          t += 900;
          break;
        }
        case 'free':
          schedule(t, () => {
            const tok = tokens.get(e.player);
            if (tok) tok.inJail = false;
          });
          break;
        case 'card':
          schedule(t, () => {
            cardLabel.draw(`${e.deck}:${e.text}`, (ctx, w, h) =>
              drawCard(ctx, w, h, e),
            );
            cardLabel.sprite.visible = true;
            cardUntil = performance.now() + 3800;
            sfx('poly.card');
          });
          t += CARD_MS;
          break;
        case 'money': {
          const amount = e.amount;
          const playerIndex = e.player;
          schedule(t, () => {
            const tok = tokens.get(playerIndex);
            if (!tok) return;
            popup(
              `${amount > 0 ? '+' : '−'}${money(amount)}`,
              amount > 0 ? '#30A46C' : '#E5484D',
              tokenHeadTop(tok),
            );
            if (Math.abs(amount) >= 1000)
              sfx(amount > 0 ? 'poly.receive' : 'poly.pay');
            if (amount < -10000)
              tok.mood = { face: 'annoyed', until: performance.now() + 2500 };
            if (amount > 10000)
              tok.mood = { face: 'joy', until: performance.now() + 2500 };
          });
          break;
        }
        case 'buy':
        case 'sold':
          schedule(t, () => sfx('poly.buy'));
          break;
        case 'build':
          schedule(t, () => sfx('poly.build'));
          break;
        case 'bid':
          schedule(t, () => sfx('poly.bid'));
          break;
        case 'bankrupt': {
          const playerIndex = e.player;
          schedule(t, () => {
            const tok = tokens.get(playerIndex);
            if (tok) tok.mood = { face: 'stunned', until: Infinity };
            sfx('poly.bankrupt');
          });
          t += 800;
          break;
        }
        case 'win': {
          const playerIndex = e.player;
          schedule(t, () => {
            const tok = tokens.get(playerIndex);
            if (tok) tok.mood = { face: 'cheer', until: Infinity };
          });
          break;
        }
        default:
          break;
      }
    }
    return t;
  }

  function refreshTokens(next) {
    next.players.forEach((player, index) => {
      let token = tokens.get(index);
      const key = avatarKey(player.avatar);
      if (token && token.key !== key) {
        disposeAvatar(token.avatar);
        token.group.remove(token.avatar);
        token.avatar = buildAvatar(player.avatar, kit);
        token.avatar.scale.setScalar(AVATAR_SCALE);
        token.group.add(token.avatar);
        token.key = key;
      }
      if (!token) {
        const group = new Group();
        const avatar = buildAvatar(player.avatar, kit);
        avatar.scale.setScalar(AVATAR_SCALE);
        group.add(avatar);
        group.position.copy(
          standingSpot(player.pos, slotOf(next, index), player.inJail),
        );
        group.rotation.y = facing(player.pos);
        scene.add(group);
        const tag = new Label(360, 140, 0.55);
        scene.add(tag.sprite);
        token = {
          group,
          avatar,
          tag,
          key,
          at: player.pos,
          inJail: player.inJail,
          walking: null,
          mood: null,
          phase: Math.random() * 10,
        };
        tokens.set(index, token);
      }
      token.group.visible = !player.bankrupt;
      token.tag.sprite.visible = !player.bankrupt;
      token.tag.draw(
        `${player.name}|${player.money}|${player.color}|${next.turn === index}|${player.bankrupt}|${player.inJail}`,
        (ctx, w, h) =>
          drawNameTag(ctx, w, h, {
            name: player.name,
            cash: money(player.money),
            color: player.color,
            turn: next.turn === index && next.phase !== 'over',
            bankrupt: player.bankrupt,
            jail: player.inJail,
          }),
      );
    });
  }

  // Once the timeline has played out, every token stands exactly where the view says.
  function settleTokens() {
    if (!view) return;
    view.players.forEach((player, index) => {
      const token = tokens.get(index);
      if (!token || token.walking) return;
      token.at = player.pos;
      token.inJail = player.inJail;
      token.group.position.copy(
        standingSpot(player.pos, slotOf(view, index), player.inJail),
      );
      token.group.rotation.y = player.inJail ? 0 : facing(player.pos);
    });
  }

  // ── Pointer: orbit by dragging, pick a space by tapping ──
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const boardPlane = new Plane(new Vector3(0, 1, 0), -BOARD_Y);
  const hit = new Vector3();
  let press = null;
  let pinch = null;
  let hovering = -1;

  function spaceUnder(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(boardPlane, hit)) return -1;
    return spaceAt(hit.x, hit.z);
  }

  const onDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    canvas.setPointerCapture?.(event.pointerId);
    press = {
      x: event.clientX,
      y: event.clientY,
      yaw: nudge.yaw,
      pitch: nudge.pitch,
      moved: false,
      id: event.pointerId,
    };
  };
  const onMove = (event) => {
    if (press && press.id === event.pointerId) {
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) press.moved = true;
      if (press.moved) {
        nudge.yaw = press.yaw - dx * 0.006;
        nudge.pitch = press.pitch + dy * 0.005;
      }
      return;
    }
    const space = spaceUnder(event.clientX, event.clientY);
    if (space !== hovering) {
      hovering = space;
      canvas.classList.toggle(
        'is-pointing',
        space >= 0 && isProperty(BOARD[space]),
      );
    }
  };
  const onUp = (event) => {
    if (!press || press.id !== event.pointerId) return;
    if (!press.moved) {
      const space = spaceUnder(event.clientX, event.clientY);
      onPick?.(space >= 0 ? space : null);
    }
    press = null;
  };
  const onWheel = (event) => {
    event.preventDefault();
    nudge.radius = MathUtils.clamp(nudge.radius + event.deltaY * 0.01, -8, 8);
  };
  const onTouchStart = (event) => {
    if (event.touches.length === 2) {
      const [a, b] = event.touches;
      pinch = {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        radius: nudge.radius,
      };
      press = null;
    }
  };
  const onTouchMove = (event) => {
    if (pinch && event.touches.length === 2) {
      event.preventDefault();
      const [a, b] = event.touches;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      nudge.radius = MathUtils.clamp(
        pinch.radius + (pinch.distance - distance) * 0.02,
        -8,
        8,
      );
    }
  };
  const onTouchEnd = () => {
    pinch = null;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);

  // ── Frame ──
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
  let onScreen = true;
  const visibility = new IntersectionObserver(
    ([entry]) => (onScreen = entry.isIntersecting),
  );
  visibility.observe(canvas);

  // ── Little animations on the rig: walking, idling, cheering, sulking ──
  const limbs = (token) => ({
    arms: token.avatar.userData.arms ?? [],
    legs: token.avatar.userData.legs ?? [],
    head: token.avatar.userData.head,
  });
  function stride(token, now, speed) {
    const { arms, legs, head } = limbs(token);
    const t = (now / 110) * speed + token.phase;
    legs.forEach((hip, i) =>
      hip.rotation.set(Math.sin(t + i * Math.PI) * 0.7, 0, 0),
    );
    arms.forEach((shoulder, i) =>
      shoulder.rotation.set(
        Math.sin(t + (1 - i) * Math.PI) * 0.5,
        0,
        (i ? 1 : -1) * 0.12,
      ),
    );
    if (head) head.rotation.set(0.05, 0, Math.sin(t / 2) * 0.05);
  }
  function idle(token, now) {
    const { arms, legs, head } = limbs(token);
    const t = now / 700 + token.phase;
    legs.forEach((hip) => hip.rotation.set(0, 0, 0));
    arms.forEach((shoulder, i) =>
      shoulder.rotation.set(0, 0, (i ? 1 : -1) * (0.08 + Math.sin(t) * 0.05)),
    );
    if (head)
      head.rotation.set(0, Math.sin(t / 1.7) * 0.15, Math.sin(t / 1.3) * 0.05);
  }
  function cheer(token, now) {
    const { arms, legs, head } = limbs(token);
    const t = now / 160;
    legs.forEach((hip, i) => hip.rotation.set(0, 0, (i ? 1 : -1) * 0.25));
    arms.forEach((shoulder, i) =>
      shoulder.rotation.set(0, 0, (i ? 1 : -1) * (2.6 + Math.sin(t + i) * 0.3)),
    );
    if (head) head.rotation.set(-0.25, 0, Math.sin(t / 2) * 0.12);
  }
  function sulk(token, now) {
    const { arms, legs, head } = limbs(token);
    legs.forEach((hip) => hip.rotation.set(0, 0, 0));
    arms.forEach((shoulder, i) =>
      shoulder.rotation.set(0.15, 0, (i ? 1 : -1) * 0.05),
    );
    if (head) head.rotation.set(0.35, Math.sin(now / 900) * 0.1, 0);
  }

  let picked = null;
  let lastFrame = performance.now();
  const bob = new Vector3();

  function frame(now) {
    const gap = now - lastFrame;
    const dt = Math.min(0.1, gap / 1000);
    lastFrame = now;
    if (!onScreen || tabHidden()) return;
    governor.frame(gap, now);

    // The camera eases towards wherever it should be looking from.
    aimCamera();
    const ease = 1 - Math.exp(-dt * (cameraMode === 'follow' ? 4 : 6));
    orbit.yaw += (orbitGoal.yaw - orbit.yaw) * ease;
    orbit.pitch += (orbitGoal.pitch - orbit.pitch) * ease;
    orbit.radius += (orbitGoal.radius - orbit.radius) * ease;
    target.lerp(targetGoal, ease);
    placeCamera();

    // Due timeline entries run in order.
    while (timeline.length && timeline[0].at <= now) timeline.shift().run();

    // Dice tumble, then land showing their values.
    if (diceRoll) {
      const p = Math.min(1, (now - diceRoll.start) / (calm ? 300 : ROLL_MS));
      dice.forEach((die, k) => {
        if (p < 0.8) {
          const spin = diceRoll.spin[k];
          die.rotation.x += spin.x * dt;
          die.rotation.y += spin.y * dt;
          die.rotation.z += spin.z * dt;
          die.position.y = BOARD_Y + 0.18 + Math.sin(p * Math.PI) * 0.9;
        } else {
          const [rx, ry, rz] = DIE_UP[diceRoll.values[k]];
          const q = (p - 0.8) / 0.2;
          die.rotation.x += (rx - die.rotation.x) * q;
          die.rotation.y += (ry + k * 0.7 - die.rotation.y) * q;
          die.rotation.z += (rz - die.rotation.z) * q;
          die.position.y += (BOARD_Y + 0.18 - die.position.y) * q;
        }
      });
      if (p >= 1) {
        dice.forEach((die, k) => {
          const [rx, ry, rz] = DIE_UP[diceRoll.values[k]];
          die.rotation.set(rx, ry + k * 0.7, rz);
          die.position.y = BOARD_Y + 0.18;
        });
        diceRoll = null;
      }
    }

    // Tokens hop from space to space.
    for (const [index, token] of tokens) {
      const w = token.walking;
      if (w) {
        // The frame's clock can sit a hair behind the timeline's, so never before the start.
        const elapsed = Math.max(0, now - w.start);
        const k = Math.min(w.path.length - 1, Math.floor(elapsed / STEP_MS));
        const within = Math.min(1, (elapsed - k * STEP_MS) / STEP_MS);
        if (k !== w.k || w.k === 0) {
          if (k !== w.k) sfx('poly.step');
          w.k = k;
          w.fromPos =
            k === 0 ? w.fromPos : standingSpot(w.path[k - 1], w.slot, false);
        }
        const to = standingSpot(w.path[k], w.slot, false);
        token.group.position.lerpVectors(w.fromPos, to, within);
        token.group.position.y = BOARD_Y + Math.sin(within * Math.PI) * 0.18;
        // Face the way they're going, then turn to the road once they land.
        const heading = Math.atan2(to.x - w.fromPos.x, to.z - w.fromPos.z);
        token.group.rotation.y =
          elapsed < w.path.length * STEP_MS - STEP_MS * 0.5
            ? heading
            : facing(w.path[k]);
        stride(token, now, 1);
        if (elapsed >= w.path.length * STEP_MS) {
          token.walking = null;
          token.at = w.path.at(-1);
          token.group.position.copy(to);
          token.group.position.y = BOARD_Y;
          sfx('poly.land');
        }
      } else if (view && !view.players[index].bankrupt) {
        const player = view.players[index];
        const active = view.turn === index && view.phase !== 'over';
        const winner = view.phase === 'over' && view.winner === index;
        if (winner && !calm) {
          // Jumping for joy.
          token.group.position.y =
            BOARD_Y + Math.abs(Math.sin(now / 220)) * 0.3;
          cheer(token, now);
        } else if (player.inJail) sulk(token, now);
        else {
          token.group.position.y =
            active && !calm
              ? BOARD_Y + Math.abs(Math.sin(now / 300 + token.phase)) * 0.03
              : BOARD_Y;
          idle(token, now);
        }
      }
      // Faces go back to normal after a moment.
      const face = token.avatar.userData.face;
      if (face) {
        const mood =
          token.mood && token.mood.until > now ? token.mood.face : null;
        if (mood !== token.shownMood) {
          face.material = mood
            ? moodFace(token.avatar, kit, mood)
            : token.avatar.userData.faceOpen;
          token.shownMood = mood;
        }
      }
      // The name tag floats above the head.
      bob.copy(token.group.position);
      bob.y += 1.9 * AVATAR_SCALE + 0.32;
      token.tag.sprite.position.copy(bob);
      const distance = camera.position.distanceTo(bob);
      token.tag.setScale(0.16 + distance * 0.055);
    }

    // The ring under whoever is up.
    if (view && view.phase !== 'over' && view.turn >= 0) {
      const token = tokens.get(view.turn);
      if (token && token.group.visible) {
        turnRing.visible = true;
        turnRing.position.x = token.group.position.x;
        turnRing.position.z = token.group.position.z;
        const pulse = calm ? 1 : 1 + Math.sin(now / 300) * 0.08;
        turnRing.scale.setScalar(pulse);
      } else turnRing.visible = false;
    } else turnRing.visible = false;

    // Pop-ups float up and fade.
    for (const p of popups) {
      if (!p.label.sprite.visible) continue;
      const left = p.until - now;
      if (left <= 0) {
        p.label.sprite.visible = false;
        continue;
      }
      const q = 1 - left / 1500;
      p.label.sprite.position.copy(p.from);
      p.label.sprite.position.y += q * 0.9;
      p.label.sprite.material.opacity = Math.min(1, left / 400);
    }
    if (cardLabel.sprite.visible) {
      const left = cardUntil - now;
      cardLabel.sprite.material.opacity = Math.max(0, Math.min(1, left / 400));
      cardLabel.sprite.position.y = 1.9 + Math.sin(now / 900) * 0.05;
      if (left <= 0) cardLabel.sprite.visible = false;
    }
    if (pickRing.material.opacity > 0 || picked !== null) {
      const goal = picked === null ? 0 : 0.85 + Math.sin(now / 250) * 0.15;
      pickRing.material.opacity += (goal - pickRing.material.opacity) * 0.2;
    }

    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  return {
    setView(next) {
      const settle = applyEvents(next);
      view = next;
      refreshTokens(next);
      refreshBuildings(next);
      // Once the animations are done, everyone stands where the game says.
      schedule(settle + 10, settleTokens);
    },
    setPointer(space) {
      picked = space;
      if (space !== null && space !== undefined) {
        const r = RECTS[space];
        pickRing.position.x = r.x;
        pickRing.position.z = r.z;
        pickRing.scale.setScalar(r.corner ? 1.6 : 1);
      }
    },
    // 'follow' rides with the player on the move; 'map' looks down on the whole board.
    setCamera(mode) {
      cameraMode = mode === 'map' ? 'map' : 'follow';
      nudge.yaw = 0;
      nudge.pitch = 0;
      nudge.radius = 0;
    },
    // Look at the map from one side of the board.
    lookFrom(side) {
      cameraMode = 'map';
      mapYaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][side] ?? 0;
      nudge.yaw = 0;
      nudge.pitch = 0;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      visibility.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      for (const token of tokens.values()) {
        disposeAvatar(token.avatar);
        token.tag.dispose();
      }
      for (const p of popups) p.label.dispose();
      cardLabel.dispose();
      for (const die of dice) for (const m of die.material) m.dispose();
      boardTop.dispose();
      boardTexture.dispose();
      shadow.material.map.dispose();
      shadow.material.dispose();
      scene.traverse((o) => o.geometry?.dispose?.());
      kit.dispose();
      renderer.dispose();
    },
  };
}
