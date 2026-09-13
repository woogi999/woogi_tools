import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import CopyButton from './copy-button';
import { FORMATS, compress, decompress } from '../utils/codec';

const eq = (a, b) => a === b;

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder('utf-8', { fatal: true });

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBytes(text) {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const NAMED_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function decodeEntities(text) {
  // A detached <textarea> decodes every named entity the browser knows without running any markup.
  const area = document.createElement('textarea');
  area.innerHTML = text;
  return area.value;
}

const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', _: '..--.-', '"': '.-..-.', $: '...-..-', '@': '.--.-.' };
const MORSE_REVERSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

const CODECS = [
  { id: 'base64', label: 'Base64', encode: (t) => bytesToBase64(utf8.encode(t)), decode: (t) => fromUtf8.decode(base64ToBytes(t)) },
  { id: 'base64url', label: 'Base64 URL', encode: (t) => bytesToBase64(utf8.encode(t)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), decode: (t) => fromUtf8.decode(base64ToBytes(t)) },
  { id: 'url', label: 'URL', encode: (t) => encodeURIComponent(t), decode: (t) => decodeURIComponent(t.replace(/\+/g, ' ')) },
  { id: 'html', label: 'HTML entities', encode: (t) => t.replace(/[&<>"']/g, (c) => NAMED_ENTITIES[c]).replace(/[^\x20-\x7e\n\r\t]/gu, (c) => `&#${c.codePointAt(0)};`), decode: decodeEntities },
  {
    id: 'hex',
    label: 'Hex',
    encode: (t) => Array.from(utf8.encode(t), (b) => b.toString(16).padStart(2, '0')).join(' '),
    decode: (t) => {
      const clean = t.replace(/0x|[\s,:]/gi, '');
      if (!/^([0-9a-f]{2})*$/i.test(clean)) throw new Error('Hex must be pairs of 0-9 and A-F');
      return fromUtf8.decode(Uint8Array.from(clean.match(/../g) ?? [], (h) => parseInt(h, 16)));
    },
  },
  {
    id: 'binary',
    label: 'Binary',
    encode: (t) => Array.from(utf8.encode(t), (b) => b.toString(2).padStart(8, '0')).join(' '),
    decode: (t) => {
      const clean = t.replace(/\s+/g, '');
      if (!/^([01]{8})*$/.test(clean)) throw new Error('Binary must be groups of 8 bits');
      return fromUtf8.decode(Uint8Array.from(clean.match(/.{8}/g) ?? [], (b) => parseInt(b, 2)));
    },
  },
  {
    id: 'unicode',
    label: 'Unicode escapes',
    encode: (t) => [...t].map((c) => { const cp = c.codePointAt(0); return cp < 128 ? c : cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, '0')}`; }).join(''),
    decode: (t) => t.replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b, c) => String.fromCodePoint(parseInt(a ?? b ?? c, 16))),
  },
  {
    id: 'morse',
    label: 'Morse',
    encode: (t) => t.toUpperCase().split(/\s+/).filter(Boolean).map((word) => [...word].map((c) => MORSE[c] ?? '').filter(Boolean).join(' ')).join(' / '),
    decode: (t) => t.trim().split(/\s*\/\s*|\s{3,}/).map((word) => word.split(/\s+/).map((code) => MORSE_REVERSE[code.replace(/[·•]/g, '.').replace(/[−—_]/g, '-')] ?? '').join('')).join(' '),
  },
];

export default class DataCodecPage extends Component {
  formats = FORMATS;
  codecs = CODECS;

  @tracked tab = 'compress';

  // Compression state
  @tracked mode = 'compress';
  @tracked formatId = 'gzip';
  @tracked level = FORMATS[0].level;
  @tracked input = '';
  @tracked output = '';
  @tracked error = null;
  @tracked busy = false;
  runId = 0;

  // Text encoding state
  @tracked codecId = 'base64';
  @tracked direction = 'encode';
  @tracked textInput = 'Hello, world! ✨';

  setTab = (tab) => (this.tab = tab);

  get format() {
    return FORMATS.find((f) => f.id === this.formatId);
  }

  get isCompress() {
    return this.mode === 'compress';
  }

  get stats() {
    if (!this.input || !this.output) return null;
    const plain = new TextEncoder().encode(this.isCompress ? this.input : this.output).length;
    const packed = Math.floor(((this.isCompress ? this.output : this.input).replace(/[\s=]/g, '').length * 3) / 4);
    return `${plain} B plain · ${packed} B compressed · ${Math.round((packed / plain) * 100)}%`;
  }

  async run() {
    const id = ++this.runId;
    const { input, formatId, level, isCompress } = this;
    if (!input) {
      this.output = '';
      this.error = null;
      return;
    }
    this.busy = true;
    try {
      const result = isCompress ? await compress(input, formatId, level) : await decompress(input, formatId);
      if (id !== this.runId) return;
      this.output = result;
      this.error = null;
    } catch {
      if (id !== this.runId) return;
      this.output = '';
      this.error = isCompress ? 'Compression failed.' : `Couldn't decompress: expected base64 ${this.format.label} data.`;
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

  setFormat = (event) => {
    this.formatId = event.target.value;
    this.level = this.format.level;
    this.run();
  };

  setLevel = (event) => {
    this.level = +event.target.value;
    this.run();
  };

  get codec() {
    return CODECS.find((c) => c.id === this.codecId);
  }

  get textResult() {
    if (!this.textInput) return { output: '' };
    try {
      return { output: this.codec[this.direction](this.textInput) };
    } catch (error) {
      const reason = error instanceof TypeError || error.name === 'InvalidCharacterError' ? "This doesn't look like valid input for this format" : error.message;
      return { output: '', error: `Couldn't decode: ${reason}` };
    }
  }

  setCodec = (id) => (this.codecId = id);
  setDirection = (direction) => (this.direction = direction);
  setTextInput = (e) => (this.textInput = e.target.value);

  swapText = () => {
    if (this.textResult.error) return;
    this.textInput = this.textResult.output;
    this.direction = this.direction === 'encode' ? 'decode' : 'encode';
  };

  <template>
    <ToolPage @route="data-codec" @subtitle="Compress data, or encode and decode Base64, URLs, hex, binary, Morse and more. Runs entirely in your browser.">
      <div class="text-tool pop-in">
        <div class="math-tabs" role="group" aria-label="Kind">
          <button type="button" class="qr-tab {{if (eq this.tab 'compress') 'active'}}" {{on "click" (fn this.setTab "compress")}}>Compression</button>
          <button type="button" class="qr-tab {{if (eq this.tab 'text') 'active'}}" {{on "click" (fn this.setTab "text")}}>Text encoding</button>
        </div>

        {{#if (eq this.tab "compress")}}
          <section class="tool-panel">
            <div class="tool-controls">
              <div class="mode-toggle" role="group" aria-label="Mode">
                <button type="button" class="btn {{if this.isCompress 'active'}}" {{on "click" (fn this.setMode "compress")}}>Compress</button>
                <button type="button" class="btn {{if this.isCompress '' 'active'}}" {{on "click" (fn this.setMode "decompress")}}>Decompress</button>
              </div>
              <select class="select" aria-label="Format" {{on "change" this.setFormat}}>
                {{#each this.formats as |f|}}
                  <option value={{f.id}} selected={{eq f.id this.formatId}}>{{f.label}}</option>
                {{/each}}
              </select>
            </div>

            {{#if this.isCompress}}
              <div class="slider-row slider-row-wide">
                <label for="codec-level">Level</label>
                <input
                  id="codec-level"
                  type="range"
                  min={{this.format.min}}
                  max={{this.format.max}}
                  value={{this.level}}
                  {{on "input" this.setLevel}}
                />
                <span class="slider-num">{{this.level}}</span>
              </div>
            {{/if}}

            <label class="field-label" for="codec-input">{{if this.isCompress "Text" "Base64"}}</label>
            <textarea id="codec-input" class="textarea" spellcheck="false" value={{this.input}} {{on "input" this.onInput}}></textarea>

            <div class="field-head">
              <label class="field-label" for="codec-output">{{if this.isCompress "Base64" "Text"}}</label>
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
        {{else}}
          <section class="math-card">
            <div class="line-actions" role="group" aria-label="Format">
              {{#each this.codecs as |c|}}
                <button type="button" class="btn {{if (eq this.codecId c.id) 'active'}}" {{on "click" (fn this.setCodec c.id)}}>{{c.label}}</button>
              {{/each}}
            </div>
            <div class="fc-toolbar">
              <div class="math-tabs" role="group" aria-label="Direction">
                <button type="button" class="qr-tab {{if (eq this.direction 'encode') 'active'}}" {{on "click" (fn this.setDirection "encode")}}>Encode</button>
                <button type="button" class="qr-tab {{if (eq this.direction 'decode') 'active'}}" {{on "click" (fn this.setDirection "decode")}}>Decode</button>
              </div>
              <button type="button" class="btn" {{on "click" this.swapText}}>Use output as input</button>
            </div>
            <div class="math-grid">
              <label class="field-label">
                {{if (eq this.direction "encode") "Plain text" this.codec.label}}
                <textarea class="textarea text-area-tall" spellcheck="false" value={{this.textInput}} {{on "input" this.setTextInput}}></textarea>
              </label>
              <div class="field-label">
                <div class="field-head">
                  <span>{{if (eq this.direction "encode") this.codec.label "Plain text"}}</span>
                  <CopyButton @value={{this.textResult.output}} />
                </div>
                <textarea class="textarea text-area-tall" readonly spellcheck="false" aria-label="Result" value={{this.textResult.output}}></textarea>
              </div>
            </div>
            {{#if this.textResult.error}}<p class="tool-error">{{this.textResult.error}}</p>{{/if}}
          </section>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
