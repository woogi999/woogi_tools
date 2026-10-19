<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import { keepState } from '../utils/tool-state.js';

  // A ruler on the screen that's actually the right size. Screens don't tell
  // the browser how big they are, so it's calibrated once against something
  // of a known size (a bank card, a coin, your own ruler) or the screen's
  // diagonal, and remembered.

  const OBJECTS = [
    {
      id: 'card',
      label: 'Bank card',
      mm: 85.6,
      hint: 'Any credit, debit or ID card: they are all 85.6 mm wide.',
      shape: 'card',
    },
    {
      id: 'ruler',
      label: 'My ruler',
      mm: 100,
      hint: 'Hold a real ruler up to the screen and match 10 cm.',
      shape: 'bar',
    },
    {
      id: 'a4',
      label: 'A4 paper',
      mm: 210,
      hint: 'The short edge of an A4 sheet is 210 mm.',
      shape: 'bar',
    },
    {
      id: 'letter',
      label: 'US Letter',
      mm: 215.9,
      hint: 'The short edge of a Letter sheet is 8.5 inches.',
      shape: 'bar',
    },
    {
      id: 'cd',
      label: 'CD / DVD',
      mm: 120,
      hint: 'Every disc is 120 mm across.',
      shape: 'circle',
    },
    {
      id: 'aa',
      label: 'AA battery',
      mm: 50.5,
      hint: 'An AA battery is 50.5 mm long.',
      shape: 'bar',
    },
    {
      id: 'quarter',
      label: 'US quarter',
      mm: 24.26,
      hint: '',
      shape: 'circle',
    },
    { id: 'euro', label: '1 euro coin', mm: 23.25, hint: '', shape: 'circle' },
    { id: 'pound', label: '£1 coin', mm: 23.43, hint: '', shape: 'circle' },
    { id: 'peso', label: '₱10 coin', mm: 27, hint: '', shape: 'circle' },
    { id: 'yen', label: '¥100 coin', mm: 22.6, hint: '', shape: 'circle' },
    { id: 'loonie', label: 'CA $1 coin', mm: 26.5, hint: '', shape: 'circle' },
  ];
  const eq = (a, b) => a === b;
  const MM_PER_IN = 25.4;
  const concat = (...parts) => parts.join('');

  class OnlineRulerPage extends Component {
    // Pixels per millimetre. 96 px per inch is what a browser assumes by default.
    pxPerMm = $state.raw(96 / MM_PER_IN);
    method = $state.raw('card');
    diagonal = $state.raw(15.6);
    unit = $state.raw('cm');
    measureW = $state.raw(200);
    measureH = $state.raw(120);
    calibrated = $state.raw(false);

    objects = OBJECTS;
    drag = null;

    constructor(args) {
      super(args);
      keepState(this, 'online-ruler', [
        'pxPerMm',
        'method',
        'diagonal',
        'unit',
        'calibrated',
      ]);
    }

    get object() {
      return OBJECTS.find((o) => o.id === this.method) ?? OBJECTS[0];
    }

    get isDiagonal() {
      return this.method === 'diagonal';
    }

    get objectPx() {
      return this.object.mm * this.pxPerMm;
    }

    get objectStyle() {
      const w = this.objectPx;
      const o = this.object;
      if (o.shape === 'circle')
        return `width:${w}px;height:${w}px;border-radius:50%`;
      if (o.shape === 'card')
        return `width:${w}px;height:${(53.98 * w) / 85.6}px;border-radius:${3.18 * this.pxPerMm}px`;
      return `width:${w}px;height:${Math.max(24, 12 * this.pxPerMm)}px`;
    }

    get dpi() {
      return Math.round(this.pxPerMm * MM_PER_IN);
    }

    // Tick marks for a ruler as long as the screen is wide.
    get ticks() {
      const width = Math.min(window.innerWidth - 40, 1200);
      const ticks = [];
      if (this.unit === 'cm') {
        const step = this.pxPerMm;
        for (let i = 0; i * step <= width; i++) {
          const major = i % 10 === 0;
          ticks.push({
            x: i * step,
            h: major ? 28 : i % 5 === 0 ? 18 : 10,
            label: major ? String(i / 10) : '',
          });
        }
      } else {
        const step = (this.pxPerMm * MM_PER_IN) / 16;
        for (let i = 0; i * step <= width; i++) {
          const major = i % 16 === 0;
          const h = major
            ? 28
            : i % 8 === 0
              ? 20
              : i % 4 === 0
                ? 14
                : i % 2 === 0
                  ? 10
                  : 6;
          ticks.push({ x: i * step, h, label: major ? String(i / 16) : '' });
        }
      }
      return { width, ticks, height: 46 };
    }

    get measure() {
      const wMm = this.measureW / this.pxPerMm;
      const hMm = this.measureH / this.pxPerMm;
      const fmt = (mm) =>
        this.unit === 'cm'
          ? `${(mm / 10).toFixed(2)} cm`
          : `${(mm / MM_PER_IN).toFixed(2)} in`;
      return {
        style: `width:${this.measureW}px;height:${this.measureH}px`,
        w: fmt(wMm),
        h: fmt(hMm),
        d: fmt(Math.sqrt(wMm * wMm + hMm * hMm)),
      };
    }

    pickMethod = (id) => (this.method = id);
    pickUnit = (unit) => (this.unit = unit);

    // Dragging the object's edge, or nudging with the slider, sets the scale.
    slide = (event) => {
      const px = Number(event.target.value) || 1;
      this.pxPerMm = px / this.object.mm;
      this.calibrated = true;
    };

    setDiagonal = (event) => {
      this.diagonal = Number(event.target.value) || 0;
    };

    applyDiagonal = () => {
      if (!this.diagonal) return;
      // The screen's size in CSS pixels along its diagonal, against the real one.
      const px = Math.hypot(window.screen.width, window.screen.height);
      this.pxPerMm = px / (this.diagonal * MM_PER_IN);
      this.calibrated = true;
    };

    resetCalibration = () => {
      this.pxPerMm = 96 / MM_PER_IN;
      this.calibrated = false;
    };

    // The object's right edge (or the box's corner) follows the pointer.
    startDrag = (what, event) => {
      event.preventDefault();
      event.target.setPointerCapture(event.pointerId);
      const rect = event.target.parentElement.getBoundingClientRect();
      this.drag = { what, rect };
    };

    moveDrag = (event) => {
      if (!this.drag) return;
      const { what, rect } = this.drag;
      if (what === 'object') {
        const px = Math.max(20, event.clientX - rect.left);
        this.pxPerMm = px / this.object.mm;
        this.calibrated = true;
      } else {
        this.measureW = Math.max(20, event.clientX - rect.left);
        this.measureH = Math.max(20, event.clientY - rect.top);
      }
    };

    endDrag = () => (this.drag = null);
  }
</script>

<script>
  let args = $props();
  const self = new OnlineRulerPage(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable no-pointer-down-event-binding -->
<ToolPage
  route="online-ruler"
  subtitle="A ruler on your screen that's really the right size. Calibrate it once against a bank card, a coin, a sheet of paper or your own ruler, or type in your screen's diagonal."
>
  <div class="math-stack pop-in">
    <section class="math-card">
      <div class="field-head">
        <h3 class="qr-heading">Calibrate</h3>
        <span class="tool-hint"
          >{truthy(self.calibrated) ? 'Calibrated' : 'Not calibrated yet'}
          · about
          {self.dpi}
          pixels per inch</span
        >
      </div>
      <div class="cipher-picks" role="group" aria-label="Calibrate with">
        {#each self.objects ?? [] as o}
          <button
            type="button"
            class="qr-tab {truthy(eq(self.method, o?.id)) ? 'active' : ''}"
            onclick={(..._r) => self.pickMethod(o?.id, ..._r)}
            >{o?.label}</button
          >
        {/each}
        <button
          type="button"
          class="qr-tab {truthy(self.isDiagonal) ? 'active' : ''}"
          onclick={(..._r) => self.pickMethod('diagonal', ..._r)}
          >Screen size</button
        >
      </div>

      {#if truthy(self.isDiagonal)}
        <div class="math-row is-aligned">
          <label class="math-field"
            ><span class="qr-label is-muted">Screen diagonal, in inches</span
            ><input
              type="number"
              class="math-input"
              step="0.1"
              min="3"
              max="100"
              {@attach prop('value', () => self.diagonal)}
              oninput={self.setDiagonal}
            /></label
          >
          <button type="button" class="btn active" onclick={self.applyDiagonal}
            >Use this</button
          >
        </div>
        <p class="tool-hint"
          >Works out the size from the screen's pixel count. Right for a laptop
          or a monitor; a phone reports its own screen so it works there too.</p
        >
      {:else}
        <p class="tool-hint"
          >Hold your
          {self.object?.label}
          against the screen and drag the edge of the outline until it matches.
          {self.object?.hint}</p
        >
        <div
          class="ruler-stage"
          onpointercancel={self.endDrag}
          onpointerup={self.endDrag}
          onpointermove={self.moveDrag}
        >
          <div
            class="ruler-object is-{self.object?.shape}"
            style={self.objectStyle}
          >
            <span>{self.object?.label} · {self.object?.mm} mm</span>
          </div>
          <div
            class="ruler-handle"
            style={concat('left:', self.objectPx, 'px')}
            role="slider"
            aria-label="Drag to match the object's width"
            aria-valuenow={self.objectPx}
            tabindex="0"
            onpointerdown={(..._r) => self.startDrag('object', ..._r)}
          ></div>
        </div>
        <input
          type="range"
          class="ruler-slider"
          min="40"
          max="1400"
          step="0.5"
          {@attach prop('value', () => self.objectPx)}
          aria-label="Fine adjust"
          oninput={self.slide}
        />
      {/if}
      <div class="settings-actions">
        <button type="button" class="btn" onclick={self.resetCalibration}
          >Reset</button
        >
      </div>
    </section>

    <section class="math-card">
      <div class="field-head">
        <h3 class="qr-heading">The ruler</h3>
        <div class="math-tabs" role="group" aria-label="Unit">
          <button
            type="button"
            class="qr-tab {truthy(eq(self.unit, 'cm')) ? 'active' : ''}"
            onclick={(..._r) => self.pickUnit('cm', ..._r)}>cm</button
          >
          <button
            type="button"
            class="qr-tab {truthy(eq(self.unit, 'in')) ? 'active' : ''}"
            onclick={(..._r) => self.pickUnit('in', ..._r)}>inches</button
          >
        </div>
      </div>
      <div class="ruler-scroll">
        <svg
          class="ruler-svg"
          width={self.ticks?.width}
          height={self.ticks?.height}
          aria-label="Ruler"
        >
          <rect
            x="0"
            y="0"
            width={self.ticks?.width}
            height={self.ticks?.height}
            class="ruler-body"
          ></rect>
          {#each self.ticks?.ticks ?? [] as t}
            <line x1={t?.x} y1="0" x2={t?.x} y2={t?.h} class="ruler-tick"
            ></line>
            {#if truthy(t?.label)}
              <text x={t?.x} y="42" class="ruler-label">{t?.label}</text>
            {/if}
          {/each}
        </svg>
      </div>
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Measure something</h3>
      <p class="tool-hint"
        >Drag the corner of the box to fit whatever you're measuring on screen:
        a photo, a widget, your cat.</p
      >
      <div
        class="ruler-stage is-measure"
        onpointercancel={self.endDrag}
        onpointerup={self.endDrag}
        onpointermove={self.moveDrag}
      >
        <div class="ruler-box" style={self.measure?.style}>
          <span class="ruler-box-w">{self.measure?.w}</span>
          <span class="ruler-box-h">{self.measure?.h}</span>
          <span class="ruler-box-d">↔ {self.measure?.d}</span>
        </div>
        <div
          class="ruler-corner"
          style={concat('left:', self.measureW, 'px;top:', self.measureH, 'px')}
          role="slider"
          aria-label="Drag to resize the box"
          aria-valuenow={self.measureW}
          tabindex="0"
          onpointerdown={(..._r) => self.startDrag('box', ..._r)}
        ></div>
      </div>
    </section>
  </div>
</ToolPage>
