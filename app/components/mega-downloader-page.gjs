import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { registerDestructor, isDestroyed } from '@ember/destroyable';
import ToolPage from './tool-page';
import DownloadRow from './download-row';
import Icon from './icon';
import { keepState } from '../utils/tool-state';
import { detectMega } from '../utils/mega-link';
import { DownloadJobs, iconOfType, typeOfName } from '../utils/download-jobs';
import { saveBlob, formatBytes } from '../utils/video-download';

const eq = (a, b) => a === b;
const gt = (a, b) => a > b;

export default class MegaDownloaderPage extends Component {
  @tracked input = '';
  @tracked busy = false;
  @tracked error = null;
  // { kind, title, url, files: [{ node, name, path, size }] }
  @tracked result = null;
  // True while Save all is working through the list.
  @tracked savingAll = false;

  jobs = new DownloadJobs();
  // Bumped by each lookup, so a slow answer to an old one is dropped.
  lookup = 0;
  mega = null;

  constructor(owner, args) {
    super(owner, args);
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
      this.mega ??= await import('../lazy/mega');
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
      if (!this.savingAll || this.result !== result || isDestroyed(this)) break;
      if (!row.done) await this.saveFile(row);
    }
    if (!isDestroyed(this)) this.savingAll = false;
  };

  stopAll = () => {
    this.savingAll = false;
    for (const row of this.rows) if (row.going) this.jobs.cancel(row.key);
  };

  <template>
    <ToolPage
      @route="mega-downloader"
      @busy={{this.working}}
      @closeWarning="Close the Mega Downloader? Downloads still running will stop."
      @subtitle="Paste a MEGA file or folder link and save what’s in it. Everything is decrypted here in your browser."
    >
      <div class="pop-in vd-page">
        <form class="dl-form" {{on "submit" this.submit}}>
          <input
            type="text"
            inputmode="url"
            class="math-input"
            placeholder="https://mega.nz/file/…#…"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            aria-label="MEGA link"
            value={{this.input}}
            {{on "input" this.setInput}}
          />
          <button type="submit" class="btn active" disabled={{this.busy}}>
            <Icon @name="search" @size={{13}} />
            {{if this.busy "Looking…" "Look up"}}
          </button>
        </form>

        {{#if this.detection}}
          <p
            class="vd-detect {{if this.detection.ok 'is-ok' 'is-limited'}}"
            aria-live="polite"
          >
            <Icon @name={{this.detection.icon}} @size={{14}} />
            <span>{{this.detection.text}}</span>
          </p>
        {{/if}}

        {{#if this.busy}}
          <div class="vd-loading">
            <progress
              class="tool-progress"
              aria-label="Reading the link"
            ></progress>
            <span>Asking MEGA what’s at that link…</span>
          </div>
        {{/if}}

        {{#if this.error}}
          <p class="tool-error" role="alert">{{this.error}}</p>
        {{/if}}

        {{#if this.result}}
          <section class="vd-result">
            <div class="vd-head">
              <div class="vd-meta">
                <span class="vd-platform">MEGA
                  {{if (eq this.result.kind "folder") "folder" "file"}}</span>
                <h3 class="vd-title">{{this.result.title}}</h3>
                <p class="vd-sub">
                  <span>{{this.summary}}</span>
                  <a
                    href={{this.result.url}}
                    target="_blank"
                    rel="noopener noreferrer"
                  ><Icon @name="link" @size={{12}} /> Open original</a>
                </p>
              </div>
            </div>

            {{#if (gt this.rows.length 1)}}
              <div class="dl-all">
                {{#if this.savingAll}}
                  <button type="button" class="btn" {{on "click" this.stopAll}}>
                    <Icon @name="x" @size={{13}} />
                    Stop
                  </button>
                {{else}}
                  <button
                    type="button"
                    class="btn active"
                    {{on "click" this.saveAll}}
                  >
                    <Icon @name="download" @size={{13}} />
                    Save all
                  </button>
                {{/if}}
                <span class="tool-hint">One after another. Your browser may ask
                  once whether this site can save several files.</span>
              </div>
            {{/if}}

            <ul class="vd-formats">
              {{#each this.rows key="key" as |row|}}
                <DownloadRow
                  @row={{row}}
                  @onSave={{this.saveFile}}
                  @onCancel={{this.cancel}}
                />
              {{/each}}
            </ul>
          </section>
        {{else}}{{#unless this.busy}}
            <section class="vd-sites">
              <p class="tool-hint">Works with file and folder links, including
                the old mega.nz/#!… kind. The link has to include its key (the
                part after the #): that key never leaves your browser, which
                fetches the encrypted file from MEGA and decrypts it itself. A
                file is held in memory until it is saved, so a very big one
                needs that much free RAM, and MEGA limits how much one
                connection can download for free in a day. Save only what you
                have the right to.</p>
            </section>
          {{/unless}}{{/if}}
      </div>
    </ToolPage>
  </template>
}
