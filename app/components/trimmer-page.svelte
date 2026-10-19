<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import {
    runFFmpeg,
    baseName,
    mediaInfo,
    formatTime,
    ffmpegTime,
  } from '../utils/media-jobs.js';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import { formatBytes } from '../utils/file-share.js';

  // Cutting a piece out of a video or a song. Drag the two handles (or type the
  // times), listen or watch the bit you've picked, then save just that.

  const progressWidth = (p) => `width:${Math.round((p ?? 0) * 100)}%`;
  const extOf = (name) => (name.split('.').pop() || 'mp4').toLowerCase();
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  class TrimmerPage extends Component {
    // While this is true, leaving the page floats the tool in a PiP window
    // instead of tearing it down, so the work carries on (see services/pip.js).
    get pipBusy() {
      return this.busy;
    }

    get pipWarning() {
      return 'Close the Trimmer? The trim in progress will be cancelled.';
    }
    file = $state.raw(null);
    url = $state.raw(null);
    duration = $state.raw(0);
    isAudio = $state.raw(false);
    start = $state.raw(0);
    end = $state.raw(0);
    mode = $state.raw('copy'); // 'copy' (quick, cuts at the nearest keyframe) | 'exact' (re-encodes)
    dragging = $state.raw(false);
    busy = $state.raw(false);
    status = $state.raw('');
    progress = $state.raw(0);
    error = $state.raw(null);
    resultUrl = $state.raw(null);
    resultName = $state.raw(null);
    resultSize = $state.raw(null);
    player = null;

    constructor(args) {
      super(args);
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
      if (!this.duration) return 'left:0%;width:0%';
      const left = (this.start / this.duration) * 100;
      const width = (this.span / this.duration) * 100;
      return `left:${left}%;width:${width}%`;
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
  }

  function eq(a, b) {
    return a === b;
  }
</script>

<script>
  let args = $props();
  const self = new TrimmerPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="trimmer"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Cut a piece out of a video or a song. Pick the start and end, hear or see it first, then save just that bit."
>
  <div class="fs" {@attach acceptPastedFiles([self.pasteFiles])}>
    <div class="fs-frame fc-panel pop-in">
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.drop}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="scissors" size={22} />
        <span
          >{truthy(self.dragging)
            ? 'Drop it here'
            : 'Drop a video or an audio file, paste it, or click to browse'}</span
        >
        <input
          type="file"
          accept="video/*,audio/*"
          class="sr-only"
          onchange={self.selectFile}
        />
      </label>
      {#if !truthy(self.file)}
        <p class="tool-hint"
          >Works with videos and music alike. The engine downloads the first
          time you use it (about 30 MB), then stays cached for the visit.</p
        >
      {/if}
    </div>

    {#if truthy(self.file)}
      <div class="fs-frame fc-panel pop-in">
        <div class="fc-toolbar">
          <h3 class="qr-heading">{self.file?.name}</h3>
          <span class="tool-hint"
            >{formatBytes(self.file?.size)}
            ·
            {formatTime(self.duration)}</span
          >
        </div>

        {#if truthy(self.isAudio)}
          <!-- template-lint-disable require-media-caption -->
          <audio
            class="trim-player"
            controls
            src={self.url}
            ontimeupdate={self.watch}
            {@attach self.keepPlayer?.()}
          ></audio>
        {:else}
          <!-- template-lint-disable require-media-caption -->
          <video
            class="trim-player"
            controls
            src={self.url}
            ontimeupdate={self.watch}
            {@attach self.keepPlayer?.()}
          ></video>
        {/if}

        <div class="trim-track" aria-hidden="true">
          <span class="trim-band" style={self.bandStyle}></span>
        </div>
        <label class="math-field">
          <span class="qr-label is-muted"
            >Start:
            {formatTime(self.start)}</span
          >
          <input
            type="range"
            min="0"
            max={self.duration}
            step="0.05"
            {@attach prop('value', () => self.start)}
            oninput={self.setStart}
          />
        </label>
        <label class="math-field">
          <span class="qr-label is-muted"
            >End:
            {formatTime(self.end)}</span
          >
          <input
            type="range"
            min="0"
            max={self.duration}
            step="0.05"
            {@attach prop('value', () => self.end)}
            oninput={self.setEnd}
          />
        </label>

        <div class="settings-actions">
          <button type="button" class="btn" onclick={self.markStart}
            ><Icon name="circle-dot" size={13} /> Start here</button
          >
          <button type="button" class="btn" onclick={self.markEnd}
            ><Icon name="circle-dot" size={13} /> End here</button
          >
          <button type="button" class="btn" onclick={self.playSelection}
            ><Icon name="play" size={13} /> Play the bit</button
          >
        </div>

        <div class="math-tabs" role="group" aria-label="How to cut">
          <button
            type="button"
            class="qr-tab {truthy(eq(self.mode, 'copy')) ? 'active' : ''}"
            onclick={(..._r) => self.setMode('copy', ..._r)}
            >Quick (no re-encoding)</button
          >
          <button
            type="button"
            class="qr-tab {truthy(eq(self.mode, 'exact')) ? 'active' : ''}"
            onclick={(..._r) => self.setMode('exact', ..._r)}>Exact cut</button
          >
        </div>
        <p class="tool-hint">
          {truthy(eq(self.mode, 'copy'))
            ? 'Quick copies the streams as they are, so nothing is lost, but a video can only start on a keyframe: the beginning may land up to a second early.'
            : 'Exact re-encodes the sound so the cut lands where you put it, to the frame. Slower, and very slightly lossy.'}
        </p>

        <div class="fc-toolbar">
          <div class="settings-actions">
            <button
              type="button"
              class="btn active"
              disabled={truthy(self.canCut) ? false : true}
              onclick={self.cut}
              >{truthy(self.busy) ? 'Cutting…' : 'Cut it'}</button
            >
            <button type="button" class="btn" onclick={self.reset}
              >Start over</button
            >
          </div>
          <span class="tool-hint"
            >Keeping
            {formatTime(self.span)}
            of
            {formatTime(self.duration)}</span
          >
        </div>

        {#if truthy(self.busy)}
          <div class="fs-progress"
            ><div class="fs-progress-bar" style={progressWidth(self.progress)}
            ></div></div
          >
          {#if truthy(self.status)}<p class="tool-hint">{self.status}</p>{/if}
        {/if}
        {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}

        {#if truthy(self.resultUrl)}
          <div class="fs-row fc-row">
            <Icon name="scissors" size={16} />
            <div class="fs-row-info">
              <span class="fs-row-name">{self.resultName}</span>
              <span class="fs-row-size"
                >{formatBytes(self.resultSize)}
                ·
                {formatTime(self.span)}</span
              >
            </div>
            <div class="fs-row-status">
              <a
                class="btn fs-save"
                href={self.resultUrl}
                download={self.resultName}
                ><Icon name="download" size={13} /> Save</a
              >
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</ToolPage>
