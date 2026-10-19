<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';

  import CopyButton from './copy-button.svelte';
  import {
    CODECS,
    FORMATS,
    TEXT_CODECS,
    compress,
    decompress,
    prettyText,
  } from '../utils/codec.js';
  import { keepState } from '../utils/tool-state.js';

  const eq = (a, b) => a === b;

  class DataCodecPage extends Component {
    codecs = CODECS;
    compressFormats = FORMATS;
    textFormats = TEXT_CODECS;

    mode = $state.raw('encode');
    codecId = $state.raw('gzip');
    level = $state.raw(FORMATS[0].level);
    input = $state.raw('');
    output = $state.raw('');
    error = $state.raw(null);
    busy = $state.raw(false);
    // Decoded JSON is indented rather than left on one line.
    pretty = $state.raw(true);
    runId = 0;

    constructor(args) {
      super(args);
      keepState(this, 'data-codec', ['mode', 'codecId', 'input', 'pretty']);
    }

    get codec() {
      return CODECS.find((c) => c.id === this.codecId);
    }

    get isCompress() {
      return this.codec.kind === 'compress';
    }

    get isEncode() {
      return this.mode === 'encode';
    }

    get stats() {
      if (!this.isCompress || !this.input || !this.output) return null;
      const plain = new TextEncoder().encode(
        this.isEncode ? this.input : this.output,
      ).length;
      const packed = Math.floor(
        ((this.isEncode ? this.output : this.input).replace(/[\s=]/g, '')
          .length *
          3) /
          4,
      );
      return `${plain} B plain · ${packed} B compressed · ${Math.round((packed / plain) * 100)}%`;
    }

    async run() {
      const id = ++this.runId;
      const { input, codec, level, isEncode } = this;
      if (!input) {
        this.output = '';
        this.error = null;
        return;
      }
      if (codec.kind === 'text') {
        try {
          const text = codec[isEncode ? 'encode' : 'decode'](input);
          this.output = !isEncode && this.pretty ? prettyText(text) : text;
          this.error = null;
        } catch (error) {
          this.output = '';
          const reason =
            error instanceof TypeError || error.name === 'InvalidCharacterError'
              ? "This doesn't look like valid input for this format"
              : error.message;
          this.error = `Couldn't decode: ${reason}`;
        }
        return;
      }
      this.busy = true;
      try {
        const result = isEncode
          ? await compress(input, codec.id, level)
          : await decompress(input, codec.id);
        if (id !== this.runId) return;
        this.output = !isEncode && this.pretty ? prettyText(result) : result;
        this.error = null;
      } catch {
        if (id !== this.runId) return;
        this.output = '';
        this.error = isEncode
          ? 'Compression failed.'
          : `Couldn't decompress: expected base64 ${codec.label} data.`;
      } finally {
        if (id === this.runId) this.busy = false;
      }
    }

    onInput = (event) => {
      this.input = event.target.value;
      this.run();
    };

    setMode = (mode) => {
      if (mode === this.mode) return;
      this.mode = mode;
      this.input = this.error ? '' : this.output;
      this.run();
    };

    setCodec = (event) => {
      this.codecId = event.target.value;
      if (this.isCompress) this.level = this.codec.level;
      this.run();
    };

    togglePretty = (event) => {
      this.pretty = event.target.checked;
      this.run();
    };

    setLevel = (event) => {
      this.level = +event.target.value;
      this.run();
    };
  }
</script>

<script>
  let args = $props();
  const self = new DataCodecPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="data-codec"
  busy={self.busy}
  closeWarning="Close Data Codec? The conversion still running will stop."
  subtitle="Compress it, encode it, decode it: Base64, URLs, hex, binary, Morse and more. Nothing leaves your browser."
>
  <section class="tool-panel codec-panel pop-in">
    <div class="tool-controls">
      <div class="mode-toggle" role="group" aria-label="Mode">
        <button
          type="button"
          class="btn {truthy(self.isEncode) ? 'active' : ''}"
          onclick={(..._r) => self.setMode('encode', ..._r)}>Encode</button
        >
        <button
          type="button"
          class="btn {truthy(self.isEncode) ? '' : 'active'}"
          onclick={(..._r) => self.setMode('decode', ..._r)}>Decode</button
        >
      </div>
      <select class="select" aria-label="Format" onchange={self.setCodec}>
        <optgroup label="Compression">
          {#each self.compressFormats ?? [] as f}
            <option
              value={f?.id}
              {@attach prop('selected', () => eq(f?.id, self.codecId))}
              >{f?.label}</option
            >
          {/each}
        </optgroup>
        <optgroup label="Text encoding">
          {#each self.textFormats ?? [] as f}
            <option
              value={f?.id}
              {@attach prop('selected', () => eq(f?.id, self.codecId))}
              >{f?.label}</option
            >
          {/each}
        </optgroup>
      </select>
    </div>

    {#if truthy(self.isCompress)}
      <div class="slider-row slider-row-wide">
        <label for="codec-level">Level</label>
        <input
          id="codec-level"
          type="range"
          min={self.codec?.min}
          max={self.codec?.max}
          {@attach prop('value', () => self.level)}
          oninput={self.setLevel}
        />
        <span class="slider-num">{self.level}</span>
      </div>
    {/if}

    <div class="codec-panes">
      <div class="codec-pane">
        <label class="field-label" for="codec-input"
          >{truthy(self.isEncode) ? 'Text' : self.codec?.label}</label
        >
        <textarea
          id="codec-input"
          class="textarea"
          spellcheck="false"
          {@attach prop('value', () => self.input)}
          oninput={self.onInput}></textarea>
      </div>

      <div class="codec-pane">
        <div class="field-head">
          <label class="field-label" for="codec-output"
            >{truthy(self.isEncode) ? self.codec?.label : 'Text'}</label
          >
          <div class="codec-output-tools">
            {#if !truthy(self.isEncode)}
              <label class="math-check"
                ><input
                  type="checkbox"
                  {@attach prop('checked', () => self.pretty)}
                  onchange={self.togglePretty}
                />
                Pretty-print JSON</label
              >
            {/if}
            <CopyButton value={self.output} />
          </div>
        </div>
        <textarea
          id="codec-output"
          class="textarea codec-output"
          readonly
          spellcheck="false"
          wrap="off"
          {@attach prop('value', () => self.output)}></textarea>
      </div>
    </div>

    {#if truthy(self.error)}
      <p class="tool-error">{self.error}</p>
    {:else if truthy(self.busy)}
      <p class="tool-hint">Working…</p>
    {:else if truthy(self.stats)}
      <p class="tool-hint">{self.stats}</p>
    {/if}
  </section>
</ToolPage>
