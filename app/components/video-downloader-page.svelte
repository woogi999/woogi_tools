<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import {
    destroy,
    registerDestructor,
    isDestroyed,
  } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { keepState } from '../utils/tool-state.js';
  import { PLATFORMS, detectVideo } from '../utils/video-platforms.js';
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
  } from '../utils/video-download.js';

  // One way to save a video: its name, what it is, and how the save is going.

  class VideoDownloaderPage extends Component {
    input = $state.raw('');
    busy = $state.raw(false);
    error = $state.raw(null);
    result = $state.raw(null);
    // Whether the site's download backend is set up; null until known.
    backend = $state.raw(null);
    // key -> { state, stage, received, total, error, note }
    jobs = $state.raw({});

    lookup = null;
    controllers = new Map();

    constructor(args) {
      super(args);
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
        this.busy ||
        Object.values(this.jobs).some((job) => job.state === 'going')
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
          // The backend fetches the whole video (and joins its picture and
          // sound) before the first byte comes back, so there is a wait with
          // nothing to measure, longer still if it was asleep.
          target = {
            via: 'direct',
            ...answer.files[0],
            waiting:
              'The backend is fetching the video. This can take a minute or two, longer if it was asleep',
          };
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
          this.setJob(key, { stage: target.waiting ?? 'Downloading' });
          try {
            blob = await fetchFile(target.url, {
              signal,
              onProgress: (progress) => {
                if (target.waiting) this.setJob(key, { stage: 'Downloading' });
                onProgress(progress);
              },
            });
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
        saveBlob(blob, target.filename ?? blob.name);
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
  }
</script>

<script>
  let args = $props();
  const self = new VideoDownloaderPage(args);
  onDestroy(() => destroy(self));
</script>

{#snippet FormatRow(args)}
  <li class="vd-format {truthy(args.format?.failed) ? 'is-failed' : ''}">
    <Icon name={args.format?.icon} size={16} />
    <div class="vd-format-info">
      <span class="vd-format-label">{args.format?.label}</span>
      {#if truthy(args.format?.meta)}
        <span class="vd-format-meta">{args.format?.meta}</span>
      {/if}
      {#if truthy(args.format?.going)}
        {#if truthy(args.format?.hasTotal)}
          <progress
            class="tool-progress"
            value={args.format?.fraction}
            max="1"
            aria-label="Download progress"
          ></progress>
        {:else}
          <progress class="tool-progress" aria-label="Working, length unknown"
          ></progress>
        {/if}
      {/if}
      {#if truthy(args.format?.status)}
        <span class="vd-format-status" aria-live="polite"
          >{args.format?.status}</span
        >
      {/if}
      {#if truthy(args.format?.error)}
        <span class="tool-error" role="alert">{args.format?.error}</span>
      {/if}
    </div>
    {#if truthy(args.format?.going)}
      <button
        type="button"
        class="btn"
        onclick={(..._r) => args.onCancel(args.format, ..._r)}
      >
        <Icon name="x" size={13} />
        Cancel
      </button>
    {:else}
      <button
        type="button"
        class="btn active"
        onclick={(..._r) => args.onSave(args.format, ..._r)}
      >
        <Icon name="download" size={13} />
        {truthy(args.format?.done) ? 'Save again' : 'Save'}
      </button>
    {/if}
  </li>
{/snippet}

<ToolPage
  route="video-downloader"
  busy={self.working}
  closeWarning="Close the Video Downloader? Downloads still running will stop."
  subtitle="Paste a link to a public video and save it: YouTube, X, TikTok, Facebook, Reddit, Streamable and more."
>
  <div class="pop-in vd-page">
    <form class="dl-form" onsubmit={self.submit}>
      <input
        type="text"
        inputmode="url"
        class="math-input"
        placeholder="https://x.com/someone/status/…"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        aria-label="Video link"
        {@attach prop('value', () => self.input)}
        oninput={self.setInput}
      />
      <button type="submit" class="btn active" disabled={self.busy}>
        <Icon name="download" size={13} />
        {truthy(self.busy) ? 'Looking…' : 'Download'}
      </button>
    </form>

    {#if truthy(self.detection)}
      <p
        class="vd-detect {truthy(self.detection?.ok) ? 'is-ok' : 'is-limited'}"
        aria-live="polite"
      >
        <Icon name={self.detection?.icon} size={14} />
        {#if truthy(self.detection?.name)}
          <strong>{self.detection?.name}</strong>
        {/if}
        <span>{self.detection?.text}</span>
      </p>
    {/if}

    {#if truthy(self.busy)}
      <div class="vd-loading">
        <progress class="tool-progress" aria-label="Looking the video up"
        ></progress>
        <span>Asking {self.lookingAt} what this video is…</span>
      </div>
    {/if}

    {#if truthy(self.error)}
      <p class="tool-error" role="alert">{self.error}</p>
    {/if}

    {#if truthy(self.result)}
      <section class="vd-result">
        <div class="vd-head">
          {#if truthy(self.result?.thumbnail)}
            <img
              class="vd-thumb"
              src={self.result?.thumbnail}
              alt=""
              referrerpolicy="no-referrer"
            />
          {/if}
          <div class="vd-meta">
            <span class="vd-platform">{self.result?.platformName}</span>
            <h3 class="vd-title"
              >{truthy(self.result?.title)
                ? self.result?.title
                : 'Untitled video'}</h3
            >
            {#if truthy(self.result?.author)}
              <p class="vd-author">{self.result?.author}</p>
            {/if}
            <p class="vd-sub">
              {#if truthy(self.duration)}<span>{self.duration}</span>{/if}
              <a
                href={self.result?.url}
                target="_blank"
                rel="noopener noreferrer"
                ><Icon name="link" size={12} /> Open original</a
              >
            </p>
          </div>
        </div>

        {#each self.result?.notes ?? [] as note}
          <p class="tool-hint">{note}</p>
        {/each}

        {#each self.items ?? [] as item}
          {#if truthy(item?.label)}
            <h4 class="qr-heading">{item?.label}</h4>
          {/if}
          <ul class="vd-formats">
            {#each item?.formats ?? [] as format}
              {@render FormatRow({
                format: format,
                onSave: self.save,
                onCancel: self.cancel,
              })}
            {/each}
          </ul>
        {/each}

        {#if truthy(self.backendFormats?.length)}
          <p class="tool-hint"
            >These come through this site’s download backend, which fetches the
            video with yt-dlp and picks the closest quality at or below the one
            you choose. It sleeps when nobody is using it, so the first save can
            take a minute to start.</p
          >
          <ul class="vd-formats">
            {#each self.backendFormats ?? [] as format}
              {@render FormatRow({
                format: format,
                onSave: self.save,
                onCancel: self.cancel,
              })}
            {/each}
          </ul>
        {/if}
      </section>
    {:else}{#if !truthy(self.busy)}
        <section class="vd-sites">
          <h3 class="qr-heading">What works here</h3>
          <ul class="vd-site-list">
            {#each self.sites ?? [] as site}
              <li class={truthy(site?.ok) ? 'is-ok' : ''}>
                <strong>{site?.name}</strong>
                <span>{site?.text}</span>
              </li>
            {/each}
          </ul>
          <p class="tool-hint"
            >Public videos only. Nothing here signs in anywhere or gets around
            what a site restricts, so private, age-restricted, members-only and
            DRM-protected videos stay out of reach. Save only what you have the
            right to.</p
          >
        </section>
      {/if}{/if}
  </div>
</ToolPage>
