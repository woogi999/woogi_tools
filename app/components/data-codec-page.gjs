import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import ToolPage from './tool-page';
import { fn } from '@ember/helper';
import CopyButton from './copy-button';
import { CODECS, FORMATS, TEXT_CODECS, compress, decompress } from '../utils/codec';

const eq = (a, b) => a === b;

export default class DataCodecPage extends Component {
  codecs = CODECS;
  compressFormats = FORMATS;
  textFormats = TEXT_CODECS;

  @tracked mode = 'encode';
  @tracked codecId = 'gzip';
  @tracked level = FORMATS[0].level;
  @tracked input = '';
  @tracked output = '';
  @tracked error = null;
  @tracked busy = false;
  runId = 0;

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
    const plain = new TextEncoder().encode(this.isEncode ? this.input : this.output).length;
    const packed = Math.floor(((this.isEncode ? this.output : this.input).replace(/[\s=]/g, '').length * 3) / 4);
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
        this.output = codec[isEncode ? 'encode' : 'decode'](input);
        this.error = null;
      } catch (error) {
        this.output = '';
        const reason = error instanceof TypeError || error.name === 'InvalidCharacterError' ? "This doesn't look like valid input for this format" : error.message;
        this.error = `Couldn't decode: ${reason}`;
      }
      return;
    }
    this.busy = true;
    try {
      const result = isEncode ? await compress(input, codec.id, level) : await decompress(input, codec.id);
      if (id !== this.runId) return;
      this.output = result;
      this.error = null;
    } catch {
      if (id !== this.runId) return;
      this.output = '';
      this.error = isEncode ? 'Compression failed.' : `Couldn't decompress: expected base64 ${codec.label} data.`;
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

  setLevel = (event) => {
    this.level = +event.target.value;
    this.run();
  };

  <template>
    <ToolPage @route="data-codec" @subtitle="Compress it, encode it, decode it: Base64, URLs, hex, binary, Morse and more. Nothing leaves your browser.">
      <section class="tool-panel pop-in">
        <div class="tool-controls">
          <div class="mode-toggle" role="group" aria-label="Mode">
            <button type="button" class="btn {{if this.isEncode 'active'}}" {{on "click" (fn this.setMode "encode")}}>Encode</button>
            <button type="button" class="btn {{if this.isEncode '' 'active'}}" {{on "click" (fn this.setMode "decode")}}>Decode</button>
          </div>
          <select class="select" aria-label="Format" {{on "change" this.setCodec}}>
            <optgroup label="Compression">
              {{#each this.compressFormats as |f|}}
                <option value={{f.id}} selected={{eq f.id this.codecId}}>{{f.label}}</option>
              {{/each}}
            </optgroup>
            <optgroup label="Text encoding">
              {{#each this.textFormats as |f|}}
                <option value={{f.id}} selected={{eq f.id this.codecId}}>{{f.label}}</option>
              {{/each}}
            </optgroup>
          </select>
        </div>

        {{#if this.isCompress}}
          <div class="slider-row slider-row-wide">
            <label for="codec-level">Level</label>
            <input
              id="codec-level"
              type="range"
              min={{this.codec.min}}
              max={{this.codec.max}}
              value={{this.level}}
              {{on "input" this.setLevel}}
            />
            <span class="slider-num">{{this.level}}</span>
          </div>
        {{/if}}

        <label class="field-label" for="codec-input">{{if this.isEncode "Text" this.codec.label}}</label>
        <textarea id="codec-input" class="textarea" spellcheck="false" value={{this.input}} {{on "input" this.onInput}}></textarea>

        <div class="field-head">
          <label class="field-label" for="codec-output">{{if this.isEncode this.codec.label "Text"}}</label>
          <CopyButton @value={{this.output}} />
        </div>
        <textarea id="codec-output" class="textarea" readonly spellcheck="false" value={{this.output}}></textarea>

        {{#if this.error}}
          <p class="tool-error">{{this.error}}</p>
        {{else if this.busy}}
          <p class="tool-hint">Working…</p>
        {{else if this.stats}}
          <p class="tool-hint">{{this.stats}}</p>
        {{/if}}
      </section>
    </ToolPage>
  </template>
}
