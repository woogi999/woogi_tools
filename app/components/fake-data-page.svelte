<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { keepState } from '../utils/tool-state.js';
  import { FIELDS, FORMATS, generate, seedFrom } from '../utils/fake-data.js';

  // A ready-made set of fields for the three things people are usually filling:
  // a user table, an order table, or a page of cards.
  const PRESETS = [
    {
      id: 'people',
      label: 'People',
      fields: [
        'id',
        'fullName',
        'email',
        'phone',
        'jobTitle',
        'company',
        'city',
        'country',
      ],
    },
    {
      id: 'users',
      label: 'User accounts',
      fields: ['uuid', 'username', 'email', 'status', 'datetime', 'avatar'],
    },
    {
      id: 'orders',
      label: 'Orders',
      fields: [
        'id',
        'fullName',
        'product',
        'quantity',
        'price',
        'status',
        'date',
      ],
    },
    {
      id: 'content',
      label: 'Cards & posts',
      fields: ['id', 'sentence', 'paragraph', 'fullName', 'date', 'colour'],
    },
  ];

  const eq = (a, b) => a === b;

  class FakeDataPage extends Component {
    allFields = FIELDS;
    formats = FORMATS;
    presets = PRESETS;

    fields = $state.raw(PRESETS[0].fields);
    count = $state.raw(20);
    format = $state.raw('json');
    seedText = $state.raw('woogi');

    constructor(args) {
      super(args);
      keepState(this, 'fake-data', ['fields', 'count', 'format', 'seedText']);
    }

    get fieldRows() {
      return FIELDS.map((f) => ({ ...f, on: this.fields.includes(f.id) }));
    }

    get currentFormat() {
      return FORMATS.find((f) => f.id === this.format) ?? FORMATS[0];
    }

    get rows() {
      if (!this.fields.length) return [];
      return generate({
        fields: this.fields,
        count: Math.min(1000, Math.max(1, this.count)),
        seed: seedFrom(this.seedText),
      });
    }

    get output() {
      if (!this.fields.length) return '';
      return this.currentFormat.render(this.rows, this.fields);
    }

    // A data URL rather than a blob: this is read during render, and a blob URL
    // made here would leak a new one on every keystroke with nothing to revoke it.
    get downloadUrl() {
      return `data:${this.currentFormat.mime};charset=utf-8,${encodeURIComponent(this.output)}`;
    }

    get fileName() {
      return `fake-data.${this.currentFormat.ext}`;
    }

    // Just the first few rows, as a table, so you can see the shape at a glance
    // without reading JSON.
    get preview() {
      return this.rows.slice(0, 8).map((row, index) => ({
        key: index,
        cells: this.fields.map((f) => ({ key: f, value: String(row[f]) })),
      }));
    }

    toggleField = (id) => {
      this.fields = this.fields.includes(id)
        ? this.fields.filter((f) => f !== id)
        : [...this.fields, id];
    };

    usePreset = (preset) => (this.fields = [...preset.fields]);
    setCount = (e) =>
      (this.count = Math.min(1000, Math.max(1, Number(e.target.value) || 1)));
    setFormat = (e) => (this.format = e.target.value);
    setSeed = (e) => (this.seedText = e.target.value);
    // A new seed is the whole reroll: the same fields, an entirely different set
    // of rows, and still reproducible by typing that seed back in.
    reroll = () => (this.seedText = Math.random().toString(36).slice(2, 8));
  }
</script>

<script>
  let args = $props();
  const self = new FakeDataPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="fake-data"
  subtitle="Rows of realistic-looking nonsense to fill a mockup or a test database. Pick the columns, pick a format, and take as many as you need."
>
  <div class="math-grid text-tool pop-in">
    <section class="math-card">
      <h3 class="qr-heading">Columns</h3>
      <div class="math-tabs" role="group" aria-label="Presets">
        {#each self.presets ?? [] as p}
          <button
            type="button"
            class="qr-tab"
            onclick={(..._r) => self.usePreset(p, ..._r)}>{p?.label}</button
          >
        {/each}
      </div>
      <ul class="fake-fields">
        {#each self.fieldRows ?? [] as f (f?.id)}
          <li>
            <label class="math-check">
              <input
                type="checkbox"
                {@attach prop('checked', () => f?.on)}
                onchange={(..._r) => self.toggleField(f?.id, ..._r)}
              />
              {f?.label}
            </label>
          </li>
        {/each}
      </ul>
    </section>

    <section class="math-card">
      <h3 class="qr-heading">How much, and in what</h3>
      <div class="math-row is-aligned">
        <label class="math-field"
          ><span class="qr-label is-muted">Rows</span>
          <input
            type="number"
            min="1"
            max="1000"
            class="math-input"
            {@attach prop('value', () => self.count)}
            oninput={self.setCount}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Format</span>
          <select class="select" onchange={self.setFormat}>
            {#each self.formats ?? [] as f}
              <option
                value={f?.id}
                {@attach prop('selected', () => eq(f?.id, self.format))}
                >{f?.label}</option
              >
            {/each}
          </select></label
        >
      </div>
      <div class="math-row is-aligned">
        <label class="math-field"
          ><span class="qr-label is-muted">Seed</span>
          <input
            type="text"
            class="math-input"
            {@attach prop('value', () => self.seedText)}
            oninput={self.setSeed}
          /></label
        >
        <button type="button" class="btn active math-swap" onclick={self.reroll}
          ><Icon name="dices" size={13} /> Reroll</button
        >
      </div>
      <p class="tool-hint"
        >The same seed always gives the same rows, so a fixture you generate
        today you can generate again next year. Change it for a completely
        different set.</p
      >
      <p class="tool-hint"
        >None of this is real. Emails land on example.com, phone numbers use the
        ranges reserved for fiction, card numbers are the ones every processor
        declines, and IPs come from the documentation range: nothing here can
        reach a real person or take a real payment.</p
      >
    </section>
  </div>

  {#if truthy(self.fields?.length)}
    <section class="math-card pop-in">
      <div class="field-head">
        <span class="qr-label is-muted">First few rows</span>
        <div class="settings-actions">
          <CopyButton value={self.output} />
          <a
            class="btn fs-save"
            href={self.downloadUrl}
            download={self.fileName}><Icon name="download" size={13} /> Save</a
          >
        </div>
      </div>
      <div class="fake-table-wrap">
        <table class="fake-table">
          <thead>
            <tr
              >{#each self.fields ?? [] as f}<th>{f}</th>{/each}</tr
            >
          </thead>
          <tbody>
            {#each self.preview ?? [] as row}
              <tr
                >{#each row?.cells ?? [] as cell}<td>{cell?.value}</td
                  >{/each}</tr
              >
            {/each}
          </tbody>
        </table>
      </div>
      <span class="qr-label is-muted">{self.currentFormat?.label}</span>
      <textarea
        class="textarea text-area-tall is-mono"
        readonly
        spellcheck="false"
        aria-label="Generated data"
        {@attach prop('value', () => self.output)}></textarea>
    </section>
  {:else}
    <p class="tool-hint">Tick at least one column to get started.</p>
  {/if}
</ToolPage>
