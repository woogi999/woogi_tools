/* eslint-disable warp-drive/no-legacy-request-patterns -- ctx.save() here is the canvas API, not a data request */

// Player avatars: round doodle heads somewhere between a Mii, an OMORI sprite
// and a Mob Psycho 100 scribble. An avatar is a small plain object, so it can
// be saved in localStorage and sent to other players as-is.
//
// The face (eyes, mouth, blush, glasses) is always drawn in 2D here: the lobby
// portrait paints it straight onto a canvas, and the 3D table uses the same
// drawing as a texture on the front of the head.

export const HAIR_STYLES = [
  { id: 'bowl', label: 'Bowl cut' },
  { id: 'spiky', label: 'Spiky' },
  { id: 'long', label: 'Long' },
  { id: 'bun', label: 'Bun' },
  { id: 'curly', label: 'Curly' },
  { id: 'mohawk', label: 'Mohawk' },
  { id: 'none', label: 'Bald' },
];
export const EYES = [
  { id: 'dots', label: 'Dots' },
  { id: 'big', label: 'Big' },
  { id: 'happy', label: 'Happy' },
  { id: 'sleepy', label: 'Sleepy' },
  { id: 'blank', label: 'Blank' },
  { id: 'wink', label: 'Wink' },
];
export const MOUTHS = [
  { id: 'smile', label: 'Smile' },
  { id: 'flat', label: 'Flat' },
  { id: 'open', label: 'Open' },
  { id: 'cat', label: ':3' },
  { id: 'frown', label: 'Frown' },
  { id: 'grin', label: 'Grin' },
];
export const EXTRAS = [
  { id: 'none', label: 'None' },
  { id: 'glasses', label: 'Glasses' },
  { id: 'bow', label: 'Bow' },
  { id: 'cap', label: 'Cap' },
  { id: 'halo', label: 'Halo' },
  { id: 'bandage', label: 'Plaster' },
];
export const SKIN_TONES = ['#FFE3C8', '#F6CFA8', '#E3B083', '#C68B5E', '#8D5A3B', '#5C3A24', '#F2F2F2'];
export const HAIR_COLORS = ['#1B1B1B', '#4A2F1B', '#A0522D', '#E8C468', '#D9D9D9', '#E5484D', '#3E7BE0', '#B388EB'];
export const SHIRT_COLORS = ['#3E7BE0', '#E5484D', '#30A46C', '#F2B90D', '#1B1B1B', '#F2F2F2', '#B388EB', '#FF8FAB'];

const HEX = /^#[0-9A-F]{6}$/i;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const oneOf = (list, id, fallback) => (list.some((o) => o.id === id) ? id : fallback);
const hexOr = (value, fallback) => (HEX.test(value ?? '') ? value.toUpperCase() : fallback);

export function randomAvatar() {
  return {
    skin: pick(SKIN_TONES.slice(0, 6)),
    hair: pick(HAIR_STYLES).id,
    hairColor: pick(HAIR_COLORS),
    eyes: pick(EYES).id,
    mouth: pick(MOUTHS).id,
    blush: Math.random() < 0.5,
    shirt: pick(SHIRT_COLORS),
    extra: Math.random() < 0.5 ? 'none' : pick(EXTRAS).id,
  };
}

// Anything that arrives from storage or another player is untrusted: keep only known values.
export function normaliseAvatar(avatar) {
  const a = avatar && typeof avatar === 'object' ? avatar : {};
  return {
    skin: hexOr(a.skin, SKIN_TONES[1]),
    hair: oneOf(HAIR_STYLES, a.hair, 'bowl'),
    hairColor: hexOr(a.hairColor, HAIR_COLORS[0]),
    eyes: oneOf(EYES, a.eyes, 'dots'),
    mouth: oneOf(MOUTHS, a.mouth, 'smile'),
    blush: Boolean(a.blush),
    shirt: hexOr(a.shirt, SHIRT_COLORS[0]),
    extra: oneOf(EXTRAS, a.extra, 'none'),
  };
}

export const avatarKey = (avatar) => Object.values(normaliseAvatar(avatar)).join('|');

const INK = '#141414';

// Draws the facial features centred in a size×size square, on a transparent background.
// `blink` (0–1) closes the eyes, for the idle animation on the table.
export function drawFace(ctx, avatar, size, { blink = 0 } = {}) {
  const s = size / 100;
  ctx.save();
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 3.2;

  const eyeY = 46;
  const eyeDx = 15;
  const closed = blink > 0.5 && avatar.eyes !== 'happy' && avatar.eyes !== 'sleepy';

  const line = (x1, y1, x2, y2) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  const dot = (x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  for (const side of [-1, 1]) {
    const x = 50 + side * eyeDx;
    if (closed || (avatar.eyes === 'wink' && side === 1)) {
      line(x - 5, eyeY, x + 5, eyeY);
      continue;
    }
    switch (avatar.eyes) {
      case 'big':
        ctx.beginPath();
        ctx.ellipse(x, eyeY, 5.5, 7.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        dot(x + 1.8, eyeY - 2.8, 2);
        ctx.fillStyle = INK;
        break;
      case 'happy':
        ctx.beginPath();
        ctx.arc(x, eyeY + 2, 5, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
        break;
      case 'sleepy':
        ctx.beginPath();
        ctx.arc(x, eyeY - 1, 5, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        break;
      case 'blank':
        // Mob-style: big empty eyes with a tiny pupil.
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.ellipse(x, eyeY, 6, 7, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        dot(x, eyeY + 1, 1.6);
        ctx.lineWidth = 3.2;
        break;
      default:
        dot(x, eyeY, avatar.eyes === 'wink' ? 3.4 : 3.6);
    }
  }

  if (avatar.blush) {
    ctx.fillStyle = 'rgba(255, 110, 130, 0.45)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(50 + side * 24, 58, 6, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = INK;
  }

  const my = 64;
  switch (avatar.mouth) {
    case 'flat':
      line(44, my, 56, my);
      break;
    case 'open':
      ctx.beginPath();
      ctx.ellipse(50, my + 1, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'cat':
      ctx.beginPath();
      ctx.arc(46, my - 1, 4, 0, Math.PI);
      ctx.arc(54, my - 1, 4, 0, Math.PI);
      ctx.stroke();
      break;
    case 'frown':
      ctx.beginPath();
      ctx.arc(50, my + 7, 7, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
      break;
    case 'grin':
      ctx.beginPath();
      ctx.moveTo(40, my - 3);
      ctx.quadraticCurveTo(50, my + 12, 60, my - 3);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      break;
    default:
      ctx.beginPath();
      ctx.arc(50, my - 5, 8, Math.PI * 0.25, Math.PI * 0.75);
      ctx.stroke();
  }

  if (avatar.extra === 'glasses') {
    ctx.lineWidth = 2.6;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(50 + side * eyeDx, eyeY, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    line(50 - eyeDx + 9, eyeY, 50 + eyeDx - 9, eyeY);
  } else if (avatar.extra === 'bandage') {
    ctx.save();
    ctx.translate(30, 34);
    ctx.rotate(-0.5);
    ctx.fillStyle = '#F4D3B0';
    ctx.fillRect(-9, -3.5, 18, 7);
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-9, -3.5, 18, 7);
    line(-2, -3.5, -2, 3.5);
    line(2, -3.5, 2, 3.5);
    ctx.restore();
  }
  ctx.restore();
}

// A head-and-shoulders portrait for the lobby, drawn to fill a size×size canvas.
export function drawPortrait(ctx, avatar, size) {
  const a = normaliseAvatar(avatar);
  const s = size / 100;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(s, s);
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;

  const shape = (draw, fill) => {
    ctx.beginPath();
    draw();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  };

  // Shoulders.
  shape(() => {
    ctx.moveTo(18, 104);
    ctx.quadraticCurveTo(20, 76, 50, 76);
    ctx.quadraticCurveTo(80, 76, 82, 104);
  }, a.shirt);

  const hx = 50;
  const hy = 46;
  const r = 30;

  // Hair that sits behind the head.
  if (a.hair === 'long') shape(() => ctx.roundRect(hx - r - 3, hy - r, (r + 3) * 2, r * 2 + 10, [r, r, 8, 8]), a.hairColor);
  if (a.hair === 'bun') shape(() => ctx.arc(hx, hy - r - 4, 11, 0, Math.PI * 2), a.hairColor);

  shape(() => ctx.arc(hx, hy, r, 0, Math.PI * 2), a.skin);

  // Hair on top.
  switch (a.hair) {
    case 'bowl':
    case 'long':
    case 'bun':
      shape(() => {
        ctx.moveTo(hx - r - 2, hy - 2);
        ctx.arc(hx, hy, r + 2, Math.PI, 0);
        ctx.lineTo(hx + r + 2, hy - 6);
        ctx.lineTo(hx - r - 2, hy - 6);
        ctx.closePath();
      }, a.hairColor);
      break;
    case 'spiky':
      shape(() => {
        ctx.moveTo(hx - r - 2, hy - 4);
        const spikes = 6;
        for (let i = 0; i <= spikes; i++) {
          const t = Math.PI + (i / spikes) * Math.PI;
          const out = i % 2 ? r + 14 : r + 1;
          ctx.lineTo(hx + Math.cos(t) * out, hy - 4 + Math.sin(t) * out);
        }
        ctx.closePath();
      }, a.hairColor);
      break;
    case 'curly':
      for (let i = 0; i < 7; i++) {
        const t = Math.PI * (1.02 + (i / 6) * 0.96);
        shape(() => ctx.arc(hx + Math.cos(t) * (r - 2), hy - 4 + Math.sin(t) * (r - 2), 10, 0, Math.PI * 2), a.hairColor);
      }
      break;
    case 'mohawk':
      shape(() => ctx.roundRect(hx - 6, hy - r - 12, 12, 26, 6), a.hairColor);
      break;
    default:
      break;
  }

  // The face drawing works in its own 100-unit square; fit it to the head.
  ctx.save();
  ctx.translate(hx - r, hy - r - 2);
  drawFace(ctx, a, r * 2);
  ctx.restore();

  if (a.extra === 'bow') {
    shape(() => {
      ctx.moveTo(hx + 18, hy - 26);
      ctx.lineTo(hx + 6, hy - 36);
      ctx.lineTo(hx + 6, hy - 18);
      ctx.closePath();
      ctx.moveTo(hx + 18, hy - 26);
      ctx.lineTo(hx + 30, hy - 36);
      ctx.lineTo(hx + 30, hy - 18);
      ctx.closePath();
    }, '#FF6B8B');
  } else if (a.extra === 'cap') {
    shape(() => {
      ctx.arc(hx, hy - 8, r + 1, Math.PI, 0);
      ctx.closePath();
    }, a.shirt);
    shape(() => ctx.roundRect(hx - 8, hy - 12, r + 16, 7, 3), a.shirt);
  } else if (a.extra === 'halo') {
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#F5C518';
    ctx.beginPath();
    ctx.ellipse(hx, hy - r - 8, 18, 5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
