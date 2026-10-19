<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { keepState } from '../utils/tool-state.js';

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  export const stamp = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${h ? `${h}:` : ''}${pad(m)}:${pad(s)}.${pad(cs)}`;
  };

  class StopwatchPage extends Component {
    running = $state.raw(false);
    elapsed = $state.raw(0);
    laps = $state.raw([]);
    // Where the clock stood when it was last started, so a refresh mid-run carries on.
    startedAt = $state.raw(null);

    frame = 0;

    constructor(args) {
      super(args);
      keepState(this, 'stopwatch', ['elapsed', 'laps', 'startedAt'], () => {
        if (this.startedAt !== null) {
          this.running = true;
          this.tick();
        }
      });
      registerDestructor(this, () => cancelAnimationFrame(this.frame));
    }

    get notStarted() {
      return !this.running && !this.elapsed;
    }

    get display() {
      return stamp(this.elapsed);
    }

    get lapRows() {
      const times = this.laps.map((l) => l.split);
      const best = times.length > 1 ? Math.min(...times) : null;
      const worst = times.length > 1 ? Math.max(...times) : null;
      return this.laps
        .map((lap, i) => ({
          n: i + 1,
          split: stamp(lap.split),
          total: stamp(lap.total),
          best: lap.split === best,
          worst: lap.split === worst,
        }))
        .reverse();
    }

    get text() {
      return this.laps
        .map(
          (lap, i) => `Lap ${i + 1}\t${stamp(lap.split)}\t${stamp(lap.total)}`,
        )
        .join('\n');
    }

    keys = modifier(() => {
      const onKey = (event) => {
        if (event.target.closest('input, textarea, select, button')) return;
        if (event.code === 'Space') {
          event.preventDefault();
          this.toggle();
        } else if (event.key === 'l' || event.key === 'L') this.lap();
        else if (event.key === 'r' || event.key === 'R') this.reset();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    });

    tick = () => {
      if (!this.running) return;
      this.elapsed = Date.now() - this.startedAt;
      this.frame = requestAnimationFrame(this.tick);
    };

    toggle = () => {
      if (this.running) {
        this.running = false;
        cancelAnimationFrame(this.frame);
        this.elapsed = Date.now() - this.startedAt;
        this.startedAt = null;
        return;
      }
      this.startedAt = Date.now() - this.elapsed;
      this.running = true;
      this.tick();
    };

    lap = () => {
      if (!this.running && !this.elapsed) return;
      const total = this.running ? Date.now() - this.startedAt : this.elapsed;
      const last = this.laps[this.laps.length - 1]?.total ?? 0;
      this.laps = [...this.laps, { total, split: total - last }];
    };

    reset = () => {
      this.running = false;
      cancelAnimationFrame(this.frame);
      this.elapsed = 0;
      this.startedAt = null;
      this.laps = [];
    };
  }
</script>

<script>
  let args = $props();
  const self = new StopwatchPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="stopwatch"
  subtitle="A stopwatch with laps. It keeps counting if you leave and come back."
  busy={self.running}
  closeWarning="the running stopwatch"
>
  <div class="pop-in" {@attach self.keys?.()}>
    <div class="sw-face {truthy(self.running) ? 'is-running' : ''}">
      <span class="sw-time">{self.display}</span>
      <div class="settings-actions sw-actions">
        <button type="button" class="btn active" onclick={self.toggle}>
          <Icon name={truthy(self.running) ? 'pause' : 'play'} size={14} />
          {truthy(self.running)
            ? 'Stop'
            : truthy(self.elapsed)
              ? 'Resume'
              : 'Start'}</button
        >
        <button
          type="button"
          class="btn"
          disabled={self.notStarted}
          onclick={self.lap}
        >
          <Icon name="flag" size={14} />
          Lap</button
        >
        <button type="button" class="btn" onclick={self.reset}>
          <Icon name="rotate-ccw" size={14} />
          Reset</button
        >
      </div>
      <p class="tool-hint">Space starts and stops, L marks a lap, R resets.</p>
    </div>

    {#if truthy(self.laps?.length)}
      <section class="math-card">
        <div class="fc-toolbar">
          <h3 class="qr-heading">Laps</h3>
          <CopyButton value={self.text} label="Copy laps" />
        </div>
        <table class="sw-laps">
          <thead>
            <tr><th>Lap</th><th>Split</th><th>Total</th></tr>
          </thead>
          <tbody>
            {#each self.lapRows ?? [] as lap}
              <tr
                class="{truthy(lap?.best) ? 'is-best' : ''}
                      {truthy(lap?.worst) ? 'is-worst' : ''}"
              >
                <td>{lap?.n}</td>
                <td>{lap?.split}</td>
                <td>{lap?.total}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}
  </div>
</ToolPage>
