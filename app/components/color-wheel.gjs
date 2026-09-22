import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import { clamp01, hsvToRgb, rgbToHsv } from 'woogi-tools/utils/color';

const SIZE = 190;
const CX = SIZE / 2;
const CY = SIZE / 2;
const OUTER_R = 88;
const RING_WIDTH = 16;
const INNER_R = OUTER_R - RING_WIDTH;
const TRI_R = INNER_R - 6;

function hueAngle(h) {
  return ((h - 90) * Math.PI) / 180;
}

function pointAt(angle, radius) {
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

function triangleVertices(h) {
  const a = hueAngle(h);
  return {
    color: pointAt(a, TRI_R),
    white: pointAt(a + (2 * Math.PI) / 3, TRI_R),
    black: pointAt(a - (2 * Math.PI) / 3, TRI_R),
  };
}

export default class ColorWheel extends Component {
  canvas = null;
  ctx = null;
  triBuffer = document.createElement('canvas');
  triCtx = this.triBuffer.getContext('2d');
  dragMode = null;
  lastRgbKey = null;
  pendingHsv = null;

  get hsv() {
    const key = `${this.args.r},${this.args.g},${this.args.b}`;
    if (this.lastRgbKey === key && this.pendingHsv) {
      return this.pendingHsv;
    }
    return rgbToHsv(this.args.r, this.args.g, this.args.b);
  }

  setup = modifier((element) => {
    this.canvas = element;
    this.ctx = element.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    element.width = SIZE * dpr;
    element.height = SIZE * dpr;
    this.ctx.scale(dpr, dpr);

    const onPointerDown = (evt) => this.handlePointerDown(evt);
    const onPointerMove = (evt) => this.handlePointerMove(evt);
    const onPointerUp = () => {
      if (this.dragMode && this.args.onCommit) this.args.onCommit();
      this.dragMode = null;
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);

    this.draw();

    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
    };
  });

  redraw = modifier(() => {
    this.draw();
  });

  canvasPoint(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const scale = SIZE / rect.width;
    return {
      x: (evt.clientX - rect.left) * scale,
      y: (evt.clientY - rect.top) * scale,
    };
  }

  handlePointerDown(evt) {
    const { x, y } = this.canvasPoint(evt);
    const dist = Math.hypot(x - CX, y - CY);
    this.dragMode = dist >= INNER_R - 6 ? 'ring' : 'triangle';
    this.canvas.setPointerCapture(evt.pointerId);
    this.applyPoint(x, y);
  }

  handlePointerMove(evt) {
    if (!this.dragMode) return;
    const { x, y } = this.canvasPoint(evt);
    this.applyPoint(x, y);
  }

  applyPoint(x, y) {
    const { h, s, v } = this.hsv;
    if (this.dragMode === 'ring') {
      const angle = Math.atan2(y - CY, x - CX);
      const newHue = ((angle * 180) / Math.PI + 90 + 360) % 360;
      // Starting from a fully desaturated (gray) colour, hue has no visible
      // effect on its own, so bump saturation up so picking a hue from the
      // ring always shows a colour change, instead of looking unresponsive.
      const effectiveS = s < 0.05 ? 1 : s;
      this.emit(newHue, effectiveS, v);
    } else {
      const { color, white, black } = triangleVertices(h);
      const denom =
        (white.y - black.y) * (color.x - black.x) +
        (black.x - white.x) * (color.y - black.y);
      let a =
        ((white.y - black.y) * (x - black.x) +
          (black.x - white.x) * (y - black.y)) /
        denom;
      let b =
        ((black.y - color.y) * (x - black.x) +
          (color.x - black.x) * (y - black.y)) /
        denom;
      let c = 1 - a - b;
      a = Math.max(a, 0);
      b = Math.max(b, 0);
      c = Math.max(c, 0);
      const sum = a + b + c || 1;
      a /= sum;
      b /= sum;
      c /= sum;
      const newV = 1 - c;
      const newS = newV > 0 ? a / newV : 0;
      this.emit(h, newS, newV);
    }
  }

  emit(h, s, v) {
    const clampedS = clamp01(s);
    const clampedV = clamp01(v);
    const rgb = hsvToRgb(h, clampedS, clampedV);
    this.pendingHsv = { h, s: clampedS, v: clampedV };
    this.lastRgbKey = `${rgb.r},${rgb.g},${rgb.b}`;
    this.args.onChange(rgb);
  }

  draw() {
    if (!this.ctx) return;
    const { h, s, v } = this.hsv;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    this.drawRing(ctx);
    this.drawTriangle(ctx, h);

    const huePoint = pointAt(hueAngle(h), (OUTER_R + INNER_R) / 2);
    this.drawMarker(ctx, huePoint.x, huePoint.y, `hsl(${h}, 100%, 50%)`);

    const { color, white, black } = triangleVertices(h);
    const a = s * v;
    const b = v * (1 - s);
    const c = 1 - v;
    const svPoint = {
      x: a * color.x + b * white.x + c * black.x,
      y: a * color.y + b * white.y + c * black.y,
    };
    this.drawMarker(
      ctx,
      svPoint.x,
      svPoint.y,
      `rgb(${this.args.r}, ${this.args.g}, ${this.args.b})`,
    );
  }

  drawRing(ctx) {
    const gradient = ctx.createConicGradient(-Math.PI / 2, CX, CY);
    for (let deg = 0; deg <= 360; deg += 30) {
      gradient.addColorStop(deg / 360, `hsl(${deg}, 100%, 50%)`);
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, OUTER_R, 0, Math.PI * 2);
    ctx.arc(CX, CY, INNER_R, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();
  }

  drawTriangle(ctx, hue) {
    const { color, white, black } = triangleVertices(hue);
    const minX = Math.max(0, Math.floor(Math.min(color.x, white.x, black.x)));
    const maxX = Math.min(SIZE, Math.ceil(Math.max(color.x, white.x, black.x)));
    const minY = Math.max(0, Math.floor(Math.min(color.y, white.y, black.y)));
    const maxY = Math.min(SIZE, Math.ceil(Math.max(color.y, white.y, black.y)));
    const w = maxX - minX;
    const h = maxY - minY;
    if (w <= 0 || h <= 0) return;

    this.triBuffer.width = w;
    this.triBuffer.height = h;
    const image = this.triCtx.createImageData(w, h);
    const denom =
      (white.y - black.y) * (color.x - black.x) +
      (black.x - white.x) * (color.y - black.y);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const x = minX + px + 0.5;
        const y = minY + py + 0.5;
        const a =
          ((white.y - black.y) * (x - black.x) +
            (black.x - white.x) * (y - black.y)) /
          denom;
        const b =
          ((black.y - color.y) * (x - black.x) +
            (color.x - black.x) * (y - black.y)) /
          denom;
        const c = 1 - a - b;
        const idx = (py * w + px) * 4;
        if (a >= -0.002 && b >= -0.002 && c >= -0.002) {
          const v = 1 - c;
          const s = v > 0 ? a / v : 0;
          const rgb = hsvToRgb(hue, clamp01(s), clamp01(v));
          image.data[idx] = rgb.r;
          image.data[idx + 1] = rgb.g;
          image.data[idx + 2] = rgb.b;
          image.data[idx + 3] = 255;
        }
      }
    }
    // Composite via an offscreen buffer + drawImage (alpha-aware) rather than
    // putImageData straight onto the main canvas, which overwrites pixels
    // (including transparent ones) and would erase the ring underneath.
    this.triCtx.putImageData(image, 0, 0);
    ctx.drawImage(this.triBuffer, minX, minY);

    ctx.beginPath();
    ctx.moveTo(color.x, color.y);
    ctx.lineTo(white.x, white.y);
    ctx.lineTo(black.x, black.y);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawMarker(ctx, x, y, fill) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  }

  <template>
    <canvas
      width={{SIZE}}
      height={{SIZE}}
      class="color-wheel"
      aria-label="Colour wheel: hue ring and saturation/value triangle"
      {{this.setup}}
      {{this.redraw @r @g @b}}
    ></canvas>
  </template>
}
