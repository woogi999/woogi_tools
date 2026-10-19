<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { ALGORITHMS } from '../utils/hash.js';
  import { formatBytes } from '../utils/file-share.js';
  import { acceptPastedFiles } from '../utils/paste-files.js';

  const eq = (a, b) => a === b;

  class HashGeneratorPage extends Component {
    source = $state.raw('text');
    text = $state.raw('hello world');
    file = $state.raw(null);
    hashes = $state.raw([]);
    busy = $state.raw(false);
    uppercase = $state.raw(false);
    expected = $state.raw('');
    dragging = $state.raw(false);

    // Results from a slower, earlier run must not overwrite a newer one.
    runId = 0;

    constructor(args) {
      super(args);
      this.compute();
    }

    get display() {
      return this.hashes.map((h) => ({
        ...h,
        value: this.uppercase ? h.value.toUpperCase() : h.value,
      }));
    }

    get match() {
      const wanted = this.expected.trim().toLowerCase().replace(/\s+/g, '');
      if (!wanted) return null;
      return this.hashes.find((h) => h.value === wanted) ?? false;
    }

    async compute() {
      const id = ++this.runId;
      const bytes =
        this.source === 'file'
          ? this.file
            ? new Uint8Array(await this.file.arrayBuffer())
            : null
          : new TextEncoder().encode(this.text);
      if (!bytes) {
        this.hashes = [];
        return;
      }
      this.busy = true;
      const hashes = await Promise.all(
        ALGORITHMS.map(async (a) => ({
          id: a.id,
          label: a.label,
          value: await a.run(bytes),
        })),
      );
      if (id !== this.runId) return;
      this.hashes = hashes;
      this.busy = false;
    }

    setSource = (source) => {
      this.source = source;
      this.compute();
    };

    setText = (e) => {
      this.text = e.target.value;
      this.compute();
    };

    pickFile(file) {
      if (!file) return;
      this.file = file;
      this.source = 'file';
      this.compute();
    }

    selectFile = (e) => {
      this.pickFile(e.target.files?.[0]);
      e.target.value = '';
    };

    dragOver = (e) => {
      e.preventDefault();
      this.dragging = e.type === 'dragover';
    };

    dropFile = (e) => {
      e.preventDefault();
      this.dragging = false;
      this.pickFile(e.dataTransfer.files?.[0]);
    };

    setExpected = (e) => (this.expected = e.target.value);
    toggleUppercase = () => (this.uppercase = !this.uppercase);

    pasteFiles = (files) => this.pickFile(files[0]);
  }
</script>

<script>
  let args = $props();
  const self = new HashGeneratorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="hash-generator"
  busy={self.busy}
  closeWarning="Close the Hash Generator? The file being hashed will stop."
  subtitle="Hash text or a file with MD5, SHA-1, SHA-2 or CRC-32, then compare it to a checksum to make sure nothing’s been tampered with."
>
  <div
    class="math-grid text-tool pop-in"
    {@attach acceptPastedFiles([self.pasteFiles])}
  >
    <section class="math-card">
      <div class="math-tabs" role="group" aria-label="Input">
        <button
          type="button"
          class="qr-tab {truthy(eq(self.source, 'text')) ? 'active' : ''}"
          onclick={(..._r) => self.setSource('text', ..._r)}>Text</button
        >
        <button
          type="button"
          class="qr-tab {truthy(eq(self.source, 'file')) ? 'active' : ''}"
          onclick={(..._r) => self.setSource('file', ..._r)}>File</button
        >
      </div>
      {#if truthy(eq(self.source, 'text'))}
        <textarea
          class="textarea text-area-tall"
          spellcheck="false"
          aria-label="Text to hash"
          {@attach prop('value', () => self.text)}
          oninput={self.setText}></textarea>
        <p class="tool-hint">Text is hashed as UTF-8.</p>
      {:else}
        <label
          class="qr-drop {truthy(self.dragging) ? 'is-dragging' : ''}"
          ondrop={self.dropFile}
          ondragleave={self.dragOver}
          ondragover={self.dragOver}
        >
          <Icon name="upload" size={22} />
          <span
            >{truthy(self.file)
              ? self.file?.name
              : 'Drop a file, or click to browse'}</span
          >
          {#if truthy(self.file)}<span class="tool-hint"
              >{formatBytes(self.file?.size)}</span
            >{/if}
          <input type="file" class="sr-only" onchange={self.selectFile} />
        </label>
        <p class="tool-hint"
          >The file is read on your device and never uploaded.</p
        >
      {/if}
      <label class="math-field">
        <span class="qr-label is-muted">Compare with a checksum</span>
        <input
          type="text"
          class="math-input"
          spellcheck="false"
          placeholder="Paste an expected hash"
          {@attach prop('value', () => self.expected)}
          oninput={self.setExpected}
        />
      </label>
      {#if truthy(self.expected)}
        {#if truthy(self.match)}
          <p class="math-callout">Matches the {self.match?.label} hash.</p>
        {:else}
          <p class="math-callout is-soft">Doesn't match any of these hashes.</p>
        {/if}
      {/if}
    </section>

    <section class="math-card">
      <div class="field-head">
        <h3 class="qr-heading">Hashes</h3>
        <label class="math-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.uppercase)}
            onchange={self.toggleUppercase}
          />
          Uppercase</label
        >
      </div>
      {#if truthy(self.busy)}<p class="tool-hint">Hashing…</p>{/if}
      <ul class="case-list">
        {#each self.display ?? [] as h (h?.id)}
          <li
            class="case-item {truthy(eq(self.match?.id, h?.id))
              ? 'is-match'
              : ''}"
          >
            <div class="case-text">
              <span class="qr-label is-muted">{h?.label}</span>
              <span class="case-value is-mono">{h?.value}</span>
            </div>
            <CopyButton value={h?.value} />
          </li>
        {/each}
      </ul>
    </section>
  </div>
</ToolPage>
