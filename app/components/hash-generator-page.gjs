import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { ALGORITHMS } from '../utils/hash';
import { formatBytes } from '../utils/file-share';

const eq = (a, b) => a === b;

export default class HashGeneratorPage extends Component {
  @tracked source = 'text';
  @tracked text = 'hello world';
  @tracked file = null;
  @tracked hashes = [];
  @tracked busy = false;
  @tracked uppercase = false;
  @tracked expected = '';
  @tracked dragging = false;

  // Results from a slower, earlier run must not overwrite a newer one.
  runId = 0;

  constructor(owner, args) {
    super(owner, args);
    this.compute();
  }

  get display() {
    return this.hashes.map((h) => ({ ...h, value: this.uppercase ? h.value.toUpperCase() : h.value }));
  }

  get match() {
    const wanted = this.expected.trim().toLowerCase().replace(/\s+/g, '');
    if (!wanted) return null;
    return this.hashes.find((h) => h.value === wanted) ?? false;
  }

  async compute() {
    const id = ++this.runId;
    const bytes = this.source === 'file' ? (this.file ? new Uint8Array(await this.file.arrayBuffer()) : null) : new TextEncoder().encode(this.text);
    if (!bytes) {
      this.hashes = [];
      return;
    }
    this.busy = true;
    const hashes = await Promise.all(ALGORITHMS.map(async (a) => ({ id: a.id, label: a.label, value: await a.run(bytes) })));
    if (id !== this.runId) return;
    this.hashes = hashes;
    this.busy = false;
  }

  setSource = (source) => {
    this.source = source;
    this.compute();
  };

  setText = (e) => {
    this.text = e.target.value;
    this.compute();
  };

  pickFile(file) {
    if (!file) return;
    this.file = file;
    this.source = 'file';
    this.compute();
  }

  selectFile = (e) => {
    this.pickFile(e.target.files?.[0]);
    e.target.value = '';
  };

  dragOver = (e) => {
    e.preventDefault();
    this.dragging = e.type === 'dragover';
  };

  dropFile = (e) => {
    e.preventDefault();
    this.dragging = false;
    this.pickFile(e.dataTransfer.files?.[0]);
  };

  setExpected = (e) => (this.expected = e.target.value);
  toggleUppercase = () => (this.uppercase = !this.uppercase);

  <template>
    <ToolPage @route="hash-generator" @subtitle="Hash text or a file with MD5, SHA-1, SHA-2 or CRC-32, then compare it to a checksum to make sure nothing’s been tampered with.">
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <div class="math-tabs" role="group" aria-label="Input">
            <button type="button" class="qr-tab {{if (eq this.source 'text') 'active'}}" {{on "click" (fn this.setSource "text")}}>Text</button>
            <button type="button" class="qr-tab {{if (eq this.source 'file') 'active'}}" {{on "click" (fn this.setSource "file")}}>File</button>
          </div>
          {{#if (eq this.source "text")}}
            <textarea class="textarea text-area-tall" spellcheck="false" aria-label="Text to hash" value={{this.text}} {{on "input" this.setText}}></textarea>
            <p class="tool-hint">Text is hashed as UTF-8.</p>
          {{else}}
            <label class="qr-drop {{if this.dragging 'is-dragging'}}" {{on "dragover" this.dragOver}} {{on "dragleave" this.dragOver}} {{on "drop" this.dropFile}}>
              <Icon @name="upload" @size={{22}} />
              <span>{{if this.file this.file.name "Drop a file, or click to browse"}}</span>
              {{#if this.file}}<span class="tool-hint">{{formatBytes this.file.size}}</span>{{/if}}
              <input type="file" class="sr-only" {{on "change" this.selectFile}} />
            </label>
            <p class="tool-hint">The file is read on your device and never uploaded.</p>
          {{/if}}
          <label class="math-field">
            <span class="qr-label is-muted">Compare with a checksum</span>
            <input type="text" class="math-input" spellcheck="false" placeholder="Paste an expected hash" value={{this.expected}} {{on "input" this.setExpected}} />
          </label>
          {{#if this.expected}}
            {{#if this.match}}
              <p class="math-callout">Matches the {{this.match.label}} hash.</p>
            {{else}}
              <p class="math-callout is-soft">Doesn't match any of these hashes.</p>
            {{/if}}
          {{/if}}
        </section>

        <section class="math-card">
          <div class="field-head">
            <h3 class="qr-heading">Hashes</h3>
            <label class="math-check"><input type="checkbox" checked={{this.uppercase}} {{on "change" this.toggleUppercase}} /> Uppercase</label>
          </div>
          {{#if this.busy}}<p class="tool-hint">Hashing…</p>{{/if}}
          <ul class="case-list">
            {{#each this.display key="id" as |h|}}
              <li class="case-item {{if (eq this.match.id h.id) 'is-match'}}">
                <div class="case-text">
                  <span class="qr-label is-muted">{{h.label}}</span>
                  <span class="case-value is-mono">{{h.value}}</span>
                </div>
                <CopyButton @value={{h.value}} />
              </li>
            {{/each}}
          </ul>
        </section>
      </div>
    </ToolPage>
  </template>
}
