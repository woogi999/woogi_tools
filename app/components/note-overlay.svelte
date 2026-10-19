<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, on, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ColourField from './colour-field.svelte';
  import Icon from './icon.svelte';
  import {
    flipNeutralHex,
    flipCanvasNeutrals,
    isDarkTheme,
    stickerExtent,
  } from '../utils/ink.js';

  const eq = (a, b) => a === b;
  const stickerPos = (s) => `left:${s.x}px;top:${s.y}px;`;
  const stickerFontSize = (s) => `font-size:${s.size}px;`;
  const stickerImgSize = (s) => `width:${s.size}px;height:${s.size}px;`;

  // Drawing or dragging within this distance of the bottom grows the note by GROW_STEP.
  const GROW_MARGIN = 60;
  const GROW_STEP = 200;
  const BOTTOM_PAD = 40;

  // Sits on top of a note's text: a transparent ink canvas (active only while
  // @drawing) plus a layer of draggable stickers (active while @interactive),
  // the way iOS/Android notes apps let you draw and stick things right on the
  // page instead of in a separate mode. The note grows taller as ink or
  // stickers reach its bottom edge; that height is kept on the doodle.
  class NoteOverlay extends Component {
    // Stored as the light-mode colour; shown flipped in dark mode (see utils/ink).
    penColor = $state.raw('#1E1E1E');
    penSize = $state.raw(4);
    dark = $state.raw(isDarkTheme());

    overlayEl = null;
    canvas = null;
    ctx = null;
    ratio = 1;
    drawing = false;
    last = null;
    strokeBottom = 0;

    get stickers() {
      return this.args.doodle?.stickers ?? [];
    }

    get savedHeight() {
      return this.args.doodle?.height ?? 0;
    }

    get shownPenColor() {
      return this.dark ? flipNeutralHex(this.penColor) : this.penColor;
    }

    registerOverlay = modifier((element) => {
      this.overlayEl = element;
    });

    // Re-runs when @noteKey changes so switching notes reloads the right ink.
    setupCanvas = modifier((canvas) => {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.ratio = window.devicePixelRatio || 1;
      this.fitCanvas(true);

      const url = this.args.doodle?.drawingDataUrl;
      if (url) {
        const img = new Image();
        img.onload = () => {
          if (this.canvas !== canvas) return;
          // Draw at the CSS size it was saved at, so a wider/narrower editor never stretches it.
          const scale = this.args.doodle?.width
            ? this.args.doodle.width / img.width
            : 1 / this.ratio;
          const layer = document.createElement('canvas');
          layer.width = canvas.width;
          layer.height = canvas.height;
          const layerCtx = layer.getContext('2d');
          layerCtx.scale(this.ratio, this.ratio);
          layerCtx.drawImage(img, 0, 0, img.width * scale, img.height * scale);
          if (this.dark) flipCanvasNeutrals(layer);
          this.ctx.drawImage(
            layer,
            0,
            0,
            layer.width / this.ratio,
            layer.height / this.ratio,
          );
        };
        img.src = url;
      }

      const resize = new ResizeObserver(() => this.fitCanvas(false));
      resize.observe(canvas);
      const theme = new MutationObserver(() => {
        const dark = isDarkTheme();
        if (dark === this.dark) return;
        this.dark = dark;
        flipCanvasNeutrals(canvas);
      });
      theme.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });

      return () => {
        resize.disconnect();
        theme.disconnect();
      };
    });

    // Matches the bitmap to the canvas's on-screen size, keeping existing ink unscaled.
    fitCanvas(fresh) {
      const { canvas, ratio } = this;
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (!fresh && canvas.width === w && canvas.height === h) return;
      let snapshot = null;
      if (!fresh) {
        snapshot = document.createElement('canvas');
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        snapshot.getContext('2d').drawImage(canvas, 0, 0);
      }
      canvas.width = w;
      canvas.height = h;
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (snapshot)
        this.ctx.drawImage(
          snapshot,
          0,
          0,
          snapshot.width / ratio,
          snapshot.height / ratio,
        );
    }

    growTo(bottom) {
      const current = this.overlayEl.clientHeight;
      if (bottom > current - GROW_MARGIN)
        this.args.onChange({ height: Math.round(current + GROW_STEP) });
    }

    pointerPos(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    startDraw = (event) => {
      if (!this.args.drawing) return;
      this.drawing = true;
      this.last = this.pointerPos(event);
      this.strokeBottom = this.last.y;
      this.canvas.setPointerCapture?.(event.pointerId);
    };

    moveDraw = (event) => {
      if (!this.drawing) return;
      const pos = this.pointerPos(event);
      this.ctx.strokeStyle = this.shownPenColor;
      this.ctx.lineWidth = this.penSize;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(this.last.x, this.last.y);
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
      this.last = pos;
      this.strokeBottom = Math.max(this.strokeBottom, pos.y);
      this.growTo(pos.y);
    };

    endDraw = () => {
      if (!this.drawing) return;
      this.drawing = false;
      let source = this.canvas;
      if (this.dark) {
        source = document.createElement('canvas');
        source.width = this.canvas.width;
        source.height = this.canvas.height;
        source.getContext('2d').drawImage(this.canvas, 0, 0);
        flipCanvasNeutrals(source);
      }
      this.args.onChange({
        drawingDataUrl: source.toDataURL('image/png'),
        width: this.canvas.clientWidth,
        height: Math.round(
          Math.max(this.savedHeight, this.strokeBottom + BOTTOM_PAD),
        ),
      });
    };

    clear = () => {
      this.ctx.clearRect(
        0,
        0,
        this.canvas.clientWidth,
        this.canvas.clientHeight,
      );
      const stickersBottom = stickerExtent(this.stickers);
      this.args.onChange({
        drawingDataUrl: null,
        height: stickersBottom ? Math.round(stickersBottom + BOTTOM_PAD) : null,
      });
    };

    setPenColor = (hex) =>
      (this.penColor = this.dark ? flipNeutralHex(hex) : hex);
    setPenSize = (event) => (this.penSize = +event.target.value);

    removeSticker = (id) =>
      this.args.onChange({
        stickers: this.stickers.filter((s) => s.id !== id),
      });

    dragSticker = (id, event) => {
      if (!this.args.interactive || event.target.closest('.sticker-remove'))
        return;
      event.preventDefault();
      const sticker = this.stickers.find((s) => s.id === id);
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = sticker.x;
      const originY = sticker.y;
      const onMove = (e) => {
        const x = Math.max(0, originX + (e.clientX - startX));
        const y = Math.max(0, originY + (e.clientY - startY));
        const stickers = this.stickers.map((s) =>
          s.id === id ? { ...s, x, y } : s,
        );
        this.args.onChange({ stickers, width: this.overlayEl.clientWidth });
        this.growTo(stickerExtent(stickers.filter((s) => s.id === id)));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const needed = Math.round(stickerExtent(this.stickers) + BOTTOM_PAD);
        if (needed > this.savedHeight) this.args.onChange({ height: needed });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

    growSticker = (id, event) => {
      if (!this.args.interactive) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -4 : 4;
      const stickers = this.stickers.map((s) =>
        s.id === id
          ? { ...s, size: Math.max(20, Math.min(280, s.size + delta)) }
          : s,
      );
      this.args.onChange({
        stickers,
        width: this.overlayEl.clientWidth,
        height: Math.round(
          Math.max(this.savedHeight, stickerExtent(stickers) + BOTTOM_PAD),
        ),
      });
    };

    // Both pointerdown bindings below are the start of a drag, not a click:
    // ink is drawn between pointer down and up, and a sticker is dragged from
    // the moment it is pressed. Bound to pointerup there would be nothing left
    // to draw or drag, so no-pointer-down-event-binding is waived on each.
  }
</script>

<script>
  let args = $props();
  const self = new NoteOverlay(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable no-pointer-down-event-binding -->
<div class="note-overlay" {@attach self.registerOverlay?.()}>
  <canvas
    class="note-ink {truthy(args.drawing) ? 'is-active' : ''}"
    onpointercancel={self.endDraw}
    onpointerup={self.endDraw}
    onpointermove={self.moveDraw}
    onpointerdown={self.startDraw}
    {@attach self.setupCanvas?.([args.noteKey])}
  ></canvas>
  <div class="note-stickers {!truthy(args.interactive) ? 'is-locked' : ''}">
    {#each self.stickers ?? [] as sticker}
      <div
        class="doodle-sticker"
        style={stickerPos(sticker)}
        {@attach on('wheel', (..._r) => self.growSticker(sticker?.id, ..._r))}
        onpointerdown={(..._r) => self.dragSticker(sticker?.id, ..._r)}
      >
        {#if truthy(eq(sticker?.type, 'emoji'))}
          <span class="sticker-emoji" style={stickerFontSize(sticker)}
            >{sticker?.content}</span
          >
        {:else}
          <img src={sticker?.content} alt="" style={stickerImgSize(sticker)} />
        {/if}
        {#if truthy(args.interactive)}
          <button
            type="button"
            class="sticker-remove"
            aria-label="Remove sticker"
            onclick={(..._r) => self.removeSticker(sticker?.id, ..._r)}
            ><Icon name="x" size={10} /></button
          >
        {/if}
      </div>
    {/each}
  </div>
  {#if truthy(args.drawing)}
    <div class="note-ink-toolbar pop-in">
      <ColourField
        label="Pen colour"
        value={self.shownPenColor}
        onChange={self.setPenColor}
      />
      <input
        type="range"
        min="1"
        max="24"
        {@attach prop('value', () => self.penSize)}
        class="doodle-size"
        aria-label="Pen size"
        oninput={self.setPenSize}
      />
      <button type="button" class="btn" onclick={self.clear}
        ><Icon name="trash-2" size={13} />
        Clear</button
      >
    </div>
  {/if}
</div>
