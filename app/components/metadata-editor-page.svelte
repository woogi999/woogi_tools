<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import { formatBytes } from '../utils/file-share.js';
  import {
    readMetadata,
    stripImage,
    isStrippableImage,
    extOf,
  } from '../utils/metadata.js';
  import { runFFmpeg, baseName } from '../utils/media-jobs.js';

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

  class MetadataEditorPage extends Component {
    // While this is true, leaving the page floats the tool in a PiP window
    // instead of tearing it down, so the work carries on (see services/pip.js).
    get pipBusy() {
      return this.busy;
    }

    get pipWarning() {
      return 'Close the Metadata Editor? The file being processed will be lost.';
    }
    items = $state.raw([]);
    dragging = $state.raw(false);
    busy = $state.raw(false);
    tags = $state.raw({ title: '', artist: '', album: '', comment: '' });
    error = $state.raw(null);

    tagFields = TAG_FIELDS;

    constructor(args) {
      super(args);
      registerDestructor(this, () => this.revokeAll());
    }

    revokeAll() {
      for (const item of this.items)
        if (item.url) URL.revokeObjectURL(item.url);
    }

    update(id, patch) {
      this.items = this.items.map((i) =>
        i.id === id ? { ...i, ...patch } : i,
      );
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
  }
</script>

<script>
  let args = $props();
  const self = new MetadataEditorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="metadata-editor"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="See what's hidden inside your photos and media (camera, software, even where you were standing) and strip it out before you share."
>
  <div class="fs" {@attach acceptPastedFiles([self.pasteFiles])}>
    <div class="fs-frame fc-panel pop-in">
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.drop}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="shield" size={22} />
        <span
          >{truthy(self.dragging)
            ? 'Drop them here'
            : 'Drop photos or media, paste them, or click to browse'}</span
        >
        <input
          type="file"
          multiple
          class="sr-only"
          onchange={self.selectFiles}
        />
      </label>
      <p class="tool-hint"
        >JPEG and PNG are cleaned by cutting the metadata blocks straight out,
        so the picture itself isn't touched or re-encoded, so nothing is lost.
        Audio and video are rewritten with their tags dropped, streams copied.</p
      >
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
    </div>

    {#if truthy(self.items?.length)}
      <div class="fs-frame fc-panel pop-in">
        <div class="fc-toolbar">
          <h3 class="qr-heading">Files</h3>
          <div class="settings-actions">
            <button
              type="button"
              class="btn active"
              disabled={self.busy}
              onclick={self.stripAll}
              >{truthy(self.busy) ? 'Working…' : 'Strip it all out'}</button
            >
            {#if truthy(self.anyMedia)}
              <button
                type="button"
                class="btn"
                disabled={self.busy}
                onclick={self.writeTags}>Strip, then write my tags</button
              >
            {/if}
            <button type="button" class="btn" onclick={self.clear}>Clear</button
            >
          </div>
        </div>

        {#if truthy(self.anyMedia)}
          <div class="math-row">
            {#each self.tagFields ?? [] as f}
              <label class="math-field">
                <span class="qr-label is-muted">{f?.label}</span>
                <input
                  type="text"
                  class="math-input"
                  {@attach prop('value', () => self.tags?.[f?.id])}
                  oninput={(..._r) => self.setTag(f?.id, ..._r)}
                />
              </label>
            {/each}
          </div>
          <p class="tool-hint"
            >These are written onto the audio and video files only, after the
            old tags are cleared. Leave them blank to just strip.</p
          >
        {/if}

        <ul class="fs-list">
          {#each self.items ?? [] as item (item?.id)}
            <li class="fs-row fc-row is-stacked">
              <div class="fs-row-info">
                <span class="fs-row-name">{item?.file?.name}</span>
                <span class="fs-row-size"
                  >{formatBytes(item?.file?.size)}{#if truthy(item?.size)}
                    →
                    {formatBytes(item?.size)}{/if}</span
                >
                {#if truthy(item?.error)}
                  <span class="tool-error">{item?.error}</span>
                {:else if truthy(item?.status)}
                  <span class="fs-row-size">{item?.status}</span>
                {:else if truthy(item?.fields?.length)}
                  <ul class="meta-list">
                    {#each item?.fields ?? [] as field}
                      <li class="meta-field"
                        ><span class="qr-label is-muted">{field?.name}</span
                        ><span class="meta-value">{field?.value}</span></li
                      >
                    {/each}
                  </ul>
                {:else if truthy(item?.image)}
                  <span class="fs-row-size">Nothing hidden in here.</span>
                {:else if truthy(item?.media)}
                  <span class="fs-row-size"
                    >Audio or video: tags are cleared when you strip it.</span
                  >
                {/if}
              </div>
              <div class="fs-row-status">
                {#if truthy(item?.url)}<a
                    class="btn fs-save"
                    href={item?.url}
                    download={item?.name}
                    ><Icon name="download" size={13} />
                    Save clean copy</a
                  >{/if}
              </div>
              <button
                type="button"
                class="fs-remove"
                aria-label="Remove {item?.file?.name}"
                onclick={(..._r) => self.remove(item?.id, ..._r)}
                ><Icon name="x" size={13} /></button
              >
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
</ToolPage>
