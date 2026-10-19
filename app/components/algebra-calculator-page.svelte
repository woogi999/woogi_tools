<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import CopyButton from './copy-button.svelte';
  import { solve, simplify, factor } from '../utils/algebra.js';
  import { keepState } from '../utils/tool-state.js';

  const eq = (a, b) => a === b;

  const MODES = [
    {
      id: 'solve',
      label: 'Solve',
      hint: 'One equation per line. Several lines are solved as a linear system.',
      placeholder: 'x^2 - 5x + 6 = 0',
      examples: [
        '2x + 3 = 11',
        'x^2 - 5x + 6 = 0',
        'x^2 + 2x + 5 = 0',
        'x^3 - 6x^2 + 11x - 6 = 0',
        '2x + y = 5\nx - y = 1',
        'y = 3x - 7',
        'e^x = 5',
      ],
      run: solve,
    },
    {
      id: 'expand',
      label: 'Expand',
      hint: 'Multiplies out brackets and collects like terms.',
      placeholder: '(x + 1)^3',
      examples: [
        '(x + 1)^3',
        '(a + b)(a - b)',
        '2(x - 3)^2 + 4x',
        '(x + y + 1)^2',
      ],
      run: simplify,
    },
    {
      id: 'factor',
      label: 'Factor',
      hint: 'Factors single-variable polynomials with whole-number coefficients.',
      placeholder: 'x^2 - 5x + 6',
      examples: [
        'x^2 - 5x + 6',
        '2x^3 - 8x',
        '6x^2 - 5x + 1',
        'x^3 - 3x^2 + 3x - 1',
        'x^4 - 1',
      ],
      run: factor,
    },
  ];

  class AlgebraCalculatorPage extends Component {
    modes = MODES;

    modeId = $state.raw('solve');
    inputs = $state.raw({
      solve: 'x^2 - 5x + 6 = 0',
      expand: '(x + 1)^3',
      factor: 'x^2 - 5x + 6',
    });

    constructor(args) {
      super(args);
      keepState(this, 'algebra-calculator', ['modeId']);
    }

    get mode() {
      return MODES.find((m) => m.id === this.modeId);
    }

    get input() {
      return this.inputs[this.modeId];
    }

    get output() {
      if (!this.input.trim()) return null;
      try {
        const result = this.mode.run(this.input);
        // Expand/factor return a single result; solve returns a heading with lines.
        return result.lines
          ? result
          : {
              heading: this.mode.label === 'Factor' ? 'Factored' : 'Expanded',
              lines: [result.result],
              note: result.note,
              copy: result.result,
            };
      } catch (error) {
        return { error: error.message };
      }
    }

    get copyText() {
      return this.output?.copy ?? this.output?.lines?.join('\n') ?? '';
    }

    setMode = (id) => (this.modeId = id);
    setInput = (event) =>
      (this.inputs = { ...this.inputs, [this.modeId]: event.target.value });
    useExample = (text) =>
      (this.inputs = { ...this.inputs, [this.modeId]: text });
  }
</script>

<script>
  let args = $props();
  const self = new AlgebraCalculatorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="algebra-calculator"
  subtitle="Solve equations, rearrange formulas, expand brackets and factor polynomials. Answers show up as you type."
>
  <div class="math-stack pop-in">
    <div class="math-tabs" role="tablist">
      {#each self.modes ?? [] as m}
        <button
          type="button"
          role="tab"
          class="qr-tab {truthy(eq(self.modeId, m?.id)) ? 'active' : ''}"
          aria-selected={truthy(eq(self.modeId, m?.id)) ? 'true' : 'false'}
          onclick={(..._r) => self.setMode(m?.id, ..._r)}>{m?.label}</button
        >
      {/each}
    </div>

    <section class="math-card qr-mode-panel">
      <label class="math-field">
        <span class="qr-label is-muted"
          >{truthy(eq(self.modeId, 'solve')) ? 'Equation' : 'Expression'}</span
        >
        <textarea
          class="textarea algebra-input"
          rows="3"
          spellcheck="false"
          placeholder={self.mode?.placeholder}
          {@attach prop('value', () => self.input)}
          oninput={self.setInput}></textarea>
      </label>
      <p class="tool-hint"
        >{self.mode?.hint}
        Use ^ for powers; 2x and 3(x+1) multiply.</p
      >
      <div class="notes-font-row">
        {#each self.mode?.examples ?? [] as example}
          <button
            type="button"
            class="qr-chip algebra-example"
            onclick={(..._r) => self.useExample(example, ..._r)}
            >{example}</button
          >
        {/each}
      </div>

      {#if truthy(self.output)}
        {#if truthy(self.output?.error)}
          <p class="tool-error">{self.output?.error}</p>
        {:else}
          <div class="algebra-result">
            <div class="field-head">
              <span class="qr-label is-muted">{self.output?.heading}</span>
              <CopyButton value={self.copyText} />
            </div>
            {#each self.output?.lines ?? [] as line}
              <div class="algebra-line">{line}</div>
            {/each}
            {#if truthy(self.output?.note)}
              <p class="tool-hint">{self.output?.note}</p>
            {/if}
          </div>
        {/if}
      {/if}
    </section>
  </div>
</ToolPage>
