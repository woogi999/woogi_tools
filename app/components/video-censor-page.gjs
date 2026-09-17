import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import ColourField from './colour-field';
import { acceptPastedFiles } from '../utils/paste-files';
import { formatBytes } from '../utils/file-share';
import { runFFmpeg, baseName, formatTime } from '../utils/media-jobs';
import { EFFECTS, censor } from '../utils/censor-image';
import { greyFrame, follow, findFaces, seekTo } from '../utils/track';
import { keepState } from '../utils/tool-state';

// Blurs faces, plates and anything else out of a video. Draw a box on a frame,
// let it follow the thing as it moves, and the effect is painted onto every
// frame as the video is written back out. All on your device.

const TOOLS = [
  { id: 'rect', label: 'Box', icon: 'square' },
  { id: 'ellipse', label: 'Oval', icon: 'circle' },
  { id: 'brush', label: 'Brush', icon: 'brush' },
];
const TRACK_STEP = 1 / 12;
const eq = (a, b) => a === b;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const progressWidth = (p) => htmlSafe(`width:${Math.round((p ?? 0) * 100)}%`);
const isVideo = (file) =>
  file.type.startsWith('video/') ||
  /\.(mp4|mkv|mov|webm|avi|m4v|ts|mpg|mpeg)$/i.test(file.name);
let nextId = 1;

// Where a tracked mark is at time t: the keyframes either side, blended.
function boxAt(mark, t) {
  const keys = mark.keys;
  if (t <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (t >= last.t) return last;
  let i = 1;
  while (keys[i].t < t) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const k = (t - a.t) / (b.t - a.t || 1);
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    w: a.w + (b.w - a.w) * k,
    h: a.h + (b.h - a.h) * k,
  };
}

export default class VideoCensorPage extends Component {
  get pipBusy() {
    return this.busy || this.tracking;
  }

  get pipWarning() {
    return 'Close the Video Censor? The video being written will be lost.';
  }
  @tracked file = null;
  @tracked mediaUrl = null;
  @tracked duration = 0;
  @tracked time = 0;
  @tracked playing = false;
  @tracked marks = [];
  @tracked selectedId = null;
  @tracked draft = null;
  @tracked tool = 'rect';
  @tracked effect = 'blur';
  @tracked strength = 50;
  @tracked brushSize = 6;
  @tracked colour = '#000000';
  @tracked dragging = false;
  @tracked tracking = false;
  @tracked trackProgress = 0;
  @tracked busy = false;
  @tracked status = '';
  @tracked progress = 0;
  @tracked error = null;
  @tracked notice = null;
  @tracked resultUrl = null;
  @tracked resultSize = 0;
  @tracked resultExt = 'webm';
  @tracked toMp4 = false;

  tools = TOOLS;
  effects = EFFECTS;
  canvas = null;
  video = null;
  frame = null;
  stopTracking = false;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'video-censor', [
      'tool',
      'effect',
      'strength',
      'brushSize',
      'colour',
      'toMp4',
    ]);
    registerDestructor(this, () => {
      cancelAnimationFrame(this.frame);
      this.stopTracking = true;
      this.clearUrls();
    });
  }

  clearUrls() {
    if (this.mediaUrl) URL.revokeObjectURL(this.mediaUrl);
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
  }

  get canFindFaces() {
    return 'FaceDetector' in window;
  }

  get selected() {
    return this.marks.find((m) => m.id === this.selectedId) ?? null;
  }

  get usesColour() {
    return this.effect === 'colour';
  }

  get noMarks() {
    return this.marks.length === 0;
  }

  get resultName() {
    return `${baseName(this.file?.name ?? 'video')}-censored.${this.resultExt}`;
  }

  get markRows() {
    return this.marks.map((m, i) => ({
      ...m,
      label: `${m.type === 'rect' ? 'Box' : m.type === 'ellipse' ? 'Oval' : 'Brush'} ${i + 1}`,
      effectLabel: EFFECTS.find((e) => e.id === m.effect)?.label ?? m.effect,
      range: `${formatTime(m.start)} to ${formatTime(m.end)}`,
      tracked: m.keys?.length > 1,
      selected: m.id === this.selectedId,
    }));
  }

  // The marks that are on screen at time t, in the shape censor() paints.
  marksAt(t, { draft = true } = {}) {
    const out = [];
    for (const mark of this.marks) {
      if (t < mark.start || t > mark.end) continue;
      if (mark.type === 'brush') out.push(mark);
      else out.push({ ...mark, ...boxAt(mark, t) });
    }
    if (draft && this.draft) out.push(this.draft);
    return out;
  }

  bindVideo = modifier((element) => {
    this.video = element;
    const onTime = () => {
      this.time = element.currentTime;
      if (!this.playing) this.draw();
    };
    const onMeta = () => {
      this.duration = element.duration || 0;
      this.draw();
    };
    const onEnd = () => (this.playing = false);
    element.addEventListener('timeupdate', onTime);
    element.addEventListener('seeked', onTime);
    element.addEventListener('loadedmetadata', onMeta);
    element.addEventListener('loadeddata', onMeta);
    element.addEventListener('ended', onEnd);
    element.addEventListener('pause', onEnd);
    return () => {
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('seeked', onTime);
      element.removeEventListener('loadedmetadata', onMeta);
      element.removeEventListener('loadeddata', onMeta);
      element.removeEventListener('ended', onEnd);
      element.removeEventListener('pause', onEnd);
      this.video = null;
    };
  });

  bindCanvas = modifier((element) => {
    this.canvas = element;
    this.draw();
    return () => (this.canvas = null);
  });

  draw() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.paint());
  }

  paint() {
    const { canvas, video } = this;
    if (!canvas || !video || video.readyState < 2) return;
    const t = video.currentTime;
    censor(canvas, video, this.marksAt(t), { colour: this.colour });
    // Outlines so you can see where the marks are; never part of the output.
    const ctx = canvas.getContext('2d');
    const accent =
      getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#4ea8de';
    for (const mark of this.marksAt(t)) {
      if (mark.type === 'brush') continue;
      ctx.strokeStyle =
        mark.id === this.selectedId ? accent : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = mark.id === this.selectedId ? 4 : 2;
      ctx.setLineDash(mark.id === this.selectedId ? [] : [8, 6]);
      const x = mark.x * canvas.width;
      const y = mark.y * canvas.height;
      const w = mark.w * canvas.width;
      const h = mark.h * canvas.height;
      if (mark.type === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else ctx.strokeRect(x, y, w, h);
    }
    ctx.setLineDash([]);
    if (this.playing) this.frame = requestAnimationFrame(() => this.paint());
  }

  async open(file) {
    if (!file || !isVideo(file)) {
      this.error = 'That doesn’t look like a video.';
      return;
    }
    this.clearUrls();
    this.resultUrl = null;
    this.error = this.notice = null;
    this.marks = [];
    this.selectedId = null;
    this.file = file;
    this.mediaUrl = URL.createObjectURL(file);
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
  pick = (key, value) => (this[key] = value);
  number = (key, event) => (this[key] = Number(event.target.value) || 0);
  setColour = (value) => (this.colour = value);
  toggleMp4 = (event) => (this.toMp4 = event.target.checked);

  scrub = (event) => {
    if (!this.video) return;
    this.pause();
    this.video.currentTime = Number(event.target.value) || 0;
  };

  step = (seconds) => {
    if (!this.video) return;
    this.pause();
    this.video.currentTime = Math.min(
      this.duration,
      Math.max(0, this.video.currentTime + seconds),
    );
  };

  togglePlay = () => {
    if (!this.video) return;
    if (this.playing) return this.pause();
    this.video.play();
    this.playing = true;
    this.paint();
  };

  pause() {
    this.video?.pause();
    this.playing = false;
  }

  at(event) {
    const rect = this.canvas.getBoundingClientRect();
    return [
      clamp01((event.clientX - rect.left) / rect.width),
      clamp01((event.clientY - rect.top) / rect.height),
    ];
  }

  base() {
    return {
      id: nextId++,
      effect: this.effect,
      strength: this.strength,
      colour: this.colour,
      start: this.time,
      end: this.duration,
    };
  }

  pointerDown = (event) => {
    if (!this.video || event.button || this.tracking) return;
    event.preventDefault();
    this.pause();
    this.canvas.setPointerCapture(event.pointerId);
    const [x, y] = this.at(event);
    this.draft =
      this.tool === 'brush'
        ? {
            ...this.base(),
            type: 'brush',
            size: this.brushSize / 100,
            points: [[x, y]],
          }
        : { ...this.base(), type: this.tool, x, y, w: 0, h: 0, ox: x, oy: y };
    this.draw();
  };

  pointerMove = (event) => {
    if (!this.draft) return;
    const [x, y] = this.at(event);
    if (this.draft.type === 'brush') {
      this.draft = { ...this.draft, points: [...this.draft.points, [x, y]] };
    } else {
      const { ox, oy } = this.draft;
      this.draft = {
        ...this.draft,
        x: Math.min(ox, x),
        y: Math.min(oy, y),
        w: Math.abs(x - ox),
        h: Math.abs(y - oy),
      };
    }
    this.draw();
  };

  pointerUp = () => {
    if (!this.draft) return;
    const mark = this.draft;
    this.draft = null;
    const tooSmall =
      mark.type !== 'brush' && (mark.w < 0.005 || mark.h < 0.005);
    if (!tooSmall) this.addMark(mark);
    this.draw();
  };

  addMark(mark) {
    if (mark.type !== 'brush') {
      mark.keys = [
        { t: mark.start, x: mark.x, y: mark.y, w: mark.w, h: mark.h },
      ];
      delete mark.ox;
      delete mark.oy;
    }
    this.marks = [...this.marks, mark];
    this.selectedId = mark.id;
    this.resultUrl = null;
  }

  update(id, patch) {
    this.marks = this.marks.map((m) => (m.id === id ? { ...m, ...patch } : m));
    this.resultUrl = null;
    this.draw();
  }

  select = (id) => {
    this.selectedId = id;
    this.draw();
  };

  remove = (id) => {
    this.marks = this.marks.filter((m) => m.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.resultUrl = null;
    this.draw();
  };

  startHere = (id) => {
    const mark = this.marks.find((m) => m.id === id);
    if (mark)
      this.update(id, { start: this.time, end: Math.max(mark.end, this.time) });
  };

  endHere = (id) => {
    const mark = this.marks.find((m) => m.id === id);
    if (mark)
      this.update(id, {
        end: this.time,
        start: Math.min(mark.start, this.time),
      });
  };

  // Steps forward from the current frame, following the box until the end of
  // the mark, the end of the video, or the thing is lost.
  track = async (id) => {
    const mark = this.marks.find((m) => m.id === id);
    if (!mark || mark.type === 'brush' || this.tracking || !this.video) return;
    this.pause();
    this.tracking = true;
    this.stopTracking = false;
    this.notice = null;
    const video = this.video;
    const from = video.currentTime;
    let box = boxAt(mark, from);
    // Anything already keyed after this point is replaced by the new track.
    let keys = [...mark.keys.filter((k) => k.t < from), { t: from, ...box }];
    let previous = greyFrame(video);
    let t = from;
    let lost = false;
    try {
      while (
        !this.stopTracking &&
        t + TRACK_STEP <= Math.min(mark.end, this.duration)
      ) {
        t += TRACK_STEP;
        await seekTo(video, t);
        const next = greyFrame(video);
        const found = follow(previous, next, box);
        if (!found) {
          lost = true;
          break;
        }
        box = found;
        keys.push({ t, ...box });
        previous = next;
        this.trackProgress =
          (t - from) / Math.max(0.01, Math.min(mark.end, this.duration) - from);
        if (keys.length % 6 === 0) this.update(id, { keys: [...keys] });
      }
    } finally {
      this.tracking = false;
      this.update(id, { keys, end: lost ? t : mark.end });
      if (lost)
        this.notice = `Lost it at ${formatTime(t)}, so the mark ends there. Scrub on, draw it again and track from there if it comes back.`;
      this.trackProgress = 0;
    }
  };

  cancelTrack = () => (this.stopTracking = true);

  faces = async () => {
    if (!this.video) return;
    this.pause();
    const found = await findFaces(this.video);
    if (!found) {
      this.notice =
        'This browser has no face finder built in (Chrome on Android and Mac do). Draw the boxes by hand instead.';
      return;
    }
    if (!found.length) {
      this.notice = 'No faces found on this frame.';
      return;
    }
    for (const box of found)
      this.addMark({ ...this.base(), type: 'ellipse', ...box });
    this.notice = `${found.length} ${found.length === 1 ? 'face' : 'faces'} marked. Press Track on each to follow it through the clip.`;
    this.draw();
  };

  // Plays the video through a hidden copy, paints each frame with the marks
  // and records the canvas (with the sound routed through Web Audio so it is
  // captured without being heard).
  render = async () => {
    if (!this.file || !this.marks.length || this.busy) return;
    this.pause();
    this.busy = true;
    this.error = null;
    this.progress = 0;
    this.status = 'Writing the frames…';
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    this.resultUrl = null;
    const video = document.createElement('video');
    video.src = this.mediaUrl;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    let audioCtx = null;
    try {
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () =>
          reject(new Error('The video couldn’t be decoded'));
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const stream = canvas.captureStream(30);
      try {
        audioCtx = new AudioContext();
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        for (const track of dest.stream.getAudioTracks())
          stream.addTrack(track);
      } catch {
        // No audio graph: the picture still comes out, just silent.
      }
      const mime = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ].find((m) => MediaRecorder.isTypeSupported(m));
      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 8e6,
      });
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise((resolve) => (recorder.onstop = resolve));
      const paintFrame = () => {
        censor(
          canvas,
          video,
          this.marksAt(video.currentTime, { draft: false }),
          { colour: this.colour },
        );
        this.progress = video.duration
          ? (video.currentTime / video.duration) * (this.toMp4 ? 0.6 : 1)
          : 0;
      };
      const loop = () => {
        if (video.ended || video.paused) return;
        paintFrame();
        if (video.requestVideoFrameCallback)
          video.requestVideoFrameCallback(loop);
        else requestAnimationFrame(loop);
      };
      recorder.start(500);
      paintFrame();
      await video.play();
      loop();
      await new Promise((resolve) => (video.onended = resolve));
      paintFrame();
      recorder.stop();
      await done;
      let blob = new Blob(chunks, { type: 'video/webm' });
      let ext = 'webm';
      if (this.toMp4) {
        this.status = 'Converting to MP4…';
        blob = await runFFmpeg(
          new File([blob], 'blurred.webm', { type: 'video/webm' }),
          {
            out: 'mp4',
            type: 'video/mp4',
            duration: this.duration,
            build: (input) => [
              '-i',
              input,
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '20',
              '-pix_fmt',
              'yuv420p',
              '-c:a',
              'aac',
              '-b:a',
              '160k',
              '-movflags',
              '+faststart',
            ],
            onProgress: (p) => (this.progress = 0.6 + p * 0.4),
          },
        );
        ext = 'mp4';
      }
      this.resultUrl = URL.createObjectURL(blob);
      this.resultSize = blob.size;
      this.resultExt = ext;
      this.progress = 1;
    } catch (error) {
      this.error = error?.message ?? 'Couldn’t write the video out';
    } finally {
      video.pause();
      video.removeAttribute('src');
      audioCtx?.close().catch(() => {});
      this.busy = false;
      this.status = '';
    }
  };

  reset = () => {
    this.pause();
    this.clearUrls();
    this.file = this.mediaUrl = this.resultUrl = null;
    this.marks = [];
    this.duration = this.time = 0;
    this.error = this.notice = null;
  };

  <template>
    {{! template-lint-disable no-pointer-down-event-binding }}
    <ToolPage
      @route="video-censor"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Blur, pixelate or black out faces and anything else in a video. Draw a box on one frame, let it follow the thing as it moves, and the effect is painted onto every frame. Nothing is uploaded."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        {{#if this.file}}
          <div class="ie-layout">
            <div class="ie-stage">
              {{! template-lint-disable require-media-caption }}
              <video
                class="vb-source"
                muted
                playsinline
                preload="auto"
                src={{this.mediaUrl}}
                {{this.bindVideo}}
              ></video>
              <div class="ie-canvas-wrap vb-wrap">
                <canvas
                  class="ie-canvas ic-canvas"
                  {{this.bindCanvas}}
                  {{on "pointerdown" this.pointerDown}}
                  {{on "pointermove" this.pointerMove}}
                  {{on "pointerup" this.pointerUp}}
                  {{on "pointercancel" this.pointerUp}}
                ></canvas>
              </div>
              <div class="vb-timeline">
                <button
                  type="button"
                  class="btn"
                  aria-label={{if this.playing "Pause" "Play"}}
                  {{on "click" this.togglePlay}}
                ><Icon
                    @name={{if this.playing "pause" "play"}}
                    @size={{13}}
                  /></button>
                <button
                  type="button"
                  class="btn"
                  title="Back a frame"
                  {{on "click" (fn this.step -0.04)}}
                >‹</button>
                <button
                  type="button"
                  class="btn"
                  title="Forward a frame"
                  {{on "click" (fn this.step 0.04)}}
                >›</button>
                <input
                  type="range"
                  class="vb-scrub"
                  min="0"
                  max={{this.duration}}
                  step="0.01"
                  value={{this.time}}
                  aria-label="Position"
                  {{on "input" this.scrub}}
                />
                <span class="tool-hint vb-time">{{formatTime this.time}}
                  /
                  {{formatTime this.duration}}</span>
              </div>
              {{#if this.tracking}}
                <div class="fs-progress"><div
                    class="fs-progress-bar"
                    style={{progressWidth this.trackProgress}}
                  ></div></div>
                <div class="fc-toolbar">
                  <span class="tool-hint">Following it through the clip…</span>
                  <button
                    type="button"
                    class="btn"
                    {{on "click" this.cancelTrack}}
                  >Stop here</button>
                </div>
              {{/if}}
              <div class="fc-toolbar">
                <div class="settings-actions">
                  <button
                    type="button"
                    class="btn"
                    disabled={{this.tracking}}
                    {{on "click" this.faces}}
                  ><Icon @name="scan-face" @size={{13}} /> Find faces</button>
                </div>
                <div class="settings-actions">
                  <label class="math-check"><input
                      type="checkbox"
                      checked={{this.toMp4}}
                      {{on "change" this.toggleMp4}}
                    />
                    Save as MP4 (slower)</label>
                  <button
                    type="button"
                    class="btn active"
                    disabled={{this.noMarks}}
                    {{on "click" this.render}}
                  >{{if this.busy "Writing…" "Write the video"}}</button>
                  {{#if this.resultUrl}}
                    <a
                      class="btn fs-save"
                      href={{this.resultUrl}}
                      download={{this.resultName}}
                    ><Icon @name="download" @size={{13}} />
                      Save ({{formatBytes this.resultSize}})</a>
                  {{/if}}
                  <button
                    type="button"
                    class="btn"
                    {{on "click" this.reset}}
                  >New video</button>
                </div>
              </div>
              {{#if this.busy}}
                <div class="fs-progress"><div
                    class="fs-progress-bar"
                    style={{progressWidth this.progress}}
                  ></div></div>
                <p class="tool-hint">{{this.status}}
                  The video plays through once in the background while it's
                  recorded, so this takes as long as the clip is.</p>
              {{/if}}
              {{#if this.notice}}<p class="tool-hint">{{this.notice}}</p>{{/if}}
              {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
            </div>

            <aside class="ie-panel">
              <div class="math-field">
                <span class="qr-label is-muted">Draw with</span>
                <div class="math-tabs" role="group" aria-label="Tool">
                  {{#each this.tools as |t|}}
                    <button
                      type="button"
                      class="qr-tab {{if (eq this.tool t.id) 'active'}}"
                      {{on "click" (fn this.pick "tool" t.id)}}
                    ><Icon @name={{t.icon}} @size={{13}} /> {{t.label}}</button>
                  {{/each}}
                </div>
              </div>
              {{#if (eq this.tool "brush")}}
                <div class="ie-slider">
                  <div class="field-head">
                    <span class="qr-label is-muted">Brush size</span>
                    <span class="ie-slider-value">{{this.brushSize}}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="30"
                    value={{this.brushSize}}
                    aria-label="Brush size"
                    {{on "input" (fn this.number "brushSize")}}
                  />
                </div>
                <p class="tool-hint">Brush strokes stay where you paint them;
                  boxes and ovals can be tracked.</p>
              {{/if}}
              <div class="math-field">
                <span class="qr-label is-muted">Hide it with</span>
                <div class="cipher-picks" role="group" aria-label="Effect">
                  {{#each this.effects as |e|}}
                    <button
                      type="button"
                      class="qr-tab {{if (eq this.effect e.id) 'active'}}"
                      {{on "click" (fn this.pick "effect" e.id)}}
                    >{{e.label}}</button>
                  {{/each}}
                </div>
              </div>
              {{#if this.usesColour}}
                <ColourField
                  @label="Box colour"
                  @value={{this.colour}}
                  @onChange={{this.setColour}}
                />
              {{/if}}
              <div class="ie-slider">
                <div class="field-head">
                  <span class="qr-label is-muted">Strength</span>
                  <span class="ie-slider-value">{{this.strength}}</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  value={{this.strength}}
                  aria-label="Strength"
                  {{on "input" (fn this.number "strength")}}
                />
              </div>

              <span class="qr-label is-muted">Marks</span>
              {{#if this.marks.length}}
                <ul class="vb-marks">
                  {{#each this.markRows key="id" as |m|}}
                    <li class="vb-mark {{if m.selected 'is-selected'}}">
                      <button
                        type="button"
                        class="vb-mark-head"
                        {{on "click" (fn this.select m.id)}}
                      >
                        <strong>{{m.label}}</strong>
                        <span class="tool-hint">{{m.effectLabel}}
                          ·
                          {{m.range}}{{if m.tracked " · tracked"}}</span>
                      </button>
                      <div class="vb-mark-actions">
                        {{#unless (eq m.type "brush")}}
                          <button
                            type="button"
                            class="btn"
                            disabled={{this.tracking}}
                            {{on "click" (fn this.track m.id)}}
                          >Track from here</button>
                        {{/unless}}
                        <button
                          type="button"
                          class="btn"
                          {{on "click" (fn this.startHere m.id)}}
                        >Start here</button>
                        <button
                          type="button"
                          class="btn"
                          {{on "click" (fn this.endHere m.id)}}
                        >End here</button>
                        <button
                          type="button"
                          class="btn"
                          aria-label="Remove"
                          {{on "click" (fn this.remove m.id)}}
                        ><Icon @name="trash-2" @size={{12}} /></button>
                      </div>
                    </li>
                  {{/each}}
                </ul>
              {{else}}
                <p class="tool-hint">Scrub to the frame where the thing first
                  appears, draw over it, then press Track so the mark follows
                  it. Marks last until the end of the clip unless you press End
                  here.</p>
              {{/if}}
            </aside>
          </div>
        {{else}}
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="scan-face" @size={{22}} />
            <span>{{if
                this.dragging
                "Drop it here"
                "Drop a video, paste it, or click to browse"
              }}</span>
            <input
              type="file"
              accept="video/*"
              class="sr-only"
              {{on "change" this.selectFile}}
            />
          </label>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
