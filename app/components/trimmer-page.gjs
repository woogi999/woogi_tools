import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import {
  runFFmpeg,
  baseName,
  mediaInfo,
  formatTime,
  ffmpegTime,
} from '../utils/media-jobs';
import { acceptPastedFiles } from '../utils/paste-files';
import { formatBytes } from '../utils/file-share';

// Cutting a piece out of a video or a song. Drag the two handles (or type the
// times), listen or watch the bit you've picked, then save just that.

const progressWidth = (p) => htmlSafe(`width:${Math.round((p ?? 0) * 100)}%`);
const extOf = (name) => (name.split('.').pop() || 'mp4').toLowerCase();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export default class TrimmerPage extends Component {
  // While this is true, leaving the page floats the tool in a PiP window
  // instead of tearing it down, so the work carries on (see services/pip.js).
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close the Trimmer? The trim in progress will be cancelled.';
  }
  @tracked file = null;
  @tracked url = null;
  @tracked duration = 0;
  @tracked isAudio = false;
  @tracked start = 0;
  @tracked end = 0;
  @tracked mode = 'copy'; // 'copy' (quick, cuts at the nearest keyframe) | 'exact' (re-encodes)
  @tracked dragging = false;
  @tracked busy = false;
  @tracked status = '';
  @tracked progress = 0;
  @tracked error = null;
  @tracked resultUrl = null;
  @tracked resultName = null;
  @tracked resultSize = null;
  player = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.clearUrls());
  }

  clearUrls() {
    if (this.url) URL.revokeObjectURL(this.url);
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
  }

  get span() {
    return Math.max(0, this.end - this.start);
  }

  get canCut() {
    return Boolean(this.file) && this.span > 0.05 && !this.busy;
  }

  // The chosen piece, as a bar across the timeline.
  get bandStyle() {
    if (!this.duration) return htmlSafe('left:0%;width:0%');
    const left = (this.start / this.duration) * 100;
    const width = (this.span / this.duration) * 100;
    return htmlSafe(`left:${left}%;width:${width}%`);
  }

  async open(file) {
    if (!file) return;
    this.clearUrls();
    this.resultUrl = this.resultName = this.resultSize = null;
    this.error = null;
    this.file = file;
    this.url = URL.createObjectURL(file);
    this.isAudio =
      file.type.startsWith('audio/') ||
      /\.(mp3|wav|flac|ogg|m4a|opus|aac)$/i.test(file.name);
    const info = await mediaInfo(file);
    this.duration = info.duration || 0;
    this.start = 0;
    this.end = this.duration;
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

  // Holds on to the player element, so "start here" can read where it's paused.
  keepPlayer = modifier((element) => {
    this.player = element;
    return () => (this.player = null);
  });

  setStart = (e) => {
    this.start = clamp(
      Number(e.target.value) || 0,
      0,
      Math.max(0, this.end - 0.1),
    );
    this.seek(this.start);
  };

  setEnd = (e) => {
    this.end = clamp(
      Number(e.target.value) || 0,
      this.start + 0.1,
      this.duration,
    );
  };

  setMode = (mode) => (this.mode = mode);

  // "Start here" / "End here" from wherever the preview is paused.
  markStart = () => {
    this.start = clamp(
      this.player?.currentTime ?? 0,
      0,
      Math.max(0, this.end - 0.1),
    );
  };

  markEnd = () => {
    this.end = clamp(
      this.player?.currentTime ?? this.duration,
      this.start + 0.1,
      this.duration,
    );
  };

  seek(time) {
    if (this.player) this.player.currentTime = time;
  }

  playSelection = () => {
    if (!this.player) return;
    this.seek(this.start);
    this.player.play();
  };

  // Stop at the end of the piece you picked, rather than playing on.
  watch = (e) => {
    const player = e.target;
    if (player.currentTime >= this.end && !player.paused) player.pause();
  };

  reset = () => {
    this.clearUrls();
    this.file =
      this.url =
      this.resultUrl =
      this.resultName =
      this.resultSize =
        null;
    this.duration = this.start = this.end = 0;
    this.error = null;
  };

  cut = async () => {
    if (!this.canCut) return;
    this.busy = true;
    this.error = null;
    this.progress = 0;
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    this.resultUrl = null;
    const ext = extOf(this.file.name);
    const exact = this.mode === 'exact';
    try {
      const blob = await runFFmpeg(this.file, {
        out: ext,
        type: this.file.type || '',
        duration: this.span,
        // -ss before -i seeks fast; copy keeps the streams, otherwise it's re-encoded for a frame-exact cut.
        build: (input) => [
          '-ss',
          ffmpegTime(this.start),
          '-to',
          ffmpegTime(this.end),
          '-i',
          input,
          ...(exact ? ['-c:a', 'aac'] : ['-c', 'copy']),
          '-avoid_negative_ts',
          'make_zero',
        ],
        onStatus: (status) => (this.status = status),
        onProgress: (progress) => (this.progress = progress),
      });
      this.resultUrl = URL.createObjectURL(blob);
      this.resultName = `${baseName(this.file.name)}-trimmed.${ext}`;
      this.resultSize = blob.size;
    } catch (error) {
      this.error = error?.message || 'Couldn’t trim this one';
    } finally {
      this.busy = false;
      this.status = '';
    }
  };

  <template>
    <ToolPage
      @route="trimmer"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Cut a piece out of a video or a song. Pick the start and end, hear or see it first, then save just that bit."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="scissors" @size={{22}} />
            <span>{{if
                this.dragging
                "Drop it here"
                "Drop a video or an audio file, paste it, or click to browse"
              }}</span>
            <input
              type="file"
              accept="video/*,audio/*"
              class="sr-only"
              {{on "change" this.selectFile}}
            />
          </label>
          {{#unless this.file}}
            <p class="tool-hint">Works with videos and music alike. The engine
              downloads the first time you use it (about 30 MB), then stays
              cached for the visit.</p>
          {{/unless}}
        </div>

        {{#if this.file}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <h3 class="qr-heading">{{this.file.name}}</h3>
              <span class="tool-hint">{{formatBytes this.file.size}}
                ·
                {{formatTime this.duration}}</span>
            </div>

            {{#if this.isAudio}}
              {{! template-lint-disable require-media-caption }}
              <audio
                class="trim-player"
                controls
                src={{this.url}}
                {{this.keepPlayer}}
                {{on "timeupdate" this.watch}}
              ></audio>
            {{else}}
              {{! template-lint-disable require-media-caption }}
              <video
                class="trim-player"
                controls
                src={{this.url}}
                {{this.keepPlayer}}
                {{on "timeupdate" this.watch}}
              ></video>
            {{/if}}

            <div class="trim-track" aria-hidden="true">
              <span class="trim-band" style={{this.bandStyle}}></span>
            </div>
            <label class="math-field">
              <span class="qr-label is-muted">Start:
                {{formatTime this.start}}</span>
              <input
                type="range"
                min="0"
                max={{this.duration}}
                step="0.05"
                value={{this.start}}
                {{on "input" this.setStart}}
              />
            </label>
            <label class="math-field">
              <span class="qr-label is-muted">End:
                {{formatTime this.end}}</span>
              <input
                type="range"
                min="0"
                max={{this.duration}}
                step="0.05"
                value={{this.end}}
                {{on "input" this.setEnd}}
              />
            </label>

            <div class="settings-actions">
              <button
                type="button"
                class="btn"
                {{on "click" this.markStart}}
              ><Icon @name="circle-dot" @size={{13}} /> Start here</button>
              <button
                type="button"
                class="btn"
                {{on "click" this.markEnd}}
              ><Icon @name="circle-dot" @size={{13}} /> End here</button>
              <button
                type="button"
                class="btn"
                {{on "click" this.playSelection}}
              ><Icon @name="play" @size={{13}} /> Play the bit</button>
            </div>

            <div class="math-tabs" role="group" aria-label="How to cut">
              <button
                type="button"
                class="qr-tab {{if (eq this.mode 'copy') 'active'}}"
                {{on "click" (fn this.setMode "copy")}}
              >Quick (no re-encoding)</button>
              <button
                type="button"
                class="qr-tab {{if (eq this.mode 'exact') 'active'}}"
                {{on "click" (fn this.setMode "exact")}}
              >Exact cut</button>
            </div>
            <p class="tool-hint">
              {{if
                (eq this.mode "copy")
                "Quick copies the streams as they are, so nothing is lost, but a video can only start on a keyframe: the beginning may land up to a second early."
                "Exact re-encodes the sound so the cut lands where you put it, to the frame. Slower, and very slightly lossy."
              }}
            </p>

            <div class="fc-toolbar">
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn active"
                  disabled={{if this.canCut false true}}
                  {{on "click" this.cut}}
                >{{if this.busy "Cutting…" "Cut it"}}</button>
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.reset}}
                >Start over</button>
              </div>
              <span class="tool-hint">Keeping
                {{formatTime this.span}}
                of
                {{formatTime this.duration}}</span>
            </div>

            {{#if this.busy}}
              <div class="fs-progress"><div
                  class="fs-progress-bar"
                  style={{progressWidth this.progress}}
                ></div></div>
              {{#if this.status}}<p class="tool-hint">{{this.status}}</p>{{/if}}
            {{/if}}
            {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}

            {{#if this.resultUrl}}
              <div class="fs-row fc-row">
                <Icon @name="scissors" @size={{16}} />
                <div class="fs-row-info">
                  <span class="fs-row-name">{{this.resultName}}</span>
                  <span class="fs-row-size">{{formatBytes this.resultSize}}
                    ·
                    {{formatTime this.span}}</span>
                </div>
                <div class="fs-row-status">
                  <a
                    class="btn fs-save"
                    href={{this.resultUrl}}
                    download={{this.resultName}}
                  ><Icon @name="download" @size={{13}} /> Save</a>
                </div>
              </div>
            {{/if}}
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}

function eq(a, b) {
  return a === b;
}
