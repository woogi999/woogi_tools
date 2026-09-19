import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { loadQpdf } from '../utils/converters/engines';
import { formatBytes } from '../utils/file-share';
import { acceptPastedFiles } from '../utils/paste-files';

let nextId = 1;

// qpdf writes the same file back with its encryption dictionary gone, so the
// text, images and layout are untouched: it is the original PDF, just open.
async function unlock(file, password) {
  const create = await loadQpdf();
  const qpdf = await create();
  qpdf.FS.writeFile('/in.pdf', new Uint8Array(await file.arrayBuffer()));
  const args = ['--decrypt'];
  if (password) args.push(`--password=${password}`);
  let status = 0;
  try {
    status = qpdf.callMain([...args, '/in.pdf', '/out.pdf']);
  } catch (error) {
    status = error?.status ?? 1;
  }
  // 3 is qpdf's "finished with warnings": the file is still written.
  if (status !== 0 && status !== 3) {
    throw new Error(
      password
        ? 'That password did not open it. Check it and try again.'
        : 'This PDF needs a password to open. Type it in and try again.',
    );
  }
  return new Blob([qpdf.FS.readFile('/out.pdf')], { type: 'application/pdf' });
}

export default class UnlockPdfPage extends Component {
  @tracked items = [];
  @tracked password = '';
  @tracked busy = false;
  @tracked dragging = false;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.revokeAll());
  }

  revokeAll() {
    for (const item of this.items) if (item.url) URL.revokeObjectURL(item.url);
  }

  addFiles(list) {
    const pdfs = [...list].filter(
      (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
    );
    if (!pdfs.length) return;
    this.items = [
      ...this.items,
      ...pdfs.map((file) => ({
        id: nextId++,
        file,
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

  pasteFiles = (files) => this.addFiles(files);
  setPassword = (e) => (this.password = e.target.value);

  remove = (id) => {
    const item = this.items.find((i) => i.id === id);
    if (item?.url) URL.revokeObjectURL(item.url);
    this.items = this.items.filter((i) => i.id !== id);
  };

  clear = () => {
    this.revokeAll();
    this.items = [];
  };

  run = async () => {
    this.busy = true;
    for (const item of this.items) {
      if (item.url) continue;
      try {
        const blob = await unlock(item.file, this.password);
        this.items = this.items.map((i) =>
          i.id === item.id
            ? {
                ...i,
                url: URL.createObjectURL(blob),
                size: blob.size,
                error: null,
              }
            : i,
        );
      } catch (error) {
        this.items = this.items.map((i) =>
          i.id === item.id ? { ...i, error: error.message } : i,
        );
      }
    }
    this.busy = false;
  };

  <template>
    <ToolPage
      @route="unlock-pdf"
      @subtitle="Take the password and the restrictions off a PDF, and get the same file back, open."
      @busy={{this.busy}}
      @closeWarning="the PDF being unlocked"
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="lock-open" @size={{22}} />
            <span>Drop locked PDFs here, or click to browse</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              class="sr-only"
              {{on "change" this.selectFiles}}
            />
          </label>
          <label class="math-field">
            <span class="qr-label is-muted">Password, if it asks for one to open</span>
            <input
              type="password"
              class="math-input"
              autocomplete="off"
              value={{this.password}}
              {{on "input" this.setPassword}}
            />
          </label>
          <p class="tool-hint">A PDF that opens but won't let you print, copy or
            edit has no password to type: leave this empty. One that asks for a
            password when opened needs it here. The file never leaves your
            browser.</p>
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
                >{{if this.busy "Unlocking…" "Unlock"}}</button>
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.clear}}
                >Clear</button>
              </div>
            </div>
            <ul class="fs-list">
              {{#each this.items key="id" as |item|}}
                <li class="fs-row fc-row">
                  <Icon @name={{if item.url "lock-open" "lock"}} @size={{16}} />
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{item.file.name}}</span>
                    <span class="fs-row-size">{{formatBytes
                        item.file.size
                      }}</span>
                    {{#if item.error}}<span
                        class="tool-error"
                      >{{item.error}}</span>{{/if}}
                  </div>
                  <div class="fs-row-status">
                    {{#if item.url}}<a
                        class="btn fs-save"
                        href={{item.url}}
                        download="{{item.file.name}}"
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
