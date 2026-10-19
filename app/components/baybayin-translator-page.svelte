<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import CopyButton from './copy-button.svelte';
  import { toBaybayin, fromBaybayin, FINAL_MODES } from '../utils/baybayin.js';
  import { keepState } from '../utils/tool-state.js';

  const eq = (a, b) => a === b;
  const FONT_URL =
    'https://fonts.googleapis.com/css2?family=Noto+Sans+Tagalog&display=swap';

  // Few systems ship a Baybayin font, so one is fetched the first time the page opens.
  const loadFont = modifier(() => {
    if (document.querySelector(`link[href="${FONT_URL}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_URL;
    document.head.append(link);
  });

  class BaybayinTranslatorPage extends Component {
    finalModes = FINAL_MODES;

    text = $state.raw('Mabuhay ang Pilipinas');
    direction = $state.raw('encode'); // 'encode' | 'decode'
    final = $state.raw('virama');

    constructor(args) {
      super(args);
      keepState(this, 'baybayin-translator', ['text', 'direction', 'final']);
    }

    get output() {
      if (!this.text.trim()) return '';
      return this.direction === 'encode'
        ? toBaybayin(this.text, { final: this.final })
        : fromBaybayin(this.text);
    }

    setText = (event) => (this.text = event.target.value);
    setFinal = (event) => (this.final = event.target.value);
    setDirection = (direction) => {
      if (direction === this.direction) return;
      const out = this.output;
      this.direction = direction;
      if (out) this.text = out;
    };
  }
</script>

<script>
  let args = $props();
  const self = new BaybayinTranslatorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="baybayin-translator"
  subtitle="Tagalog into Baybayin, the script the Philippines wrote in before the Latin alphabet, and back again."
>
  <div class="math-grid text-tool pop-in" {@attach loadFont()}>
    <section class="math-card">
      <div class="math-tabs" role="group" aria-label="Direction">
        <button
          type="button"
          class="qr-tab {truthy(eq(self.direction, 'encode')) ? 'active' : ''}"
          onclick={(..._r) => self.setDirection('encode', ..._r)}
          >Letters to Baybayin</button
        >
        <button
          type="button"
          class="qr-tab {truthy(eq(self.direction, 'decode')) ? 'active' : ''}"
          onclick={(..._r) => self.setDirection('decode', ..._r)}
          >Baybayin to letters</button
        >
      </div>
      <label class="field-label" for="baybayin-text"
        >{truthy(eq(self.direction, 'encode')) ? 'Tagalog' : 'Baybayin'}</label
      >
      <textarea
        id="baybayin-text"
        class="textarea text-area-tall
              {truthy(eq(self.direction, 'decode')) ? 'baybayin-text' : ''}"
        spellcheck="false"
        {@attach prop('value', () => self.text)}
        oninput={self.setText}></textarea>
      {#if truthy(eq(self.direction, 'encode'))}
        <label class="math-field">
          <span class="qr-label is-muted">Consonant with no vowel after it</span
          >
          <select class="select" onchange={self.setFinal}>
            {#each self.finalModes ?? [] as mode}
              <option
                value={mode?.id}
                {@attach prop('selected', () => eq(mode?.id, self.final))}
                >{mode?.label}</option
              >
            {/each}
          </select>
        </label>
        <p class="tool-hint"
          >Spell it the Tagalog way for the best result: "ng" is one letter, and
          C, F, J, Q, V, X and Z are swapped for the nearest Tagalog sound.</p
        >
      {:else}
        <p class="tool-hint"
          >Paste Baybayin here. A kudlit above reads as i, below as u; a
          consonant without one reads with a.</p
        >
      {/if}
    </section>

    <section class="math-card">
      <div class="fc-toolbar">
        <h3 class="qr-heading"
          >{truthy(eq(self.direction, 'encode')) ? 'Baybayin' : 'Letters'}</h3
        >
        <CopyButton value={self.output} />
      </div>
      <p
        class="cipher-output
              {truthy(eq(self.direction, 'encode')) ? 'baybayin-text' : ''}"
        lang={truthy(eq(self.direction, 'encode')) ? 'tl-Tglg' : 'tl'}
        >{truthy(self.output)
          ? self.output
          : 'Nothing yet. Type something on the left.'}</p
      >
      <p class="tool-hint"
        >The three vowels, ᜀ ᜁ ᜂ, stand alone; every other character is a
        consonant with "a" built in, so ᜊ is "ba", ᜊᜒ is "bi" and ᜊᜓ is "bu".</p
      >
    </section>
  </div>
</ToolPage>
