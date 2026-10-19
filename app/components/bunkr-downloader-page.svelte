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
  import DownloadRow from './download-row.svelte';
  import Icon from './icon.svelte';
  import { keepState } from '../utils/tool-state.js';
  import { detectBunkr } from '../utils/bunkr-link.js';
  import { DownloadJobs, iconOfType } from '../utils/download-jobs.svelte.js';
  import {
    api,
    fetchFile,
    saveBlob,
    formatBytes,
  } from '../utils/video-download.js';

  const eq = (a, b) => a === b;
  const gt = (a, b) => a > b;

  class BunkrDownloaderPage extends Component {
    input = $state.raw('');
    busy = $state.raw(false);
    error = $state.raw(null);
    // { kind, title, url, files: [{ name, size, type, url }] }
    result = $state.raw(null);
    // Whether the site's download backend is set up; null until known.
    backend = $state.raw(null);
    // True while Save all is working through the list.
    savingAll = $state.raw(false);

    jobs = new DownloadJobs();
    lookup = null;

    constructor(args) {
      super(args);
      keepState(this, 'bunkr-downloader', ['input']);
      // Asking also wakes the backend, which sleeps when nobody is using it.
      const info = new AbortController();
      api('/api/bunkr', { signal: info.signal })
        .then(({ backend }) => {
          if (!isDestroyed(this)) this.backend = backend;
        })
        .catch(() => {});
      registerDestructor(this, () => {
        info.abort();
        this.lookup?.abort();
        this.jobs.reset();
      });
    }

    // What the pasted link is, as you type. The Worker checks again.
    get detection() {
      const found = detectBunkr(this.input);
      if (!found) return null;
      if (found.error)
        return { ok: false, icon: 'triangle-alert', text: found.error };
      return {
        ok: true,
        icon: 'check',
        text: found.kind === 'album' ? 'A Bunkr album' : 'A Bunkr file',
      };
    }

    get rows() {
      return (this.result?.files ?? []).map((file, i) => ({
        key: `${i}`,
        file,
        icon: iconOfType(file.type),
        label: file.name,
        meta: file.size ? formatBytes(file.size) : null,
        ...this.jobs.view(`${i}`),
      }));
    }

    get summary() {
      const files = this.result?.files ?? [];
      const total = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
      const count = `${files.length} ${files.length === 1 ? 'file' : 'files'}`;
      return total ? `${count}, ${formatBytes(total)}` : count;
    }

    get working() {
      return this.busy || this.jobs.working;
    }

    setInput = (event) => (this.input = event.target.value);

    submit = async (event) => {
      event.preventDefault();
      const found = detectBunkr(this.input);
      if (!found) return;
      this.savingAll = false;
      this.jobs.reset();
      this.result = null;
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
        const result = await api('/api/bunkr', {
          method: 'POST',
          body: JSON.stringify({ url: this.input.trim() }),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) this.result = result;
      } catch (error) {
        if (!controller.signal.aborted) this.error = error.message;
      }
      if (!controller.signal.aborted && !isDestroyed(this)) this.busy = false;
    };

    cancel = (row) => this.jobs.cancel(row.key);

    saveFile = (row) =>
      this.jobs.run(row.key, async ({ signal, onProgress, onStage }) => {
        // The backend asks Bunkr where the file is before any of it arrives.
        onStage('Asking Bunkr for the file');
        let started = false;
        const blob = await fetchFile(row.file.url, {
          signal,
          onProgress: (progress) => {
            if (!started) onStage('Downloading');
            started = true;
            onProgress(progress);
          },
        });
        saveBlob(blob, row.file.name);
        return `Saved ${formatBytes(blob.size)}`;
      });

    // One at a time: the backend is small, and so is a browser's patience for
    // a dozen save prompts at once.
    saveAll = async () => {
      this.savingAll = true;
      const result = this.result;
      for (const row of this.rows) {
        if (!this.savingAll || this.result !== result || isDestroyed(this))
          break;
        if (!row.done) await this.saveFile(row);
      }
      if (!isDestroyed(this)) this.savingAll = false;
    };

    stopAll = () => {
      this.savingAll = false;
      for (const row of this.rows) if (row.going) this.jobs.cancel(row.key);
    };
  }
</script>

<script>
  let args = $props();
  const self = new BunkrDownloaderPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="bunkr-downloader"
  busy={self.working}
  closeWarning="Close the Bunkr Downloader? Downloads still running will stop."
  subtitle="Paste a Bunkr album or file link and save what’s in it: photos, videos and anything else."
>
  <div class="pop-in vd-page">
    <form class="dl-form" onsubmit={self.submit}>
      <input
        type="text"
        inputmode="url"
        class="math-input"
        placeholder="https://bunkr.cr/a/…"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        aria-label="Bunkr link"
        {@attach prop('value', () => self.input)}
        oninput={self.setInput}
      />
      <button type="submit" class="btn active" disabled={self.busy}>
        <Icon name="search" size={13} />
        {truthy(self.busy) ? 'Looking…' : 'Look up'}
      </button>
    </form>

    {#if truthy(self.detection)}
      <p
        class="vd-detect {truthy(self.detection?.ok) ? 'is-ok' : 'is-limited'}"
        aria-live="polite"
      >
        <Icon name={self.detection?.icon} size={14} />
        <span>{self.detection?.text}</span>
      </p>
    {/if}

    {#if truthy(self.busy)}
      <div class="vd-loading">
        <progress class="tool-progress" aria-label="Reading the link"
        ></progress>
        <span
          >Asking Bunkr what’s there. If the download backend was asleep, this
          takes about a minute…</span
        >
      </div>
    {/if}

    {#if truthy(self.error)}
      <p class="tool-error" role="alert">{self.error}</p>
    {/if}

    {#if truthy(self.result)}
      <section class="vd-result">
        <div class="vd-head">
          <div class="vd-meta">
            <span class="vd-platform"
              >Bunkr
              {truthy(eq(self.result?.kind, 'album')) ? 'album' : 'file'}</span
            >
            <h3 class="vd-title"
              >{truthy(self.result?.title)
                ? self.result?.title
                : 'Untitled'}</h3
            >
            <p class="vd-sub">
              <span>{self.summary}</span>
              <a
                href={self.result?.url}
                target="_blank"
                rel="noopener noreferrer"
                ><Icon name="link" size={12} /> Open original</a
              >
            </p>
          </div>
        </div>

        {#if truthy(gt(self.rows?.length, 1))}
          <div class="dl-all">
            {#if truthy(self.savingAll)}
              <button type="button" class="btn" onclick={self.stopAll}>
                <Icon name="x" size={13} />
                Stop
              </button>
            {:else}
              <button type="button" class="btn active" onclick={self.saveAll}>
                <Icon name="download" size={13} />
                Save all
              </button>
            {/if}
            <span class="tool-hint"
              >One after another. Your browser may ask once whether this site
              can save several files.</span
            >
          </div>
        {/if}

        <ul class="vd-formats">
          {#each self.rows ?? [] as row}
            <DownloadRow {row} onSave={self.saveFile} onCancel={self.cancel} />
          {/each}
        </ul>
      </section>
    {:else}{#if !truthy(self.busy)}
        <section class="vd-sites">
          {#if truthy(eq(self.backend, false))}
            <p class="tool-error" role="alert"
              >Bunkr can only be read through this site’s download backend,
              which isn’t set up here.</p
            >
          {/if}
          <p class="tool-hint"
            >Works with album links (bunkr.cr/a/…) and single files (/f/, /v/,
            /i/), on whichever domain Bunkr is using this month. Files come
            through this site’s download backend, because Bunkr’s servers only
            answer requests that look like they came from Bunkr. Save only what
            you have the right to.</p
          >
        </section>
      {/if}{/if}
  </div>
</ToolPage>
