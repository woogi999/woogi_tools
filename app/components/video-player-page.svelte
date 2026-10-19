<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { acceptPastedFiles } from '../utils/paste-files.js';
  import { formatBytes } from '../utils/file-share.js';
  import { formatTime, baseName } from '../utils/media-jobs.js';
  import { parseSubtitles, toVtt } from '../utils/subtitles.js';
  import { keepState } from '../utils/tool-state.js';

  // A proper player for the videos on your machine: a playlist, speed, frame
  // stepping, A-B loop, subtitles from a file, snapshots and the keyboard
  // shortcuts you'd expect. Files are played straight from disk.

  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  const eq = (a, b) => a === b;
  const isMedia = (file) =>
    file.type.startsWith('video/') ||
    file.type.startsWith('audio/') ||
    /\.(mp4|mkv|mov|webm|m4v|ogv|mp3|wav|flac|ogg|m4a|opus|aac)$/i.test(
      file.name,
    );
  const isSubs = (file) => /\.(srt|vtt)$/i.test(file.name);
  let nextId = 1;

  class VideoPlayerPage extends Component {
    get pipBusy() {
      return this.playing;
    }

    get pipWarning() {
      return 'Close the Video Player? Playback will stop.';
    }
    items = $state.raw([]);
    currentId = $state.raw(null);
    playing = $state.raw(false);
    time = $state.raw(0);
    duration = $state.raw(0);
    speed = $state.raw(1);
    volume = $state.raw(1);
    muted = $state.raw(false);
    loopA = $state.raw(null);
    loopB = $state.raw(null);
    subsUrl = $state.raw(null);
    subsName = $state.raw('');
    dragging = $state.raw(false);
    flip = $state.raw(false);
    snapshotUrl = $state.raw(null);
    message = $state.raw('');

    speeds = SPEEDS;
    video = null;
    messageTimer = null;

    constructor(args) {
      super(args);
      keepState(this, 'video-player', ['speed', 'volume', 'muted']);
      registerDestructor(this, () => {
        clearTimeout(this.messageTimer);
        for (const item of this.items) URL.revokeObjectURL(item.url);
        if (this.subsUrl) URL.revokeObjectURL(this.subsUrl);
        if (this.snapshotUrl) URL.revokeObjectURL(this.snapshotUrl);
      });
    }

    get current() {
      return this.items.find((i) => i.id === this.currentId) ?? null;
    }

    get rows() {
      return this.items.map((i) => ({ ...i, active: i.id === this.currentId }));
    }

    get progressStyle() {
      const p = this.duration ? (this.time / this.duration) * 100 : 0;
      return `width:${p}%`;
    }

    get loopStyle() {
      if (this.loopA === null || !this.duration) return 'display:none';
      const a = (this.loopA / this.duration) * 100;
      const b = ((this.loopB ?? this.duration) / this.duration) * 100;
      return `left:${a}%;width:${Math.max(0, b - a)}%`;
    }

    get loopLabel() {
      if (this.loopA === null) return 'Loop A';
      if (this.loopB === null) return `A ${formatTime(this.loopA)} · set B`;
      return `${formatTime(this.loopA)} to ${formatTime(this.loopB)}`;
    }

    get videoStyle() {
      return this.flip ? 'transform:scaleX(-1)' : '';
    }

    bindVideo = modifier((element) => {
      this.video = element;
      element.volume = this.volume;
      element.muted = this.muted;
      element.playbackRate = this.speed;
      const onTime = () => {
        this.time = element.currentTime;
        // The A-B loop: past B, back to A.
        if (
          this.loopA !== null &&
          this.loopB !== null &&
          element.currentTime >= this.loopB
        )
          element.currentTime = this.loopA;
      };
      const onMeta = () => (this.duration = element.duration || 0);
      const onPlay = () => (this.playing = true);
      const onPause = () => (this.playing = false);
      const onEnd = () => this.next();
      element.addEventListener('timeupdate', onTime);
      element.addEventListener('loadedmetadata', onMeta);
      element.addEventListener('durationchange', onMeta);
      element.addEventListener('play', onPlay);
      element.addEventListener('pause', onPause);
      element.addEventListener('ended', onEnd);
      return () => {
        element.removeEventListener('timeupdate', onTime);
        element.removeEventListener('loadedmetadata', onMeta);
        element.removeEventListener('durationchange', onMeta);
        element.removeEventListener('play', onPlay);
        element.removeEventListener('pause', onPause);
        element.removeEventListener('ended', onEnd);
        this.video = null;
      };
    });

    // Shortcuts work anywhere on the page except inside a text field.
    keys = modifier(() => {
      const onKey = (event) => {
        if (
          !this.video ||
          /^(input|textarea|select)$/i.test(event.target.tagName)
        )
          return;
        const handled = this.shortcut(event.key.toLowerCase(), event.shiftKey);
        if (handled) event.preventDefault();
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    });

    shortcut(key, shift) {
      switch (key) {
        case ' ':
        case 'k':
          this.togglePlay();
          return true;
        case 'arrowleft':
          this.seekBy(shift ? -1 : -5);
          return true;
        case 'arrowright':
          this.seekBy(shift ? 1 : 5);
          return true;
        case 'j':
          this.seekBy(-10);
          return true;
        case 'l':
          this.seekBy(10);
          return true;
        case ',':
          this.stepFrame(-1);
          return true;
        case '.':
          this.stepFrame(1);
          return true;
        case 'arrowup':
          this.setVolume(Math.min(1, this.volume + 0.1));
          return true;
        case 'arrowdown':
          this.setVolume(Math.max(0, this.volume - 0.1));
          return true;
        case 'm':
          this.toggleMute();
          return true;
        case 'f':
          this.fullscreen();
          return true;
        case '<':
          this.bumpSpeed(-1);
          return true;
        case '>':
          this.bumpSpeed(1);
          return true;
        case 'a':
          this.markLoop();
          return true;
        case 's':
          this.snapshot();
          return true;
        case 'n':
          this.next();
          return true;
        case 'p':
          this.previous();
          return true;
        case '0':
          this.seekTo(0);
          return true;
        default:
          return false;
      }
    }

    flash(text) {
      this.message = text;
      clearTimeout(this.messageTimer);
      this.messageTimer = setTimeout(() => (this.message = ''), 1200);
    }

    addFiles(list) {
      const files = [...list];
      const subs = files.find(isSubs);
      if (subs) this.loadSubs(subs);
      const media = files.filter(isMedia);
      if (!media.length) return;
      const added = media.map((file) => ({
        id: nextId++,
        file,
        name: file.name,
        size: file.size,
        url: URL.createObjectURL(file),
        isAudio:
          file.type.startsWith('audio/') ||
          /\.(mp3|wav|flac|ogg|m4a|opus|aac)$/i.test(file.name),
      }));
      this.items = [...this.items, ...added];
      if (!this.current) this.play(added[0].id);
    }

    async loadSubs(file) {
      const cues = parseSubtitles(await file.text());
      if (this.subsUrl) URL.revokeObjectURL(this.subsUrl);
      // The <track> element only speaks WebVTT, so SRT is rewritten on the way in.
      this.subsUrl = URL.createObjectURL(
        new Blob([toVtt(cues)], { type: 'text/vtt' }),
      );
      this.subsName = file.name;
      this.flash(`Subtitles: ${file.name}`);
      requestAnimationFrame(() => {
        const track = this.video?.textTracks?.[0];
        if (track) track.mode = 'showing';
      });
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

    play = (id) => {
      this.currentId = id;
      this.loopA = this.loopB = null;
      this.time = 0;
      requestAnimationFrame(() => this.video?.play().catch(() => {}));
    };

    remove = (id) => {
      const item = this.items.find((i) => i.id === id);
      if (item) URL.revokeObjectURL(item.url);
      this.items = this.items.filter((i) => i.id !== id);
      if (this.currentId === id) {
        this.currentId = this.items[0]?.id ?? null;
        this.playing = false;
      }
    };

    clear = () => {
      for (const item of this.items) URL.revokeObjectURL(item.url);
      this.items = [];
      this.currentId = null;
      this.playing = false;
    };

    next = () => {
      const i = this.items.findIndex((x) => x.id === this.currentId);
      if (i >= 0 && i < this.items.length - 1) this.play(this.items[i + 1].id);
    };

    previous = () => {
      const i = this.items.findIndex((x) => x.id === this.currentId);
      if (i > 0) this.play(this.items[i - 1].id);
      else this.seekTo(0);
    };

    togglePlay = () => {
      if (!this.video) return;
      if (this.video.paused) this.video.play().catch(() => {});
      else this.video.pause();
    };

    seekTo = (t) => {
      if (this.video)
        this.video.currentTime = Math.min(this.duration, Math.max(0, t));
    };
    seekBy = (dt) => this.seekTo((this.video?.currentTime ?? 0) + dt);
    scrub = (event) => this.seekTo(Number(event.target.value) || 0);

    stepFrame = (dir) => {
      this.video?.pause();
      this.seekBy(dir / 30);
    };

    setSpeed = (speed) => {
      this.speed = speed;
      if (this.video) this.video.playbackRate = speed;
      this.flash(`${speed}× speed`);
    };

    pickSpeed = (event) => this.setSpeed(Number(event.target.value) || 1);

    bumpSpeed = (dir) => {
      const i = SPEEDS.indexOf(this.speed);
      const next =
        SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? 3 : i) + dir))];
      this.setSpeed(next);
    };

    setVolume = (v) => {
      this.volume = Math.round(v * 100) / 100;
      if (this.video) {
        this.video.volume = this.volume;
        if (this.volume > 0 && this.muted) this.toggleMute();
      }
      this.flash(`Volume ${Math.round(this.volume * 100)}%`);
    };
    slideVolume = (event) => this.setVolume(Number(event.target.value));

    toggleMute = () => {
      this.muted = !this.muted;
      if (this.video) this.video.muted = this.muted;
      this.flash(this.muted ? 'Muted' : 'Sound on');
    };

    toggleFlip = () => (this.flip = !this.flip);

    markLoop = () => {
      if (this.loopA === null) {
        this.loopA = this.time;
        this.flash('Loop start set. Press A again at the end.');
      } else if (this.loopB === null) {
        if (this.time <= this.loopA) return;
        this.loopB = this.time;
        this.flash('Looping.');
      } else {
        this.loopA = this.loopB = null;
        this.flash('Loop off.');
      }
    };

    fullscreen = () => {
      const el = this.video?.parentElement;
      if (!el) return;
      if (document.fullscreenElement) document.exitFullscreen?.();
      else el.requestFullscreen?.();
    };

    pictureInPicture = async () => {
      try {
        if (document.pictureInPictureElement)
          await document.exitPictureInPicture();
        else await this.video?.requestPictureInPicture?.();
      } catch {
        this.flash('Picture-in-picture isn’t available here.');
      }
    };

    snapshot = async () => {
      const video = this.video;
      if (!video || !video.videoWidth) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (this.flip) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (this.snapshotUrl) URL.revokeObjectURL(this.snapshotUrl);
      this.snapshotUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = this.snapshotUrl;
      link.download = `${baseName(this.current?.name ?? 'frame')}-${formatTime(this.time).replaceAll(':', '.')}.png`;
      link.click();
      this.flash('Frame saved.');
    };
  }
</script>

<script>
  let args = $props();
  const self = new VideoPlayerPage(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable no-invalid-interactive -->
<ToolPage
  route="video-player"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Play the videos and music on your machine with a playlist, speed control, frame stepping, an A-B loop, subtitles from a file and snapshots. Space, arrows, J/K/L, F, M and A do what you'd expect."
>
  <div
    class="fs"
    {@attach acceptPastedFiles([self.pasteFiles])}
    {@attach self.keys?.()}
  >
    {#if truthy(self.items?.length)}
      <div class="vp-layout">
        <div class="vp-stage">
          <div
            class="vp-screen"
            ondrop={self.drop}
            ondragleave={self.dragOver}
            ondragover={self.dragOver}
          >
            {#if truthy(self.current)}
              <!-- template-lint-disable require-media-caption -->
              <video
                class="vp-video {truthy(self.current?.isAudio)
                  ? 'is-audio'
                  : ''}"
                playsinline
                src={self.current?.url}
                style={self.videoStyle}
                ondblclick={self.fullscreen}
                onclick={self.togglePlay}
                {@attach self.bindVideo?.()}
              >
                {#if truthy(self.subsUrl)}
                  <track
                    kind="subtitles"
                    label={self.subsName}
                    src={self.subsUrl}
                    default
                  />
                {/if}
              </video>
            {/if}
            {#if truthy(self.message)}<div class="vp-toast">{self.message}</div
              >{/if}
          </div>

          <div class="vp-bar">
            <div class="vp-track">
              <div class="vp-loop" style={self.loopStyle}></div>
              <div class="vp-progress" style={self.progressStyle}></div>
              <input
                type="range"
                class="vp-scrub"
                min="0"
                max={self.duration}
                step="0.01"
                {@attach prop('value', () => self.time)}
                aria-label="Position"
                oninput={self.scrub}
              />
            </div>
            <div class="vp-controls">
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn"
                  title="Previous (P)"
                  onclick={self.previous}>⏮</button
                >
                <button
                  type="button"
                  class="btn active"
                  title="Play / pause (Space)"
                  onclick={self.togglePlay}
                  ><Icon
                    name={truthy(self.playing) ? 'pause' : 'play'}
                    size={13}
                  /></button
                >
                <button
                  type="button"
                  class="btn"
                  title="Next (N)"
                  onclick={self.next}>⏭</button
                >
                <button
                  type="button"
                  class="btn"
                  title="Back a frame (,)"
                  onclick={(..._r) => self.stepFrame(-1, ..._r)}>‹</button
                >
                <button
                  type="button"
                  class="btn"
                  title="Forward a frame (.)"
                  onclick={(..._r) => self.stepFrame(1, ..._r)}>›</button
                >
                <span class="tool-hint vb-time"
                  >{formatTime(self.time)}
                  /
                  {formatTime(self.duration)}</span
                >
              </div>
              <div class="settings-actions">
                <button
                  type="button"
                  class="btn"
                  title="Mute (M)"
                  onclick={self.toggleMute}
                  ><Icon
                    name={truthy(self.muted) ? 'volume-x' : 'volume-2'}
                    size={13}
                  /></button
                >
                <input
                  type="range"
                  class="vp-volume"
                  min="0"
                  max="1"
                  step="0.05"
                  {@attach prop('value', () => self.volume)}
                  aria-label="Volume"
                  oninput={self.slideVolume}
                />
                <select
                  class="select"
                  aria-label="Speed"
                  onchange={self.pickSpeed}
                >
                  {#each self.speeds ?? [] as s}
                    <option
                      value={s}
                      {@attach prop('selected', () => eq(self.speed, s))}
                      >{s}×</option
                    >
                  {/each}
                </select>
                <button
                  type="button"
                  class="btn {truthy(self.loopB) ? 'active' : ''}"
                  title="A-B loop (A)"
                  onclick={self.markLoop}>{self.loopLabel}</button
                >
                <button
                  type="button"
                  class="btn"
                  title="Save this frame (S)"
                  onclick={self.snapshot}
                  ><Icon name="camera" size={13} /></button
                >
                <button
                  type="button"
                  class="btn {truthy(self.flip) ? 'active' : ''}"
                  title="Mirror"
                  onclick={self.toggleFlip}>Mirror</button
                >
                <button
                  type="button"
                  class="btn"
                  title="Picture in picture"
                  onclick={self.pictureInPicture}
                  ><Icon name="picture-in-picture" size={13} /></button
                >
                <button
                  type="button"
                  class="btn"
                  title="Fullscreen (F)"
                  onclick={self.fullscreen}
                  ><Icon name="maximize" size={13} /></button
                >
              </div>
            </div>
          </div>
          <p class="tool-hint"
            >Space or K plays and pauses; ← → skip 5 s (Shift for 1 s), J and L
            skip 10 s, , and . step a frame, ↑ ↓ change the volume, M mutes, F
            is fullscreen, &lt; &gt; change the speed, A sets the loop, S saves
            a frame. Drop a .srt or .vtt on the video for subtitles.</p
          >
        </div>

        <aside class="vp-list">
          <div class="field-head">
            <span class="qr-label is-muted"
              >Playlist ·
              {self.items?.length}</span
            >
            <div class="settings-actions">
              <label class="btn"
                ><Icon name="plus" size={12} />
                Add
                <input
                  type="file"
                  accept="video/*,audio/*,.mkv,.srt,.vtt"
                  multiple
                  class="sr-only"
                  onchange={self.selectFiles}
                /></label
              >
              <button type="button" class="btn" onclick={self.clear}
                >Clear</button
              >
            </div>
          </div>
          <ul class="vp-items">
            {#each self.rows ?? [] as item (item?.id)}
              <li class="vp-item {truthy(item?.active) ? 'is-active' : ''}">
                <button
                  type="button"
                  class="vp-item-main"
                  onclick={(..._r) => self.play(item?.id, ..._r)}
                >
                  <Icon
                    name={truthy(item?.isAudio) ? 'music' : 'film'}
                    size={13}
                  />
                  <span class="vp-item-name">{item?.name}</span>
                  <span class="tool-hint">{formatBytes(item?.size)}</span>
                </button>
                <button
                  type="button"
                  class="btn"
                  aria-label="Remove"
                  onclick={(..._r) => self.remove(item?.id, ..._r)}
                  ><Icon name="x" size={12} /></button
                >
              </li>
            {/each}
          </ul>
        </aside>
      </div>
    {:else}
      <label
        class="qr-drop fs-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
        ondrop={self.drop}
        ondragleave={self.dragOver}
        ondragover={self.dragOver}
      >
        <Icon name="monitor-play" size={22} />
        <span
          >{truthy(self.dragging)
            ? 'Drop them here'
            : 'Drop videos or music (and a .srt or .vtt), or click to browse'}</span
        >
        <input
          type="file"
          accept="video/*,audio/*,.mkv,.srt,.vtt"
          multiple
          class="sr-only"
          onchange={self.selectFiles}
        />
      </label>
    {/if}
  </div>
</ToolPage>
