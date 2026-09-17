import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import PrintButton from './print-button';
import { acceptPastedFiles } from '../utils/paste-files';
import { formatBytes } from '../utils/file-share';
import {
  listArchive,
  canOpen,
  looksDoubleWrapped,
  unwrapTar,
  typeOf,
  isText,
  isImage,
} from '../utils/archive';

// Looks inside ZIP, 7z, RAR, TAR and the rest: lists what's in there, previews the
// text and pictures, and lets you pull out one file or the lot.

let nextId = 1;

export default class ArchiveOpenerPage extends Component {
  // While this is true, leaving the page floats the tool in a PiP window
  // instead of tearing it down, so the work carries on (see services/pip.js).
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close the Archive Opener? The archive being read will be closed.';
  }
  @tracked file = null;
  @tracked entries = [];
  @tracked status = '';
  @tracked error = null;
  @tracked dragging = false;
  @tracked busy = false;
  @tracked password = '';
  @tracked preview = null; // { name, kind, text, url }
  @tracked filter = '';
  reader = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.clearPreview());
  }

  get shown() {
    const needle = this.filter.trim().toLowerCase();
    const list = needle
      ? this.entries.filter((e) => e.path.toLowerCase().includes(needle))
      : this.entries;
    return list.slice(0, 2000);
  }

  get totalSize() {
    return this.entries.reduce((sum, e) => sum + e.size, 0);
  }

  clearPreview() {
    if (this.preview?.url) URL.revokeObjectURL(this.preview.url);
    this.preview = null;
  }

  async openFile(file) {
    if (!file) return;
    this.clearPreview();
    this.error = null;
    this.entries = [];
    this.file = file;
    if (!canOpen(file.name)) {
      this.error = `${file.name} doesn’t look like an archive this can open.`;
      return;
    }
    this.busy = true;
    this.status = 'Starting the archive engine…';
    try {
      let opened = await listArchive(file, { password: this.password });
      // A .tar.gz unpacks to a .tar, which has the real contents inside it.
      if (looksDoubleWrapped(opened.entries)) {
        this.status = 'Unpacking the tar inside…';
        const inner = opened.entries[0];
        opened = await unwrapTar(opened.read(inner), inner.name);
      }
      this.entries = opened.entries.map((e) => ({ ...e, id: nextId++ }));
      this.reader = opened.read;
      if (!this.entries.length)
        this.error = 'Nothing inside, or the archive needs a password.';
    } catch (error) {
      this.error = error?.message ?? 'Couldn’t open this archive';
    } finally {
      this.busy = false;
      this.status = '';
    }
  }

  selectFile = (e) => {
    this.openFile(e.target.files?.[0]);
    e.target.value = '';
  };

  dragOver = (e) => {
    e.preventDefault();
    this.dragging = e.type === 'dragover';
  };

  drop = (e) => {
    e.preventDefault();
    this.dragging = false;
    this.openFile(e.dataTransfer.files?.[0]);
  };

  pasteFiles = (files) => this.openFile(files[0]);
  setPassword = (e) => (this.password = e.target.value);
  setFilter = (e) => (this.filter = e.target.value);

  blobOf = (entry) =>
    new Blob([this.reader(entry)], { type: typeOf(entry.name) });

  // Text and pictures can be looked at without saving them first.
  look = async (entry) => {
    this.clearPreview();
    const blob = this.blobOf(entry);
    if (isText(entry.name)) {
      const text = await blob.slice(0, 200_000).text();
      this.preview = { name: entry.path, kind: 'text', text, url: null };
    } else if (isImage(entry.name)) {
      this.preview = {
        name: entry.path,
        kind: 'image',
        text: '',
        url: URL.createObjectURL(blob),
      };
    } else {
      this.preview = {
        name: entry.path,
        kind: 'none',
        text: 'No preview for this sort of file. Save it to have a look.',
        url: null,
      };
    }
  };

  save = (entry) => {
    const url = URL.createObjectURL(this.blobOf(entry));
    const link = document.createElement('a');
    link.href = url;
    link.download = entry.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Everything, repacked as a plain ZIP (so a RAR or a 7z comes out openable anywhere).
  saveAll = async () => {
    if (!this.entries.length) return;
    this.busy = true;
    this.status = 'Packing everything into a ZIP…';
    try {
      const { zipSync } = await import('fflate');
      const files = {};
      for (const entry of this.entries) files[entry.path] = this.reader(entry);
      const url = URL.createObjectURL(
        new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.file.name.replace(/\.[^.]+$/, '')}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (error) {
      this.error = error?.message ?? 'Couldn’t pack these up';
    } finally {
      this.busy = false;
      this.status = '';
    }
  };

  reset = () => {
    this.clearPreview();
    this.file = null;
    this.entries = [];
    this.error = null;
    this.filter = '';
  };

  <template>
    <ToolPage
      @route="archive-opener"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Look inside a ZIP, 7z, RAR, TAR, ISO and more: see what's in there, preview it, and pull out one file or the lot."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="file-archive" @size={{22}} />
            <span>{{if
                this.dragging
                "Drop it here"
                "Drop an archive, paste it, or click to browse"
              }}</span>
            <input
              type="file"
              class="sr-only"
              {{on "change" this.selectFile}}
            />
          </label>
          <label class="math-field">
            <span class="qr-label is-muted">Password (only if it needs one)</span>
            <input
              type="password"
              class="math-input"
              autocomplete="off"
              value={{this.password}}
              {{on "input" this.setPassword}}
            />
          </label>
          <p class="tool-hint">ZIP, 7z, RAR, TAR, GZ, BZ2, XZ, ZST, ISO, CAB,
            DMG, DEB, RPM, APK, JAR and more. The engine (about 2 MB) downloads
            the first time and the archive never leaves your device.</p>
          {{#if this.busy}}<p class="tool-hint">{{this.status}}</p>{{/if}}
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
        </div>

        {{#if this.entries.length}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <h3 class="qr-heading">{{this.file.name}}</h3>
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn active"
                  disabled={{this.busy}}
                  {{on "click" this.saveAll}}
                ><Icon @name="download" @size={{13}} /> Save all as ZIP</button>
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.reset}}
                >Close</button>
              </div>
            </div>
            <p class="tool-hint">{{this.entries.length}}
              files ·
              {{formatBytes this.totalSize}}
              unpacked</p>
            <label class="math-field">
              <span class="qr-label is-muted">Find a file</span>
              <input
                type="search"
                class="math-input"
                placeholder="Part of a name or folder"
                value={{this.filter}}
                {{on "input" this.setFilter}}
              />
            </label>

            {{#if this.preview}}
              <div class="fc-toolbar">
                <h3 class="qr-heading">{{this.preview.name}}</h3>
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.clearPreview}}
                ><Icon @name="x" @size={{13}} /> Close preview</button>
              </div>
              {{#if (eq this.preview.kind "image")}}
                <div class="stitch-preview"><img
                    class="stitch-canvas"
                    src={{this.preview.url}}
                    alt={{this.preview.name}}
                  /></div>
              {{else}}
                <p class="cipher-output">{{this.preview.text}}</p>
              {{/if}}
            {{/if}}

            <ul class="fs-list">
              {{#each this.shown key="id" as |entry|}}
                <li class="fs-row fc-row">
                  <Icon @name="file" @size={{16}} />
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{entry.path}}</span>
                    <span class="fs-row-size">{{formatBytes entry.size}}</span>
                  </div>
                  <div class="fs-row-status">
                    <button
                      type="button"
                      class="btn"
                      {{on "click" (fn this.look entry)}}
                    >Look</button>
                    <button
                      type="button"
                      class="btn"
                      {{on "click" (fn this.save entry)}}
                    ><Icon @name="download" @size={{13}} /> Save</button>
                    <PrintButton
                      @get={{fn this.blobOf entry}}
                      @name={{entry.name}}
                    />
                  </div>
                </li>
              {{/each}}
            </ul>
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}

function eq(a, b) {
  return a === b;
}
