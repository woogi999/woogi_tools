import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn, get } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { acceptPastedFiles } from '../utils/paste-files';
import { formatBytes } from '../utils/file-share';
import {
  readMetadata,
  stripImage,
  isStrippableImage,
  extOf,
} from '../utils/metadata';
import { runFFmpeg, baseName } from '../utils/media-jobs';

// Shows what's hidden inside your files: camera, software, and often the exact
// spot you took the photo, and takes it back out again.

const MEDIA = [
  'mp3',
  'm4a',
  'wav',
  'flac',
  'ogg',
  'opus',
  'mp4',
  'mkv',
  'mov',
  'webm',
  'avi',
  'm4v',
];
const TAG_FIELDS = [
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
  { id: 'album', label: 'Album' },
  { id: 'comment', label: 'Comment' },
];
let nextId = 1;

export default class MetadataEditorPage extends Component {
  // While this is true, leaving the page floats the tool in a PiP window
  // instead of tearing it down, so the work carries on (see services/pip.js).
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close the Metadata Editor? The file being processed will be lost.';
  }
  @tracked items = [];
  @tracked dragging = false;
  @tracked busy = false;
  @tracked tags = { title: '', artist: '', album: '', comment: '' };
  @tracked error = null;

  tagFields = TAG_FIELDS;

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

  get anyMedia() {
    return this.items.some((i) => i.media);
  }

  async addFiles(list) {
    const files = [...list];
    if (!files.length) return;
    for (const file of files) {
      const media = MEDIA.includes(extOf(file.name));
      const item = {
        id: nextId++,
        file,
        media,
        image: isStrippableImage(file.name),
        fields: [],
        url: null,
        name: null,
        size: null,
        status: '',
        error: null,
      };
      this.items = [...this.items, item];
      if (item.image) {
        try {
          const { fields } = await readMetadata(file);
          this.update(item.id, { fields });
        } catch {
          this.update(item.id, {
            error: 'Couldn’t read what’s inside this one',
          });
        }
      }
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
  setTag = (key, event) =>
    (this.tags = { ...this.tags, [key]: event.target.value });

  remove = (id) => {
    const item = this.items.find((i) => i.id === id);
    if (item?.url) URL.revokeObjectURL(item.url);
    this.items = this.items.filter((i) => i.id !== id);
  };

  clear = () => {
    this.revokeAll();
    this.items = [];
  };

  stripAll = () => this.runAll(false);
  writeTags = () => this.runAll(true);

  async runAll(withTags) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    for (const item of this.items) await this.handle(item, withTags);
    this.busy = false;
  }

  async handle(item, withTags) {
    if (item.url) URL.revokeObjectURL(item.url);
    this.update(item.id, { url: null, error: null, status: 'Working…' });
    try {
      if (item.image) {
        // Straight surgery on the file's blocks: the picture data is untouched.
        const blob = await stripImage(item.file);
        if (!blob) throw new Error('This image couldn’t be cleaned');
        this.update(item.id, {
          url: URL.createObjectURL(blob),
          name: `${baseName(item.file.name)}-clean.${extOf(item.file.name)}`,
          size: blob.size,
          status: '',
          fields: [],
        });
        return;
      }
      if (item.media) {
        const ext = extOf(item.file.name);
        const tagArgs = withTags
          ? TAG_FIELDS.flatMap((f) =>
              this.tags[f.id]
                ? ['-metadata', `${f.id}=${this.tags[f.id]}`]
                : [],
            )
          : [];
        const blob = await runFFmpeg(item.file, {
          out: ext,
          type: item.file.type || '',
          build: (input) => [
            '-i',
            input,
            '-map_metadata',
            '-1',
            '-c',
            'copy',
            ...tagArgs,
          ],
          onStatus: (status) => this.update(item.id, { status }),
        });
        this.update(item.id, {
          url: URL.createObjectURL(blob),
          name: `${baseName(item.file.name)}-clean.${ext}`,
          size: blob.size,
          status: '',
        });
        return;
      }
      this.update(item.id, {
        error: 'Nothing this tool can do with this sort of file yet',
        status: '',
      });
    } catch (error) {
      this.update(item.id, {
        error: error?.message ?? 'Couldn’t clean this one',
        status: '',
      });
    }
  }

  <template>
    <ToolPage
      @route="metadata-editor"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="See what's hidden inside your photos and media (camera, software, even where you were standing) and strip it out before you share."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="shield" @size={{22}} />
            <span>{{if
                this.dragging
                "Drop them here"
                "Drop photos or media, paste them, or click to browse"
              }}</span>
            <input
              type="file"
              multiple
              class="sr-only"
              {{on "change" this.selectFiles}}
            />
          </label>
          <p class="tool-hint">JPEG and PNG are cleaned by cutting the metadata
            blocks straight out, so the picture itself isn't touched or
            re-encoded, so nothing is lost. Audio and video are rewritten with
            their tags dropped, streams copied.</p>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
        </div>

        {{#if this.items.length}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <h3 class="qr-heading">Files</h3>
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn active"
                  disabled={{this.busy}}
                  {{on "click" this.stripAll}}
                >{{if this.busy "Working…" "Strip it all out"}}</button>
                {{#if this.anyMedia}}
                  <button
                    type="button"
                    class="btn"
                    disabled={{this.busy}}
                    {{on "click" this.writeTags}}
                  >Strip, then write my tags</button>
                {{/if}}
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.clear}}
                >Clear</button>
              </div>
            </div>

            {{#if this.anyMedia}}
              <div class="math-row">
                {{#each this.tagFields as |f|}}
                  <label class="math-field">
                    <span class="qr-label is-muted">{{f.label}}</span>
                    <input
                      type="text"
                      class="math-input"
                      value={{get this.tags f.id}}
                      {{on "input" (fn this.setTag f.id)}}
                    />
                  </label>
                {{/each}}
              </div>
              <p class="tool-hint">These are written onto the audio and video
                files only, after the old tags are cleared. Leave them blank to
                just strip.</p>
            {{/if}}

            <ul class="fs-list">
              {{#each this.items key="id" as |item|}}
                <li class="fs-row fc-row is-stacked">
                  <div class="fs-row-info">
                    <span class="fs-row-name">{{item.file.name}}</span>
                    <span class="fs-row-size">{{formatBytes
                        item.file.size
                      }}{{#if item.size}}
                        →
                        {{formatBytes item.size}}{{/if}}</span>
                    {{#if item.error}}
                      <span class="tool-error">{{item.error}}</span>
                    {{else if item.status}}
                      <span class="fs-row-size">{{item.status}}</span>
                    {{else if item.fields.length}}
                      <ul class="meta-list">
                        {{#each item.fields key="name" as |field|}}
                          <li class="meta-field"><span
                              class="qr-label is-muted"
                            >{{field.name}}</span><span
                              class="meta-value"
                            >{{field.value}}</span></li>
                        {{/each}}
                      </ul>
                    {{else if item.image}}
                      <span class="fs-row-size">Nothing hidden in here.</span>
                    {{else if item.media}}
                      <span class="fs-row-size">Audio or video: tags are cleared
                        when you strip it.</span>
                    {{/if}}
                  </div>
                  <div class="fs-row-status">
                    {{#if item.url}}<a
                        class="btn fs-save"
                        href={{item.url}}
                        download={{item.name}}
                      ><Icon @name="download" @size={{13}} />
                        Save clean copy</a>{{/if}}
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
