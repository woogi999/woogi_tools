<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { keepState } from '../utils/tool-state.js';
  import { waybackSnapshots, waybackDate, waybackUrl } from '../utils/osint.js';

  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const sum = (list) => list.reduce((a, b) => a + b, 0);

  class WaybackSnapshotsPage extends Component {
    input = $state.raw('');
    target = $state.raw(null);
    result = $state.raw(null);
    busy = $state.raw(false);
    error = $state.raw(null);
    year = $state.raw(null);

    controller = null;

    constructor(args) {
      super(args);
      keepState(this, 'wayback-snapshots', ['input']);
      registerDestructor(this, () => this.controller?.abort());
    }

    get yearEntries() {
      const years = this.result?.years ?? {};
      return Object.entries(years)
        .map(([year, months]) => ({ year, months, count: sum(months) }))
        .filter((y) => y.count > 0)
        .sort((a, b) => a.year.localeCompare(b.year));
    }

    get total() {
      return sum(this.yearEntries.map((y) => y.count)).toLocaleString();
    }

    // One bar per year, sized by how many captures it has.
    get years() {
      const entries = this.yearEntries;
      const max = Math.max(1, ...entries.map((y) => y.count));
      return entries.map((y) => ({
        ...y,
        height: `height: ${Math.max(6, (y.count / max) * 100)}%`,
        active: y.year === this.year,
      }));
    }

    // The picked year's months, each linking to the capture nearest its middle
    // (the Archive redirects /web/<date>/<url> to the closest one it has).
    get months() {
      const entry = this.yearEntries.find((y) => y.year === this.year);
      if (!entry) return [];
      return entry.months.map((count, i) => {
        const stamp = `${this.year}${String(i + 1).padStart(2, '0')}15`;
        return {
          name: MONTHS[i],
          count,
          href: count ? waybackUrl(stamp, this.target) : null,
          calendar: `https://web.archive.org/web/${stamp.slice(0, 6)}*/${this.target}`,
        };
      });
    }

    get first() {
      const t = this.result?.first;
      return t
        ? {
            when: waybackDate(t).toLocaleDateString(),
            href: waybackUrl(t, this.target),
          }
        : null;
    }

    get last() {
      const t = this.result?.last;
      return t
        ? {
            when: waybackDate(t).toLocaleDateString(),
            href: waybackUrl(t, this.target),
          }
        : null;
    }

    setInput = (event) => (this.input = event.target.value);
    pickYear = (year) => (this.year = this.year === year ? null : year);

    submit = async (event) => {
      event.preventDefault();
      const target = this.input.trim().replace(/^https?:\/\//i, '');
      if (!target) return;
      this.controller?.abort();
      const controller = (this.controller = new AbortController());
      this.busy = true;
      this.error = null;
      this.result = null;
      this.year = null;
      this.target = target;
      try {
        const result = await waybackSnapshots(target, controller.signal);
        if (controller.signal.aborted) return;
        this.result = result;
        this.year = this.yearEntries.at(-1)?.year ?? null;
      } catch (error) {
        if (!controller.signal.aborted) this.error = error.message;
      }
      if (!controller.signal.aborted) this.busy = false;
    };
  }
</script>

<script>
  let args = $props();
  const self = new WaybackSnapshotsPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="wayback-snapshots"
  busy={self.busy}
  closeWarning="Close Wayback Snapshots? The lookup still running will stop."
  subtitle="What a page used to say: when the Internet Archive saved it, year by year, one click from the copy."
>
  <div class="pop-in">
    <form class="dl-form" onsubmit={self.submit}>
      <input
        type="text"
        class="math-input"
        placeholder="example.com/about"
        spellcheck="false"
        autocapitalize="off"
        aria-label="Address"
        {@attach prop('value', () => self.input)}
        oninput={self.setInput}
      />
      <button type="submit" class="btn active" disabled={self.busy}>
        <Icon name="history" size={13} />
        {truthy(self.busy) ? 'Asking the Archive…' : 'Look back'}</button
      >
    </form>
    {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}

    {#if truthy(self.result)}
      <section class="math-card">
        {#if truthy(self.first)}
          <p
            ><strong>{self.total}</strong>
            captures, the first on
            <a href={self.first?.href} target="_blank" rel="noopener noreferrer"
              >{self.first?.when}</a
            >
            and the latest on
            <a href={self.last?.href} target="_blank" rel="noopener noreferrer"
              >{self.last?.when}</a
            >.</p
          >
          <div class="osint-years">
            {#each self.years ?? [] as y}
              <button
                type="button"
                class="osint-year {truthy(y?.active) ? 'is-active' : ''}"
                title="{y?.year}: {y?.count}"
                onclick={(..._r) => self.pickYear(y?.year, ..._r)}
                ><span style={y?.height}></span><small>{y?.year}</small></button
              >
            {/each}
          </div>
          {#if truthy(self.year)}
            <h3 class="qr-heading">{self.year}</h3>
            <ul class="osint-months">
              {#each self.months ?? [] as m}
                <li class={!truthy(m?.count) ? 'is-empty' : ''}>
                  {#if truthy(m?.href)}
                    <a href={m?.href} target="_blank" rel="noopener noreferrer"
                      >{m?.name}</a
                    >
                    <a
                      class="is-muted"
                      href={m?.calendar}
                      target="_blank"
                      rel="noopener noreferrer">{m?.count} captures</a
                    >
                  {:else}
                    <span>{m?.name}</span>
                    <span class="is-muted">none</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="tool-hint"
            >The Archive has never saved
            {self.target}.</p
          >
        {/if}
      </section>
    {:else}
      <p class="tool-hint"
        >Pick a year to see its months. A month opens the capture nearest its
        middle; its count opens the Archive's own list for that month.</p
      >
    {/if}
  </div>
</ToolPage>
