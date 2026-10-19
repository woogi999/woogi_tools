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
  import { detectMega } from '../utils/mega-link.js';
  import {
    DownloadJobs,
    iconOfType,
    typeOfName,
  } from '../utils/download-jobs.svelte.js';
  import { saveBlob, formatBytes } from '../utils/video-download.js';

  const eq = (a, b) => a === b;
  const gt = (a, b) => a > b;

  class MegaDownloaderPage extends Component {
    input = $state.raw('');
    busy = $state.raw(false);
    error = $state.raw(null);
    // { kind, title, url, files: [{ node, name, path, size }] }
    result = $state.raw(null);
    // True while Save all is working through the list.
    savingAll = $state.raw(false);

    jobs = new DownloadJobs();
    // Bumped by each lookup, so a slow answer to an old one is dropped.
    lookup = 0;
    mega = null;

    constructor(args) {
      super(args);
      keepState(this, 'mega-downloader', ['input']);
      registerDestructor(this, () => {
        this.lookup++;
        this.jobs.reset();
      });
    }

    // What the pasted link is, as you type.
    get detection() {
      const found = detectMega(this.input);
      if (!found) return null;
      if (found.error)
        return { ok: false, icon: 'triangle-alert', text: found.error };
      return {
        ok: true,
        icon: 'check',
        text: found.kind === 'folder' ? 'A MEGA folder' : 'A MEGA file',
      };
    }

    get rows() {
      return (this.result?.files ?? []).map((file, i) => ({
        key: `${i}`,
        file,
        icon: iconOfType(typeOfName(file.name)),
        label: file.name,
        meta: [file.path, file.size ? formatBytes(file.size) : null]
          .filter(Boolean)
          .join(' · '),
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
      const found = detectMega(this.input);
      if (!found) return;
      this.savingAll = false;
      this.jobs.reset();
      this.result = null;
      if (found.error) {
        this.error = found.error;
        return;
      }
      const mine = ++this.lookup;
      this.busy = true;
      this.error = null;
      try {
        this.mega ??= await import('../lazy/mega.js');
        const opened = await this.mega.openMega(found.url);
        if (mine !== this.lookup) return;
        if (!opened.files.length) throw new Error('That MEGA folder is empty.');
        this.result = { ...opened, url: found.url };
      } catch (error) {
        if (mine === this.lookup) this.error = error.message;
      }
      if (mine === this.lookup && !isDestroyed(this)) this.busy = false;
    };

    cancel = (row) => this.jobs.cancel(row.key);

    saveFile = (row) =>
      this.jobs.run(row.key, async ({ signal, onProgress, onStage }) => {
        onStage('Downloading and decrypting');
        const blob = await this.mega.downloadMega(row.file.node, {
          signal,
          onProgress,
        });
        saveBlob(blob, row.file.name);
        return `Saved ${formatBytes(blob.size)}`;
      });

    // One at a time, so MEGA's connections go to a single file.
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
  const self = new MegaDownloaderPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="mega-downloader"
  busy={self.working}
  closeWarning="Close the Mega Downloader? Downloads still running will stop."
  subtitle="Paste a MEGA file or folder link and save what’s in it. Everything is decrypted here in your browser."
>
  <div class="pop-in vd-page">
    <form class="dl-form" onsubmit={self.submit}>
      <input
        type="text"
        inputmode="url"
        class="math-input"
        placeholder="https://mega.nz/file/…#…"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        aria-label="MEGA link"
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
        <span>Asking MEGA what’s at that link…</span>
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
              >MEGA
              {truthy(eq(self.result?.kind, 'folder'))
                ? 'folder'
                : 'file'}</span
            >
            <h3 class="vd-title">{self.result?.title}</h3>
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
          <p class="tool-hint"
            >Works with file and folder links, including the old mega.nz/#!…
            kind. The link has to include its key (the part after the #): that
            key never leaves your browser, which fetches the encrypted file from
            MEGA and decrypts it itself. A file is held in memory until it is
            saved, so a very big one needs that much free RAM, and MEGA limits
            how much one connection can download for free in a day. Save only
            what you have the right to.</p
          >
        </section>
      {/if}{/if}
  </div>
</ToolPage>
