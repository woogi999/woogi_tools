<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import CopyButton from './copy-button.svelte';
  import { toBraille, fromBraille, dotsOf } from '../utils/braille.js';
  import { keepState } from '../utils/tool-state.js';

  // Words to Unicode braille and back, with the cells drawn big so you can read the dots.

  const eq = (a, b) => a === b;

  class TextBraillePage extends Component {
    text = $state.raw('hello world');
    direction = $state.raw('encode'); // 'encode' | 'decode'
    capitals = $state.raw(true);
    numbers = $state.raw(true);

    constructor(args) {
      super(args);
      keepState(this, 'text-braille', [
        'text',
        'direction',
        'capitals',
        'numbers',
      ]);
    }

    get output() {
      if (!this.text.trim()) return '';
      return this.direction === 'encode'
        ? toBraille(this.text, {
            capitals: this.capitals,
            numbers: this.numbers,
          })
        : fromBraille(this.text);
    }

    // Each cell with its six dots, for the picture underneath.
    get cells() {
      const braille = this.direction === 'encode' ? this.output : this.text;
      return [...braille].slice(0, 300).map((cell, i) => ({
        id: i,
        cell,
        space: cell === ' ' || cell === '\n',
        dots: dotsOf(cell) ?? [],
      }));
    }

    setText = (event) => (this.text = event.target.value);
    setDirection = (direction) => {
      const out = this.output;
      this.direction = direction;
      if (out) this.text = out;
    };
    toggle = (key, event) => (this[key] = event.target.checked);
  }
</script>

<script>
  let args = $props();
  const self = new TextBraillePage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="text-braille"
  subtitle="Words to braille and back. Unicode cells you can copy anywhere, drawn big so you can see the dots."
>
  <div class="math-grid text-tool pop-in">
    <section class="math-card">
      <div class="math-tabs" role="group" aria-label="Direction">
        <button
          type="button"
          class="qr-tab {truthy(eq(self.direction, 'encode')) ? 'active' : ''}"
          onclick={(..._r) => self.setDirection('encode', ..._r)}
          >Words to braille</button
        >
        <button
          type="button"
          class="qr-tab {truthy(eq(self.direction, 'decode')) ? 'active' : ''}"
          onclick={(..._r) => self.setDirection('decode', ..._r)}
          >Braille to words</button
        >
      </div>
      <label class="field-label" for="braille-text"
        >{truthy(eq(self.direction, 'encode'))
          ? 'Your words'
          : 'The braille'}</label
      >
      <textarea
        id="braille-text"
        class="textarea text-area-tall"
        spellcheck="false"
        {@attach prop('value', () => self.text)}
        oninput={self.setText}></textarea>

      {#if truthy(eq(self.direction, 'encode'))}
        <label class="lobby-rule is-switch">
          <span class="lobby-rule-text"
            ><span class="qr-label">Capital signs</span><span class="tool-hint"
              >A ⠠ before a capital letter, as braille does it.</span
            ></span
          >
          <span class="qr-switch">
            <input
              type="checkbox"
              role="switch"
              {@attach prop('checked', () => self.capitals)}
              aria-checked={truthy(self.capitals) ? 'true' : 'false'}
              onchange={(..._r) => self.toggle('capitals', ..._r)}
            />
            <span class="qr-switch-track" aria-hidden="true"></span>
          </span>
        </label>
        <label class="lobby-rule is-switch">
          <span class="lobby-rule-text"
            ><span class="qr-label">Number signs</span><span class="tool-hint"
              >A ⠼ before digits, which are written as the letters a–j.</span
            ></span
          >
          <span class="qr-switch">
            <input
              type="checkbox"
              role="switch"
              {@attach prop('checked', () => self.numbers)}
              aria-checked={truthy(self.numbers) ? 'true' : 'false'}
              onchange={(..._r) => self.toggle('numbers', ..._r)}
            />
            <span class="qr-switch-track" aria-hidden="true"></span>
          </span>
        </label>
      {/if}
      <p class="tool-hint"
        >This is Grade 1 (uncontracted) English braille: every letter spelled
        out, no contractions.</p
      >
    </section>

    <section class="math-card">
      <div class="fc-toolbar">
        <h3 class="qr-heading"
          >{truthy(eq(self.direction, 'encode')) ? 'Braille' : 'Words'}</h3
        >
        <CopyButton value={self.output} />
      </div>
      <p
        class="cipher-output
              {truthy(eq(self.direction, 'encode')) ? 'is-braille' : ''}"
        >{truthy(self.output)
          ? self.output
          : 'Nothing yet. Type something on the left.'}</p
      >

      {#if truthy(self.cells?.length)}
        <h3 class="qr-heading">The dots</h3>
        <div class="braille-cells">
          {#each self.cells ?? [] as c (c?.id)}
            {#if truthy(c?.space)}
              <span class="braille-gap"></span>
            {:else}
              <span class="braille-cell" title={c?.cell}>
                {#each c?.dots ?? [] as on}<span
                    class="braille-dot {truthy(on) ? 'is-on' : ''}"
                  ></span>{/each}
              </span>
            {/if}
          {/each}
        </div>
      {/if}
    </section>
  </div>
</ToolPage>
