<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { formatBytes } from '../utils/file-share.js';

  const eq = (a, b) => a === b;
  const MIME_TYPES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  const extFor = (mime) => (mime.includes('mp4') ? 'mp4' : 'webm');
  const pad = (n) => String(n).padStart(2, '0');
  const clock = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  };
  const fileStamp = () =>
    new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

  class WebcamRecorderPage extends Component {
    state = $state.raw('off'); // 'off' | 'ready' | 'recording' | 'paused'
    cameras = $state.raw([]);
    cameraId = $state.raw('');
    withMic = $state.raw(true);
    mirror = $state.raw(true);
    elapsed = $state.raw(0);
    error = $state.raw(null);
    recordings = $state.raw([]);

    stream = null;
    recorder = null;
    chunks = [];
    video = null;
    startedAt = 0;
    pausedFor = 0;
    pausedAt = 0;
    timer = null;

    constructor(args) {
      super(args);
      registerDestructor(this, () => {
        this.stopCamera();
        for (const r of this.recordings) URL.revokeObjectURL(r.url);
      });
    }

    get busy() {
      return this.state === 'recording' || this.state === 'paused';
    }

    get on() {
      return this.state !== 'off';
    }

    get time() {
      return clock(this.elapsed);
    }

    bindVideo = modifier((video) => {
      this.video = video;
      if (this.stream) video.srcObject = this.stream;
      return () => (this.video = null);
    });

    startCamera = async () => {
      this.error = null;
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        this.error = 'This browser cannot record from a camera.';
        return;
      }
      this.stopCamera();
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: this.cameraId
            ? { deviceId: { exact: this.cameraId } }
            : { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: this.withMic,
        });
      } catch (err) {
        this.error =
          err?.name === 'NotAllowedError'
            ? 'The camera was not allowed. Check the site permission.'
            : 'The camera could not be started.';
        return;
      }
      if (this.video) this.video.srcObject = this.stream;
      this.state = 'ready';
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.cameras = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({
          id: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }));
    };

    stopCamera = () => {
      if (this.recorder && this.recorder.state !== 'inactive')
        this.recorder.stop();
      clearInterval(this.timer);
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      if (this.video) this.video.srcObject = null;
      this.state = 'off';
    };

    setCamera = (event) => {
      this.cameraId = event.target.value;
      if (this.on) this.startCamera();
    };

    toggleMic = () => {
      this.withMic = !this.withMic;
      if (this.state === 'ready') this.startCamera();
    };

    toggleMirror = () => (this.mirror = !this.mirror);

    record = () => {
      if (!this.stream) return;
      const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      this.recorder = new MediaRecorder(
        this.stream,
        mimeType ? { mimeType } : undefined,
      );
      this.chunks = [];
      this.recorder.ondataavailable = (e) => {
        if (e.data.size) this.chunks.push(e.data);
      };
      this.recorder.onstop = () => this.finish();
      this.recorder.start(500);
      this.startedAt = Date.now();
      this.pausedFor = 0;
      this.elapsed = 0;
      this.state = 'recording';
      this.timer = setInterval(() => {
        if (this.state === 'recording')
          this.elapsed = Date.now() - this.startedAt - this.pausedFor;
      }, 250);
    };

    pause = () => {
      if (this.state !== 'recording') return;
      this.recorder.pause();
      this.pausedAt = Date.now();
      this.state = 'paused';
    };

    resume = () => {
      if (this.state !== 'paused') return;
      this.pausedFor += Date.now() - this.pausedAt;
      this.recorder.resume();
      this.state = 'recording';
    };

    stop = () => {
      if (!this.busy) return;
      if (this.state === 'paused') this.pausedFor += Date.now() - this.pausedAt;
      this.elapsed = Date.now() - this.startedAt - this.pausedFor;
      this.recorder.stop();
    };

    finish() {
      clearInterval(this.timer);
      const mime = this.recorder?.mimeType || 'video/webm';
      const blob = new Blob(this.chunks, { type: mime });
      this.recordings = [
        {
          id: Date.now(),
          kind: 'video',
          url: URL.createObjectURL(blob),
          name: `webcam-${fileStamp()}.${extFor(mime)}`,
          length: clock(this.elapsed),
          size: formatBytes(blob.size),
        },
        ...this.recordings,
      ];
      this.recorder = null;
      this.state = this.stream ? 'ready' : 'off';
    }

    snapshot = () => {
      if (!this.video?.videoWidth) return;
      const canvas = document.createElement('canvas');
      canvas.width = this.video.videoWidth;
      canvas.height = this.video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (this.mirror) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(this.video, 0, 0);
      canvas.toBlob((blob) => {
        this.recordings = [
          {
            id: Date.now(),
            kind: 'photo',
            url: URL.createObjectURL(blob),
            name: `photo-${fileStamp()}.png`,
            length: `${canvas.width}×${canvas.height}`,
            size: formatBytes(blob.size),
          },
          ...this.recordings,
        ];
      }, 'image/png');
    };

    remove = (rec) => {
      URL.revokeObjectURL(rec.url);
      this.recordings = this.recordings.filter((r) => r !== rec);
    };
  }
</script>

<script>
  let args = $props();
  const self = new WebcamRecorderPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="webcam-recorder"
  subtitle="Record a video from your webcam, or grab a photo, and save it. Nothing leaves your device."
  busy={self.busy}
  closeWarning="a recording in progress"
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <div
        class="wc-stage
              {truthy(self.mirror) ? 'is-mirrored' : ''}
              {truthy(eq(self.state, 'recording')) ? 'is-live' : ''}"
      >
        <!-- template-lint-disable require-media-caption -->
        <video
          class="wc-video"
          autoplay
          playsinline
          muted
          {@attach self.bindVideo?.()}
        ></video>
        {#if !truthy(self.on)}
          <div class="wc-off">
            <Icon name="video-off" size={32} />
            <span>Camera is off</span>
          </div>
        {/if}
        {#if truthy(self.busy)}
          <span class="wc-clock"
            ><span class="rec-dot"></span>
            {self.time}</span
          >
        {/if}
      </div>
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
      <div class="settings-actions">
        {#if truthy(self.on)}
          {#if truthy(eq(self.state, 'ready'))}
            <button type="button" class="btn active" onclick={self.record}>
              <Icon name="circle-dot" size={14} />
              Record</button
            >
            <button type="button" class="btn" onclick={self.snapshot}>
              <Icon name="camera" size={14} />
              Photo</button
            >
            <button type="button" class="btn" onclick={self.stopCamera}>
              <Icon name="video-off" size={14} />
              Turn off</button
            >
          {:else}
            {#if truthy(eq(self.state, 'recording'))}
              <button type="button" class="btn" onclick={self.pause}>
                <Icon name="pause" size={14} />
                Pause</button
              >
            {:else}
              <button type="button" class="btn" onclick={self.resume}>
                <Icon name="play" size={14} />
                Resume</button
              >
            {/if}
            <button type="button" class="btn active" onclick={self.stop}>
              <Icon name="circle-stop" size={14} />
              Stop</button
            >
          {/if}
        {:else}
          <button type="button" class="btn active" onclick={self.startCamera}>
            <Icon name="video" size={14} />
            Turn on camera</button
          >
        {/if}
      </div>
      <div class="settings-actions wc-options">
        {#if truthy(self.cameras?.length)}
          <select
            class="select"
            aria-label="Camera"
            disabled={self.busy}
            onchange={self.setCamera}
          >
            {#each self.cameras ?? [] as c}
              <option
                value={c?.id}
                {@attach prop('selected', () => eq(c?.id, self.cameraId))}
                >{c?.label}</option
              >
            {/each}
          </select>
        {/if}
        <button
          type="button"
          class="btn {truthy(self.withMic) ? 'active' : ''}"
          aria-pressed={truthy(self.withMic) ? 'true' : 'false'}
          disabled={self.busy}
          onclick={self.toggleMic}
          ><Icon name={truthy(self.withMic) ? 'mic' : 'mic-off'} size={13} />
          Microphone</button
        >
        <button
          type="button"
          class="btn {truthy(self.mirror) ? 'active' : ''}"
          aria-pressed={truthy(self.mirror) ? 'true' : 'false'}
          onclick={self.toggleMirror}>Mirror preview</button
        >
      </div>
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Recordings</h3>
      {#if truthy(self.recordings?.length)}
        <ul class="rec-list">
          {#each self.recordings ?? [] as rec (rec?.id)}
            <li class="rec-item">
              <div class="rec-item-head">
                <span class="rec-item-name">{rec?.name}</span>
                <span class="is-muted">{rec?.length} · {rec?.size}</span>
              </div>
              {#if truthy(eq(rec?.kind, 'photo'))}
                <img src={rec?.url} alt="Snapshot" class="wc-photo" />
              {:else}
                <!-- template-lint-disable require-media-caption -->
                <video controls src={rec?.url} class="wc-playback"></video>
              {/if}
              <div class="settings-actions">
                <a class="btn fs-save" href={rec?.url} download={rec?.name}>
                  <Icon name="download" size={13} />
                  Save</a
                >
                <button
                  type="button"
                  class="btn"
                  aria-label="Delete {rec?.name}"
                  onclick={(..._r) => self.remove(rec, ..._r)}
                  ><Icon name="trash-2" size={13} /></button
                >
              </div>
            </li>
          {/each}
        </ul>
        <p class="tool-hint"
          >Kept in memory only: save what you want before you leave. Videos are
          WebM (MP4 on Safari); the File Converter can change that.</p
        >
      {:else}
        <p class="tool-hint"
          >Nothing recorded yet. Turn the camera on and press Record.</p
        >
      {/if}
    </section>
  </div>
</ToolPage>
