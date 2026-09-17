import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import {
  runFFmpeg,
  baseName,
  mediaInfo,
  formatTime,
} from '../utils/media-jobs';
import { acceptPastedFiles } from '../utils/paste-files';
import { formatBytes } from '../utils/file-share';

// Takes the sound off a video and leaves the picture alone: the video stream is
// copied across untouched, so there's no quality lost and it's quick.

const progressWidth = (p) => htmlSafe(`width:${Math.round((p ?? 0) * 100)}%`);
const extOf = (name) => (name.split('.').pop() || 'mp4').toLowerCase();
let nextId = 1;

export default class VideoMuterPage extends Component {
  // While this is true, leaving the page floats the tool in a PiP window
  // instead of tearing it down, so the work carries on (see services/pip.js).
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close the Video Muter? The job in progress will be cancelled.';
  }
  @tracked items = [];
  @tracked dragging = false;
  @tracked busy = false;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.revokeAll());
  }

  revokeAll() {
    for (const item of this.items) if (item.url) URL.revokeObjectURL(item.url);
  }

  update(id, patch) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
  }

  async addFiles(list) {
    const files = [...list].filter(
      (f) =>
        f.type.startsWith('video/') ||
        /\.(mp4|mkv|mov|webm|avi|m4v|flv|wmv|ts|mpg|mpeg|gif)$/i.test(f.name),
    );
    if (!files.length) return;
    const added = files.map((file) => ({
      id: nextId++,
      file,
      url: null,
      name: null,
      size: null,
      status: '',
      progress: 0,
      error: null,
      duration: 0,
      hasAudio: undefined,
    }));
    this.items = [...this.items, ...added];
    for (const item of added) {
      const info = await mediaInfo(item.file);
      this.update(item.id, {
        duration: info.duration,
        hasAudio: info.hasAudio,
      });
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

  remove = (id) => {
    const item = this.items.find((i) => i.id === id);
    if (item?.url) URL.revokeObjectURL(item.url);
    this.items = this.items.filter((i) => i.id !== id);
  };

  clear = () => {
    this.revokeAll();
    this.items = [];
  };

  muteAll = async () => {
    if (this.busy) return;
    this.busy = true;
    for (const item of this.items) {
      if (!item.url) await this.mute(item.id);
    }
    this.busy = false;
  };

  mute = async (id) => {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    if (item.url) URL.revokeObjectURL(item.url);
    this.update(id, { url: null, error: null, progress: 0, status: 'Queued…' });
    const ext = extOf(item.file.name);
    try {
      const blob = await runFFmpeg(item.file, {
        out: ext,
        type: item.file.type || `video/${ext}`,
        duration: item.duration,
        // -an drops every sound track; -c copy leaves the picture exactly as it was.
        build: (input) => ['-i', input, '-c', 'copy', '-an'],
        onStatus: (status) => this.update(id, { status }),
        onProgress: (progress) => this.update(id, { progress }),
      });
      this.update(id, {
        url: URL.createObjectURL(blob),
        name: `${baseName(item.file.name)}-muted.${ext}`,
        size: blob.size,
        status: '',
        progress: 1,
      });
    } catch (error) {
      this.update(id, {
        error: error?.message || 'Couldn’t mute this one',
        status: '',
      });
    }
  };

  <template>
    <ToolPage
      @route="video-muter"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Strip the sound off a video and keep the picture exactly as it was. Quick, lossless and all on your device."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="volume-x" @size={{22}} />
            <span>{{if
                this.dragging
                "Drop them here"
                "Drop videos, paste them, or click to browse"
              }}</span>
            <input
              type="file"
              accept="video/*"
              multiple
              class="sr-only"
              {{on "change" this.selectFiles}}
            />
          </label>
          <p class="tool-hint">The picture is copied over frame for frame, so
            nothing is re-encoded and nothing is lost: only the sound goes. The
            engine downloads the first time you use it (about 30 MB), then stays
            cached for the visit.</p>
        </div>

        {{#if this.items.length}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <h3 class="qr-heading">Videos</h3>
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn active"
                  disabled={{this.busy}}
                  {{on "click" this.muteAll}}
                >{{if this.busy "Working…" "Mute them"}}</button>
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
                  <Icon @name="video" @size={{16}} />
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{item.file.name}}</span>
                    <span class="fs-row-size">
                      {{formatBytes item.file.size}}{{#if item.duration}}
                        ·
                        {{formatTime item.duration}}{{/if}}{{#if item.size}}
                        →
                        {{formatBytes item.size}}{{/if}}
                    </span>
                    {{#if item.error}}
                      <span class="tool-error">{{item.error}}</span>
                    {{else if item.status}}
                      <span class="fs-row-size">{{item.status}}</span>
                    {{else if (eq item.hasAudio false)}}
                      <span class="fs-row-size">This one has no sound already.</span>
                    {{/if}}
                  </div>
                  <div class="fs-row-status">
                    {{#if item.url}}
                      {{! template-lint-disable require-media-caption }}
                      <video
                        class="media-preview"
                        controls
                        src={{item.url}}
                      ></video>
                      <a
                        class="btn fs-save"
                        href={{item.url}}
                        download={{item.name}}
                      ><Icon @name="download" @size={{13}} /> Save</a>
                    {{else if item.status}}
                      <div class="fs-progress"><div
                          class="fs-progress-bar"
                          style={{progressWidth item.progress}}
                        ></div></div>
                    {{else}}
                      <button
                        type="button"
                        class="btn"
                        {{on "click" (fn this.mute item.id)}}
                      >{{if item.error "Retry" "Mute"}}</button>
                    {{/if}}
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

function eq(a, b) {
  return a === b;
}
