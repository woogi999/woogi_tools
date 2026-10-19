<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { formatBytes } from '../utils/file-share.js';
  import { formatTime, runFFmpeg } from '../utils/media-jobs.js';

  // Records your screen, a window or a tab, with the sound from it and/or your
  // microphone. The browser does the recording; nothing is sent anywhere.
  // Recordings always come out as MP4: straight from the recorder where the
  // browser can write one (Chrome, Edge, Safari), otherwise recorded as WebM
  // and turned into MP4 by FFmpeg afterwards.

  // MP4 first, then whatever the browser supports.
  const TYPES = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1,opus',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const QUALITY = [
    { id: 'high', label: 'High', bits: 8_000_000 },
    { id: 'normal', label: 'Normal', bits: 4_000_000 },
    { id: 'small', label: 'Small file', bits: 1_500_000 },
  ];
  const FPS = [60, 30, 24, 15];
  const eq = (a, b) => a === b;

  const supportedType = () =>
    TYPES.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) ?? '';

  class ScreenRecorderPage extends Component {
    // While this is true, leaving the page floats the tool in a PiP window
    // instead of tearing it down, so the work carries on (see services/pip.js).
    get pipBusy() {
      return (
        this.state === 'recording' ||
        this.state === 'paused' ||
        this.state === 'converting'
      );
    }

    get pipWarning() {
      return 'Close the Screen Recorder? The recording in progress will be lost.';
    }
    state = $state.raw('idle'); // 'idle' | 'recording' | 'paused' | 'converting' | 'done'
    convertStatus = $state.raw('');
    convertProgress = $state.raw(0);
    seconds = $state.raw(0);
    size = $state.raw(0);
    error = $state.raw(null);
    resultUrl = $state.raw(null);
    resultSize = $state.raw(0);
    resultType = $state.raw('');
    withSystemAudio = $state.raw(true);
    withMic = $state.raw(false);
    quality = $state.raw('normal');
    fps = $state.raw(30);

    qualities = QUALITY;
    frameRates = FPS;
    recorder = null;
    chunks = [];
    streams = [];
    ticker = null;
    liveVideo = null;
    mixer = null;

    constructor(args) {
      super(args);
      registerDestructor(this, () => {
        this.stopTracks();
        clearInterval(this.ticker);
        if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      });
    }

    get supported() {
      return Boolean(
        navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder,
      );
    }

    get recording() {
      return this.state === 'recording' || this.state === 'paused';
    }

    get clock() {
      return formatTime(this.seconds);
    }

    get resultName() {
      const stamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replaceAll(/[:T]/g, '-');
      return `screen-${stamp}.${this.resultType.includes('mp4') ? 'mp4' : 'webm'}`;
    }

    // The live picture while you record, so you can see what's being caught.
    // It has to stay silent: the `muted` attribute is ignored once the element
    // exists, so the property is set here, or the screen's own sound would play
    // back out of the speakers and be caught again as an echo.
    showLive = modifier((element) => {
      element.muted = true;
      element.volume = 0;
      this.liveVideo = element;
      return () => (this.liveVideo = null);
    });

    stopTracks() {
      for (const stream of this.streams)
        for (const track of stream.getTracks()) track.stop();
      this.streams = [];
      this.mixer?.close().catch(() => {});
      this.mixer = null;
      if (this.liveVideo) this.liveVideo.srcObject = null;
    }

    // A recorder only keeps one sound track, so the screen's sound and the
    // microphone are mixed into a single track first.
    mixAudio(streams) {
      const withSound = streams.filter((s) => s.getAudioTracks().length);
      if (withSound.length < 2) return withSound[0]?.getAudioTracks() ?? [];
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return withSound[0].getAudioTracks();
      const context = new Context();
      const out = context.createMediaStreamDestination();
      for (const stream of withSound)
        context.createMediaStreamSource(stream).connect(out);
      this.mixer = context;
      return out.stream.getAudioTracks();
    }

    toggle = (key, event) => (this[key] = event.target.checked);
    pick = (key, value) => (this[key] = value);

    start = async () => {
      if (this.recording || !this.supported) return;
      this.error = null;
      if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      this.resultUrl = null;
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: this.fps } },
          audio: this.withSystemAudio,
        });
        this.streams = [display];
        // A microphone is a second stream, mixed in beside the screen's own sound.
        if (this.withMic) {
          try {
            const mic = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true },
            });
            this.streams.push(mic);
          } catch {
            this.error =
              'Couldn’t use the microphone, so it’s recording without it.';
          }
        }
        const stream = new MediaStream([
          ...display.getVideoTracks(),
          ...this.mixAudio(this.streams),
        ]);
        if (this.liveVideo) {
          // Picture only: the sound is never played back here.
          this.liveVideo.muted = true;
          this.liveVideo.srcObject = new MediaStream(display.getVideoTracks());
          this.liveVideo.play?.().catch(() => {});
        }
        const type = supportedType();
        const recorder = new MediaRecorder(stream, {
          ...(type ? { mimeType: type } : {}),
          videoBitsPerSecond:
            QUALITY.find((q) => q.id === this.quality)?.bits ?? 4_000_000,
        });
        this.chunks = [];
        this.size = 0;
        this.seconds = 0;
        recorder.ondataavailable = (event) => {
          if (!event.data?.size) return;
          this.chunks.push(event.data);
          this.size += event.data.size;
        };
        recorder.onstop = () => this.finish(type);
        // Stopping the share from the browser's own bar ends the recording too.
        display
          .getVideoTracks()[0]
          ?.addEventListener('ended', () => this.stop());
        recorder.start(1000);
        this.recorder = recorder;
        this.state = 'recording';
        this.ticker = setInterval(() => {
          if (this.state === 'recording') this.seconds += 0.25;
        }, 250);
      } catch (error) {
        this.stopTracks();
        // Cancelling the "choose what to share" window isn't an error worth shouting about.
        this.error =
          error?.name === 'NotAllowedError'
            ? null
            : (error?.message ?? 'Couldn’t start recording');
        this.state = 'idle';
      }
    };

    pause = () => {
      if (this.state !== 'recording') return;
      this.recorder?.pause();
      this.state = 'paused';
    };

    resume = () => {
      if (this.state !== 'paused') return;
      this.recorder?.resume();
      this.state = 'recording';
    };

    stop = () => {
      if (!this.recording) return;
      this.recorder?.stop();
    };

    async finish(type) {
      clearInterval(this.ticker);
      this.ticker = null;
      this.stopTracks();
      let blob = new Blob(this.chunks, { type: type || 'video/webm' });
      this.chunks = [];
      this.recorder = null;
      if (!blob.type.includes('mp4')) {
        // The browser could only write WebM, so FFmpeg makes the MP4.
        this.state = 'converting';
        this.convertProgress = 0;
        this.convertStatus = 'Starting the audio/video engine…';
        try {
          blob = await runFFmpeg(new File([blob], 'recording.webm'), {
            out: 'mp4',
            type: 'video/mp4',
            duration: this.seconds,
            build: (input) => [
              '-i',
              input,
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '23',
              '-pix_fmt',
              'yuv420p',
              '-c:a',
              'aac',
              '-b:a',
              '160k',
              '-movflags',
              '+faststart',
            ],
            onStatus: (status) => (this.convertStatus = status),
            onProgress: (progress) => (this.convertProgress = progress),
          });
        } catch (error) {
          // The WebM is still a perfectly good recording; hand that over instead.
          this.error = `Couldn’t convert to MP4 (${error?.message ?? 'unknown error'}), so here it is as WebM.`;
        }
      }
      this.resultUrl = URL.createObjectURL(blob);
      this.resultSize = blob.size;
      this.resultType = blob.type;
      this.state = 'done';
    }

    again = () => {
      if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      this.resultUrl = null;
      this.state = 'idle';
      this.seconds = 0;
      this.size = 0;
    };
  }
</script>

<script>
  let args = $props();
  const self = new ScreenRecorderPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="screen-recorder"
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
  subtitle="Record your screen, a window or a tab, with its sound and your microphone if you like. The video is made on your device and stays there."
>
  <div class="fs">
    <div class="fs-frame fc-panel pop-in">
      {#if truthy(self.supported)}
        <div class="rec-stage">
          <!-- template-lint-disable require-media-caption -->
          <video
            class="rec-preview"
            muted
            playsinline
            {@attach self.showLive?.()}
          ></video>
          {#if truthy(self.recording)}
            <span
              class="rec-dot {truthy(eq(self.state, 'paused'))
                ? 'is-paused'
                : ''}"
              aria-hidden="true"
            ></span>
            <span class="rec-clock"
              >{self.clock}
              ·
              {formatBytes(self.size)}</span
            >
          {/if}
        </div>

        <div class="settings-actions">
          {#if truthy(self.recording)}
            {#if truthy(eq(self.state, 'paused'))}
              <button type="button" class="btn active" onclick={self.resume}
                ><Icon name="play" size={14} /> Carry on</button
              >
            {:else}
              <button type="button" class="btn" onclick={self.pause}
                ><Icon name="pause" size={14} /> Pause</button
              >
            {/if}
            <button type="button" class="btn" onclick={self.stop}
              ><Icon name="square" size={14} />
              Stop</button
            >
          {:else}
            <button type="button" class="btn active" onclick={self.start}
              ><Icon name="circle-dot" size={14} />
              Start recording</button
            >
          {/if}
        </div>

        {#if !truthy(self.recording)}
          <div class="math-row">
            <label class="math-field">
              <span class="qr-label is-muted">Quality</span>
              <div class="math-tabs" role="group" aria-label="Quality">
                {#each self.qualities ?? [] as q}
                  <button
                    type="button"
                    class="qr-tab {truthy(eq(self.quality, q?.id))
                      ? 'active'
                      : ''}"
                    onclick={(..._r) => self.pick('quality', q?.id, ..._r)}
                    >{q?.label}</button
                  >
                {/each}
              </div>
            </label>
            <label class="math-field">
              <span class="qr-label is-muted">Frames a second</span>
              <div class="math-tabs" role="group" aria-label="Frames a second">
                {#each self.frameRates ?? [] as f}
                  <button
                    type="button"
                    class="qr-tab {truthy(eq(self.fps, f)) ? 'active' : ''}"
                    onclick={(..._r) => self.pick('fps', f, ..._r)}>{f}</button
                  >
                {/each}
              </div>
            </label>
          </div>

          <label class="lobby-rule is-switch">
            <span class="lobby-rule-text"
              ><span class="qr-label">Sound from the screen</span><span
                class="tool-hint"
                >Chrome and Edge can catch a tab's or the system's sound;
                Firefox and Safari mostly can't.</span
              ></span
            >
            <span class="qr-switch">
              <input
                type="checkbox"
                role="switch"
                {@attach prop('checked', () => self.withSystemAudio)}
                aria-checked={truthy(self.withSystemAudio) ? 'true' : 'false'}
                onchange={(..._r) => self.toggle('withSystemAudio', ..._r)}
              />
              <span class="qr-switch-track" aria-hidden="true"></span>
            </span>
          </label>
          <label class="lobby-rule is-switch">
            <span class="lobby-rule-text"
              ><span class="qr-label">My microphone</span><span
                class="tool-hint"
                >Talk over what you're showing. You'll be asked for permission.</span
              ></span
            >
            <span class="qr-switch">
              <input
                type="checkbox"
                role="switch"
                {@attach prop('checked', () => self.withMic)}
                aria-checked={truthy(self.withMic) ? 'true' : 'false'}
                onchange={(..._r) => self.toggle('withMic', ..._r)}
              />
              <span class="qr-switch-track" aria-hidden="true"></span>
            </span>
          </label>
        {/if}

        {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
        {#if truthy(eq(self.state, 'converting'))}
          <div class="rec-convert" aria-live="polite">
            <Icon name="loader-pinwheel" size={16} />
            <span>{self.convertStatus}</span>
            <progress max="1" value={self.convertProgress}></progress>
          </div>
        {/if}
        <p class="tool-hint"
          >You pick what to share when you press start. Recordings come out as
          MP4 (straight from the browser where it can, otherwise converted here
          after you stop), and the Trimmer and the file converter can take it
          from there.</p
        >
      {:else}
        <p class="tool-error"
          >This browser can't record the screen. Chrome, Edge, Firefox or Safari
          on a computer can.</p
        >
      {/if}
    </div>

    {#if truthy(self.resultUrl)}
      <div class="fs-frame fc-panel pop-in">
        <div class="fc-toolbar">
          <h3 class="qr-heading">Your recording</h3>
          <div class="settings-actions">
            <a
              class="btn fs-save"
              href={self.resultUrl}
              download={self.resultName}
              ><Icon name="download" size={13} /> Save</a
            >
            <button type="button" class="btn" onclick={self.again}
              >Record another</button
            >
          </div>
        </div>
        <p class="tool-hint"
          >{self.clock}
          ·
          {formatBytes(self.resultSize)}</p
        >
        <!-- template-lint-disable require-media-caption -->
        <video class="rec-result" controls src={self.resultUrl}></video>
      </div>
    {/if}
  </div>
</ToolPage>
