import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { formatBytes } from '../utils/file-share';
import { acceptPastedFiles } from '../utils/paste-files';
import { runFFmpegMany } from '../utils/media-jobs';
import { eachFrame, canvasToPng } from '../utils/video-frames';

const MODELS = [
  { id: 'small', label: 'Fast (smaller download)' },
  { id: 'medium', label: 'Balanced' },
  { id: 'large', label: 'Best quality (larger download)' },
];

// How a clip comes back. WebM with VP9 is the only widely supported video
// format that keeps an alpha channel, so it's the default; the frames are
// there for anyone taking them into an editor that would rather have stills.
const OUTPUTS = [
  {
    id: 'webm',
    label: 'WebM video (see-through)',
    hint: 'Plays in browsers and drops straight into most editors with its transparency intact.',
  },
  {
    id: 'green',
    label: 'MP4 on a green screen',
    hint: 'For editors that won’t take an alpha channel. Key the green out at the other end.',
  },
  {
    id: 'frames',
    label: 'PNG frames in a zip',
    hint: 'Every frame as its own see-through picture.',
  },
];

// Removing a background is a model running over every single frame, so the
// cost is per frame and it adds up fast. These caps are what keeps a dropped
// clip from locking the tab up for half an hour.
const MAX_SECONDS = 20;
const FPS_CHOICES = [8, 12, 15, 24];

const eq = (a, b) => a === b;
const isVideo = (file) =>
  file.type.startsWith('video/') ||
  /\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name);

let nextId = 1;

export default class BackgroundRemoverPage extends Component {
  // While this is true, leaving the page floats the tool in a PiP window
  // instead of tearing it down, so the work carries on (see services/pip.js).
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close the Background Remover? Whatever is being processed will be lost.';
  }

  models = MODELS;
  outputs = OUTPUTS;
  fpsChoices = FPS_CHOICES;
  maxSeconds = MAX_SECONDS;

  @tracked items = [];
  @tracked model = 'medium';
  @tracked output = 'webm';
  @tracked fps = 12;
  @tracked busy = false;
  @tracked dragging = false;
  @tracked status = null;
  @tracked progress = 0;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.revokeAll());
  }

  get hasVideo() {
    return this.items.some((i) => i.video);
  }

  revokeAll() {
    for (const item of this.items) {
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
    }
  }

  patch(id, changes) {
    this.items = this.items.map((i) =>
      i.id === id ? { ...i, ...changes } : i,
    );
  }

  addFiles(list) {
    const usable = [...list].filter(
      (f) => f.type.startsWith('image/') || isVideo(f),
    );
    if (!usable.length) return;
    this.items = [
      ...this.items,
      ...usable.map((file) => ({
        id: nextId++,
        file,
        video: isVideo(file),
        sourceUrl: URL.createObjectURL(file),
        url: null,
        size: null,
        name: null,
        note: null,
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
  setOutput = (e) => (this.output = e.target.value);
  setFps = (fps) => (this.fps = fps);

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
    this.progress = 0;
  };

  run = async () => {
    this.busy = true;
    this.status = 'Loading the model…';
    this.progress = 0;
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      for (const item of this.items) {
        this.patch(item.id, { error: null });
        try {
          if (item.video) await this.runVideo(item, removeBackground);
          else await this.runImage(item, removeBackground);
        } catch (error) {
          this.patch(item.id, {
            error: error.message || 'Failed to process this file.',
          });
        }
      }
      this.status = null;
      this.progress = 0;
    } finally {
      this.busy = false;
    }
  };

  async runImage(item, removeBackground) {
    this.status = `Removing background from ${item.file.name}…`;
    const blob = await removeBackground(item.file, {
      model: this.model,
      progress: (key, current, total) => {
        if (total) {
          this.progress = current / total;
          this.status = `${key}: ${Math.round((current / total) * 100)}%`;
        }
      },
    });
    if (item.url) URL.revokeObjectURL(item.url);
    this.patch(item.id, {
      url: URL.createObjectURL(blob),
      size: blob.size,
      name: `${item.file.name.replace(/\.[^.]+$/, '')}-no-bg.png`,
      note: null,
    });
  }

  // A clip is just a great many pictures: pull each frame out, cut the
  // background from it, then hand the lot to FFmpeg to put back together.
  async runVideo(item, removeBackground) {
    const frames = [];
    const green = this.output === 'green';
    const base = item.file.name.replace(/\.[^.]+$/, '');

    const info = await eachFrame(item.file, {
      fps: this.fps,
      maxSeconds: MAX_SECONDS,
      onProgress: (ratio) => (this.progress = ratio),
      onFrame: async (canvas, index, count) => {
        this.status = `${item.file.name}: frame ${index + 1} of ${count}`;
        const source = await canvasToPng(canvas);
        const cut = await removeBackground(source, { model: this.model });
        frames.push({
          name: `f${String(index).padStart(5, '0')}.png`,
          data: green
            ? await this.onGreen(cut, canvas.width, canvas.height)
            : cut,
        });
      },
    });

    this.status = `${item.file.name}: putting the video back together…`;
    this.progress = 0;

    if (this.output === 'frames') {
      const { createArchive } = await import('../utils/archive');
      // createArchive flattens any path in a name, so the frames go in at the
      // top level and the numbering is what keeps them in order.
      const files = frames.map(
        (f) => new File([f.data], f.name, { type: 'image/png' }),
      );
      const bytes = await createArchive(files, 'zip', 5);
      return this.finish(
        item,
        new Blob([bytes], { type: 'application/zip' }),
        `${base}-no-bg.zip`,
        `${info.count} frames at ${info.fps} fps.`,
      );
    }

    const blob = await runFFmpegMany(frames, {
      out: green ? 'mp4' : 'webm',
      type: green ? 'video/mp4' : 'video/webm',
      onProgress: (p) => (this.progress = p),
      onStatus: (text) => (this.status = `${item.file.name}: ${text}`),
      build: () =>
        green
          ? [
              '-framerate',
              String(info.fps),
              '-i',
              'f%05d.png',
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '20',
              '-pix_fmt',
              'yuv420p',
            ]
          : [
              '-framerate',
              String(info.fps),
              '-i',
              'f%05d.png',
              '-c:v',
              'libvpx-vp9',
              // yuva420p is the pixel format that carries the alpha channel;
              // without it VP9 would quietly flatten everything onto black.
              '-pix_fmt',
              'yuva420p',
              '-b:v',
              '0',
              '-crf',
              '30',
              '-row-mt',
              '1',
            ],
    });

    const capped =
      info.duration >= MAX_SECONDS
        ? ` Only the first ${MAX_SECONDS} seconds were used.`
        : '';
    return this.finish(
      item,
      blob,
      `${base}-no-bg.${green ? 'mp4' : 'webm'}`,
      `${info.count} frames at ${info.fps} fps.${capped}`,
    );
  }

  // Alpha composited over green, for editors that only know how to key.
  async onGreen(cut, width, height) {
    const bitmap = await createImageBitmap(cut);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#00b140'; // the green that keyers are built around
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return canvasToPng(canvas);
  }

  finish(item, blob, name, note) {
    if (item.url) URL.revokeObjectURL(item.url);
    this.patch(item.id, {
      url: URL.createObjectURL(blob),
      size: blob.size,
      name,
      note,
    });
  }

  // Ctrl+V: paste screenshots or copied image files straight in.
  pasteFiles = (files) => this.addFiles(files);

  <template>
    <ToolPage
      @route="background-remover"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Drop in a photo or a clip and the background disappears. It all happens on your device, so your pics stay yours."
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
            <span>Drop photos or videos, or click to browse</span>
            <input
              type="file"
              accept="image/*,video/*"
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

          {{#if this.hasVideo}}
            <label class="math-field">
              <span class="qr-label is-muted">Video comes back as</span>
              <select class="select" {{on "change" this.setOutput}}>
                {{#each this.outputs as |o|}}
                  <option
                    value={{o.id}}
                    selected={{eq o.id this.output}}
                  >{{o.label}}</option>
                {{/each}}
              </select>
            </label>
            <label class="math-field">
              <span class="qr-label is-muted">Frames a second</span>
              <div class="math-tabs" role="group" aria-label="Frame rate">
                {{#each this.fpsChoices as |f|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.fps f) 'active'}}"
                    {{on "click" (fn this.setFps f)}}
                  >{{f}}</button>
                {{/each}}
              </div>
            </label>
            <p class="tool-hint">The model runs over every single frame, so a
              clip takes roughly its length in seconds times the frame rate,
              times however long one photo takes. Twelve a second looks smooth
              enough for most things and is half the wait of twenty-four. Clips
              are capped at
              {{this.maxSeconds}}
              seconds; trim a longer one down first.</p>
          {{/if}}

          <p class="tool-hint">The first run downloads a segmentation model (a
            few MB to tens of MB depending on quality) that your browser caches
            for next time. Video also needs the audio and video engine, about 30
            MB, to put the frames back together. Nothing is uploaded; it all
            runs on your device.</p>
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
            {{#if this.busy}}
              <progress
                class="tool-progress"
                value={{this.progress}}
                max="1"
              ></progress>
            {{/if}}
            <ul class="fs-list">
              {{#each this.items key="id" as |item|}}
                <li class="fs-row fc-row bgr-row">
                  {{#if item.video}}
                    <video
                      src={{item.sourceUrl}}
                      class="bgr-thumb"
                      muted
                      playsinline
                    ></video>
                  {{else}}
                    <img src={{item.sourceUrl}} alt="" class="bgr-thumb" />
                  {{/if}}
                  {{#if item.url}}
                    {{#if item.video}}
                      <video
                        src={{item.url}}
                        class="bgr-thumb checkerboard"
                        controls
                        loop
                        muted
                        playsinline
                      ></video>
                    {{else}}
                      <img
                        src={{item.url}}
                        alt=""
                        class="bgr-thumb checkerboard"
                      />
                    {{/if}}
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
