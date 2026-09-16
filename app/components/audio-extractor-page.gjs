import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { runFFmpeg, baseName, mediaInfo, formatTime } from '../utils/media-jobs';
import { acceptPastedFiles } from '../utils/paste-files';
import { formatBytes } from '../utils/file-share';

// Pulls the sound out of a video: the picture is thrown away and the audio is
// either copied as it is or re-encoded to the format you pick.

const FORMATS = [
  { id: 'copy', label: 'Keep as it is (fastest)', ext: '', type: '' },
  { id: 'mp3', label: 'MP3', ext: 'mp3', type: 'audio/mpeg', args: (q) => ['-c:a', 'libmp3lame', '-b:a', `${q}k`] },
  { id: 'm4a', label: 'M4A (AAC)', ext: 'm4a', type: 'audio/mp4', args: (q) => ['-c:a', 'aac', '-b:a', `${q}k`] },
  { id: 'ogg', label: 'OGG (Vorbis)', ext: 'ogg', type: 'audio/ogg', args: (q) => ['-c:a', 'libvorbis', '-b:a', `${q}k`] },
  { id: 'opus', label: 'Opus', ext: 'opus', type: 'audio/ogg', args: (q) => ['-c:a', 'libopus', '-b:a', `${q}k`] },
  { id: 'wav', label: 'WAV (uncompressed)', ext: 'wav', type: 'audio/wav', args: () => ['-c:a', 'pcm_s16le'] },
  { id: 'flac', label: 'FLAC (lossless)', ext: 'flac', type: 'audio/flac', args: () => ['-c:a', 'flac'] },
];
const BITRATES = [96, 128, 160, 192, 256, 320];
// What the copied stream actually is, so the file gets a name that matches.
const COPY_EXT = { aac: 'm4a', mp3: 'mp3', opus: 'opus', vorbis: 'ogg', flac: 'flac', pcm_s16le: 'wav' };

const eq = (a, b) => a === b;
const progressWidth = (p) => htmlSafe(`width:${Math.round((p ?? 0) * 100)}%`);
let nextId = 1;

export default class AudioExtractorPage extends Component {
  @tracked items = [];
  @tracked dragging = false;
  @tracked format = 'mp3';
  @tracked bitrate = 192;
  @tracked busy = false;

  formats = FORMATS;
  bitrates = BITRATES;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.revokeAll());
  }

  get spec() {
    return FORMATS.find((f) => f.id === this.format) ?? FORMATS[1];
  }

  get usesBitrate() {
    return ['mp3', 'm4a', 'ogg', 'opus'].includes(this.format);
  }

  get done() {
    return this.items.filter((i) => i.url);
  }

  revokeAll() {
    for (const item of this.items) if (item.url) URL.revokeObjectURL(item.url);
  }

  update(id, patch) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
  }

  async addFiles(list) {
    const files = [...list].filter((f) => f.type.startsWith('video/') || f.type.startsWith('audio/') || /\.(mp4|mkv|mov|webm|avi|m4v|flv|wmv|ts|mpg|mpeg)$/i.test(f.name));
    if (!files.length) return;
    const added = files.map((file) => ({ id: nextId++, file, url: null, name: null, size: null, status: '', progress: 0, error: null, duration: 0 }));
    this.items = [...this.items, ...added];
    for (const item of added) {
      const info = await mediaInfo(item.file);
      this.update(item.id, { duration: info.duration });
    }
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

  setFormat = (e) => (this.format = e.target.value);
  setBitrate = (e) => (this.bitrate = Number(e.target.value) || 192);

  remove = (id) => {
    const item = this.items.find((i) => i.id === id);
    if (item?.url) URL.revokeObjectURL(item.url);
    this.items = this.items.filter((i) => i.id !== id);
  };

  clear = () => {
    this.revokeAll();
    this.items = [];
  };

  extractAll = async () => {
    if (this.busy) return;
    this.busy = true;
    for (const item of this.items) {
      if (item.url) continue;
      await this.extract(item.id);
    }
    this.busy = false;
  };

  extract = async (id) => {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    if (item.url) URL.revokeObjectURL(item.url);
    this.update(id, { url: null, error: null, progress: 0, status: 'Queued…' });
    const spec = this.spec;
    const copying = spec.id === 'copy';
    // Copying keeps the stream untouched, so the container has to match what's inside it.
    const ext = copying ? (COPY_EXT[await this.codecOf(item.file)] ?? 'm4a') : spec.ext;
    try {
      const blob = await runFFmpeg(item.file, {
        out: ext,
        type: spec.type || '',
        duration: item.duration,
        build: (input) => ['-i', input, '-vn', '-sn', '-dn', ...(copying ? ['-c:a', 'copy'] : spec.args(this.bitrate))],
        onStatus: (status) => this.update(id, { status }),
        onProgress: (progress) => this.update(id, { progress }),
      });
      this.update(id, { url: URL.createObjectURL(blob), name: `${baseName(item.file.name)}.${ext}`, size: blob.size, status: '', progress: 1 });
    } catch (error) {
      this.update(id, { error: error?.message || 'Couldn’t get the audio out of this one', status: '' });
    }
  };

  // Asking FFmpeg what the audio stream is would mean a second pass, so guess from
  // the container and let the copy fall back to M4A when it's something unusual.
  async codecOf(file) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'webm') return 'opus';
    if (ext === 'ogg' || ext === 'ogv') return 'vorbis';
    if (ext === 'avi' || ext === 'mpg' || ext === 'mpeg') return 'mp3';
    return 'aac';
  }

  <template>
    <ToolPage @route="audio-extractor" @subtitle="Take the sound out of a video and save it as MP3, M4A, WAV and more. Nothing gets uploaded.">
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}" {{on "dragover" this.dragOver}} {{on "dragleave" this.dragOver}} {{on "drop" this.drop}}>
            <Icon @name="music" @size={{22}} />
            <span>{{if this.dragging "Drop them here" "Drop videos, paste them, or click to browse"}}</span>
            <input type="file" accept="video/*,audio/*" multiple class="sr-only" {{on "change" this.selectFiles}} />
          </label>

          <div class="math-row">
            <label class="math-field">
              <span class="qr-label is-muted">Save the sound as</span>
              <select class="select" {{on "change" this.setFormat}}>
                {{#each this.formats as |f|}}
                  <option value={{f.id}} selected={{eq this.format f.id}}>{{f.label}}</option>
                {{/each}}
              </select>
            </label>
            {{#if this.usesBitrate}}
              <label class="math-field">
                <span class="qr-label is-muted">Bitrate</span>
                <select class="select" {{on "change" this.setBitrate}}>
                  {{#each this.bitrates as |b|}}
                    <option value={{b}} selected={{eq this.bitrate b}}>{{b}} kbps</option>
                  {{/each}}
                </select>
              </label>
            {{/if}}
          </div>
          <p class="tool-hint">“Keep as it is” copies the sound straight out with no re-encoding: quickest, and nothing is lost. The engine downloads the first time you use it (about 30 MB), then stays cached for the visit.</p>
        </div>

        {{#if this.items.length}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <h3 class="qr-heading">Videos</h3>
              <div class="settings-actions">
                <button type="button" class="btn active" disabled={{this.busy}} {{on "click" this.extractAll}}>{{if this.busy "Working…" "Get the audio"}}</button>
                <button type="button" class="btn" {{on "click" this.clear}}>Clear</button>
              </div>
            </div>
            <ul class="fs-list">
              {{#each this.items key="id" as |item|}}
                <li class="fs-row fc-row">
                  <Icon @name="video" @size={{16}} />
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{item.file.name}}</span>
                    <span class="fs-row-size">
                      {{formatBytes item.file.size}}{{#if item.duration}} · {{formatTime item.duration}}{{/if}}{{#if item.size}} → {{formatBytes item.size}}{{/if}}
                    </span>
                    {{#if item.error}}<span class="tool-error">{{item.error}}</span>{{else if item.status}}<span class="fs-row-size">{{item.status}}</span>{{/if}}
                  </div>
                  <div class="fs-row-status">
                    {{#if item.url}}
                      {{! template-lint-disable require-media-caption }}
                      <audio class="media-preview" controls src={{item.url}}></audio>
                      <a class="btn fs-save" href={{item.url}} download={{item.name}}><Icon @name="download" @size={{13}} /> Save</a>
                    {{else if item.status}}
                      <div class="fs-progress"><div class="fs-progress-bar" style={{progressWidth item.progress}}></div></div>
                    {{else}}
                      <button type="button" class="btn" {{on "click" (fn this.extract item.id)}}>{{if item.error "Retry" "Get the audio"}}</button>
                    {{/if}}
                  </div>
                  <button type="button" class="fs-remove" aria-label="Remove {{item.file.name}}" {{on "click" (fn this.remove item.id)}}><Icon @name="x" @size={{13}} /></button>
                </li>
              {{/each}}
            </ul>
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
