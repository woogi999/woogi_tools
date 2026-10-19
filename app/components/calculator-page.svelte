<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { parse, evaluate, formatNumber } from '../utils/math-expr.js';
  import { keepState } from '../utils/tool-state.js';

  // kind: styling group. insert: text placed at the caret. action: a method name instead.
  const KEYS = [
    { label: 'DEG', action: 'toggleAngle', kind: 'mode' },
    { label: '(', insert: '(' },
    { label: ')', insert: ')' },
    { label: '%', insert: '%' },
    { label: 'AC', action: 'clear', kind: 'danger' },
    { label: 'sin', insert: 'sin(', kind: 'fn' },
    { label: 'cos', insert: 'cos(', kind: 'fn' },
    { label: 'tan', insert: 'tan(', kind: 'fn' },
    { label: 'xʸ', insert: '^', kind: 'fn' },
    { label: '⌫', action: 'backspace', kind: 'danger', aria: 'Backspace' },
    { label: 'sin⁻¹', insert: 'asin(', kind: 'fn' },
    { label: 'cos⁻¹', insert: 'acos(', kind: 'fn' },
    { label: 'tan⁻¹', insert: 'atan(', kind: 'fn' },
    { label: '√', insert: '√(', kind: 'fn' },
    { label: 'n!', insert: '!', kind: 'fn' },
    { label: 'ln', insert: 'ln(', kind: 'fn' },
    { label: 'log', insert: 'log(', kind: 'fn' },
    { label: 'π', insert: 'π', kind: 'fn' },
    { label: 'e', insert: 'e', kind: 'fn' },
    { label: 'x²', insert: '^2', kind: 'fn' },
    { label: '7', insert: '7' },
    { label: '8', insert: '8' },
    { label: '9', insert: '9' },
    { label: '÷', insert: '÷', kind: 'op' },
    { label: 'Ans', insert: 'Ans', kind: 'fn' },
    { label: '4', insert: '4' },
    { label: '5', insert: '5' },
    { label: '6', insert: '6' },
    { label: '×', insert: '×', kind: 'op' },
    { label: '1/x', insert: '^(-1)', kind: 'fn' },
    { label: '1', insert: '1' },
    { label: '2', insert: '2' },
    { label: '3', insert: '3' },
    { label: '−', insert: '−', kind: 'op' },
    { label: '|x|', insert: 'abs(', kind: 'fn' },
    { label: '0', insert: '0' },
    { label: '.', insert: '.' },
    { label: '×10ˣ', insert: '×10^', kind: 'fn' },
    { label: '+', insert: '+', kind: 'op' },
    { label: '=', action: 'equals', kind: 'equals' },
  ];

  const eq = (a, b) => a === b;
  // After a result, typing a number or function starts fresh; an operator continues from it.
  const CONTINUES = /^[\^!%×÷−+*/)]/;

  class CalculatorPage extends Component {
    keys = KEYS;

    expression = $state.raw('');
    degrees = $state.raw(true);
    history = $state.raw([]);
    error = $state.raw(null);
    ans = 0;
    showingResult = false;
    inputEl = null;

    constructor(args) {
      super(args);
      keepState(this, 'calculator', ['expression', 'degrees']);
    }

    registerInput = modifier((element) => {
      this.inputEl = element;
    });

    get preview() {
      if (!this.expression.trim() || this.showingResult) return '';
      try {
        const value = this.compute(this.expression);
        return Number.isNaN(value) ? '' : formatNumber(value);
      } catch {
        return '';
      }
    }

    compute(text) {
      return evaluate(parse(text), {
        vars: { ans: this.ans },
        degrees: this.degrees,
      });
    }

    // The input's own caret is only trustworthy while it's focused and showing the
    // current expression; otherwise (fast taps before a re-render) edit at the end.
    selection() {
      const el = this.inputEl;
      const end = this.expression.length;
      if (!el || document.activeElement !== el || el.value !== this.expression)
        return [end, end];
      return [el.selectionStart ?? end, el.selectionEnd ?? end];
    }

    setCaret(position) {
      requestAnimationFrame(() => {
        this.inputEl?.focus({ preventScroll: true });
        this.inputEl?.setSelectionRange(position, position);
      });
    }

    insert(text) {
      let value = this.expression;
      let [start, end] = this.selection();
      if (this.showingResult) {
        if (CONTINUES.test(text)) {
          start = end = value.length;
        } else {
          value = '';
          start = end = 0;
        }
      }
      this.expression = value.slice(0, start) + text + value.slice(end);
      this.showingResult = false;
      this.error = null;
      this.setCaret(start + text.length);
    }

    press = (key) => {
      if (key.action) this[key.action]();
      else this.insert(key.insert);
    };

    toggleAngle = () => (this.degrees = !this.degrees);

    clear = () => {
      this.expression = '';
      this.error = null;
      this.showingResult = false;
      this.setCaret(0);
    };

    backspace = () => {
      const value = this.expression;
      let [start, end] = this.selection();
      if (start === end && start > 0) {
        // Remove a whole function name like "sin(" in one go.
        const fnMatch =
          /(asin|acos|atan|sinh|cosh|tanh|sin|cos|tan|log2|log|ln|sqrt|abs|Ans|√)\(?$/.exec(
            value.slice(0, start),
          );
        start -= fnMatch ? fnMatch[0].length : 1;
      }
      this.expression = value.slice(0, start) + value.slice(end);
      this.showingResult = false;
      this.error = null;
      this.setCaret(start);
    };

    equals = () => {
      const text = this.expression.trim();
      if (!text || this.showingResult) return;
      try {
        const value = this.compute(text);
        const result = formatNumber(value);
        this.history = [
          { expression: text, result, degrees: this.degrees },
          ...this.history,
        ].slice(0, 50);
        if (!Number.isFinite(value)) {
          this.error = Number.isNaN(value)
            ? 'Undefined'
            : `Result is ${result}`;
          return;
        }
        this.ans = value;
        this.expression = result;
        this.showingResult = true;
        this.error = null;
        this.setCaret(result.length);
      } catch (error) {
        this.error = error.message;
      }
    };

    onInput = (event) => {
      this.expression = event.target.value;
      this.showingResult = false;
      this.error = null;
    };

    onKeydown = (event) => {
      if (event.key === 'Enter' || (event.key === '=' && !event.shiftKey)) {
        event.preventDefault();
        this.equals();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.clear();
      } else if (
        this.showingResult &&
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        this.insert(
          event.key === '*' ? '×' : event.key === '/' ? '÷' : event.key,
        );
      }
    };

    recall = (entry) => {
      this.expression = entry.expression;
      this.showingResult = false;
      this.error = null;
      this.setCaret(entry.expression.length);
    };

    clearHistory = () => (this.history = []);
  }
</script>

<script>
  let args = $props();
  const self = new CalculatorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="calculator"
  subtitle="Type or tap your maths. Understands stuff like 2π or 3(4+1), and Enter gives you the answer."
>
  <div class="calc pop-in">
    <section class="math-card calc-main">
      <div class="calc-display {truthy(self.error) ? 'has-error' : ''}">
        <span class="calc-mode">{truthy(self.degrees) ? 'DEG' : 'RAD'}</span>
        <input
          type="text"
          class="calc-input"
          aria-label="Expression"
          autocomplete="off"
          spellcheck="false"
          {@attach prop('value', () => self.expression)}
          onkeydown={self.onKeydown}
          oninput={self.onInput}
          {@attach self.registerInput?.()}
        />
        <span class="calc-preview">
          {#if truthy(self.error)}{self.error}{:else if truthy(self.preview)}=
            {self.preview}{/if}
        </span>
      </div>
      <div class="calc-keys">
        {#each self.keys ?? [] as key}
          <button
            type="button"
            class="calc-key {truthy(key?.kind) ? `is-${key?.kind ?? ''}` : ''}"
            aria-label={truthy(key?.aria) ? key?.aria : key?.label}
            onclick={(..._r) => self.press(key, ..._r)}
          >
            {#if truthy(eq(key?.action, 'toggleAngle'))}{truthy(self.degrees)
                ? 'DEG'
                : 'RAD'}{:else}{key?.label}{/if}
          </button>
        {/each}
      </div>
    </section>

    <section class="math-card calc-history">
      <div class="field-head">
        <h3 class="qr-heading"
          ><Icon name="history" size={14} />
          History</h3
        >
        {#if truthy(self.history?.length)}
          <button type="button" class="btn" onclick={self.clearHistory}
            >Clear</button
          >
        {/if}
      </div>
      {#if truthy(self.history?.length)}
        <ul class="calc-history-list">
          {#each self.history ?? [] as entry}
            <li>
              <button
                type="button"
                class="calc-history-item"
                onclick={(..._r) => self.recall(entry, ..._r)}
              >
                <span class="calc-history-expr">{entry?.expression}</span>
                <span class="calc-history-result">= {entry?.result}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="fs-empty">Results show up here. Click one to reuse it.</p>
      {/if}
      <p class="tool-hint"
        >Also understands sinh, cosh, tanh, log2, cbrt, exp, floor, ceil, round,
        mod(a,b), nroot(n,x), nCr(n,r), nPr(n,r), and |x| bars.</p
      >
    </section>
  </div>
</ToolPage>
