<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import { keepState } from '../utils/tool-state.js';
  import { CATEGORIES, SYSTEMS, fitFoot } from '../utils/shoe-sizes.js';

  const eq = (a, b) => a === b;
  const CM_PER_INCH = 2.54;

  class ShoeSizePage extends Component {
    categories = CATEGORIES;
    systems = SYSTEMS;

    categoryId = $state.raw('men');
    systemId = $state.raw('us');
    size = $state.raw('9');
    footLength = $state.raw('27');
    unit = $state.raw('cm'); // 'cm' | 'in'
    room = $state.raw('0.5');

    constructor(args) {
      super(args);
      keepState(this, 'shoe-size', [
        'categoryId',
        'systemId',
        'size',
        'footLength',
        'unit',
        'room',
      ]);
    }

    get category() {
      return CATEGORIES.find((c) => c.id === this.categoryId);
    }

    get sizeOptions() {
      return this.category.sizes.map((row) => String(row[this.systemId]));
    }

    get converted() {
      return (
        this.category.sizes.find(
          (row) => String(row[this.systemId]) === this.size,
        ) ?? null
      );
    }

    get footCm() {
      const n = Number(this.footLength);
      if (!(n > 0)) return null;
      return this.unit === 'in' ? n * CM_PER_INCH : n;
    }

    get fitted() {
      if (this.footCm === null) return null;
      return fitFoot(this.category, this.footCm, Number(this.room) || 0);
    }

    get footInches() {
      return this.footCm === null ? '' : (this.footCm / CM_PER_INCH).toFixed(2);
    }

    setCategory = (event) => {
      this.categoryId = event.target.value;
      if (!this.sizeOptions.includes(this.size))
        this.size = this.sizeOptions[0];
    };

    setSystem = (event) => {
      const row = this.converted;
      this.systemId = event.target.value;
      this.size = String((row ?? this.category.sizes[0])[this.systemId]);
    };

    setSize = (event) => (this.size = event.target.value);
    setFoot = (event) => (this.footLength = event.target.value);
    setRoom = (event) => (this.room = event.target.value);
    setUnit = (unit) => {
      if (unit === this.unit || this.footCm === null) return;
      this.footLength =
        unit === 'in'
          ? (this.footCm / CM_PER_INCH).toFixed(2)
          : this.footCm.toFixed(1);
      this.unit = unit;
    };
  }
</script>

<script>
  let args = $props();
  const self = new ShoeSizePage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="shoe-size"
  subtitle="Measure your foot to find your size, or turn a US, UK or EU size into the others."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <h3 class="qr-heading">Find my size</h3>
      <label class="math-field">
        <span class="qr-label is-muted">For</span>
        <select class="select" onchange={self.setCategory}>
          {#each self.categories ?? [] as c}
            <option
              value={c?.id}
              {@attach prop('selected', () => eq(c?.id, self.categoryId))}
              >{c?.label}</option
            >
          {/each}
        </select>
      </label>
      <div class="math-row is-aligned">
        <label class="math-field"
          ><span class="qr-label is-muted">Foot length</span><input
            type="number"
            min="0"
            step="0.1"
            class="math-input"
            {@attach prop('value', () => self.footLength)}
            oninput={self.setFoot}
          /></label
        >
        <div class="math-tabs" role="group" aria-label="Unit">
          <button
            type="button"
            class="qr-tab {truthy(eq(self.unit, 'cm')) ? 'active' : ''}"
            onclick={(..._r) => self.setUnit('cm', ..._r)}>cm</button
          >
          <button
            type="button"
            class="qr-tab {truthy(eq(self.unit, 'in')) ? 'active' : ''}"
            onclick={(..._r) => self.setUnit('in', ..._r)}>inches</button
          >
        </div>
      </div>
      <label class="math-field">
        <span class="qr-label is-muted">Wiggle room: {self.room} cm</span>
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.1"
          {@attach prop('value', () => self.room)}
          oninput={self.setRoom}
        />
      </label>
      {#if truthy(self.fitted)}
        <div class="math-result">
          <span class="qr-label is-muted">Your size, about</span>
          <span class="math-big">US {self.fitted?.us}</span>
          <span class="tool-hint"
            >UK
            {self.fitted?.uk}
            · EU
            {self.fitted?.eu}
            ·
            {self.fitted?.cm}
            cm last</span
          >
        </div>
      {/if}
      <p class="tool-hint"
        >Stand on a sheet of paper, mark the heel and the longest toe, and
        measure between the marks. Do the bigger foot, late in the day. Half a
        centimetre of room is usual; more for running shoes.</p
      >
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Convert a size</h3>
      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted">System</span>
          <select class="select" onchange={self.setSystem}>
            {#each self.systems ?? [] as s}
              <option
                value={s?.id}
                {@attach prop('selected', () => eq(s?.id, self.systemId))}
                >{s?.label}</option
              >
            {/each}
          </select></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Size</span>
          <select class="select" onchange={self.setSize}>
            {#each self.sizeOptions ?? [] as s}
              <option
                value={s}
                {@attach prop('selected', () => eq(s, self.size))}>{s}</option
              >
            {/each}
          </select></label
        >
      </div>
      {#if truthy(self.converted)}
        <dl class="shoe-dl">
          <dt>US</dt><dd>{self.converted?.us}</dd>
          <dt>UK</dt><dd>{self.converted?.uk}</dd>
          <dt>EU</dt><dd>{self.converted?.eu}</dd>
          <dt>Foot</dt><dd>{self.converted?.cm} cm</dd>
        </dl>
      {/if}
      <details class="shoe-table-wrap">
        <summary>The whole {self.category?.label} table</summary>
        <table class="shoe-table">
          <thead><tr><th>US</th><th>UK</th><th>EU</th><th>cm</th></tr></thead>
          <tbody>
            {#each self.category?.sizes ?? [] as row}
              <tr class={truthy(eq(row, self.converted)) ? 'is-current' : ''}>
                <td>{row?.us}</td><td>{row?.uk}</td><td>{row?.eu}</td><td
                  >{row?.cm}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      </details>
      <p class="tool-hint"
        >Charts differ from brand to brand by up to half a size, and widths are
        another matter entirely.</p
      >
    </section>
  </div>
</ToolPage>
