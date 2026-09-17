import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import {
  detectFormat,
  targetGroups,
  defaultTarget,
  canConvert,
  routeDescription,
  convertFile,
  CATEGORY_ORDER,
  categoryLabel,
  formatsIn,
} from '../utils/converters/index';
import { formatBytes } from '../utils/file-share';
import { collectDrop, groupByFolder, zipFolder } from '../utils/folder-zip';
import { acceptPastedFiles } from '../utils/paste-files';
import PrintButton from './print-button';

const ICON_BY_CATEGORY = {
  image: 'image',
  raw: 'image',
  audio: 'music',
  video: 'video',
  document: 'file-text',
  data: 'braces',
  archive: 'file-archive',
  font: 'type',
};
const eq = (a, b) => a === b;
const progressWidth = (p) => htmlSafe(`width:${Math.round((p ?? 0) * 100)}%`);

// Every format anything can be read from, for the "supported formats" list.
const SUPPORTED = CATEGORY_ORDER.map((category) => ({
  label: categoryLabel(category),
  names: formatsIn(category)
    .filter((f) => canConvert(f.ext))
    .map((f) => f.label)
    .join(', '),
})).filter((group) => group.names);

let nextId = 1;

export default class FileConverterPage extends Component {
  // While this is true, leaving the page floats the tool in a PiP window
  // instead of tearing it down, so the work carries on (see services/pip.js).
  get pipBusy() {
    return (
      this.items.some((it) => it.status === 'working') ||
      Boolean(this.zipStatus)
    );
  }

  get pipWarning() {
    return 'Close the File Converter? The conversion in progress will be cancelled.';
  }
  @tracked items = [];
  @tracked dragging = false;
  @tracked zipStatus = '';

  supported = SUPPORTED;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => {
      for (const item of this.items)
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
  }

  get readyItems() {
    return this.items.filter((it) => it.status === 'ready');
  }

  get canConvertAll() {
    return this.readyItems.length > 1;
  }

  update(id, patch) {
    this.items = this.items.map((it) =>
      it.id === id ? { ...it, ...patch } : it,
    );
  }

  addFiles(fileList) {
    const added = [...fileList].map((file) => {
      const source = detectFormat(file.name);
      const usable = source && canConvert(source.ext);
      return {
        id: `c${nextId++}`,
        file,
        source,
        groups: usable ? targetGroups(source.ext) : [],
        target: usable ? defaultTarget(source) : null,
        status: usable ? 'ready' : 'unsupported',
        statusText: '',
        progress: 0,
        resultUrl: null,
        resultName: null,
        resultSize: null,
        error: null,
      };
    });
    if (added.length) this.items = [...this.items, ...added];
  }

  selectFiles = (event) => {
    this.addFiles(event.target.files);
    event.target.value = '';
  };

  // A picked folder comes through as its files, each with the path it came from.
  selectFolder = (event) => {
    const { loose, folders } = groupByFolder(event.target.files);
    this.addFiles(loose);
    this.addFolders(folders);
    event.target.value = '';
  };

  // Folders can't be converted as they are, so each one is zipped first and the zip joins the list.
  async addFolders(folders) {
    for (const folder of folders) {
      if (!folder.files.length) continue;
      try {
        const file = await zipFolder(folder, {
          onProgress: (p) =>
            (this.zipStatus = `Zipping ${folder.name}… ${Math.round(p * 100)}%`),
        });
        this.addFiles([file]);
      } catch {
        this.zipStatus = `${folder.name} couldn’t be zipped.`;
        setTimeout(() => (this.zipStatus = ''), 4000);
        continue;
      }
      this.zipStatus = '';
    }
  }

  dragOver = (event) => {
    event.preventDefault();
    this.dragging = event.type === 'dragover';
  };

  dropFiles = async (event) => {
    event.preventDefault();
    this.dragging = false;
    const { loose, folders } = await collectDrop(event.dataTransfer);
    this.addFiles(loose);
    this.addFolders(folders);
  };

  setTarget = (id, event) => this.update(id, { target: event.target.value });

  remove = (id) => {
    const item = this.items.find((it) => it.id === id);
    if (item?.resultUrl) URL.revokeObjectURL(item.resultUrl);
    this.items = this.items.filter((it) => it.id !== id);
  };

  clearAll = () => {
    for (const item of this.items)
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    this.items = [];
  };

  // Converting a finished file again (e.g. to a different format) starts it fresh.
  reset = (id) => {
    const item = this.items.find((it) => it.id === id);
    if (item?.resultUrl) URL.revokeObjectURL(item.resultUrl);
    this.update(id, {
      status: 'ready',
      resultUrl: null,
      resultName: null,
      resultSize: null,
      error: null,
      progress: 0,
    });
  };

  convert = async (id) => {
    const item = this.items.find((it) => it.id === id);
    if (!item?.target || item.status === 'working') return;
    this.update(id, {
      status: 'working',
      statusText: 'Starting…',
      progress: 0,
      error: null,
    });
    try {
      const result = await convertFile(item.file, item.source, item.target, {
        onStatus: (statusText) => this.update(id, { statusText }),
        onProgress: (progress) => this.update(id, { progress }),
      });
      this.update(id, {
        status: 'done',
        progress: 1,
        resultUrl: URL.createObjectURL(result.blob),
        resultName: result.name,
        resultSize: result.blob.size,
      });
    } catch (error) {
      this.update(id, {
        status: 'error',
        error: error?.message || 'Conversion failed',
      });
    }
  };

  convertAll = () => this.readyItems.forEach((item) => this.convert(item.id));

  pasteFiles = (files) => this.addFiles(files);

  <template>
    <ToolPage
      @route="file-converter"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Images, RAW photos, audio, video, documents, data, archives, fonts… pick a format and convert. It all runs on your device."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.dropFiles}}
          >
            <Icon @name="file-symlink" @size={{22}} />
            <span>{{if
                this.dragging
                "Drop them here"
                "Drop any files or folders, or click to browse"
              }}</span>
            <input
              type="file"
              multiple
              class="sr-only"
              {{on "change" this.selectFiles}}
            />
          </label>
          <label class="btn fc-folder">
            <Icon @name="folder" @size={{14}} />
            Add a folder
            <input
              type="file"
              webkitdirectory
              directory
              multiple
              class="sr-only"
              {{on "change" this.selectFolder}}
            />
          </label>
          {{#if this.zipStatus}}<p
              class="tool-hint"
            >{{this.zipStatus}}</p>{{/if}}
          <p class="tool-hint">Drop a folder and it's zipped for you, ready to
            convert or save. Big engines (images, audio/video, documents)
            download the first time you need them, then stay cached for the
            visit.</p>
        </div>

        {{#if this.items.length}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <h3 class="qr-heading">Files</h3>
              <div class="settings-actions">
                {{#if this.canConvertAll}}
                  <button
                    type="button"
                    class="btn active"
                    {{on "click" this.convertAll}}
                  >Convert all</button>
                {{/if}}
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.clearAll}}
                >Clear</button>
              </div>
            </div>
            <ul class="fs-list">
              {{#each this.items key="id" as |item|}}
                <ConvertRow
                  @item={{item}}
                  @onSetTarget={{fn this.setTarget item.id}}
                  @onConvert={{fn this.convert item.id}}
                  @onReset={{fn this.reset item.id}}
                  @onRemove={{fn this.remove item.id}}
                />
              {{/each}}
            </ul>
          </div>
        {{/if}}

        <div class="fc-panel pop-in">
          <h3 class="qr-heading">Supported formats</h3>
          <p class="tool-hint">Anything below can be read. If there's no single
            tool for a pair, the converter chains a few together (DOCX → text →
            PDF, say) and shows the route.</p>
          <dl class="fc-formats">
            {{#each this.supported as |group|}}
              <dt class="qr-label">{{group.label}}</dt>
              <dd class="tool-hint">{{group.names}}</dd>
            {{/each}}
          </dl>
        </div>
      </div>
    </ToolPage>
  </template>
}

const ConvertRow = <template>
  <li class="fs-row fc-row">
    <Icon @name={{icon @item.source}} @size={{16}} />
    <div class="fs-row-info">
      <span class="fs-row-name">{{@item.file.name}}</span>
      <span class="fs-row-size">
        {{if @item.source @item.source.label "Unknown type"}}
        ·
        {{formatBytes @item.file.size}}{{#if @item.resultSize}}
          →
          {{formatBytes @item.resultSize}}{{/if}}
      </span>
      {{#if (eq @item.status "error")}}
        <span class="tool-error">{{@item.error}}</span>
      {{else if (eq @item.status "working")}}
        <span class="fs-row-size">{{@item.statusText}}</span>
      {{else if (eq @item.status "ready")}}
        {{#let (via @item) as |route|}}
          {{#if route}}<span class="fs-row-size">via {{route}}</span>{{/if}}
        {{/let}}
      {{/if}}
    </div>
    <div class="fs-row-status">
      {{#if (eq @item.status "unsupported")}}
        <span class="fs-tag is-error"><Icon @name="circle-alert" @size={{13}} />
          Not supported yet</span>
      {{else if (eq @item.status "working")}}
        <div class="fs-progress"><div
            class="fs-progress-bar"
            style={{progressWidth @item.progress}}
          ></div></div>
      {{else if (eq @item.status "done")}}
        <a
          class="btn fs-save"
          href={{@item.resultUrl}}
          download={{@item.resultName}}
        ><Icon @name="download" @size={{13}} /> Save</a>
        <PrintButton @url={{@item.resultUrl}} @name={{@item.resultName}} />
        <button type="button" class="btn" {{on "click" @onReset}}>Again</button>
      {{else}}
        <select
          class="select"
          aria-label="Convert {{@item.file.name}} to"
          {{on "change" @onSetTarget}}
        >
          {{#each @item.groups as |group|}}
            <optgroup label={{group.label}}>
              {{#each group.formats as |f|}}
                <option
                  value={{f.ext}}
                  selected={{eq @item.target f.ext}}
                >{{f.label}}</option>
              {{/each}}
            </optgroup>
          {{/each}}
        </select>
        <button type="button" class="btn active" {{on "click" @onConvert}}>{{if
            (eq @item.status "error")
            "Retry"
            "Convert"
          }}</button>
      {{/if}}
    </div>
    <button
      type="button"
      class="fs-remove"
      aria-label="Remove {{@item.file.name}}"
      {{on "click" @onRemove}}
    ><Icon @name="x" @size={{13}} /></button>
  </li>
</template>;

function icon(source) {
  return ICON_BY_CATEGORY[source?.category] ?? 'file';
}

function via(item) {
  return item.source && item.target
    ? routeDescription(item.source.ext, item.target)
    : null;
}
