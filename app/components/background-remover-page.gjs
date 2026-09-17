import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { formatBytes } from '../utils/file-share';
import { acceptPastedFiles } from '../utils/paste-files';

const MODELS = [
  { id: 'small', label: 'Fast (smaller download)' },
  { id: 'medium', label: 'Balanced' },
  { id: 'large', label: 'Best quality (larger download)' },
];
const eq = (a, b) => a === b;

let nextId = 1;

export default class BackgroundRemoverPage extends Component {
  // While this is true, leaving the page floats the tool in a PiP window
  // instead of tearing it down, so the work carries on (see services/pip.js).
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close the Background Remover? The image being processed will be lost.';
  }
  models = MODELS;

  @tracked items = [];
  @tracked model = 'medium';
  @tracked busy = false;
  @tracked dragging = false;
  @tracked status = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.revokeAll());
  }

  revokeAll() {
    for (const item of this.items) {
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
    }
  }

  addFiles(list) {
    const images = [...list].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    this.items = [
      ...this.items,
      ...images.map((file) => ({
        id: nextId++,
        file,
        sourceUrl: URL.createObjectURL(file),
        url: null,
        size: null,
        error: null,
      })),
    ];
  }

  selectFiles = (e) => {
    this.addFiles(e.target.files);
    e.target.value = '';
  };

  dragOver = (e) => {
    e.preventDefault();
    this.dragging = e.type === 'dragover';
  };

  drop = (e) => {
    e.preventDefault();
    this.dragging = false;
    this.addFiles(e.dataTransfer.files);
  };

  setModel = (model) => (this.model = model);

  remove = (id) => {
    const item = this.items.find((i) => i.id === id);
    if (item?.url) URL.revokeObjectURL(item.url);
    if (item?.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
    this.items = this.items.filter((i) => i.id !== id);
  };

  clear = () => {
    this.revokeAll();
    this.items = [];
    this.status = null;
  };

  run = async () => {
    this.busy = true;
    this.status = 'Loading the model…';
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      for (const item of this.items) {
        try {
          this.status = `Removing background from ${item.file.name}…`;
          const blob = await removeBackground(item.file, {
            model: this.model,
            progress: (key, current, total) => {
              if (total)
                this.status = `${key}: ${Math.round((current / total) * 100)}%`;
            },
          });
          const url = URL.createObjectURL(blob);
          const name = `${item.file.name.replace(/\.[^.]+$/, '')}-no-bg.png`;
          this.items = this.items.map((i) =>
            i.id === item.id
              ? { ...i, url, size: blob.size, name, error: null }
              : i,
          );
        } catch (error) {
          this.items = this.items.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  error: error.message || 'Failed to process this image.',
                }
              : i,
          );
        }
      }
      this.status = null;
    } finally {
      this.busy = false;
    }
  };

  // Ctrl+V: paste screenshots or copied image files straight in.
  pasteFiles = (files) => this.addFiles(files);

  <template>
    <ToolPage
      @route="background-remover"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Drop in a photo and the background disappears. It all happens on your device, so your pics stay yours."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="eraser" @size={{22}} />
            <span>Drop photos, or click to browse</span>
            <input
              type="file"
              accept="image/*"
              multiple
              class="sr-only"
              {{on "change" this.selectFiles}}
            />
          </label>

          <label class="math-field">
            <span class="qr-label is-muted">Model</span>
            <div class="math-tabs" role="group" aria-label="Model">
              {{#each this.models as |m|}}
                <button
                  type="button"
                  class="qr-tab {{if (eq this.model m.id) 'active'}}"
                  {{on "click" (fn this.setModel m.id)}}
                >{{m.label}}</button>
              {{/each}}
            </div>
          </label>
          <p class="tool-hint">The first run downloads a segmentation model (a
            few MB to tens of MB depending on quality) that your browser caches
            for next time. Nothing is uploaded; the model runs entirely on your
            device.</p>
        </div>

        {{#if this.items.length}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn active"
                  disabled={{this.busy}}
                  {{on "click" this.run}}
                >{{if this.busy "Working…" "Remove backgrounds"}}</button>
                <button
                  type="button"
                  class="btn"
                  disabled={{this.busy}}
                  {{on "click" this.clear}}
                >Clear</button>
              </div>
              {{#if this.status}}<span
                  class="tool-hint"
                >{{this.status}}</span>{{/if}}
            </div>
            <ul class="fs-list">
              {{#each this.items key="id" as |item|}}
                <li class="fs-row fc-row bgr-row">
                  <img src={{item.sourceUrl}} alt="" class="bgr-thumb" />
                  {{#if item.url}}<img
                      src={{item.url}}
                      alt=""
                      class="bgr-thumb checkerboard"
                    />{{/if}}
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{item.file.name}}</span>
                    <span class="fs-row-size">{{formatBytes
                        item.file.size
                      }}{{#if item.size}}
                        →
                        {{formatBytes item.size}}{{/if}}</span>
                    {{#if item.error}}<span
                        class="tool-error"
                      >{{item.error}}</span>{{/if}}
                  </div>
                  <div class="fs-row-status">
                    {{#if item.url}}<a
                        class="btn fs-save"
                        href={{item.url}}
                        download={{item.name}}
                      ><Icon @name="download" @size={{13}} /> Save</a>{{/if}}
                  </div>
                  <button
                    type="button"
                    class="fs-remove"
                    aria-label="Remove {{item.file.name}}"
                    {{on "click" (fn this.remove item.id)}}
                  ><Icon @name="x" @size={{13}} /></button>
                </li>
              {{/each}}
            </ul>
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
