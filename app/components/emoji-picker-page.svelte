<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import {
    EMOJI,
    CATEGORIES,
    SKIN_TONES,
    withTone,
  } from '../utils/emoji-data.js';
  import { keepState } from '../utils/tool-state.js';

  // Find an emoji by name, tap it to copy, or line a few up to paste at once.
  // The code points are shown so it works for CSS and code as well as chat.

  const eq = (a, b) => a === b;
  const swatch = (colour) => `background:${colour}`;

  const codePoints = (char) =>
    [...char]
      .map(
        (c) =>
          `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
      )
      .join(' ');

  class EmojiPickerPage extends Component {
    query = $state.raw('');
    category = $state.raw('Smileys');
    tone = $state.raw('');
    picked = $state.raw('');
    recent = $state.raw([]);
    flash = $state.raw(null);

    categories = CATEGORIES;
    tones = SKIN_TONES;

    constructor(args) {
      super(args);
      keepState(this, 'emoji-picker', ['tone', 'recent', 'category']);
    }

    get searching() {
      return this.query.trim().length > 0;
    }

    get shown() {
      const q = this.query.trim().toLowerCase();
      const list = q
        ? EMOJI.filter((e) => e.search.includes(q) || e.char === q)
        : EMOJI.filter((e) => e.category === this.category);
      return list.map((e) => ({ ...e, shown: withTone(e, this.tone) }));
    }

    get recentEntries() {
      return this.recent
        .map((char) => EMOJI.find((e) => e.char === char))
        .filter(Boolean)
        .map((e) => ({ ...e, shown: withTone(e, this.tone) }));
    }

    get flashInfo() {
      if (!this.flash) return null;
      return { ...this.flash, codes: codePoints(this.flash.shown) };
    }

    setQuery = (event) => (this.query = event.target.value);
    clearQuery = () => (this.query = '');
    pickCategory = (id) => {
      this.category = id;
      this.query = '';
    };
    pickTone = (id) => (this.tone = id);
    setPicked = (event) => (this.picked = event.target.value);
    clearPicked = () => (this.picked = '');

    // Tapping copies straight away and also drops it into the line-up.
    choose = async (entry) => {
      this.picked += entry.shown;
      this.recent = [
        entry.char,
        ...this.recent.filter((c) => c !== entry.char),
      ].slice(0, 24);
      this.flash = entry;
      try {
        await navigator.clipboard.writeText(entry.shown);
      } catch {
        // No clipboard: it's still in the line-up to copy from.
      }
    };
  }
</script>

<script>
  let args = $props();
  const self = new EmojiPickerPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="emoji-picker"
  subtitle="Every emoji people actually use, searchable by name. Tap one to copy it, or line up a few and copy the lot. Skin tones included."
>
  <div class="ep-page pop-in">
    <div class="ep-search">
      <Icon name="search" size={14} />
      <input
        type="search"
        class="math-input"
        placeholder="Search by name: cat, party, thumbs…"
        aria-label="Search emoji"
        {@attach prop('value', () => self.query)}
        oninput={self.setQuery}
      />
      <div class="ep-tones" role="group" aria-label="Skin tone">
        {#each self.tones ?? [] as t}
          <button
            type="button"
            class="ep-tone {truthy(eq(self.tone, t?.id)) ? 'active' : ''}"
            style={swatch(t?.swatch)}
            title={t?.label}
            aria-label={t?.label}
            onclick={(..._r) => self.pickTone(t?.id, ..._r)}
          ></button>
        {/each}
      </div>
    </div>

    <div class="ep-lineup">
      <input
        type="text"
        class="math-input ep-lineup-input"
        placeholder="Tap emoji to line them up here"
        aria-label="Picked emoji"
        {@attach prop('value', () => self.picked)}
        oninput={self.setPicked}
      />
      <CopyButton value={self.picked} />
      <button type="button" class="btn" onclick={self.clearPicked}>Clear</button
      >
    </div>
    {#if truthy(self.flashInfo)}
      <p class="tool-hint ep-flash"
        ><span class="ep-flash-char">{self.flashInfo?.shown}</span>
        <strong>{self.flashInfo?.name}</strong>
        · copied ·
        <code>{self.flashInfo?.codes}</code></p
      >
    {/if}

    {#if !truthy(self.searching)}
      <div class="cipher-picks" role="tablist" aria-label="Category">
        {#each self.categories ?? [] as c}
          <button
            type="button"
            role="tab"
            class="qr-tab {truthy(eq(self.category, c)) ? 'active' : ''}"
            aria-selected={truthy(eq(self.category, c)) ? 'true' : 'false'}
            onclick={(..._r) => self.pickCategory(c, ..._r)}>{c}</button
          >
        {/each}
      </div>
      {#if truthy(self.recentEntries?.length)}
        <span class="qr-label is-muted">Recently used</span>
        <div class="ep-grid is-small">
          {#each self.recentEntries ?? [] as e}
            <button
              type="button"
              class="ep-cell"
              title={e?.name}
              onclick={(..._r) => self.choose(e, ..._r)}>{e?.shown}</button
            >
          {/each}
        </div>
      {/if}
    {/if}

    <div class="ep-grid">
      {#each self.shown ?? [] as e}
        <button
          type="button"
          class="ep-cell"
          title={e?.name}
          onclick={(..._r) => self.choose(e, ..._r)}>{e?.shown}</button
        >
      {:else}
        <p class="fs-empty">Nothing called that. Try another word.</p>
      {/each}
    </div>
  </div>
</ToolPage>
