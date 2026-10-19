<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
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
  } from '../utils/converters/index.js';
  import { formatBytes } from '../utils/file-share.js';
  import {
    collectDrop,
    groupByFolder,
    zipFolder,
  } from '../utils/folder-zip.js';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import PrintButton from './print-button.svelte';

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
  const progressWidth = (p) => `width:${Math.round((p ?? 0) * 100)}%`;

  // Every format anything can be read from, for the "supported formats" list.
  const SUPPORTED = CATEGORY_ORDER.map((category) => ({
    label: categoryLabel(category),
    names: formatsIn(category)
      .filter((f) => canConvert(f.ext))
      .map((f) => f.label)
      .join(', '),
  })).filter((group) => group.names);

  let nextId = 1;

  class FileConverterPage extends Component {
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
    items = $state.raw([]);
    dragging = $state.raw(false);
    zipStatus = $state.raw('');

    supported = SUPPORTED;

    constructor(args) {
      super(args);
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
  }

  function icon(source) {
    return ICON_BY_CATEGORY[source?.category] ?? 'file';
  }

  function via(item) {
    return item.source && item.target
      ? routeDescription(item.source.ext, item.target)
      : null;
  }
</script>

<script>
  let args = $props();
  const self = new FileConverterPage(args);
  onDestroy(() => destroy(self));
</script>

{#snippet ConvertRow(args)}
  <li class="fs-row fc-row">
    <Icon name={icon(args.item?.source)} size={16} />
    <div class="fs-row-info">
      <span class="fs-row-name">{args.item?.file?.name}</span>
      <span class="fs-row-size">
        {truthy(args.item?.source) ? args.item?.source?.label : 'Unknown type'}
        ·
        {formatBytes(args.item?.file?.size)}{#if truthy(args.item?.resultSize)}
          →
          {formatBytes(args.item?.resultSize)}{/if}
      </span>
      {#if truthy(eq(args.item?.status, 'error'))}
        <span class="tool-error">{args.item?.error}</span>
      {:else if truthy(eq(args.item?.status, 'working'))}
        <span class="fs-row-size">{args.item?.statusText}</span>
      {:else if truthy(eq(args.item?.status, 'ready'))}
        {#if true}{@const route = via(args.item)}
          {#if truthy(route)}<span class="fs-row-size">via {route}</span>{/if}
        {/if}
      {/if}
    </div>
    <div class="fs-row-status">
      {#if truthy(eq(args.item?.status, 'unsupported'))}
        <span class="fs-tag is-error"
          ><Icon name="circle-alert" size={13} />
          Not supported yet</span
        >
      {:else if truthy(eq(args.item?.status, 'working'))}
        <div class="fs-progress"
          ><div
            class="fs-progress-bar"
            style={progressWidth(args.item?.progress)}
          ></div></div
        >
      {:else if truthy(eq(args.item?.status, 'done'))}
        <a
          class="btn fs-save"
          href={args.item?.resultUrl}
          download={args.item?.resultName}
          ><Icon name="download" size={13} /> Save</a
        >
        <PrintButton url={args.item?.resultUrl} name={args.item?.resultName} />
        <button type="button" class="btn" onclick={args.onReset}>Again</button>
      {:else}
        <select
          class="select"
          aria-label="Convert {args.item?.file?.name} to"
          onchange={args.onSetTarget}
        >
          {#each args.item?.groups ?? [] as group}
            <optgroup label={group?.label}>
              {#each group?.formats ?? [] as f}
                <option
                  value={f?.ext}
                  {@attach prop('selected', () =>
                    eq(args.item?.target, f?.ext),
                  )}>{f?.label}</option
                >
              {/each}
            </optgroup>
          {/each}
        </select>
        <button type="button" class="btn active" onclick={args.onConvert}
          >{truthy(eq(args.item?.status, 'error'))
            ? 'Retry'
            : 'Convert'}</button
        >
      {/if}
    </div>
    <button
      type="button"
      class="fs-remove"
      aria-label="Remove {args.item?.file?.name}"
      onclick={args.onRemove}><Icon name="x" size={13} /></button
    >
  </li>
{/snippet}

<ToolPage
  route="file-converter"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Images, RAW photos, audio, video, documents, data, archives, fonts… pick a format and convert. It all runs on your device."
>
  <div class="fs" {@attach acceptPastedFiles([self.pasteFiles])}>
    <div class="fs-frame fc-panel pop-in">
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.dropFiles}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="file-symlink" size={22} />
        <span
          >{truthy(self.dragging)
            ? 'Drop them here'
            : 'Drop any files or folders, or click to browse'}</span
        >
        <input
          type="file"
          multiple
          class="sr-only"
          onchange={self.selectFiles}
        />
      </label>
      <label class="btn fc-folder">
        <Icon name="folder" size={14} />
        Add a folder
        <input
          type="file"
          webkitdirectory
          directory
          multiple
          class="sr-only"
          onchange={self.selectFolder}
        />
      </label>
      {#if truthy(self.zipStatus)}<p class="tool-hint">{self.zipStatus}</p>{/if}
      <p class="tool-hint"
        >Drop a folder and it's zipped for you, ready to convert or save. Big
        engines (images, audio/video, documents) download the first time you
        need them, then stay cached for the visit.</p
      >
    </div>

    {#if truthy(self.items?.length)}
      <div class="fs-frame fc-panel pop-in">
        <div class="fc-toolbar">
          <h3 class="qr-heading">Files</h3>
          <div class="settings-actions">
            {#if truthy(self.canConvertAll)}
              <button type="button" class="btn active" onclick={self.convertAll}
                >Convert all</button
              >
            {/if}
            <button type="button" class="btn" onclick={self.clearAll}
              >Clear</button
            >
          </div>
        </div>
        <ul class="fs-list">
          {#each self.items ?? [] as item (item?.id)}
            {@render ConvertRow({
              item: item,
              onSetTarget: (..._r) => self.setTarget(item?.id, ..._r),
              onConvert: (..._r) => self.convert(item?.id, ..._r),
              onReset: (..._r) => self.reset(item?.id, ..._r),
              onRemove: (..._r) => self.remove(item?.id, ..._r),
            })}
          {/each}
        </ul>
      </div>
    {/if}

    <div class="fc-panel pop-in">
      <h3 class="qr-heading">Supported formats</h3>
      <p class="tool-hint"
        >Anything below can be read. If there's no single tool for a pair, the
        converter chains a few together (DOCX → text → PDF, say) and shows the
        route.</p
      >
      <dl class="fc-formats">
        {#each self.supported ?? [] as group}
          <dt class="qr-label">{group?.label}</dt>
          <dd class="tool-hint">{group?.names}</dd>
        {/each}
      </dl>
    </div>
  </div>
</ToolPage>
