<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { CIPHERS, runCipher, crack } from '../utils/ciphers.js';
  import { keepState } from '../utils/tool-state.js';

  // Decoding (and encoding) classic ciphers, with a "crack it" that tries the lot
  // and puts whatever reads most like English at the top.

  const eq = (a, b) => a === b;

  class CipherDecoderPage extends Component {
    text = $state.raw('');
    cipher = $state.raw('caesar');
    direction = $state.raw('decode'); // 'decode' | 'encode'
    keys = $state.raw({ caesar: 3, vigenere: 'key', railfence: 3 });

    ciphers = CIPHERS;

    constructor(args) {
      super(args);
      keepState(this, 'cipher-decoder', ['text', 'cipher', 'direction']);
    }

    get spec() {
      return CIPHERS.find((c) => c.id === this.cipher) ?? CIPHERS[0];
    }

    get key() {
      return this.keys[this.cipher] ?? this.spec.keyDefault ?? '';
    }

    get output() {
      if (!this.text) return '';
      try {
        return runCipher(
          this.cipher,
          this.text,
          this.key,
          this.direction === 'decode',
        );
      } catch {
        return '';
      }
    }

    // Every Caesar shift at once: sometimes you just want to eyeball them.
    get shifts() {
      if (this.cipher !== 'caesar' || !this.text) return [];
      return Array.from({ length: 25 }, (_, i) => ({
        shift: i + 1,
        text: runCipher('caesar', this.text, i + 1, true),
      }));
    }

    get guesses() {
      return this.text.trim().length > 3 ? crack(this.text) : [];
    }

    setText = (event) => (this.text = event.target.value);

    setCipher = (id) => (this.cipher = id);
    setDirection = (direction) => (this.direction = direction);

    setKey = (event) => {
      const raw = event.target.value;
      this.keys = {
        ...this.keys,
        [this.cipher]: this.spec.key === 'number' ? Number(raw) || 0 : raw,
      };
    };

    useGuess = (guess) => (this.text = guess.text);

    swap = () => {
      // Put the result back in the box, to peel off another layer.
      const out = this.output;
      if (out) this.text = out;
    };
  }
</script>

<script>
  let args = $props();
  const self = new CipherDecoderPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="cipher-decoder"
  subtitle="Decode (or write) Caesar shifts, Vigenère, Atbash, rail fence, Morse and more. Not sure which it is? Let it crack the message for you."
>
  <div class="math-grid text-tool pop-in">
    <section class="math-card">
      <label class="field-label" for="cipher-text">The message</label>
      <textarea
        id="cipher-text"
        class="textarea text-area-tall"
        placeholder="Paste the secret message here"
        {@attach prop('value', () => self.text)}
        oninput={self.setText}></textarea>

      <div class="math-tabs" role="group" aria-label="Direction">
        <button
          type="button"
          class="qr-tab {truthy(eq(self.direction, 'decode')) ? 'active' : ''}"
          onclick={(..._r) => self.setDirection('decode', ..._r)}>Decode</button
        >
        <button
          type="button"
          class="qr-tab {truthy(eq(self.direction, 'encode')) ? 'active' : ''}"
          onclick={(..._r) => self.setDirection('encode', ..._r)}>Encode</button
        >
      </div>

      <div class="cipher-picks" role="group" aria-label="Cipher">
        {#each self.ciphers ?? [] as c}
          <button
            type="button"
            class="qr-tab {truthy(eq(self.cipher, c?.id)) ? 'active' : ''}"
            onclick={(..._r) => self.setCipher(c?.id, ..._r)}>{c?.label}</button
          >
        {/each}
      </div>

      {#if truthy(self.spec?.key)}
        <label class="math-field">
          <span class="qr-label is-muted">{self.spec?.keyLabel}</span>
          {#if truthy(eq(self.spec?.key, 'number'))}
            <input
              type="number"
              class="math-input"
              {@attach prop('value', () => self.key)}
              oninput={self.setKey}
            />
          {:else}
            <input
              type="text"
              class="math-input"
              spellcheck="false"
              {@attach prop('value', () => self.key)}
              oninput={self.setKey}
            />
          {/if}
        </label>
      {/if}
    </section>

    <section class="math-card">
      <div class="fc-toolbar">
        <h3 class="qr-heading"
          >{truthy(eq(self.direction, 'decode')) ? 'Decoded' : 'Encoded'}</h3
        >
        <div class="settings-actions">
          <CopyButton value={self.output} />
          <button
            type="button"
            class="btn"
            title="Put this back in the box"
            onclick={self.swap}
            ><Icon name="rotate-cw" size={13} /> Use as input</button
          >
        </div>
      </div>
      <p class="cipher-output"
        >{truthy(self.output)
          ? self.output
          : 'Nothing yet. Paste a message on the left.'}</p
      >

      {#if truthy(self.guesses?.length)}
        <h3 class="qr-heading">Crack it</h3>
        <p class="tool-hint"
          >Everything it knows, tried at once and sorted by how much the result
          reads like English.</p
        >
        <ul class="case-list">
          {#each self.guesses ?? [] as guess}
            <li class="case-item">
              <div class="case-text">
                <span class="qr-label is-muted"
                  >{guess?.cipher}{#if truthy(guess?.note)}
                    · {guess?.note}{/if}</span
                >
                <span class="case-value">{guess?.text}</span>
              </div>
              <button
                type="button"
                class="btn"
                onclick={(..._r) => self.useGuess(guess, ..._r)}>Use</button
              >
            </li>
          {/each}
        </ul>
      {/if}

      {#if truthy(self.shifts?.length)}
        <h3 class="qr-heading">Every Caesar shift</h3>
        <ul class="case-list">
          {#each self.shifts ?? [] as row}
            <li class="case-item">
              <div class="case-text">
                <span class="qr-label is-muted">Shift {row?.shift}</span>
                <span class="case-value">{row?.text}</span>
              </div>
              <CopyButton value={row?.text} />
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</ToolPage>
