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
    runFFmpeg,
    baseName,
    mediaInfo,
    formatTime,
  } from '../utils/media-jobs.js';

  // Evens out how loud things are: a pile of clips that all sit at different
  // volumes come out matching, without you riding a fader.

  const MODES = [
    { id: 'loudness', label: 'Match loudness (EBU R128)' },
    { id: 'peak', label: 'Peak normalise' },
    { id: 'dynamic', label: 'Even out as it goes' },
  ];
  // The loudness levels the streaming lot actually use.
  const TARGETS = [
    { id: -14, label: '−14 LUFS · Spotify, YouTube' },
    { id: -16, label: '−16 LUFS · Apple Podcasts' },
    { id: -19, label: '−19 LUFS · quiet podcasts' },
    { id: -23, label: '−23 LUFS · TV and radio' },
  ];
  const progressWidth = (p) => `width:${Math.round((p ?? 0) * 100)}%`;
  const extOf = (name) => (name.split('.').pop() || 'mp3').toLowerCase();
  const eq = (a, b) => a === b;
  let nextId = 1;

  class AudioNormalizerPage extends Component {
    // While this is true, leaving the page floats the tool in a PiP window
    // instead of tearing it down, so the work carries on (see services/pip.js).
    get pipBusy() {
      return this.busy;
    }

    get pipWarning() {
      return 'Close the Audio Normaliser? The work in progress will be cancelled.';
    }
    items = $state.raw([]);
    dragging = $state.raw(false);
    mode = $state.raw('loudness');
    target = $state.raw(-14);
    peak = $state.raw(-1);
    busy = $state.raw(false);

    modes = MODES;
    targets = TARGETS;

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

    get filter() {
      if (this.mode === 'peak')
        return `loudnorm=I=${this.target}:TP=${this.peak}:LRA=11:linear=true`;
      if (this.mode === 'dynamic') return 'dynaudnorm=f=250:g=15:p=0.9';
      return `loudnorm=I=${this.target}:TP=${this.peak}:LRA=7`;
    }

    async addFiles(list) {
      const files = [...list].filter(
        (f) =>
          f.type.startsWith('audio/') ||
          f.type.startsWith('video/') ||
          /\.(mp3|wav|flac|ogg|opus|m4a|aac|mp4|mkv|mov|webm)$/i.test(f.name),
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
      }));
      this.items = [...this.items, ...added];
      for (const item of added) {
        const info = await mediaInfo(item.file);
        this.update(item.id, { duration: info.duration });
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
    pick = (key, value) => (this[key] = value);
    setPeak = (e) => (this.peak = Number(e.target.value) || -1);
    setTarget = (e) => (this.target = Number(e.target.value) || -14);

    remove = (id) => {
      const item = this.items.find((i) => i.id === id);
      if (item?.url) URL.revokeObjectURL(item.url);
      this.items = this.items.filter((i) => i.id !== id);
    };

    clear = () => {
      this.revokeAll();
      this.items = [];
    };

    runAll = async () => {
      if (this.busy) return;
      this.busy = true;
      for (const item of this.items) await this.run(item.id);
      this.busy = false;
    };

    run = async (id) => {
      const item = this.items.find((i) => i.id === id);
      if (!item) return;
      if (item.url) URL.revokeObjectURL(item.url);
      this.update(id, {
        url: null,
        error: null,
        progress: 0,
        status: 'Queued…',
      });
      const ext = extOf(item.file.name);
      const video = /^(mp4|mkv|mov|webm|avi|m4v)$/.test(ext);
      try {
        const blob = await runFFmpeg(item.file, {
          out: ext,
          type: item.file.type || '',
          duration: item.duration,
          // The picture (if there is one) is copied; only the sound goes through the filter.
          build: (input) => [
            '-i',
            input,
            '-af',
            this.filter,
            ...(video ? ['-c:v', 'copy'] : []),
            '-ar',
            '48000',
          ],
          onStatus: (status) => this.update(id, { status }),
          onProgress: (progress) => this.update(id, { progress }),
        });
        this.update(id, {
          url: URL.createObjectURL(blob),
          name: `${baseName(item.file.name)}-levelled.${ext}`,
          size: blob.size,
          status: '',
          progress: 1,
        });
      } catch (error) {
        this.update(id, {
          error: error?.message || 'Couldn’t level this one',
          status: '',
        });
      }
    };
  }
</script>

<script>
  let args = $props();
  const self = new AudioNormalizerPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="audio-normalizer"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Make everything sit at the same volume: the loudness levels streaming services expect, a peak limit, or evened out as it goes."
>
  <div class="fs" {@attach acceptPastedFiles([self.pasteFiles])}>
    <div class="fs-frame fc-panel pop-in">
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.drop}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="volume-2" size={22} />
        <span
          >{truthy(self.dragging)
            ? 'Drop them here'
            : 'Drop audio or video, paste it, or click to browse'}</span
        >
        <input
          type="file"
          accept="audio/*,video/*"
          multiple
          class="sr-only"
          onchange={self.selectFiles}
        />
      </label>

      <div class="math-tabs" role="group" aria-label="How to level it">
        {#each self.modes ?? [] as m}
          <button
            type="button"
            class="qr-tab {truthy(eq(self.mode, m?.id)) ? 'active' : ''}"
            onclick={(..._r) => self.pick('mode', m?.id, ..._r)}
            >{m?.label}</button
          >
        {/each}
      </div>

      {#if !truthy(eq(self.mode, 'dynamic'))}
        <div class="math-row">
          <label class="math-field">
            <span class="qr-label is-muted">How loud</span>
            <select class="select" onchange={self.setTarget}>
              {#each self.targets ?? [] as t}
                <option
                  value={t?.id}
                  {@attach prop('selected', () => eq(self.target, t?.id))}
                  >{t?.label}</option
                >
              {/each}
            </select>
          </label>
          <label class="math-field">
            <span class="qr-label is-muted"
              >Never go above:
              {self.peak}
              dB</span
            >
            <input
              type="range"
              min="-6"
              max="0"
              step="0.5"
              {@attach prop('value', () => self.peak)}
              oninput={self.setPeak}
            />
          </label>
        </div>
      {/if}

      <p class="tool-hint">
        {#if truthy(eq(self.mode, 'loudness'))}
          Measures how loud it actually sounds to a person (EBU R128) and moves
          the whole thing to your target, keeping the quiet and loud bits apart
          as they were.
        {:else if truthy(eq(self.mode, 'peak'))}
          Same measurement, but stretched so the level barely moves, which is
          useful when a track should stay flat and simply sit at the right
          volume.
        {:else}
          Rides the level as it goes, lifting quiet passages and holding back
          loud ones. Best for a recorded talk where someone wandered away from
          the mic.
        {/if}
      </p>
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
              onclick={self.runAll}
              >{truthy(self.busy) ? 'Working…' : 'Level them'}</button
            >
            <button type="button" class="btn" onclick={self.clear}>Clear</button
            >
          </div>
        </div>
        <ul class="fs-list">
          {#each self.items ?? [] as item (item?.id)}
            <li class="fs-row fc-row">
              <Icon name="music" size={16} />
              <div class="fs-row-info">
                <span class="fs-row-name">{item?.file?.name}</span>
                <span class="fs-row-size">
                  {formatBytes(item?.file?.size)}{#if truthy(item?.duration)}
                    ·
                    {formatTime(item?.duration)}{/if}{#if truthy(item?.size)}
                    →
                    {formatBytes(item?.size)}{/if}
                </span>
                {#if truthy(item?.error)}<span class="tool-error"
                    >{item?.error}</span
                  >{:else if truthy(item?.status)}<span class="fs-row-size"
                    >{item?.status}</span
                  >{/if}
              </div>
              <div class="fs-row-status">
                {#if truthy(item?.url)}
                  <!-- template-lint-disable require-media-caption -->
                  <audio class="media-preview" controls src={item?.url}></audio>
                  <a class="btn fs-save" href={item?.url} download={item?.name}
                    ><Icon name="download" size={13} /> Save</a
                  >
                {:else if truthy(item?.status)}
                  <div class="fs-progress"
                    ><div
                      class="fs-progress-bar"
                      style={progressWidth(item?.progress)}
                    ></div></div
                  >
                {:else}
                  <button
                    type="button"
                    class="btn"
                    onclick={(..._r) => self.run(item?.id, ..._r)}
                    >{truthy(item?.error) ? 'Retry' : 'Level it'}</button
                  >
                {/if}
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
