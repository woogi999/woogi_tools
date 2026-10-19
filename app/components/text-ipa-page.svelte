<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { toIpa, ipaWords, ACCENTS } from '../utils/ipa.js';
  import { keepState } from '../utils/tool-state.js';

  // English spelling into IPA, word by word, with the browser reading it aloud if it can.

  const eq = (a, b) => a === b;

  class TextIpaPage extends Component {
    text = $state.raw('The quick brown fox jumps over the lazy dog');
    accent = $state.raw('us');
    brackets = $state.raw(true);

    accents = ACCENTS;

    constructor(args) {
      super(args);
      keepState(this, 'text-ipa', ['text', 'accent', 'brackets']);
    }

    get output() {
      return this.text.trim()
        ? toIpa(this.text, { accent: this.accent, brackets: this.brackets })
        : '';
    }

    get words() {
      return this.text.trim()
        ? ipaWords(this.text, { accent: this.accent }).slice(0, 200)
        : [];
    }

    get canSpeak() {
      return typeof window !== 'undefined' && 'speechSynthesis' in window;
    }

    setText = (event) => (this.text = event.target.value);
    pick = (key, value) => (this[key] = value);
    toggleBrackets = (event) => (this.brackets = event.target.checked);

    // The browser's own voice, so you can check the transcription against the sound.
    speak = () => {
      if (!this.canSpeak) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(this.text);
      utterance.lang = this.accent === 'uk' ? 'en-GB' : 'en-US';
      window.speechSynthesis.speak(utterance);
    };
  }
</script>

<script>
  let args = $props();
  const self = new TextIpaPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="text-ipa"
  subtitle="English spelling turned into IPA, word by word, in American or British English. Handy for pronunciation notes, conlangs and singing."
>
  <div class="math-grid text-tool pop-in">
    <section class="math-card">
      <label class="field-label" for="ipa-text">Your text</label>
      <textarea
        id="ipa-text"
        class="textarea text-area-tall"
        {@attach prop('value', () => self.text)}
        oninput={self.setText}></textarea>

      <div class="math-tabs" role="group" aria-label="Accent">
        {#each self.accents ?? [] as a}
          <button
            type="button"
            class="qr-tab {truthy(eq(self.accent, a?.id)) ? 'active' : ''}"
            onclick={(..._r) => self.pick('accent', a?.id, ..._r)}
            >{a?.label}</button
          >
        {/each}
      </div>
      <label class="lobby-rule is-switch">
        <span class="lobby-rule-text"
          ><span class="qr-label">Slashes round it</span><span class="tool-hint"
            >The /…/ that marks a broad transcription.</span
          ></span
        >
        <span class="qr-switch">
          <input
            type="checkbox"
            role="switch"
            {@attach prop('checked', () => self.brackets)}
            aria-checked={truthy(self.brackets) ? 'true' : 'false'}
            onchange={self.toggleBrackets}
          />
          <span class="qr-switch-track" aria-hidden="true"></span>
        </span>
      </label>
      <p class="tool-hint"
        >English spelling barely follows its own rules, so this is a good
        approximation, not a dictionary. Common awkward words (“though”,
        “colonel”, “island”) are looked up properly; the rest is worked out
        letter by letter.</p
      >
    </section>

    <section class="math-card">
      <div class="fc-toolbar">
        <h3 class="qr-heading">IPA</h3>
        <div class="settings-actions">
          <CopyButton value={self.output} />
          {#if truthy(self.canSpeak)}
            <button type="button" class="btn" onclick={self.speak}
              ><Icon name="play" size={13} /> Hear it</button
            >
          {/if}
        </div>
      </div>
      <p class="cipher-output"
        >{truthy(self.output)
          ? self.output
          : 'Nothing yet. Type something on the left.'}</p
      >

      {#if truthy(self.words?.length)}
        <h3 class="qr-heading">Word by word</h3>
        <ul class="case-list">
          {#each self.words ?? [] as w}
            <li class="case-item">
              <div class="case-text">
                <span class="qr-label is-muted"
                  >{w?.word}{#if !truthy(w?.known)}
                    · worked out{/if}</span
                >
                <span class="case-value">{w?.ipa}</span>
              </div>
              <CopyButton value={w?.ipa} />
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</ToolPage>
