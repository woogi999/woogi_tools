import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import { formatBytes } from '../utils/file-share';
import { formatTime } from '../utils/media-jobs';

// Records your screen, a window or a tab, with the sound from it and/or your
// microphone. The browser does the recording; nothing is sent anywhere.

// In the browser's own order of preference: whatever it supports first.
const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const QUALITY = [
  { id: 'high', label: 'High', bits: 8_000_000 },
  { id: 'normal', label: 'Normal', bits: 4_000_000 },
  { id: 'small', label: 'Small file', bits: 1_500_000 },
];
const FPS = [60, 30, 24, 15];
const eq = (a, b) => a === b;

const supportedType = () => TYPES.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) ?? '';

export default class ScreenRecorderPage extends Component {
  @tracked state = 'idle'; // 'idle' | 'recording' | 'paused' | 'done'
  @tracked seconds = 0;
  @tracked size = 0;
  @tracked error = null;
  @tracked resultUrl = null;
  @tracked resultSize = 0;
  @tracked withSystemAudio = true;
  @tracked withMic = false;
  @tracked quality = 'normal';
  @tracked fps = 30;

  qualities = QUALITY;
  frameRates = FPS;
  recorder = null;
  chunks = [];
  streams = [];
  ticker = null;
  liveVideo = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => {
      this.stopTracks();
      clearInterval(this.ticker);
      if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    });
  }

  get supported() {
    return Boolean(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder);
  }

  get recording() {
    return this.state === 'recording' || this.state === 'paused';
  }

  get clock() {
    return formatTime(this.seconds);
  }

  get resultName() {
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(/[:T]/g, '-');
    return `screen-${stamp}.${supportedType().includes('mp4') ? 'mp4' : 'webm'}`;
  }

  // The live picture while you record, so you can see what's being caught.
  showLive = modifier((element) => {
    this.liveVideo = element;
    return () => (this.liveVideo = null);
  });

  stopTracks() {
    for (const stream of this.streams) for (const track of stream.getTracks()) track.stop();
    this.streams = [];
    if (this.liveVideo) this.liveVideo.srcObject = null;
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
      let tracks = [...display.getVideoTracks(), ...display.getAudioTracks()];
      // A microphone is a second stream, mixed in beside the screen's own sound.
      if (this.withMic) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.streams.push(mic);
          tracks = [...tracks, ...mic.getAudioTracks()];
        } catch {
          this.error = 'Couldn’t use the microphone, so it’s recording without it.';
        }
      }
      const stream = new MediaStream(tracks);
      if (this.liveVideo) {
        this.liveVideo.srcObject = display;
        this.liveVideo.play?.().catch(() => {});
      }
      const type = supportedType();
      const recorder = new MediaRecorder(stream, {
        ...(type ? { mimeType: type } : {}),
        videoBitsPerSecond: QUALITY.find((q) => q.id === this.quality)?.bits ?? 4_000_000,
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
      display.getVideoTracks()[0]?.addEventListener('ended', () => this.stop());
      recorder.start(1000);
      this.recorder = recorder;
      this.state = 'recording';
      this.ticker = setInterval(() => {
        if (this.state === 'recording') this.seconds += 0.25;
      }, 250);
    } catch (error) {
      this.stopTracks();
      // Cancelling the "choose what to share" window isn't an error worth shouting about.
      this.error = error?.name === 'NotAllowedError' ? null : (error?.message ?? 'Couldn’t start recording');
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

  finish(type) {
    clearInterval(this.ticker);
    this.ticker = null;
    this.stopTracks();
    const blob = new Blob(this.chunks, { type: type || 'video/webm' });
    this.chunks = [];
    this.recorder = null;
    this.resultUrl = URL.createObjectURL(blob);
    this.resultSize = blob.size;
    this.state = 'done';
  }

  again = () => {
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    this.resultUrl = null;
    this.state = 'idle';
    this.seconds = 0;
    this.size = 0;
  };

  <template>
    <ToolPage @route="screen-recorder" @subtitle="Record your screen, a window or a tab, with its sound and your microphone if you like. The video is made on your device and stays there.">
      <div class="fs">
        <div class="fs-frame fc-panel pop-in">
          {{#if this.supported}}
            <div class="rec-stage">
              {{! template-lint-disable require-media-caption }}
              <video class="rec-preview" muted playsinline {{this.showLive}}></video>
              {{#if this.recording}}
                <span class="rec-dot {{if (eq this.state 'paused') 'is-paused'}}" aria-hidden="true"></span>
                <span class="rec-clock">{{this.clock}} · {{formatBytes this.size}}</span>
              {{/if}}
            </div>

            <div class="settings-actions">
              {{#if this.recording}}
                {{#if (eq this.state "paused")}}
                  <button type="button" class="btn active" {{on "click" this.resume}}><Icon @name="play" @size={{14}} /> Carry on</button>
                {{else}}
                  <button type="button" class="btn" {{on "click" this.pause}}><Icon @name="pause" @size={{14}} /> Pause</button>
                {{/if}}
                <button type="button" class="btn" {{on "click" this.stop}}><Icon @name="square" @size={{14}} /> Stop</button>
              {{else}}
                <button type="button" class="btn active" {{on "click" this.start}}><Icon @name="circle-dot" @size={{14}} /> Start recording</button>
              {{/if}}
            </div>

            {{#unless this.recording}}
              <div class="math-row">
                <label class="math-field">
                  <span class="qr-label is-muted">Quality</span>
                  <div class="math-tabs" role="group" aria-label="Quality">
                    {{#each this.qualities as |q|}}
                      <button type="button" class="qr-tab {{if (eq this.quality q.id) 'active'}}" {{on "click" (fn this.pick "quality" q.id)}}>{{q.label}}</button>
                    {{/each}}
                  </div>
                </label>
                <label class="math-field">
                  <span class="qr-label is-muted">Frames a second</span>
                  <div class="math-tabs" role="group" aria-label="Frames a second">
                    {{#each this.frameRates as |f|}}
                      <button type="button" class="qr-tab {{if (eq this.fps f) 'active'}}" {{on "click" (fn this.pick "fps" f)}}>{{f}}</button>
                    {{/each}}
                  </div>
                </label>
              </div>

              <label class="lobby-rule is-switch">
                <span class="lobby-rule-text"><span class="qr-label">Sound from the screen</span><span class="tool-hint">Chrome and Edge can catch a tab's or the system's sound; Firefox and Safari mostly can't.</span></span>
                <span class="qr-switch">
                  <input type="checkbox" role="switch" checked={{this.withSystemAudio}} aria-checked={{if this.withSystemAudio "true" "false"}} {{on "change" (fn this.toggle "withSystemAudio")}} />
                  <span class="qr-switch-track" aria-hidden="true"></span>
                </span>
              </label>
              <label class="lobby-rule is-switch">
                <span class="lobby-rule-text"><span class="qr-label">My microphone</span><span class="tool-hint">Talk over what you're showing. You'll be asked for permission.</span></span>
                <span class="qr-switch">
                  <input type="checkbox" role="switch" checked={{this.withMic}} aria-checked={{if this.withMic "true" "false"}} {{on "change" (fn this.toggle "withMic")}} />
                  <span class="qr-switch-track" aria-hidden="true"></span>
                </span>
              </label>
            {{/unless}}

            {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
            <p class="tool-hint">You pick what to share when you press start. Recordings come out as WebM (MP4 in Safari) — the Trimmer and the file converter can take it from there.</p>
          {{else}}
            <p class="tool-error">This browser can't record the screen. Chrome, Edge, Firefox or Safari on a computer can.</p>
          {{/if}}
        </div>

        {{#if this.resultUrl}}
          <div class="fs-frame fc-panel pop-in">
            <div class="fc-toolbar">
              <h3 class="qr-heading">Your recording</h3>
              <div class="settings-actions">
                <a class="btn fs-save" href={{this.resultUrl}} download={{this.resultName}}><Icon @name="download" @size={{13}} /> Save</a>
                <button type="button" class="btn" {{on "click" this.again}}>Record another</button>
              </div>
            </div>
            <p class="tool-hint">{{this.clock}} · {{formatBytes this.resultSize}}</p>
            {{! template-lint-disable require-media-caption }}
            <video class="rec-result" controls src={{this.resultUrl}}></video>
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
