import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor, isDestroyed } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';
import { PLATFORMS, detectVideo } from '../utils/video-platforms';
import {
  downloaderInfo,
  inspectVideo,
  resolveVideo,
  fetchFile,
  fetchAndJoin,
  saveBlob,
  openLink,
  formatBytes,
  formatDuration,
} from '../utils/video-download';

// One way to save a video: its name, what it is, and how the save is going.
const FormatRow = <template>
  <li class="vd-format {{if @format.failed 'is-failed'}}">
    <Icon @name={{@format.icon}} @size={{16}} />
    <div class="vd-format-info">
      <span class="vd-format-label">{{@format.label}}</span>
      {{#if @format.meta}}
        <span class="vd-format-meta">{{@format.meta}}</span>
      {{/if}}
      {{#if @format.going}}
        {{#if @format.hasTotal}}
          <progress
            class="tool-progress"
            value={{@format.fraction}}
            max="1"
            aria-label="Download progress"
          ></progress>
        {{else}}
          <progress
            class="tool-progress"
            aria-label="Working, length unknown"
          ></progress>
        {{/if}}
      {{/if}}
      {{#if @format.status}}
        <span
          class="vd-format-status"
          aria-live="polite"
        >{{@format.status}}</span>
      {{/if}}
      {{#if @format.error}}
        <span class="tool-error" role="alert">{{@format.error}}</span>
      {{/if}}
    </div>
    {{#if @format.going}}
      <button type="button" class="btn" {{on "click" (fn @onCancel @format)}}>
        <Icon @name="x" @size={{13}} />
        Cancel
      </button>
    {{else}}
      <button
        type="button"
        class="btn active"
        {{on "click" (fn @onSave @format)}}
      >
        <Icon @name="download" @size={{13}} />
        {{if @format.done "Save again" "Save"}}
      </button>
    {{/if}}
  </li>
</template>;

export default class VideoDownloaderPage extends Component {
  @tracked input = '';
  @tracked busy = false;
  @tracked error = null;
  @tracked result = null;
  // Whether the site owner set up the optional backend; null until known.
  @tracked backend = null;
  // What the backend handed back for a post with several files.
  @tracked picked = null;
  // key -> { state, stage, received, total, error, note }
  @tracked jobs = {};

  lookup = null;
  controllers = new Map();

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'video-downloader', ['input']);
    const info = new AbortController();
    downloaderInfo(info.signal)
      .then(({ backend }) => {
        if (!isDestroyed(this)) this.backend = backend;
      })
      .catch(() => {});
    registerDestructor(this, () => {
      info.abort();
      this.lookup?.abort();
      for (const controller of this.controllers.values()) controller.abort();
    });
  }

  can(platform) {
    const { native } = PLATFORMS[platform];
    if (native === 'download') return { ok: true, text: 'Saves videos' };
    if (this.backend)
      return { ok: true, text: 'Saves videos, through the backend' };
    if (native === 'info')
      return { ok: false, text: 'Title and thumbnail only' };
    return { ok: false, text: 'Needs the download backend' };
  }

  // What the pasted link is, as you type. The Worker checks again.
  get detection() {
    const found = detectVideo(this.input);
    if (!found) return null;
    if (found.error)
      return { ok: false, icon: 'triangle-alert', text: found.error };
    const can = this.can(found.platform);
    return {
      ok: can.ok,
      icon: can.ok ? 'check' : 'info',
      name: PLATFORMS[found.platform].name,
      text: can.text,
    };
  }

  get sites() {
    return Object.keys(PLATFORMS).map((key) => ({
      name: PLATFORMS[key].name,
      ...this.can(key),
    }));
  }

  get working() {
    return (
      this.busy || Object.values(this.jobs).some((job) => job.state === 'going')
    );
  }

  get lookingAt() {
    const found = detectVideo(this.input);
    return found?.platform ? PLATFORMS[found.platform].name : 'the site';
  }

  get duration() {
    return formatDuration(this.result?.duration);
  }

  get items() {
    return (this.result?.items ?? []).map((item, i) => ({
      label: item.label,
      formats: item.formats.map((f) => this.row(`${i}:${f.id}`, f)),
    }));
  }

  get backendFormats() {
    return (this.result?.backend ?? []).map((f) =>
      this.row(`backend:${f.id}`, { ...f, via: 'backend' }),
    );
  }

  get pickedFormats() {
    return (this.picked ?? []).map((f, i) =>
      this.row(`picked:${i}`, {
        ...f,
        id: `${i}`,
        kind: f.type === 'audio' ? 'audio' : 'video',
        label: `${f.type === 'photo' ? 'Photo' : f.type === 'audio' ? 'Sound' : 'Video'} ${i + 1}`,
        via: 'direct',
      }),
    );
  }

  // A format joined with how its save is going, ready for FormatRow.
  row(key, f) {
    const job = this.jobs[key];
    const going = job?.state === 'going';
    const meta = [
      f.width && f.height ? `${f.width}×${f.height}` : null,
      f.size ? formatBytes(f.size) : null,
      f.bitrate ? `${Math.round(f.bitrate / 1000)} kb/s` : null,
      f.detail,
      f.via === 'mux' ? 'picture and sound joined in your browser' : null,
      f.via === 'relay' ? 'comes through this site' : null,
    ].filter(Boolean);
    let status = null;
    if (going) {
      const amount = job.total
        ? `${formatBytes(job.received)} of ${formatBytes(job.total)}`
        : job.received
          ? `${formatBytes(job.received)} so far (size not given)`
          : null;
      status = [job.stage, amount].filter(Boolean).join(': ');
    } else if (job?.state === 'done') status = job.note ?? job.stage;
    return {
      ...f,
      key,
      icon: f.kind === 'audio' ? 'music' : 'video',
      meta: meta.join(' · '),
      going,
      done: job?.state === 'done',
      failed: job?.state === 'failed',
      hasTotal: Boolean(job?.total),
      fraction: job?.total ? Math.min(1, job.received / job.total) : 0,
      status,
      error: job?.state === 'failed' ? job.error : null,
    };
  }

  setJob(key, patch) {
    if (isDestroyed(this)) return;
    this.jobs = { ...this.jobs, [key]: { ...this.jobs[key], ...patch } };
  }

  dropJob(key) {
    if (isDestroyed(this)) return;
    const jobs = { ...this.jobs };
    delete jobs[key];
    this.jobs = jobs;
  }

  setInput = (event) => (this.input = event.target.value);

  submit = async (event) => {
    event.preventDefault();
    const found = detectVideo(this.input);
    if (!found) return;
    this.cancelAll();
    this.result = null;
    this.picked = null;
    this.jobs = {};
    // The same check the Worker makes, so an obvious mistake needn't travel.
    if (found.error) {
      this.error = found.error;
      return;
    }
    this.lookup?.abort();
    const controller = (this.lookup = new AbortController());
    this.busy = true;
    this.error = null;
    try {
      const result = await inspectVideo(this.input.trim(), controller.signal);
      if (!controller.signal.aborted) this.result = result;
    } catch (error) {
      if (!controller.signal.aborted) this.error = error.message;
    }
    if (!controller.signal.aborted && !isDestroyed(this)) this.busy = false;
  };

  cancelAll() {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  cancel = (format) => this.controllers.get(format.key)?.abort();

  save = async (format) => {
    const { key } = format;
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const { signal } = controller;
    this.setJob(key, {
      state: 'going',
      stage: 'Starting',
      received: 0,
      total: 0,
      error: null,
      note: null,
    });
    const onProgress = ({ received, total }) =>
      this.setJob(key, { received, total });
    const onStage = (stage) =>
      this.setJob(key, { stage, received: 0, total: 0 });
    try {
      let target = format;
      if (format.via === 'backend') {
        onStage('Asking the download backend');
        const answer = await resolveVideo(this.result.url, format.id, signal);
        if (answer.merge)
          target = {
            via: 'mux',
            url: answer.merge.video,
            audio: answer.merge.audio,
            filename: answer.merge.filename,
          };
        else if (answer.files.length === 1)
          target = { via: 'direct', ...answer.files[0] };
        else {
          this.picked = answer.files;
          this.setJob(key, {
            state: 'done',
            stage: `${answer.files.length} files: pick them below`,
          });
          return;
        }
      }
      let blob;
      if (target.via === 'mux')
        blob = await fetchAndJoin(target.url, target.audio, {
          signal,
          onProgress,
          // Each stage starts its own count: loading FFmpeg and joining can't be
          // measured, so their bar goes back to "working" rather than full.
          onStage,
        });
      else {
        this.setJob(key, { stage: 'Downloading' });
        try {
          blob = await fetchFile(target.url, { signal, onProgress });
        } catch (error) {
          // Another site's file the browser may not read (no CORS): let the
          // browser download it as a plain link instead.
          if (!error.blocked || target.via === 'relay') throw error;
          openLink(target.url, target.filename);
          this.setJob(key, {
            state: 'done',
            note: 'Your browser couldn’t fetch this file itself, so it opened as a link. If it plays instead of saving, use the player’s save option.',
          });
          return;
        }
      }
      saveBlob(blob, target.filename);
      this.setJob(key, {
        state: 'done',
        stage: `Saved ${formatBytes(blob.size)}`,
      });
    } catch (error) {
      if (signal.aborted) this.dropJob(key);
      else this.setJob(key, { state: 'failed', error: error.message });
    } finally {
      if (this.controllers.get(key) === controller)
        this.controllers.delete(key);
    }
  };

  <template>
    <ToolPage
      @route="video-downloader"
      @busy={{this.working}}
      @closeWarning="Close the Video Downloader? Downloads still running will stop."
      @subtitle="Paste a link to a public video and save it: X, TikTok, Facebook, Reddit and Streamable directly, and more where the site allows."
    >
      <div class="pop-in vd-page">
        <form class="dl-form" {{on "submit" this.submit}}>
          <input
            type="text"
            inputmode="url"
            class="math-input"
            placeholder="https://x.com/someone/status/…"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            aria-label="Video link"
            value={{this.input}}
            {{on "input" this.setInput}}
          />
          <button type="submit" class="btn active" disabled={{this.busy}}>
            <Icon @name="download" @size={{13}} />
            {{if this.busy "Looking…" "Download"}}
          </button>
        </form>

        {{#if this.detection}}
          <p
            class="vd-detect {{if this.detection.ok 'is-ok' 'is-limited'}}"
            aria-live="polite"
          >
            <Icon @name={{this.detection.icon}} @size={{14}} />
            {{#if this.detection.name}}
              <strong>{{this.detection.name}}</strong>
            {{/if}}
            <span>{{this.detection.text}}</span>
          </p>
        {{/if}}

        {{#if this.busy}}
          <div class="vd-loading">
            <progress
              class="tool-progress"
              aria-label="Looking the video up"
            ></progress>
            <span>Asking {{this.lookingAt}} what this video is…</span>
          </div>
        {{/if}}

        {{#if this.error}}
          <p class="tool-error" role="alert">{{this.error}}</p>
        {{/if}}

        {{#if this.result}}
          <section class="vd-result">
            <div class="vd-head">
              {{#if this.result.thumbnail}}
                <img
                  class="vd-thumb"
                  src={{this.result.thumbnail}}
                  alt=""
                  referrerpolicy="no-referrer"
                />
              {{/if}}
              <div class="vd-meta">
                <span class="vd-platform">{{this.result.platformName}}</span>
                <h3 class="vd-title">{{if
                    this.result.title
                    this.result.title
                    "Untitled video"
                  }}</h3>
                {{#if this.result.author}}
                  <p class="vd-author">{{this.result.author}}</p>
                {{/if}}
                <p class="vd-sub">
                  {{#if this.duration}}<span>{{this.duration}}</span>{{/if}}
                  <a
                    href={{this.result.url}}
                    target="_blank"
                    rel="noopener noreferrer"
                  ><Icon @name="link" @size={{12}} /> Open original</a>
                </p>
              </div>
            </div>

            {{#each this.result.notes as |note|}}
              <p class="tool-hint">{{note}}</p>
            {{/each}}

            {{#each this.items as |item|}}
              {{#if item.label}}
                <h4 class="qr-heading">{{item.label}}</h4>
              {{/if}}
              <ul class="vd-formats">
                {{#each item.formats key="key" as |format|}}
                  <FormatRow
                    @format={{format}}
                    @onSave={{this.save}}
                    @onCancel={{this.cancel}}
                  />
                {{/each}}
              </ul>
            {{/each}}

            {{#if this.backendFormats.length}}
              <p class="tool-hint">These come from this site’s download backend,
                which picks the closest quality it has at or below the one you
                choose.</p>
              <ul class="vd-formats">
                {{#each this.backendFormats key="key" as |format|}}
                  <FormatRow
                    @format={{format}}
                    @onSave={{this.save}}
                    @onCancel={{this.cancel}}
                  />
                {{/each}}
              </ul>
            {{/if}}

            {{#if this.pickedFormats.length}}
              <h4 class="qr-heading">In this post</h4>
              <ul class="vd-formats">
                {{#each this.pickedFormats key="key" as |format|}}
                  <FormatRow
                    @format={{format}}
                    @onSave={{this.save}}
                    @onCancel={{this.cancel}}
                  />
                {{/each}}
              </ul>
            {{/if}}
          </section>
        {{else}}{{#unless this.busy}}
            <section class="vd-sites">
              <h3 class="qr-heading">What works here</h3>
              <ul class="vd-site-list">
                {{#each this.sites as |site|}}
                  <li class={{if site.ok "is-ok"}}>
                    <strong>{{site.name}}</strong>
                    <span>{{site.text}}</span>
                  </li>
                {{/each}}
              </ul>
              <p class="tool-hint">Public videos only. Nothing here signs in
                anywhere or gets around what a site restricts, so private,
                age-restricted, members-only and DRM-protected videos stay out
                of reach. Save only what you have the right to.</p>
            </section>
          {{/unless}}{{/if}}
      </div>
    </ToolPage>
  </template>
}
