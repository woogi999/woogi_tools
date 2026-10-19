<script module>
  import { onDestroy } from 'svelte';
  import Component from '../../core/component.js';
  import { modifier } from '../../core/modifier.js';
  import { truthy, prop } from '../../core/helpers.js';
  import { destroy } from '../../core/destroyable.js';
  import Icon from '../icon.svelte';
  import {
    FORMATS,
    RESOLUTIONS,
    QUALITIES,
    formatById,
    sizeFor,
    estimate,
  } from '../../utils/ferrite/export.js';
  import { formatBytes } from '../../utils/file-share.js';
  import { timecode } from '../../utils/ferrite/model.js';

  // The render queue, in the shape After Effects gives it: what to render
  // (Render Settings) above how to write it (Output Module), with the numbers
  // that follow from both shown at the bottom before anything starts.
  //
  // The one place it departs is the engine switch, which After Effects has no
  // use for. A browser can either record the canvas as it plays (fast, carries
  // the sound, drops frames when the comp is heavy) or draw every frame in
  // order and encode them, which is exact and silent. Neither is the right
  // default for everyone, so the choice is on the panel with the consequence
  // spelled out next to it rather than buried.
  const eq = (a, b) => a === b;
  const not = (v) => !v;

  const pct = (v) => `width:${Math.round(v * 100)}%`;

  class ExportModal extends Component {
    formats = FORMATS;
    resolutions = RESOLUTIONS;
    qualities = QUALITIES;

    get o() {
      return this.args.editor.exportOptions;
    }

    get format() {
      return formatById(this.o.format);
    }

    get size() {
      return sizeFor(this.o);
    }

    get numbers() {
      const e = estimate(this.o);
      return {
        ...e,
        weight: formatBytes(e.bytes),
        length: `${e.seconds.toFixed(2)}s`,
      };
    }

    // A frame-by-frame render holds every PNG until the encoder has them all, so
    // a long comp at full size is a memory problem rather than a slow one. Worth
    // saying before, not after.
    get heavy() {
      return this.o.engine === 'exact' && this.numbers.bytes > 700e6;
    }

    get engines() {
      return [
        {
          id: 'live',
          label: 'Real time',
          note: 'Records as it plays. Carries the sound. Drops frames if the comp is heavy.',
        },
        {
          id: 'exact',
          label: 'Frame by frame',
          note: 'Every frame drawn and encoded in order. Exact, slower, silent.',
        },
      ].map((e) => ({ ...e, can: this.format.engines.includes(e.id) }));
    }

    get spanLabel() {
      return `${timecode(this.o.fromMs, this.o.fps)} → ${timecode(this.o.toMs, this.o.fps)}`;
    }

    // Escape closes it, as every other dialog on the site does, but not while
    // a render is running, because there would be nothing to go back to.
    trap = modifier((element) => {
      element.querySelector('select, button')?.focus();
      const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        if (!this.args.editor.busy) this.args.editor.closeExport();
      };
      element.addEventListener('keydown', onKey);
      return () => element.removeEventListener('keydown', onKey);
    });
  }
</script>

<script>
  let args = $props();
  const self = new ExportModal(args);
  onDestroy(() => destroy(self));
</script>

<div class="fr-modal-wrap" role="presentation">
  <button
    type="button"
    class="fr-backdrop"
    aria-label="Close"
    disabled={args.editor?.busy}
    onclick={args.editor?.closeExport}
  ></button>
  <div
    class="fr-modal is-render"
    role="dialog"
    aria-modal="true"
    aria-label="Render queue"
    {@attach self.trap?.()}
  >
    <header class="fr-modal-head">
      <h2><Icon name="download" size={14} /> Render</h2>
      <span class="fr-spacer"></span>
      <button
        type="button"
        class="fr-icon-btn"
        aria-label="Close"
        disabled={args.editor?.busy}
        onclick={args.editor?.closeExport}><Icon name="x" size={14} /></button
      >
    </header>

    <div class="fr-modal-body">
      <section class="fr-modal-col">
        <h3>Render settings</h3>

        <label class="fr-field">
          <span>Time span</span>
          <select
            class="fr-input"
            data-field="span"
            onchange={(..._r) => args.editor?.setExport('span', ..._r)}
          >
            <option
              value="comp"
              {@attach prop('selected', () => eq(self.o?.span, 'comp'))}
              >Whole composition</option
            >
            <option
              value="work"
              {@attach prop('selected', () => eq(self.o?.span, 'work'))}
              >Work area</option
            >
            <option
              value="custom"
              {@attach prop('selected', () => eq(self.o?.span, 'custom'))}
              >Custom</option
            >
          </select>
        </label>
        {#if truthy(eq(self.o?.span, 'custom'))}
          <div class="fr-field-row">
            <label class="fr-field"
              ><span>From (s)</span><input
                type="number"
                class="fr-input is-short"
                step="0.1"
                min="0"
                {@attach prop('value', () => args.editor?.exportFromSec)}
                oninput={(..._r) => args.editor?.setExport('fromSec', ..._r)}
              /></label
            >
            <label class="fr-field"
              ><span>To (s)</span><input
                type="number"
                class="fr-input is-short"
                step="0.1"
                min="0"
                {@attach prop('value', () => args.editor?.exportToSec)}
                oninput={(..._r) => args.editor?.setExport('toSec', ..._r)}
              /></label
            >
          </div>
        {/if}
        <p class="fr-hint">{self.spanLabel}</p>

        <label class="fr-field">
          <span>Resolution</span>
          <select
            class="fr-input"
            data-field="resolution"
            onchange={(..._r) => args.editor?.setExport('resolution', ..._r)}
          >
            {#each self.resolutions ?? [] as r (r?.id)}
              <option
                value={r?.id}
                {@attach prop('selected', () => eq(self.o?.resolution, r?.id))}
                >{r?.label}</option
              >
            {/each}
          </select>
        </label>
        {#if truthy(eq(self.o?.resolution, 'custom'))}
          <div class="fr-field-row">
            <label class="fr-field"
              ><span>Width</span><input
                type="number"
                class="fr-input is-short"
                min="2"
                {@attach prop('value', () => self.o?.customW)}
                oninput={(..._r) => args.editor?.setExport('customW', ..._r)}
              /></label
            >
            <label class="fr-field"
              ><span>Height</span><input
                type="number"
                class="fr-input is-short"
                min="2"
                {@attach prop('value', () => self.o?.customH)}
                oninput={(..._r) => args.editor?.setExport('customH', ..._r)}
              /></label
            >
          </div>
        {/if}

        <div class="fr-field">
          <span>Frame rate</span>
          <span class="fr-field-row">
            <input
              type="number"
              class="fr-input is-short"
              aria-label="Frame rate"
              min="1"
              max="120"
              {@attach prop('value', () => self.o?.fps)}
              oninput={(..._r) => args.editor?.setExport('fps', ..._r)}
            />
            <button
              type="button"
              class="fr-btn is-small"
              onclick={args.editor?.useCompFps}
              >Use comp ({args.editor?.fps})</button
            >
          </span>
        </div>

        <label class="fr-field">
          <span>Quality</span>
          <select
            class="fr-input"
            data-field="quality"
            onchange={(..._r) => args.editor?.setExport('quality', ..._r)}
          >
            {#each self.qualities ?? [] as q (q?.id)}
              <option
                value={q?.id}
                {@attach prop('selected', () => eq(self.o?.quality, q?.id))}
                >{q?.label}</option
              >
            {/each}
          </select>
        </label>

        <label class="fr-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.o?.motionBlur)}
            onchange={(..._r) => args.editor?.setExport('motionBlur', ..._r)}
          />
          Motion blur</label
        >
        <label class="fr-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.o?.effects)}
            onchange={(..._r) => args.editor?.setExport('effects', ..._r)}
          />
          Effects</label
        >
        <label class="fr-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.o?.soloOff)}
            onchange={(..._r) => args.editor?.setExport('soloOff', ..._r)}
          />
          Ignore solo switches</label
        >
      </section>

      <section class="fr-modal-col">
        <h3>Output module</h3>

        <label class="fr-field">
          <span>Format</span>
          <select
            class="fr-input"
            data-field="format"
            onchange={(..._r) => args.editor?.setExport('format', ..._r)}
          >
            {#each self.formats ?? [] as f (f?.id)}
              <option
                value={f?.id}
                {@attach prop('selected', () => eq(self.o?.format, f?.id))}
                >{f?.label}</option
              >
            {/each}
          </select>
        </label>
        <p class="fr-hint">{self.format?.note}</p>

        <span class="fr-field-label">Engine</span>
        <div class="fr-engine-list">
          {#each self.engines ?? [] as e (e?.id)}
            <button
              type="button"
              class="fr-engine {truthy(eq(self.o?.engine, e?.id))
                ? 'is-on'
                : ''}"
              data-engine={e?.id}
              disabled={not(e?.can)}
              onclick={(..._r) => args.editor?.setEngine(e?.id, ..._r)}
            >
              <b>{e?.label}</b>
              <i class="fr-faint">{e?.note}</i>
            </button>
          {/each}
        </div>

        <label class="fr-field">
          <span>Channels</span>
          <select
            class="fr-input"
            data-field="alpha"
            disabled={not(self.format?.alpha)}
            onchange={(..._r) => args.editor?.setExport('alpha', ..._r)}
          >
            <option
              value="rgb"
              {@attach prop('selected', () => not(self.o?.alpha))}>RGB</option
            >
            <option value="rgba" {@attach prop('selected', () => self.o?.alpha)}
              >RGB + Alpha</option
            >
          </select>
        </label>
        {#if !truthy(self.format?.alpha)}
          <p class="fr-hint"
            >{self.format?.label}
            has no alpha channel; the background shows through instead.</p
          >
        {/if}

        <label class="fr-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.o?.audio)}
            disabled={not(self.format?.audio)}
            onchange={(..._r) => args.editor?.setExport('audio', ..._r)}
          />
          Include sound</label
        >
        {#if truthy(eq(self.o?.engine, 'exact'))}
          <p class="fr-hint"
            >Frame-by-frame renders are silent; sound is a live graph and there
            is no clock to play it against. Use real time if you need the audio.</p
          >
        {/if}

        <label class="fr-field">
          <span>File name</span>
          <input
            type="text"
            class="fr-input"
            {@attach prop('value', () => self.o?.name)}
            oninput={(..._r) => args.editor?.setExport('name', ..._r)}
          />
        </label>

        <dl class="fr-summary">
          <div
            ><dt>Size</dt><dd data-out="size"
              >{self.size?.width}×{self.size?.height}</dd
            ></div
          >
          <div
            ><dt>Frames</dt><dd
              >{self.numbers?.frames}
              at
              {self.o?.fps}fps</dd
            ></div
          >
          <div><dt>Length</dt><dd>{self.numbers?.length}</dd></div>
          <div><dt>About</dt><dd>{self.numbers?.weight}</dd></div>
        </dl>
        {#if truthy(self.heavy)}
          <p class="fr-warn"
            >That is a lot of frames to hold at once. Drop the resolution,
            shorten the span, or render it in pieces.</p
          >
        {/if}
      </section>
    </div>

    <footer class="fr-modal-foot">
      {#if truthy(args.editor?.busy)}
        <div class="fr-progress is-inline"
          ><div class="fr-progress-bar" style={pct(args.editor?.progress)}
          ></div></div
        >
        <span class="fr-faint">{args.editor?.status}</span>
        <span class="fr-spacer"></span>
        <button type="button" class="fr-btn" onclick={args.editor?.cancelRender}
          >Stop</button
        >
      {:else}
        {#if truthy(args.editor?.resultUrl)}
          <a
            class="fr-btn is-accent"
            href={args.editor?.resultUrl}
            download={args.editor?.resultName}
            data-download
            ><Icon name="download" size={12} />
            Save
            {args.editor?.resultName}</a
          >
          <span class="fr-faint">{args.editor?.resultWeight}</span>
        {/if}
        <span class="fr-spacer"></span>
        <button type="button" class="fr-btn" onclick={args.editor?.closeExport}
          >Close</button
        >
        <button
          type="button"
          class="fr-btn is-accent"
          data-render
          disabled={not(args.editor?.layers?.length)}
          onclick={args.editor?.render}>Render</button
        >
      {/if}
    </footer>
  </div>
</div>
