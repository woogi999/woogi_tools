import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import ColourField from './colour-field';
import { acceptPastedFiles } from '../utils/paste-files';
import { formatBytes } from '../utils/file-share';
import {
  runFFmpeg,
  baseName,
  mediaInfo,
  formatTime,
} from '../utils/media-jobs';
import { toSrt, parseSubtitles, clock } from '../utils/subtitles';
import { takeHandoff } from '../utils/handoff';
import { keepState } from '../utils/tool-state';

// Burns subtitles into the picture itself, so they show up in any player and
// can't be switched off. Auto Subtitle can send its lines straight here.

const POSITIONS = [
  { id: 'bottom', label: 'Bottom', align: 2 },
  { id: 'top', label: 'Top', align: 8 },
  { id: 'middle', label: 'Middle', align: 5 },
];
const BACKDROPS = [
  { id: 'outline', label: 'Outline' },
  { id: 'box', label: 'Dark box' },
  { id: 'none', label: 'Plain' },
];
const eq = (a, b) => a === b;
const progressWidth = (p) => htmlSafe(`width:${Math.round((p ?? 0) * 100)}%`);
const isVideo = (file) =>
  file.type.startsWith('video/') ||
  /\.(mp4|mkv|mov|webm|avi|m4v|ts|mpg|mpeg)$/i.test(file.name);
const isSubs = (file) => /\.(srt|vtt)$/i.test(file.name);

// libass writes colours back to front: &HAABBGGRR.
function assColour(hex, alpha = 0) {
  const [r, g, b] = [1, 3, 5].map((i) => hex.slice(i, i + 2));
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

export default class SubtitleBakerPage extends Component {
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close the Subtitle Baker? The video being written will be lost.';
  }
  @tracked file = null;
  @tracked mediaUrl = null;
  @tracked duration = 0;
  @tracked width = 0;
  @tracked height = 0;
  @tracked cues = [];
  @tracked subsName = '';
  @tracked fontSize = 5;
  @tracked colour = '#FFFFFF';
  @tracked outlineColour = '#000000';
  @tracked backdrop = 'outline';
  @tracked position = 'bottom';
  @tracked margin = 4;
  @tracked bold = true;
  @tracked busy = false;
  @tracked status = '';
  @tracked progress = 0;
  @tracked error = null;
  @tracked dragging = false;
  @tracked resultUrl = null;
  @tracked resultSize = 0;

  positions = POSITIONS;
  backdrops = BACKDROPS;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'subtitle-baker', [
      'fontSize',
      'colour',
      'outlineColour',
      'backdrop',
      'position',
      'margin',
      'bold',
    ]);
    registerDestructor(this, () => this.clearUrls());
    const parcel = takeHandoff('subtitle-baker');
    if (parcel) {
      queueMicrotask(() => {
        this.open(parcel.file);
        this.cues = parcel.cues;
        this.subsName = 'from Auto Subtitle';
      });
    }
  }

  clearUrls() {
    if (this.mediaUrl) URL.revokeObjectURL(this.mediaUrl);
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
  }

  get resultName() {
    return `${baseName(this.file?.name ?? 'video')}-subtitled.mp4`;
  }

  get ready() {
    return Boolean(this.file && this.cues.length && !this.busy);
  }

  get notReady() {
    return !this.ready;
  }

  // Preview text sized like the real thing: the font size is a share of the height.
  get previewStyle() {
    const align = POSITIONS.find((p) => p.id === this.position) ?? POSITIONS[0];
    const place =
      align.id === 'top'
        ? `top:${this.margin}%`
        : align.id === 'middle'
          ? 'top:50%;transform:translateY(-50%)'
          : `bottom:${this.margin}%`;
    const shadow =
      this.backdrop === 'outline'
        ? `text-shadow:0 0 0.12em ${this.outlineColour},0 0 0.12em ${this.outlineColour},0.06em 0.06em 0 ${this.outlineColour},-0.06em -0.06em 0 ${this.outlineColour};`
        : '';
    const box =
      this.backdrop === 'box'
        ? 'background:rgba(0,0,0,0.65);padding:0.1em 0.3em;'
        : '';
    return htmlSafe(
      `${place};font-size:${this.fontSize * 1.6}cqh;color:${this.colour};font-weight:${this.bold ? 700 : 400};${shadow}${box}`,
    );
  }

  get previewLine() {
    return this.cues[0]?.text ?? 'Your subtitles will look like this';
  }

  async open(file) {
    if (!file) return;
    if (isSubs(file)) return this.openSubs(file);
    if (!isVideo(file)) {
      this.error = 'That doesn’t look like a video or a subtitle file.';
      return;
    }
    if (this.mediaUrl) URL.revokeObjectURL(this.mediaUrl);
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    this.resultUrl = null;
    this.error = null;
    this.file = file;
    this.mediaUrl = URL.createObjectURL(file);
    const info = await mediaInfo(file);
    this.duration = info.duration || 0;
    this.width = info.width;
    this.height = info.height;
  }

  async openSubs(file) {
    const cues = parseSubtitles(await file.text());
    if (!cues.length) {
      this.error = 'No lines could be read from that subtitle file.';
      return;
    }
    this.cues = cues;
    this.subsName = file.name;
    this.error = null;
    this.resultUrl = null;
  }

  addFiles(list) {
    for (const file of [...list]) this.open(file);
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
  pick = (key, value) => {
    this[key] = value;
    this.resultUrl = null;
  };
  number = (key, event) => this.pick(key, Number(event.target.value) || 0);
  setColour = (value) => this.pick('colour', value);
  setOutline = (value) => this.pick('outlineColour', value);
  toggleBold = (event) => this.pick('bold', event.target.checked);

  bake = async () => {
    if (!this.ready) return;
    this.busy = true;
    this.error = null;
    this.progress = 0;
    try {
      // The font is packed with the site so libass never has to go looking.
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- a font packed with the site, not app data
      const font = await fetch('/fonts/LiberationSans-Bold.ttf').then((r) =>
        r.ok
          ? r.arrayBuffer()
          : Promise.reject(new Error('The subtitle font couldn’t be loaded')),
      );
      const align = POSITIONS.find((p) => p.id === this.position)?.align ?? 2;
      // ASS sizes are in a 384-high playfield; the margin is a share of the real height.
      const size = Math.round((this.fontSize / 100) * 384 * 1.4);
      const marginV = Math.round((this.margin / 100) * 384);
      const style = [
        'FontName=Liberation Sans',
        `FontSize=${size}`,
        `Bold=${this.bold ? -1 : 0}`,
        `PrimaryColour=${assColour(this.colour)}`,
        // Players disagree on which colour fills an opaque box, so both are set.
        `OutlineColour=${this.backdrop === 'box' ? assColour('#000000', 0.35) : assColour(this.outlineColour)}`,
        `BackColour=${this.backdrop === 'box' ? assColour('#000000', 0.35) : assColour(this.outlineColour, 0.5)}`,
        `BorderStyle=${this.backdrop === 'box' ? 3 : 1}`,
        `Outline=${this.backdrop === 'none' ? 0 : this.backdrop === 'box' ? 4 : 2}`,
        `Shadow=${this.backdrop === 'outline' ? 1 : 0}`,
        `Alignment=${align}`,
        `MarginV=${marginV}`,
        'MarginL=20',
        'MarginR=20',
      ].join(',');
      const blob = await runFFmpeg(this.file, {
        out: 'mp4',
        type: 'video/mp4',
        duration: this.duration,
        extras: [
          {
            name: 'subs.srt',
            data: new TextEncoder().encode(toSrt(this.cues)),
          },
          { name: 'LiberationSans-Bold.ttf', data: new Uint8Array(font) },
        ],
        build: (input) => [
          '-i',
          input,
          '-vf',
          `subtitles=subs.srt:fontsdir=.:force_style='${style}'`,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          '-movflags',
          '+faststart',
        ],
        onProgress: (p) => (this.progress = p),
        onStatus: (s) => (this.status = s),
      });
      if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      this.resultUrl = URL.createObjectURL(blob);
      this.resultSize = blob.size;
    } catch (error) {
      this.error =
        error?.message ?? 'Couldn’t bake the subtitles into this one';
    } finally {
      this.busy = false;
      this.status = '';
    }
  };

  reset = () => {
    this.clearUrls();
    this.file = this.mediaUrl = this.resultUrl = null;
    this.cues = [];
    this.subsName = '';
    this.duration = 0;
    this.error = null;
  };

  <template>
    <ToolPage
      @route="subtitle-baker"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Burns subtitles into a video for good, so they show in every player. Bring a video and an .srt or .vtt, or send the lines over from Auto Subtitle."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="film" @size={{22}} />
            <span>{{if
                this.dragging
                "Drop them here"
                "Drop a video and a subtitle file (.srt or .vtt), or click to browse"
              }}</span>
            <input
              type="file"
              accept="video/*,.srt,.vtt"
              multiple
              class="sr-only"
              {{on "change" this.selectFiles}}
            />
          </label>

          <div class="fc-toolbar">
            <span class="tool-hint">
              {{#if this.file}}
                <Icon @name="film" @size={{12}} />
                {{this.file.name}}
                ·
                {{formatBytes this.file.size}}{{#if this.duration}}
                  ·
                  {{formatTime this.duration}}{{/if}}
              {{else}}
                No video yet
              {{/if}}
            </span>
            <span class="tool-hint">
              {{#if this.cues.length}}
                <Icon @name="captions" @size={{12}} />
                {{this.cues.length}}
                lines ({{this.subsName}})
              {{else}}
                No subtitles yet
              {{/if}}
            </span>
          </div>

          <div class="math-row">
            <label class="math-field"><span class="qr-label is-muted">Size:
                {{this.fontSize}}% of the height</span><input
                type="range"
                min="2"
                max="12"
                step="0.5"
                value={{this.fontSize}}
                {{on "input" (fn this.number "fontSize")}}
              /></label>
            <label class="math-field"><span class="qr-label is-muted">Margin
                from the edge:
                {{this.margin}}%</span><input
                type="range"
                min="0"
                max="30"
                value={{this.margin}}
                {{on "input" (fn this.number "margin")}}
              /></label>
          </div>
          <div class="math-row">
            <ColourField
              @label="Text colour"
              @value={{this.colour}}
              @onChange={{this.setColour}}
            />
            <ColourField
              @label="Outline colour"
              @value={{this.outlineColour}}
              @onChange={{this.setOutline}}
            />
          </div>
          <div class="math-row">
            <label class="math-field">
              <span class="qr-label is-muted">Where</span>
              <div class="math-tabs" role="group" aria-label="Position">
                {{#each this.positions as |p|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.position p.id) 'active'}}"
                    {{on "click" (fn this.pick "position" p.id)}}
                  >{{p.label}}</button>
                {{/each}}
              </div>
            </label>
            <label class="math-field">
              <span class="qr-label is-muted">Behind the words</span>
              <div class="math-tabs" role="group" aria-label="Backdrop">
                {{#each this.backdrops as |b|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.backdrop b.id) 'active'}}"
                    {{on "click" (fn this.pick "backdrop" b.id)}}
                  >{{b.label}}</button>
                {{/each}}
              </div>
            </label>
          </div>
          <label class="math-check"><input
              type="checkbox"
              checked={{this.bold}}
              {{on "change" this.toggleBold}}
            />
            Bold</label>

          <div class="sb-preview">
            {{#if this.mediaUrl}}
              {{! template-lint-disable require-media-caption }}
              <video
                class="sb-preview-video"
                muted
                src={{this.mediaUrl}}
              ></video>
            {{/if}}
            <span
              class="sb-preview-line"
              style={{this.previewStyle}}
            >{{this.previewLine}}</span>
          </div>

          <div class="fc-toolbar">
            <div class="settings-actions">
              <button
                type="button"
                class="btn active"
                disabled={{this.notReady}}
                {{on "click" this.bake}}
              >{{if this.busy "Baking…" "Bake them in"}}</button>
              {{#if this.resultUrl}}
                <a
                  class="btn fs-save"
                  href={{this.resultUrl}}
                  download={{this.resultName}}
                ><Icon @name="download" @size={{13}} />
                  Save ({{formatBytes this.resultSize}})</a>
              {{/if}}
              <button type="button" class="btn" {{on "click" this.reset}}>Start
                over</button>
            </div>
          </div>
          {{#if this.busy}}
            <div class="fs-progress"><div
                class="fs-progress-bar"
                style={{progressWidth this.progress}}
              ></div></div>
            <p class="tool-hint">{{this.status}}
              The whole video is re-encoded, so this takes a while.</p>
          {{/if}}
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
        </div>

        {{#if this.resultUrl}}
          <div class="fs-frame fc-panel pop-in">
            <h3 class="qr-heading">Done</h3>
            {{! template-lint-disable require-media-caption }}
            <video class="trim-player" controls src={{this.resultUrl}}></video>
          </div>
        {{/if}}

        {{#if this.cues.length}}
          <div class="fs-frame fc-panel pop-in">
            <h3 class="qr-heading">The lines</h3>
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
