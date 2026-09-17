import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { acceptPastedFiles } from '../utils/paste-files';
import { formatBytes } from '../utils/file-share';
import {
  runFFmpeg,
  baseName,
  mediaInfo,
  formatTime,
} from '../utils/media-jobs';
import { loadModel, decodeAudio, isLoaded } from '../utils/ai-models';
import { service } from '@ember/service';
import { toCues, tidyCues, FORMATS, clock } from '../utils/subtitles';
import { handOff } from '../utils/handoff';

// Listens to a video or a recording and writes the subtitles: Whisper, running
// on your device. The file is never uploaded; the model comes to you instead.

const SIZES = [
  { id: 'whisper-tiny', label: 'Quick · English only (~130 MB)' },
  { id: 'whisper-base', label: 'Better · any language (~250 MB)' },
];
const eq = (a, b) => a === b;
const progressWidth = (p) => htmlSafe(`width:${Math.round((p ?? 0) * 100)}%`);

export default class AutoSubtitlePage extends Component {
  @service router;
  // While this is true, leaving the page floats the tool in a PiP window
  // instead of tearing it down, so the work carries on (see services/pip.js).
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close Auto Subtitles? The transcription in progress will be cancelled and the model work lost.';
  }
  @tracked file = null;
  @tracked mediaUrl = null;
  @tracked duration = 0;
  @tracked isAudio = false;
  @tracked size = 'whisper-tiny';
  @tracked format = 'srt';
  @tracked rawCues = [];
  @tracked tidy = true;
  @tracked busy = false;
  @tracked status = '';
  @tracked progress = 0;
  @tracked error = null;
  @tracked dragging = false;
  @tracked resultUrl = null;

  sizes = SIZES;
  formats = FORMATS;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.clearUrls());
  }

  clearUrls() {
    if (this.mediaUrl) URL.revokeObjectURL(this.mediaUrl);
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
  }

  // The tidied version is built from the raw chunks, so switching the option
  // off and on again never loses anything.
  get cues() {
    return this.tidy ? tidyCues(this.rawCues) : this.rawCues;
  }

  get formatSpec() {
    return FORMATS.find((f) => f.id === this.format) ?? FORMATS[0];
  }

  get subtitleText() {
    return this.cues.length ? this.formatSpec.make(this.cues) : '';
  }

  get resultName() {
    return `${baseName(this.file?.name ?? 'subtitles')}.${this.formatSpec.ext}`;
  }

  async open(file) {
    if (!file) return;
    this.clearUrls();
    this.resultUrl = null;
    this.rawCues = [];
    this.error = null;
    this.file = file;
    this.mediaUrl = URL.createObjectURL(file);
    this.isAudio =
      file.type.startsWith('audio/') ||
      /\.(mp3|wav|flac|ogg|m4a|opus|aac)$/i.test(file.name);
    const info = await mediaInfo(file);
    this.duration = info.duration || 0;
  }

  selectFile = (e) => {
    this.open(e.target.files?.[0]);
    e.target.value = '';
  };

  dragOver = (e) => {
    e.preventDefault();
    this.dragging = e.type === 'dragover';
  };

  drop = (e) => {
    e.preventDefault();
    this.dragging = false;
    this.open(e.dataTransfer.files?.[0]);
  };

  pasteFiles = (files) => this.open(files[0]);
  pick = (key, value) => (this[key] = value);
  setFormat = (e) => (this.format = e.target.value);

  transcribe = async () => {
    if (!this.file || this.busy) return;
    this.busy = true;
    this.error = null;
    this.rawCues = [];
    this.progress = 0;
    try {
      // FFmpeg pulls out plain 16 kHz mono audio, which is exactly what Whisper wants.
      this.status = 'Getting the sound out of the file…';
      const wav = await runFFmpeg(this.file, {
        out: 'wav',
        type: 'audio/wav',
        duration: this.duration,
        build: (input) => [
          '-i',
          input,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'pcm_s16le',
        ],
        onProgress: (p) => (this.progress = p * 0.3),
      });
      this.status = isLoaded(this.size)
        ? 'Starting the speech model…'
        : 'Downloading the speech model (once, then it’s cached)…';
      const model = await loadModel(this.size, {
        onProgress: ({ ratio }) => {
          this.progress = 0.3 + (ratio ?? 0) * 0.3;
          this.status = `Downloading the speech model… ${Math.round((ratio ?? 0) * 100)}%`;
        },
      });
      this.status = 'Listening…';
      this.progress = 0.62;
      const samples = await decodeAudio(wav);
      const output = await model(samples, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      this.progress = 1;
      const chunks = output?.chunks?.length
        ? output.chunks
        : [{ timestamp: [0, this.duration], text: output?.text ?? '' }];
      this.rawCues = toCues(chunks);
      if (!this.rawCues.length)
        this.error =
          'Nothing was said, or the speech was too quiet to make out.';
    } catch (error) {
      this.error =
        error?.message ?? 'Couldn’t write the subtitles for this one';
    } finally {
      this.busy = false;
      this.status = '';
    }
  };

  save = () => {
    if (!this.subtitleText) return;
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    const blob = new Blob([this.subtitleText], { type: this.formatSpec.type });
    this.resultUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = this.resultUrl;
    link.download = this.resultName;
    link.click();
  };

  toggleTidy = (event) => (this.tidy = event.target.checked);

  // Carries the video and the lines over to the Subtitle Baker.
  bake = () => {
    if (!this.file || !this.cues.length) return;
    handOff('subtitle-baker', { file: this.file, cues: this.cues });
    this.router.transitionTo('subtitle-baker');
  };

  reset = () => {
    this.clearUrls();
    this.file = this.mediaUrl = this.resultUrl = null;
    this.rawCues = [];
    this.duration = 0;
    this.error = null;
  };

  <template>
    <ToolPage
      @route="auto-subtitle"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Writes the subtitles for a video or a recording, with timings, using Whisper running on your device, so the file never leaves it."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="captions" @size={{22}} />
            <span>{{if
                this.dragging
                "Drop it here"
                "Drop a video or a recording, paste it, or click to browse"
              }}</span>
            <input
              type="file"
              accept="video/*,audio/*"
              class="sr-only"
              {{on "change" this.selectFile}}
            />
          </label>

          <div class="math-tabs" role="group" aria-label="Model size">
            {{#each this.sizes as |s|}}
              <button
                type="button"
                class="qr-tab {{if (eq this.size s.id) 'active'}}"
                {{on "click" (fn this.pick "size" s.id)}}
              >{{s.label}}</button>
            {{/each}}
          </div>
          <p class="tool-hint">The model downloads once from Hugging Face and is
            cached by your browser after that; the audio itself is never sent
            anywhere. Expect roughly real time on a laptop: a ten-minute video
            takes a few minutes.</p>

          {{#if this.file}}
            <div class="fc-toolbar">
              <span class="tool-hint">{{this.file.name}}
                ·
                {{formatBytes this.file.size}}{{#if this.duration}}
                  ·
                  {{formatTime this.duration}}{{/if}}</span>
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn active"
                  disabled={{this.busy}}
                  {{on "click" this.transcribe}}
                >{{if this.busy "Working…" "Write the subtitles"}}</button>
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.reset}}
                >Start over</button>
              </div>
            </div>
            {{#if this.busy}}
              <div class="fs-progress"><div
                  class="fs-progress-bar"
                  style={{progressWidth this.progress}}
                ></div></div>
              <p class="tool-hint">{{this.status}}</p>
            {{/if}}
          {{/if}}
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
        </div>

        {{#if this.cues.length}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <h3 class="qr-heading">{{this.cues.length}} lines</h3>
              <div class="settings-actions">
                <select
                  class="select"
                  aria-label="Subtitle format"
                  {{on "change" this.setFormat}}
                >
                  {{#each this.formats as |f|}}
                    <option
                      value={{f.id}}
                      selected={{eq this.format f.id}}
                    >{{f.label}}</option>
                  {{/each}}
                </select>
                <button
                  type="button"
                  class="btn active"
                  {{on "click" this.save}}
                ><Icon @name="download" @size={{13}} /> Save</button>
                <CopyButton @value={{this.subtitleText}} />
                {{#unless this.isAudio}}
                  <button
                    type="button"
                    class="btn"
                    {{on "click" this.bake}}
                  ><Icon @name="film" @size={{13}} />
                    Bake into the video</button>
                {{/unless}}
              </div>
            </div>
            <label class="lobby-rule is-switch">
              <span class="lobby-rule-text"><span class="qr-label">Tidy into
                  sentences</span><span class="tool-hint">Joins the chunks back
                  into sentences and re-cuts them into short lines at commas and
                  clause ends, with the timings shared out to match.</span></span>
              <span class="qr-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={{this.tidy}}
                  aria-checked={{if this.tidy "true" "false"}}
                  {{on "change" this.toggleTidy}}
                />
                <span class="qr-switch-track" aria-hidden="true"></span>
              </span>
            </label>

            {{#if this.mediaUrl}}
              {{! template-lint-disable require-media-caption }}
              {{#if this.isAudio}}
                <audio
                  class="trim-player"
                  controls
                  src={{this.mediaUrl}}
                ></audio>
              {{else}}
                <video
                  class="trim-player"
                  controls
                  src={{this.mediaUrl}}
                ></video>
              {{/if}}
            {{/if}}

            <ul class="cue-list">
              {{#each this.cues key="start" as |cue|}}
                <li class="cue">
                  <span class="cue-time">{{clock cue.start}}</span>
                  <span class="cue-text">{{cue.text}}</span>
                </li>
              {{/each}}
            </ul>
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
