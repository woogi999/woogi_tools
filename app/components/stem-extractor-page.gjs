import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { formatBytes } from '../utils/file-share';
import { acceptPastedFiles } from '../utils/paste-files';
import { keepState } from '../utils/tool-state';
import { formatTime } from '../utils/media-jobs';
import { STEMS, separate, toWav } from '../utils/stems';
import {
  ENGINES,
  engineById,
  totalBytes,
  modelsFor,
} from '../utils/separator-models';
import { inspectDevice, isCached, clearModelCache } from '../utils/onnx';
import {
  decodeForModel,
  separateWithModel,
  stereoWav,
} from '../utils/separate-model';

// Letting the browser paint between chunks of arithmetic. A plain
// queueMicrotask wouldn't: it runs before the next frame, so the progress bar
// would never move.
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

const gt = (a, b) => a > b;

const stemInfo = (id) => STEMS.find((s) => s.id === id);

export default class StemExtractorPage extends Component {
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close the Stem Extractor? The separation in progress will be lost, and it takes a while to redo.';
  }

  allStems = STEMS;

  @tracked engine = 'mdx';
  @tracked device = null; // { webgpu, vramGb, reason }
  @tracked cached = {};

  @tracked file = null;
  @tracked duration = 0;
  @tracked wanted = ['vocals', 'instrumental'];
  @tracked sharpness = 2;

  @tracked results = [];
  @tracked busy = false;
  @tracked status = null;
  @tracked progress = 0;
  @tracked error = null;
  @tracked warning = null;
  @tracked dragging = false;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'stem-extractor', ['engine', 'wanted', 'sharpness']);
    registerDestructor(this, () => this.revoke());
    this.checkDevice();
  }

  async checkDevice() {
    const device = await inspectDevice();
    this.device = device;
    // A model engine the machine can't run is worse than no offer at all, so
    // fall back to the instant one rather than leaving a dead button selected.
    if (!device.webgpu && this.currentEngine.models.length) this.engine = 'dsp';
    const cached = {};
    for (const spec of ENGINES)
      for (const model of modelsFor(spec))
        cached[model.id] = await isCached(model);
    this.cached = cached;
  }

  revoke() {
    for (const r of this.results) URL.revokeObjectURL(r.url);
  }

  get deviceState() {
    if (!this.device) return 'checking';
    return this.device.webgpu ? 'gpu' : 'none';
  }

  get currentEngine() {
    return engineById(this.engine);
  }

  get isModel() {
    return this.currentEngine.models.length > 0;
  }

  get engineRows() {
    return ENGINES.map((spec) => {
      const models = modelsFor(spec);
      const blocked = models.length > 0 && this.device && !this.device.webgpu;
      // WebGPU won't say how much memory a card has, but the largest buffer it
      // will allow is a reasonable proxy, and it errs low.
      const short =
        models.length > 0 &&
        this.device &&
        this.device.vramGb > 0 &&
        this.device.vramGb < Math.max(...models.map((m) => m.vramGb));
      return {
        ...spec,
        bytes: totalBytes(spec),
        ready: models.length > 0 && models.every((m) => this.cached[m.id]),
        blocked,
        short,
        selected: spec.id === this.engine,
        sdr: models.length ? Math.max(...models.map((m) => m.sdr)) : null,
      };
    });
  }

  get currentRow() {
    return this.engineRows.find((r) => r.selected);
  }

  get stemRows() {
    // A model engine only makes the two stems it was trained for; offering the
    // other three here would be a promise it can't keep.
    const allowed = this.currentEngine.stems;
    return STEMS.filter((s) => allowed.includes(s.id)).map((s) => ({
      ...s,
      on: this.isModel || this.wanted.includes(s.id),
      fixed: this.isModel,
    }));
  }

  get slow() {
    return (
      !this.isModel &&
      this.wanted.some((id) => ['drums', 'bass', 'other'].includes(id))
    );
  }

  get estimate() {
    if (!this.duration) return null;
    if (this.isModel)
      return 'depends on your graphics card — the progress bar is the honest answer';
    const seconds = Math.round(this.duration * (this.slow ? 0.35 : 0.12));
    return seconds < 5 ? 'a few seconds' : `roughly ${formatTime(seconds)}`;
  }

  setEngine = (id) => {
    const row = this.engineRows.find((r) => r.id === id);
    if (row?.blocked) return;
    this.engine = id;
  };

  toggleStem = (id) => {
    if (this.isModel) return;
    this.wanted = this.wanted.includes(id)
      ? this.wanted.filter((s) => s !== id)
      : [...this.wanted, id];
  };

  setSharpness = (e) => (this.sharpness = Number(e.target.value));

  forgetModels = async () => {
    await clearModelCache();
    this.cached = {};
    this.status = 'Downloaded models removed.';
  };

  async load(file) {
    if (!file) return;
    const usable =
      /^(audio|video)\//.test(file.type) ||
      /\.(mp3|wav|flac|ogg|opus|m4a|aac|mp4|mkv|mov|webm)$/i.test(file.name);
    if (!usable) return;
    this.revoke();
    this.file = file;
    this.results = [];
    this.error = null;
    this.warning = null;
    this.duration = 0;
    const el = document.createElement('audio');
    const url = URL.createObjectURL(file);
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      this.duration = Number.isFinite(el.duration) ? el.duration : 0;
      URL.revokeObjectURL(url);
    };
    el.onerror = () => URL.revokeObjectURL(url);
    el.src = url;
  }

  selectFile = (e) => {
    this.load(e.target.files[0]);
    e.target.value = '';
  };

  dragOver = (e) => {
    e.preventDefault();
    this.dragging = e.type === 'dragover';
  };

  drop = (e) => {
    e.preventDefault();
    this.dragging = false;
    this.load(e.dataTransfer.files[0]);
  };

  pasteFiles = (files) => this.load(files[0]);

  clear = () => {
    this.revoke();
    this.file = null;
    this.results = [];
    this.error = null;
    this.warning = null;
    this.status = null;
    this.progress = 0;
    this.duration = 0;
  };

  run = async () => {
    if (!this.file) return;
    if (!this.isModel && !this.wanted.length) return;
    this.busy = true;
    this.error = null;
    this.warning = null;
    this.revoke();
    this.results = [];
    this.progress = 0;
    try {
      if (this.isModel) await this.runModel();
      else await this.runDsp();
      this.status = null;
      this.progress = 0;
    } catch (error) {
      this.error = error.message || 'Could not separate this file.';
    } finally {
      this.busy = false;
    }
  };

  async runModel() {
    this.status = 'Decoding the audio…';
    const buffer = await decodeForModel(this.file);
    await breathe();

    const stems = await separateWithModel(buffer, this.currentEngine, {
      webgpu: true,
      onStatus: (text) => (this.status = text),
      onProgress: (ratio) => (this.progress = ratio),
      onYield: breathe,
    });

    for (const model of modelsFor(this.currentEngine))
      this.cached = { ...this.cached, [model.id]: true };

    this.results = Object.entries(stems).map(([id, chans]) => {
      const spec = stemInfo(id);
      const blob = stereoWav(chans);
      return {
        id,
        label: spec?.label ?? id,
        icon: spec?.icon ?? 'audio-lines',
        url: URL.createObjectURL(blob),
        size: blob.size,
        name: `${this.file.name.replace(/\.[^.]+$/, '')}-${id}.wav`,
      };
    });
  }

  async runDsp() {
    this.status = 'Decoding the audio…';
    let ctx;
    try {
      ctx = new (window.AudioContext ?? window.webkitAudioContext)();
      const buffer = await ctx.decodeAudioData(await this.file.arrayBuffer());
      await breathe();
      const { stems, sampleRate, isMono } = await separate(buffer, {
        wanted: this.wanted,
        sharpness: this.sharpness,
        onProgress: (ratio, label) => {
          this.progress = ratio;
          if (label) this.status = label;
        },
        onYield: breathe,
      });
      if (isMono)
        this.warning =
          'This file is mono, so there is no stereo field to read: the vocal and instrumental stems are the whole mix. The drums and bass stems still work.';
      this.results = this.wanted
        .filter((id) => stems[id])
        .map((id) => {
          const spec = stemInfo(id);
          const blob = toWav(stems[id], sampleRate);
          return {
            id,
            label: spec.label,
            icon: spec.icon,
            url: URL.createObjectURL(blob),
            size: blob.size,
            name: `${this.file.name.replace(/\.[^.]+$/, '')}-${id}.wav`,
          };
        });
    } finally {
      ctx?.close?.();
    }
  }

  <template>
    <ToolPage
      @route="stem-extractor"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Split a song into its parts: the vocal on its own for an acapella, the backing track on its own for karaoke, or the drums and bass pulled out to play along with."
    >
      {{! data-device says what the graphics check decided, which is otherwise
          invisible: "checking" until it answers, then "gpu" or "none". }}
      <div
        class="fs"
        data-device={{this.deviceState}}
        {{acceptPastedFiles this.pasteFiles}}
      >
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="split" @size={{22}} />
            <span>{{if
                this.file
                this.file.name
                "Drop a song or a video, or click to browse"
              }}</span>
            <input
              type="file"
              accept="audio/*,video/*"
              class="sr-only"
              {{on "change" this.selectFile}}
            />
          </label>

          <span class="qr-label is-muted">How should it separate?</span>
          <ul class="stem-engines">
            {{#each this.engineRows key="id" as |e|}}
              <li>
                <button
                  type="button"
                  class="stem-engine
                    {{if e.selected 'is-selected'}}
                    {{if e.blocked 'is-blocked'}}"
                  disabled={{e.blocked}}
                  aria-pressed={{if e.selected "true" "false"}}
                  {{on "click" (fn this.setEngine e.id)}}
                >
                  <span class="stem-engine-head">
                    <strong>{{e.quality}}</strong>
                    {{#if e.sdr}}
                      <span class="stem-badge">{{e.sdr}} dB</span>
                    {{else}}
                      <span class="stem-badge">no download</span>
                    {{/if}}
                  </span>
                  <span class="tool-hint">{{e.hint}}</span>
                  {{#if e.bytes}}
                    <span class="stem-engine-foot">
                      {{#if e.ready}}
                        <Icon @name="circle-check-big" @size={{12}} />
                        already downloaded
                      {{else}}
                        <Icon @name="download" @size={{12}} />
                        {{formatBytes e.bytes}}, downloaded once
                      {{/if}}
                    </span>
                  {{/if}}
                  {{#if e.blocked}}
                    <span class="tool-error">Needs WebGPU, which this browser
                      doesn't have.</span>
                  {{/if}}
                  {{#if e.short}}
                    <span class="tool-error">Your graphics card may not have
                      enough memory for this one.</span>
                  {{/if}}
                </button>
              </li>
            {{/each}}
          </ul>

          {{#if this.device}}
            {{#unless this.device.webgpu}}
              <p class="tool-hint"><Icon @name="info" @size={{13}} />
                {{this.device.reason}}
                The instant mode still works everywhere, and the model modes
                appear here in a browser that has WebGPU.</p>
            {{/unless}}
          {{/if}}

          <span class="qr-label is-muted">Which parts do you want?</span>
          <ul class="stem-picks">
            {{#each this.stemRows key="id" as |s|}}
              <li>
                <label class="math-check">
                  <input
                    type="checkbox"
                    checked={{s.on}}
                    disabled={{s.fixed}}
                    {{on "change" (fn this.toggleStem s.id)}}
                  />
                  <span><strong><Icon @name={{s.icon}} @size={{13}} />
                      {{s.label}}</strong><span
                      class="tool-hint"
                    >{{s.hint}}</span></span>
                </label>
              </li>
            {{/each}}
          </ul>
          {{#if this.isModel}}
            <p class="tool-hint">This model splits the voice from everything
              else, and the two always add back up to the original song. For
              drums and bass on their own, use the instant mode.</p>
          {{/if}}

          {{#unless this.isModel}}
            <div class="slider-row slider-row-wide">
              <label for="stem-sharpness">Separation strength</label>
              <input
                id="stem-sharpness"
                type="range"
                min="1"
                max="6"
                step="0.5"
                value={{this.sharpness}}
                {{on "input" this.setSharpness}}
              />
              <span class="slider-num">{{this.sharpness}}</span>
            </div>
            <p class="tool-hint">Higher pulls the vocal further out of the mix
              but starts to chew holes in it; lower leaves more backing behind
              but sounds smoother. Two or three suits most songs.</p>
          {{/unless}}

          <div class="settings-actions">
            <button
              type="button"
              class="btn active"
              disabled={{this.busy}}
              {{on "click" this.run}}
            >{{if this.busy "Separating…" "Separate"}}</button>
            <button
              type="button"
              class="btn"
              disabled={{this.busy}}
              {{on "click" this.clear}}
            >Clear</button>
            {{#if this.currentRow.ready}}
              <button
                type="button"
                class="btn"
                disabled={{this.busy}}
                {{on "click" this.forgetModels}}
              >Free up space</button>
            {{/if}}
            {{#if this.estimate}}<span class="tool-hint">Should take
                {{this.estimate}}</span>{{/if}}
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
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
          {{#if this.warning}}<p class="tool-hint">{{this.warning}}</p>{{/if}}

          {{#if this.isModel}}
            <p class="tool-hint">The model runs on your own graphics card
              through WebGPU, and its weights are kept after the first download
              so the wait only happens once. Your music is never uploaded: the
              file is read, decoded and separated entirely inside this page.</p>
          {{else}}
            <p class="tool-hint">The instant mode compares the left and right
              channels — a lead vocal is almost always panned dead centre — and
              tells drum hits from held notes on a spectrogram. It's arithmetic
              rather than a model, so it needs no download and takes seconds,
              but it is the roughest option here: a mono recording, or a vocal
              panned off centre, won't separate at all.</p>
          {{/if}}
        </div>

        {{#if this.results.length}}
          <div class="fs-frame fc-panel pop-in">
            <ul class="fs-list">
              {{#each this.results key="id" as |r|}}
                <li class="fs-row fc-row stem-row">
                  <Icon @name={{r.icon}} @size={{16}} />
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{r.label}}</span>
                    <span class="fs-row-size">{{formatBytes r.size}}
                      · WAV</span>
                    {{! template-lint-disable require-media-caption }}
                    <audio controls src={{r.url}} class="stem-audio"></audio>
                  </div>
                  <div class="fs-row-status">
                    <a
                      class="btn fs-save"
                      href={{r.url}}
                      download={{r.name}}
                    ><Icon @name="download" @size={{13}} /> Save</a>
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
