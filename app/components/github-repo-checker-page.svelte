<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { keepState } from '../utils/tool-state.js';
  import {
    parseRepo,
    inspectRepo,
    estimateLines,
    fileStats,
    formatBytes,
    timeAgo,
  } from '../utils/github.js';
  import { clocRepo } from '../utils/cloc.js';

  const num = (n) => (n == null ? '-' : Number(n).toLocaleString());
  const width = (share) => `width: ${share.toFixed(1)}%`;
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString() : '-');

  class GithubRepoCheckerPage extends Component {
    query = $state.raw('');
    token = $state.raw('');
    showToken = $state.raw(false);
    tokenBox = $state.raw(false);
    loading = $state.raw(false);
    counting = $state.raw(false);
    error = $state.raw('');
    data = $state.raw(null);
    exact = $state.raw(null);
    progress = $state.raw(null);

    constructor(args) {
      super(args);
      keepState(this, 'github-repo-checker', ['query', 'token']);
    }

    get target() {
      return parseRepo(this.query);
    }
    get cannotCheck() {
      return !this.target || this.loading;
    }
    get info() {
      return this.data?.info;
    }

    get facts() {
      const info = this.info;
      if (!info) return [];
      const d = this.data;
      const lines = this.exact
        ? { label: 'Lines of code', value: num(this.exact.total.code) }
        : {
            label: 'Lines of code (est.)',
            value: `~${num(estimateLines(d.languages))}`,
          };
      return [
        { label: 'Stars', value: num(info.stargazers_count) },
        { label: 'Forks', value: num(info.forks_count) },
        { label: 'Watchers', value: num(info.subscribers_count) },
        { label: 'Open issues & PRs', value: num(info.open_issues_count) },
        { label: 'Commits', value: num(d.commits) },
        { label: 'Contributors', value: num(d.contributorCount) },
        lines,
        { label: 'Size on GitHub', value: formatBytes(info.size * 1024) },
        { label: 'Created', value: date(info.created_at) },
        {
          label: 'Last push',
          value: `${date(info.pushed_at)} (${timeAgo(info.pushed_at)})`,
        },
        { label: 'Default branch', value: info.default_branch },
        { label: 'Licence', value: info.license?.spdx_id ?? 'None' },
      ];
    }

    get flags() {
      const info = this.info;
      if (!info) return [];
      const out = [];
      if (info.archived) out.push('Archived');
      if (info.fork)
        out.push(`Fork of ${info.parent?.full_name ?? 'another repo'}`);
      if (info.is_template) out.push('Template');
      if (info.private) out.push('Private');
      if (info.has_wiki) out.push('Wiki');
      if (info.has_pages) out.push('Pages');
      if (info.has_discussions) out.push('Discussions');
      return out;
    }

    get languages() {
      const list = this.exact?.languages;
      if (list?.length) {
        const total = this.exact.total.code || 1;
        return list.slice(0, 10).map((r) => ({
          name: r.name,
          detail: `${num(r.code)} lines, ${num(r.files)} files`,
          share: (r.code / total) * 100,
        }));
      }
      const langs = this.data?.languages;
      if (!langs) return [];
      const total = Object.values(langs).reduce((n, b) => n + b, 0) || 1;
      return Object.entries(langs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, bytes]) => ({
          name,
          detail: formatBytes(bytes),
          share: (bytes / total) * 100,
        }));
    }

    get contributors() {
      return (this.data?.contributors ?? []).map((c) => ({
        login: c.login ?? c.name ?? 'anonymous',
        url: c.html_url,
        avatar: c.avatar_url,
        commits: num(c.contributions),
      }));
    }

    get files() {
      return fileStats(this.data?.tree);
    }

    get release() {
      const r = this.data?.release;
      if (!r) return null;
      return {
        name: r.name || r.tag_name,
        tag: r.tag_name,
        url: r.html_url,
        when: `${date(r.published_at)} (${timeAgo(r.published_at)})`,
        downloads: num(
          (r.assets ?? []).reduce((n, a) => n + (a.download_count ?? 0), 0),
        ),
      };
    }

    setQuery = (event) => (this.query = event.target.value);
    setToken = (event) => (this.token = event.target.value);
    toggleToken = () => (this.showToken = !this.showToken);
    toggleTokenBox = () => (this.tokenBox = !this.tokenBox);

    submit = (event) => {
      event.preventDefault();
      this.check();
    };

    check = async () => {
      const target = this.target;
      if (!target || this.loading) return;
      this.loading = true;
      this.error = '';
      this.data = null;
      this.exact = null;
      try {
        this.data = await inspectRepo(target, this.token);
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading = false;
      }
    };

    countExact = async () => {
      const target = this.target;
      if (this.counting || !target || !this.data?.tree) return;
      this.counting = true;
      this.error = '';
      this.progress = null;
      try {
        this.exact = await clocRepo(
          { ...target, ref: this.info.default_branch, tree: this.data.tree },
          this.token,
          { onProgress: (p) => (this.progress = p) },
        );
      } catch (error) {
        this.error = error.message;
      } finally {
        this.counting = false;
        this.progress = null;
      }
    };
  }
</script>

<script>
  let args = $props();
  const self = new GithubRepoCheckerPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="github-repo-checker"
  busy={self.loading}
  closeWarning="Close the GitHub Repo Checker? The repository still being counted will stop."
  subtitle="Paste a GitHub link for the numbers behind a repository: stars, commits, contributors, languages, lines of code and more."
>
  <div class="gh-shell pop-in">
    <form class="gh-form" onsubmit={self.submit}>
      <input
        type="text"
        class="math-input"
        placeholder="owner/repo or https://github.com/owner/repo"
        spellcheck="false"
        autocomplete="off"
        aria-label="Repository"
        {@attach prop('value', () => self.query)}
        oninput={self.setQuery}
      />
      <button type="submit" class="btn" disabled={self.cannotCheck}>
        {#if truthy(self.loading)}Checking…{:else}Check{/if}
      </button>
    </form>
    <div class="gh-token">
      <button type="button" class="btn" onclick={self.toggleTokenBox}
        >{truthy(self.tokenBox) ? 'Hide token' : 'Add a token'}</button
      >
      {#if truthy(self.tokenBox)}
        <div class="tool-controls">
          <input
            type={truthy(self.showToken) ? 'text' : 'password'}
            class="math-input"
            placeholder="ghp_…"
            autocomplete="off"
            aria-label="GitHub token"
            {@attach prop('value', () => self.token)}
            oninput={self.setToken}
          />
          <button
            type="button"
            class="btn"
            aria-label="Show or hide the token"
            onclick={self.toggleToken}
            ><Icon
              name={truthy(self.showToken) ? 'eye-off' : 'eye'}
              size={14}
            /></button
          >
        </div>
        <p class="tool-hint"
          >A personal access token lets you look at private repositories and
          make more than 60 lookups an hour. It is sent straight to
          api.github.com and nowhere else, and stays on this device.</p
        >
      {/if}
    </div>

    {#if truthy(self.error)}
      <p class="tool-error">{self.error}</p>
    {/if}

    {#if truthy(self.info)}
      <div class="gh-head">
        <img
          class="gh-avatar"
          src={self.info?.owner?.avatar_url}
          alt=""
          width="48"
          height="48"
        />
        <div>
          <h3 class="gh-name">
            <a
              href={self.info?.html_url}
              target="_blank"
              rel="noopener noreferrer">{self.info?.full_name}</a
            >
          </h3>
          {#if truthy(self.info?.description)}
            <p class="gh-desc">{self.info?.description}</p>
          {/if}
          <div class="stat-row">
            <span class="stat-chip"
              >by
              {self.info?.owner?.login}
              ({self.info?.owner?.type})</span
            >
            {#if truthy(self.info?.language)}
              <span class="stat-chip">{self.info?.language}</span>
            {/if}
            {#each self.flags ?? [] as f}
              <span class="stat-chip">{f}</span>
            {/each}
            {#each self.info?.topics ?? [] as t}
              <span class="stat-chip gh-topic">#{t}</span>
            {/each}
          </div>
          {#if truthy(self.info?.homepage)}
            <a
              class="gh-link"
              href={self.info?.homepage}
              target="_blank"
              rel="noopener noreferrer">{self.info?.homepage}</a
            >
          {/if}
        </div>
      </div>

      <div class="math-stats gh-stats">
        {#each self.facts ?? [] as f}
          <div class="math-stat"
            ><span>{f?.label}</span><strong>{f?.value}</strong></div
          >
        {/each}
      </div>

      <div class="tool-controls">
        {#if truthy(self.exact)}
          <span class="tool-hint"
            >{num(self.exact?.total?.code)}
            lines of code across
            {num(self.exact?.total?.files)}
            files, plus
            {num(self.exact?.total?.comment)}
            comment lines and
            {num(self.exact?.total?.blank)}
            blank ones.
            {#if truthy(self.exact?.failed)}({self.exact?.failed}
              files couldn't be read.){/if}
            {#if truthy(self.exact?.truncated)}Some files were skipped to keep
              this quick.{/if}</span
          >
        {:else}
          <button
            type="button"
            class="btn"
            disabled={self.counting}
            onclick={self.countExact}
          >
            {#if truthy(self.counting)}
              {#if truthy(self.progress)}Counting…
                {self.progress?.done}
                /
                {self.progress?.total}
              {:else}
                Counting…
              {/if}
            {:else}
              Count exact lines
            {/if}
          </button>
          <span class="tool-hint"
            >The estimate is from GitHub's byte counts. The exact count reads
            every source file in the repository and counts it the way
            <a
              href="https://github.com/AlDanial/cloc"
              target="_blank"
              rel="noopener noreferrer">cloc</a
            >
            does; large repositories take longer.</span
          >
        {/if}
      </div>

      <div class="gh-grid">
        {#if truthy(self.languages?.length)}
          <section>
            <h3 class="qr-heading">Languages</h3>
            <ul class="gh-langs">
              {#each self.languages ?? [] as l}
                <li>
                  <div class="gh-lang-row"
                    ><span>{l?.name}</span><span class="tool-hint"
                      >{l?.detail}</span
                    ></div
                  >
                  <div class="gh-bar"
                    ><div class="gh-bar-fill" style={width(l?.share)}
                    ></div></div
                  >
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if truthy(self.contributors?.length)}
          <section>
            <h3 class="qr-heading">Top contributors</h3>
            <ul class="gh-people">
              {#each self.contributors ?? [] as c}
                <li>
                  <img src={c?.avatar} alt="" width="24" height="24" />
                  <a href={c?.url} target="_blank" rel="noopener noreferrer"
                    >{c?.login}</a
                  >
                  <span class="tool-hint">{c?.commits} commits</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if truthy(self.files)}
          <section>
            <h3 class="qr-heading"
              >Files on
              {self.info?.default_branch}</h3
            >
            <div class="math-stats">
              <div class="math-stat"
                ><span>Files</span><strong>{num(self.files?.files)}</strong
                ></div
              >
              <div class="math-stat"
                ><span>Folders</span><strong>{num(self.files?.folders)}</strong
                ></div
              >
              <div class="math-stat"
                ><span>Source size</span><strong
                  >{formatBytes(self.files?.bytes)}</strong
                ></div
              >
            </div>
            <div class="stat-row">
              {#each self.files?.extensions ?? [] as e}
                <span class="stat-chip">.{e?.ext} × {e?.count}</span>
              {/each}
            </div>
            {#if truthy(self.files?.largest)}
              <p class="tool-hint"
                >Largest file:
                {self.files?.largest?.path}
                ({formatBytes(self.files?.largest?.size)})</p
              >
            {/if}
            {#if truthy(self.files?.truncated)}
              <p class="tool-hint"
                >GitHub cut the file list short; this repository has more than
                it lists in one go.</p
              >
            {/if}
          </section>
        {/if}

        {#if truthy(self.release)}
          <section>
            <h3 class="qr-heading">Latest release</h3>
            <p class="gh-release"
              ><a
                href={self.release?.url}
                target="_blank"
                rel="noopener noreferrer">{self.release?.name}</a
              >
              <span class="tool-hint"
                >{self.release?.tag}
                ·
                {self.release?.when}
                ·
                {self.release?.downloads}
                downloads</span
              ></p
            >
          </section>
        {/if}
      </div>
    {/if}
  </div>
</ToolPage>
