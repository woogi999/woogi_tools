<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import { keepState } from '../utils/tool-state.js';
  import { randomInt, shuffled } from '../utils/random.js';

  const COLOURS = [
    '#ff9f1a',
    '#4ea8de',
    '#e5596b',
    '#30a46c',
    '#a78bfa',
    '#f2c94c',
    '#2dd4bf',
    '#f472b6',
  ];
  const SPIN_MS = 3200;
  const eq = (a, b) => a === b;

  const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.motion === 'reduce';

  class SpinTheWheelPage extends Component {
    text = $state.raw('Pizza\nSushi\nTacos\nRamen\nBurgers\nCurry');
    mode = $state.raw('wheel');
    rotation = $state.raw(0);
    spinning = $state.raw(false);
    winner = $state.raw(null);
    removeWinner = $state.raw(false);
    count = $state.raw(2);
    groups = $state.raw([]);
    groupMode = $state.raw('teams');
    history = $state.raw([]);

    timer = null;

    constructor(args) {
      super(args);
      keepState(this, 'spin-the-wheel', [
        'text',
        'mode',
        'removeWinner',
        'count',
        'groupMode',
      ]);
      registerDestructor(this, () => clearTimeout(this.timer));
    }

    get entries() {
      return this.text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    get slices() {
      const entries = this.entries;
      const n = entries.length;
      if (!n) return [];
      const angle = 360 / n;
      return entries.map((label, i) => {
        const start = ((i * angle - 90) * Math.PI) / 180;
        const end = (((i + 1) * angle - 90) * Math.PI) / 180;
        const mid = (start + end) / 2;
        const large = angle > 180 ? 1 : 0;
        const path =
          n === 1
            ? 'M100,100 m-96,0 a96,96 0 1,0 192,0 a96,96 0 1,0 -192,0'
            : `M100,100 L${100 + 96 * Math.cos(start)},${100 + 96 * Math.sin(start)} A96,96 0 ${large},1 ${100 + 96 * Math.cos(end)},${100 + 96 * Math.sin(end)} Z`;
        const text = label.length > 14 ? `${label.slice(0, 13)}…` : label;
        return {
          path,
          fill: COLOURS[i % COLOURS.length],
          text,
          x: 100 + 62 * Math.cos(mid),
          y: 100 + 62 * Math.sin(mid),
          rotate: (mid * 180) / Math.PI,
        };
      });
    }

    get wheelStyle() {
      const duration = this.spinning && !reducedMotion() ? SPIN_MS : 0;
      return `transform:rotate(${this.rotation}deg);transition:transform ${duration}ms cubic-bezier(0.12, 0.8, 0.2, 1)`;
    }

    spin = () => {
      const entries = this.entries;
      if (!entries.length || this.spinning) return;
      const index = randomInt(entries.length);
      const slice = 360 / entries.length;
      // Land the pointer (at the top) somewhere inside the chosen slice, never on an edge.
      const within = slice * (0.15 + 0.7 * (randomInt(1000) / 1000));
      const target = 360 - (index * slice + within);
      const current = ((this.rotation % 360) + 360) % 360;
      this.rotation += 360 * 5 + ((target - current + 360) % 360);
      this.spinning = true;
      this.winner = null;
      this.timer = setTimeout(
        () => this.finish(entries[index]),
        reducedMotion() ? 50 : SPIN_MS,
      );
    };

    finish(name) {
      this.spinning = false;
      this.winner = name;
      this.history = [name, ...this.history].slice(0, 10);
      if (this.removeWinner) {
        const lines = this.text.split('\n');
        const i = lines.findIndex((l) => l.trim() === name);
        if (i >= 0) lines.splice(i, 1);
        this.text = lines.join('\n');
      }
    }

    makeGroups = () => {
      const entries = shuffled(this.entries);
      const size = Math.max(1, this.count);
      if (this.groupMode === 'teams') {
        const teams = Array.from(
          { length: Math.min(size, entries.length) },
          () => [],
        );
        entries.forEach((e, i) => teams[i % teams.length].push(e));
        this.groups = teams.map((members, i) => ({
          title: `Team ${i + 1}`,
          members,
        }));
      } else {
        this.groups = [
          {
            title:
              size === 1 ? 'Winner' : `${Math.min(size, entries.length)} picks`,
            members: entries.slice(0, size),
          },
        ];
      }
    };

    setText = (e) => (this.text = e.target.value);
    setMode = (mode) => (this.mode = mode);
    setGroupMode = (mode) => (this.groupMode = mode);
    setCount = (e) =>
      (this.count = Math.max(1, Math.floor(+e.target.value) || 1));
    toggleRemove = () => (this.removeWinner = !this.removeWinner);
  }

  function join(list) {
    return list.join(', ');
  }
</script>

<script>
  let args = $props();
  const self = new SpinTheWheelPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="spin-the-wheel"
  subtitle="Spin the wheel, pull a name out of the hat, or split a list into random teams. Let fate decide."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <label class="field-label" for="rp-list"
        >Entries ·
        {self.entries?.length}</label
      >
      <textarea
        id="rp-list"
        class="textarea text-area-tall"
        placeholder="One entry per line"
        {@attach prop('value', () => self.text)}
        oninput={self.setText}></textarea>
      {#if truthy(self.history?.length)}
        <p class="tool-hint">Recent: {join(self.history)}</p>
      {/if}
    </section>

    <section class="math-card">
      <div class="math-tabs" role="group" aria-label="Mode">
        <button
          type="button"
          class="qr-tab {truthy(eq(self.mode, 'wheel')) ? 'active' : ''}"
          onclick={(..._r) => self.setMode('wheel', ..._r)}>Wheel</button
        >
        <button
          type="button"
          class="qr-tab {truthy(eq(self.mode, 'groups')) ? 'active' : ''}"
          onclick={(..._r) => self.setMode('groups', ..._r)}
          >Draw & teams</button
        >
      </div>

      {#if truthy(eq(self.mode, 'wheel'))}
        <div class="wheel">
          <span class="wheel-pointer" aria-hidden="true"></span>
          <svg
            viewBox="0 0 200 200"
            class="wheel-disc"
            style={self.wheelStyle}
            role="img"
            aria-label="Spinning wheel"
          >
            {#each self.slices ?? [] as s}
              <path d={s?.path} fill={s?.fill}></path>
              <text
                x={s?.x}
                y={s?.y}
                transform="rotate({s?.rotate} {s?.x} {s?.y})"
                text-anchor="middle"
                dominant-baseline="middle">{s?.text}</text
              >
            {/each}
          </svg>
        </div>
        <div class="settings-actions">
          <button
            type="button"
            class="btn active"
            disabled={truthy(self.entries?.length) ? self.spinning : true}
            onclick={self.spin}
            >{truthy(self.spinning) ? 'Spinning…' : 'Spin'}</button
          >
          <label class="math-check"
            ><input
              type="checkbox"
              {@attach prop('checked', () => self.removeWinner)}
              onchange={self.toggleRemove}
            />
            Remove the winner after each spin</label
          >
        </div>
        {#if truthy(self.winner)}
          <p class="math-callout" role="status">{self.winner}</p>
        {/if}
      {:else}
        <div class="math-tabs" role="group" aria-label="Draw type">
          <button
            type="button"
            class="qr-tab {truthy(eq(self.groupMode, 'teams')) ? 'active' : ''}"
            onclick={(..._r) => self.setGroupMode('teams', ..._r)}
            >Split into teams</button
          >
          <button
            type="button"
            class="qr-tab {truthy(eq(self.groupMode, 'draw')) ? 'active' : ''}"
            onclick={(..._r) => self.setGroupMode('draw', ..._r)}
            >Draw names</button
          >
        </div>
        <div class="math-row is-aligned">
          <label class="math-field"
            ><span class="qr-label is-muted"
              >{truthy(eq(self.groupMode, 'teams'))
                ? 'Number of teams'
                : 'How many to draw'}</span
            ><input
              type="number"
              min="1"
              class="math-input"
              {@attach prop('value', () => self.count)}
              oninput={self.setCount}
            /></label
          >
          <button
            type="button"
            class="btn active math-swap"
            disabled={truthy(self.entries?.length) ? false : true}
            onclick={self.makeGroups}
            >{truthy(eq(self.groupMode, 'teams'))
              ? 'Make teams'
              : 'Draw'}</button
          >
        </div>
        {#if truthy(self.groups?.length)}
          <div class="math-stats">
            {#each self.groups ?? [] as g}
              <div class="math-stat">
                <span>{g?.title}</span>
                <strong>{join(g?.members)}</strong>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
      <p class="tool-hint"
        >Picks use your browser's cryptographic random number generator, so
        every entry has an equal chance.</p
      >
    </section>
  </div>
</ToolPage>
