import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';

// Whatever the browser can write: Opus in WebM nearly everywhere, MP4 on Safari.
const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];
const extFor = (mime) =>
  mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';

const eq = (a, b) => a === b;
const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

export default class AudioRecorderPage extends Component {
  @tracked state = 'idle'; // 'idle' | 'recording' | 'paused'
  @tracked elapsed = 0;
  @tracked level = 0;
  @tracked error = null;
  @tracked recordings = [];

  stream = null;
  recorder = null;
  chunks = [];
  audio = null;
  analyser = null;
  startedAt = 0;
  pausedFor = 0;
  pausedAt = 0;
  frame = 0;
  canvas = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => {
      this.teardown();
      for (const r of this.recordings) URL.revokeObjectURL(r.url);
    });
  }

  get busy() {
    return this.state !== 'idle';
  }

  get time() {
    return clock(this.elapsed);
  }

  get levelStyle() {
    return htmlSafe(`width:${Math.round(this.level * 100)}%`);
  }

  meter = modifier((canvas) => {
    this.canvas = canvas;
    return () => (this.canvas = null);
  });

  start = async () => {
    this.error = null;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      this.error = 'This browser cannot record audio.';
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      this.error = 'The microphone was not allowed. Check the site permission.';
      return;
    }
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
    this.recorder.start(250);

    this.audio = new (window.AudioContext ?? window.webkitAudioContext)();
    this.analyser = this.audio.createAnalyser();
    this.analyser.fftSize = 512;
    this.audio.createMediaStreamSource(this.stream).connect(this.analyser);

    this.startedAt = performance.now();
    this.pausedFor = 0;
    this.elapsed = 0;
    this.state = 'recording';
    this.tick();
  };

  tick = () => {
    if (this.state === 'idle') return;
    if (this.state === 'recording')
      this.elapsed = performance.now() - this.startedAt - this.pausedFor;
    this.draw();
    this.frame = requestAnimationFrame(this.tick);
  };

  draw() {
    const canvas = this.canvas;
    if (!canvas || !this.analyser) return;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) {
      const d = (v - 128) / 128;
      sum += d * d;
    }
    const rms = Math.sqrt(sum / data.length);
    this.level = this.state === 'recording' ? Math.min(1, rms * 3) : 0;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = getComputedStyle(canvas).color;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w;
      const y = (data[i] / 255) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  pause = () => {
    if (this.state !== 'recording') return;
    this.recorder.pause();
    this.pausedAt = performance.now();
    this.state = 'paused';
  };

  resume = () => {
    if (this.state !== 'paused') return;
    this.pausedFor += performance.now() - this.pausedAt;
    this.recorder.resume();
    this.state = 'recording';
  };

  stop = () => {
    if (this.state === 'idle') return;
    if (this.state === 'paused')
      this.pausedFor += performance.now() - this.pausedAt;
    this.elapsed = performance.now() - this.startedAt - this.pausedFor;
    this.recorder.stop();
  };

  finish() {
    const mime = this.recorder?.mimeType || 'audio/webm';
    const blob = new Blob(this.chunks, { type: mime });
    const at = new Date();
    this.recordings = [
      {
        id: at.getTime(),
        url: URL.createObjectURL(blob),
        name: `recording-${at.toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${extFor(mime)}`,
        length: clock(this.elapsed),
        size: `${(blob.size / 1024).toFixed(0)} KB`,
      },
      ...this.recordings,
    ];
    this.teardown();
    this.state = 'idle';
    this.level = 0;
  }

  teardown() {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.analyser = null;
    this.audio?.close?.();
    this.audio = null;
  }

  remove = (rec) => {
    URL.revokeObjectURL(rec.url);
    this.recordings = this.recordings.filter((r) => r !== rec);
  };

  <template>
    <ToolPage
      @route="audio-recorder"
      @subtitle="Record from your microphone, watch the level as you go, then listen back and save the take."
      @busy={{this.busy}}
      @closeWarning="a recording in progress"
    >
      <div class="math-grid pop-in">
        <section class="math-card rec-card">
          <div class="rec-display {{if (eq this.state 'recording') 'is-live'}}">
            <canvas
              class="rec-wave"
              width="600"
              height="120"
              aria-hidden="true"
              {{this.meter}}
            ></canvas>
            <div class="rec-clock">
              {{#if (eq this.state "recording")}}<span
                  class="rec-dot"
                ></span>{{/if}}
              {{this.time}}
            </div>
          </div>
          <div class="rec-level" aria-hidden="true">
            <span style={{this.levelStyle}}></span>
          </div>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
          <div class="settings-actions rec-actions">
            {{#if (eq this.state "idle")}}
              <button
                type="button"
                class="btn active"
                {{on "click" this.start}}
              >
                <Icon @name="mic" @size={{14}} />
                Record</button>
            {{else}}
              {{#if (eq this.state "recording")}}
                <button type="button" class="btn" {{on "click" this.pause}}>
                  <Icon @name="pause" @size={{14}} />
                  Pause</button>
              {{else}}
                <button type="button" class="btn" {{on "click" this.resume}}>
                  <Icon @name="play" @size={{14}} />
                  Resume</button>
              {{/if}}
              <button type="button" class="btn active" {{on "click" this.stop}}>
                <Icon @name="circle-stop" @size={{14}} />
                Stop</button>
            {{/if}}
          </div>
          <p class="tool-hint">The microphone is only on while you're recording,
            and nothing is sent anywhere.</p>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Recordings</h3>
          {{#if this.recordings.length}}
            <ul class="rec-list">
              {{#each this.recordings key="id" as |rec|}}
                <li class="rec-item">
                  <div class="rec-item-head">
                    <span class="rec-item-name">{{rec.name}}</span>
                    <span class="is-muted">{{rec.length}} · {{rec.size}}</span>
                  </div>
                  {{! template-lint-disable require-media-caption }}
                  <audio controls src={{rec.url}} class="rec-audio"></audio>
                  <div class="settings-actions">
                    <a
                      class="btn fs-save"
                      href={{rec.url}}
                      download={{rec.name}}
                    >
                      <Icon @name="download" @size={{13}} />
                      Save</a>
                    <button
                      type="button"
                      class="btn"
                      aria-label="Delete {{rec.name}}"
                      {{on "click" (fn this.remove rec)}}
                    ><Icon @name="trash-2" @size={{13}} /></button>
                  </div>
                </li>
              {{/each}}
            </ul>
            <p class="tool-hint">These are kept in memory: save the ones you
              want before leaving the page.</p>
          {{else}}
            <p class="tool-hint">Nothing recorded yet. Press Record to start.</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
