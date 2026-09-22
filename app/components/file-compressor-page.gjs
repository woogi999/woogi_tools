import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { formatBytes } from '../utils/file-share';
import { acceptPastedFiles } from '../utils/paste-files';
import { runFFmpeg, mediaInfo, baseName } from '../utils/media-jobs';
import {
  kindOf,
  canEncode,
  compressImage,
  videoBitrates,
  audioBitrate,
} from '../utils/compress-media';
import { keepState } from '../utils/tool-state';

// How hard to squeeze, for the people who don't have a number in mind. The
// image quality and the audio bitrate are the settings themselves; the video
// CRF is x264's constant-quality scale, where bigger means smaller and worse.
const PRESETS = [
  {
    id: 'light',
    label: 'Light',
    hint: 'Barely touched. Good for photos you still want to print.',
    quality: 0.9,
    crf: 23,
    audioKbps: 192,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'The usual choice: a lot smaller, and you have to look for the difference.',
    quality: 0.75,
    crf: 28,
    audioKbps: 128,
  },
  {
    id: 'strong',
    label: 'Strong',
    hint: 'As small as it can go while still looking like the original.',
    quality: 0.55,
    crf: 33,
    audioKbps: 96,
  },
];

const IMAGE_FORMATS = [
  { id: 'keep', label: 'Keep the format' },
  { id: 'jpeg', label: 'JPEG' },
  { id: 'webp', label: 'WebP (smaller)' },
  { id: 'avif', label: 'AVIF (smallest)' },
];

const eq = (a, b) => a === b;
const gt = (a, b) => a > b;
const pct = (n) => `${Math.round(n * 100)}%`;

let nextId = 1;

export default class FileCompressorPage extends Component {
  // While this is true, leaving the page floats the tool in a PiP window
  // instead of tearing it down, so the work carries on (see services/pip.js).
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close the File Compressor? The file being compressed will be lost.';
  }

  presets = PRESETS;
  imageFormats = IMAGE_FORMATS;

  @tracked items = [];
  @tracked mode = 'preset'; // 'preset' | 'target'
  @tracked preset = 'balanced';
  @tracked targetMb = 5;
  @tracked imageFormat = 'keep';
  @tracked busy = false;
  @tracked status = null;
  @tracked progress = 0;
  @tracked dragging = false;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'file-compressor', [
      'mode',
      'preset',
      'targetMb',
      'imageFormat',
    ]);
    registerDestructor(this, () => this.revokeAll());
  }

  get isTarget() {
    return this.mode === 'target';
  }

  get currentPreset() {
    return PRESETS.find((p) => p.id === this.preset) ?? PRESETS[1];
  }

  get targetBytes() {
    return Math.max(0.01, Number(this.targetMb) || 0) * 1024 * 1024;
  }

  get done() {
    return this.items.filter((i) => i.blobUrl);
  }

  get savings() {
    const done = this.done;
    if (!done.length) return null;
    const before = done.reduce((n, i) => n + i.file.size, 0);
    const after = done.reduce((n, i) => n + i.size, 0);
    const saved = Math.round((1 - after / before) * 100);
    return `${formatBytes(before)} → ${formatBytes(after)} (${
      saved >= 0 ? `${saved}% smaller` : `${-saved}% larger`
    })`;
  }

  revokeAll() {
    for (const item of this.items) {
      if (item.blobUrl) URL.revokeObjectURL(item.blobUrl);
      if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
    }
  }

  patch(id, changes) {
    this.items = this.items.map((i) =>
      i.id === id ? { ...i, ...changes } : i,
    );
  }

  async addFiles(list) {
    const usable = [...list]
      .map((file) => ({ file, kind: kindOf(file) }))
      .filter((f) => f.kind);
    if (!usable.length) return;
    const added = usable.map(({ file, kind }) => ({
      id: nextId++,
      file,
      kind,
      sourceUrl: kind === 'image' ? URL.createObjectURL(file) : null,
      blobUrl: null,
      name: null,
      size: null,
      note: null,
      error: null,
      duration: 0,
    }));
    this.items = [...this.items, ...added];
    // Audio and video need their length before the budget can be divided up,
    // and the browser can read that without waking the engine.
    for (const item of added) {
      if (item.kind === 'image') continue;
      const info = await mediaInfo(item.file);
      this.patch(item.id, { duration: info.duration, hasAudio: info.hasAudio });
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

  setMode = (mode) => (this.mode = mode);
  setPreset = (id) => (this.preset = id);
  setFormat = (e) => (this.imageFormat = e.target.value);
  setTarget = (e) => {
    const value = Number(e.target.value);
    this.targetMb = Number.isFinite(value) && value > 0 ? value : 1;
  };

  remove = (id) => {
    const item = this.items.find((i) => i.id === id);
    if (item?.blobUrl) URL.revokeObjectURL(item.blobUrl);
    if (item?.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
    this.items = this.items.filter((i) => i.id !== id);
  };

  clear = () => {
    this.revokeAll();
    this.items = [];
    this.status = null;
    this.progress = 0;
  };

  run = async () => {
    this.busy = true;
    this.progress = 0;
    try {
      for (const item of this.items) {
        this.patch(item.id, { error: null, note: null });
        this.status = `Compressing ${item.file.name}…`;
        try {
          const result =
            item.kind === 'image'
              ? await this.compressImage(item)
              : await this.compressMedia(item);
          if (item.blobUrl) URL.revokeObjectURL(item.blobUrl);
          this.patch(item.id, {
            blobUrl: URL.createObjectURL(result.blob),
            size: result.blob.size,
            name: result.name,
            note: result.note,
          });
        } catch (error) {
          this.patch(item.id, {
            error: error.message || 'Could not compress this file.',
          });
        }
      }
      this.status = null;
      this.progress = 0;
    } finally {
      this.busy = false;
    }
  };

  async compressImage(item) {
    const current = (item.file.type.split('/')[1] || 'jpeg').toLowerCase();
    let format =
      this.imageFormat === 'keep'
        ? current === 'png' || current === 'webp' || current === 'avif'
          ? current
          : 'jpeg'
        : this.imageFormat;
    if (!canEncode(format)) {
      // Safari has no AVIF encoder, and a canvas that can't encode what you
      // asked for silently returns a PNG, which would be bigger than the input.
      format = canEncode('webp') ? 'webp' : 'jpeg';
    }
    const result = await compressImage(item.file, {
      format,
      quality: this.currentPreset.quality,
      targetBytes: this.isTarget ? this.targetBytes : null,
      onStatus: (text) => (this.status = `${item.file.name}: ${text}`),
    });
    const scaled = result.scale < 1;
    const note =
      this.isTarget && result.blob.size > this.targetBytes
        ? `Couldn't reach the target: ${formatBytes(result.blob.size)} is as small as this picture goes without falling apart.`
        : `${format.toUpperCase()} at ${pct(result.quality)} quality${
            scaled ? `, scaled to ${result.width}×${result.height}` : ''
          }.`;
    return {
      blob: result.blob,
      name: `${baseName(item.file.name)}-small.${format === 'jpeg' ? 'jpg' : format}`,
      note,
    };
  }

  async compressMedia(item) {
    const isVideo = item.kind === 'video';
    const preset = this.currentPreset;
    if (this.isTarget && !item.duration)
      throw new Error(
        "Couldn't read how long this file is, so a target size can't be worked out. Use a preset instead.",
      );

    const out = isVideo ? 'mp4' : 'mp3';
    const type = isVideo ? 'video/mp4' : 'audio/mpeg';
    let note;
    let build;

    if (isVideo) {
      const rates = this.isTarget
        ? videoBitrates(this.targetBytes, item.duration, preset.audioKbps)
        : null;
      // A target size means a fixed bitrate, because that is the only way to
      // predict how big the result will be; a preset means constant quality,
      // which looks better but lands wherever it lands.
      build = (input) => [
        '-i',
        input,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        ...(rates
          ? [
              '-b:v',
              `${rates.video}k`,
              '-maxrate',
              `${rates.video}k`,
              '-bufsize',
              `${rates.video * 2}k`,
            ]
          : ['-crf', String(preset.crf)]),
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        `${preset.audioKbps}k`,
        '-movflags',
        '+faststart',
      ];
      note = rates
        ? rates.fits
          ? `Video at ${rates.video} kbps, audio at ${rates.audio} kbps.`
          : `This clip is too long for ${this.targetMb} MB: held at the lowest watchable bitrate (${rates.video} kbps) instead.`
        : `Constant quality (CRF ${preset.crf}).`;
    } else {
      const rate = this.isTarget
        ? audioBitrate(this.targetBytes, item.duration)
        : { audio: preset.audioKbps, fits: true };
      build = (input) => [
        '-i',
        input,
        '-vn',
        '-c:a',
        'libmp3lame',
        '-b:a',
        `${rate.audio}k`,
      ];
      note = rate.fits
        ? `MP3 at ${rate.audio} kbps.`
        : `This track is too long for ${this.targetMb} MB: held at 32 kbps, the lowest that still sounds like music.`;
    }

    const blob = await runFFmpeg(item.file, {
      out,
      type,
      build,
      duration: item.duration,
      onStatus: (text) => (this.status = `${item.file.name}: ${text}`),
      onProgress: (p) => (this.progress = p),
    });
    return { blob, name: `${baseName(item.file.name)}-small.${out}`, note };
  }

  pasteFiles = (files) => this.addFiles(files);

  <template>
    <ToolPage
      @route="file-compressor"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="That photo, song or clip is too big to send. Say how small you need it and it comes back that size, or pick how hard to squeeze and let it get on with it."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="shrink" @size={{22}} />
            <span>Drop images, videos or audio, or click to browse</span>
            <input
              type="file"
              accept="image/*,video/*,audio/*"
              multiple
              class="sr-only"
              {{on "change" this.selectFiles}}
            />
          </label>

          <div class="mode-toggle" role="group" aria-label="How to compress">
            <button
              type="button"
              class="btn {{unless this.isTarget 'active'}}"
              {{on "click" (fn this.setMode "preset")}}
            >How hard to squeeze</button>
            <button
              type="button"
              class="btn {{if this.isTarget 'active'}}"
              {{on "click" (fn this.setMode "target")}}
            >Aim for a size</button>
          </div>

          {{#if this.isTarget}}
            <label class="math-field">
              <span class="qr-label is-muted">Target size, in MB</span>
              <input
                type="number"
                min="0.05"
                step="0.5"
                class="math-input"
                value={{this.targetMb}}
                {{on "input" this.setTarget}}
              />
            </label>
            <p class="tool-hint">Pictures are re-encoded over and over until one
              lands just under your number, and shrunk in size only if quality
              alone can't get there. Video and audio get a bitrate worked out
              from how long they run, so the result lands within a few percent.</p>
          {{else}}
            <div class="math-tabs" role="group" aria-label="Strength">
              {{#each this.presets as |p|}}
                <button
                  type="button"
                  class="qr-tab {{if (eq this.preset p.id) 'active'}}"
                  {{on "click" (fn this.setPreset p.id)}}
                >{{p.label}}</button>
              {{/each}}
            </div>
            <p class="tool-hint">{{this.currentPreset.hint}}</p>
          {{/if}}

          <label class="math-field">
            <span class="qr-label is-muted">Picture format</span>
            <select class="select" {{on "change" this.setFormat}}>
              {{#each this.imageFormats as |f|}}
                <option
                  value={{f.id}}
                  selected={{eq f.id this.imageFormat}}
                >{{f.label}}</option>
              {{/each}}
            </select>
          </label>
          <p class="tool-hint">Videos come out as MP4 (H.264) and audio as MP3,
            so they play anywhere. The audio and video engine is about 30 MB and
            downloads the first time you compress a clip; pictures need no
            engine at all. Nothing leaves your device either way.</p>
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
                >{{if this.busy "Working…" "Compress"}}</button>
                <button
                  type="button"
                  class="btn"
                  disabled={{this.busy}}
                  {{on "click" this.clear}}
                >Clear</button>
              </div>
              {{#if this.savings}}<span
                  class="tool-hint"
                >{{this.savings}}</span>{{/if}}
            </div>
            {{#if this.status}}
              <p class="tool-hint">{{this.status}}</p>
              {{#if (gt this.progress 0)}}
                <progress
                  class="tool-progress"
                  value={{this.progress}}
                  max="1"
                ></progress>
              {{/if}}
            {{/if}}
            <ul class="fs-list">
              {{#each this.items key="id" as |item|}}
                <li class="fs-row fc-row">
                  {{#if item.sourceUrl}}
                    <img src={{item.sourceUrl}} alt="" class="bgr-thumb" />
                  {{else}}
                    <Icon
                      @name={{if (eq item.kind "video") "film" "music"}}
                      @size={{16}}
                    />
                  {{/if}}
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{item.file.name}}</span>
                    <span class="fs-row-size">{{formatBytes
                        item.file.size
                      }}{{#if item.size}}
                        →
                        {{formatBytes item.size}}{{/if}}</span>
                    {{#if item.note}}<span
                        class="tool-hint"
                      >{{item.note}}</span>{{/if}}
                    {{#if item.error}}<span
                        class="tool-error"
                      >{{item.error}}</span>{{/if}}
                  </div>
                  <div class="fs-row-status">
                    {{#if item.blobUrl}}<a
                        class="btn fs-save"
                        href={{item.blobUrl}}
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
