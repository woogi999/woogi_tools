<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { keepState } from '../utils/tool-state.js';

  const meterWidth = (percent) => `width:${percent ?? 0}%`;

  const CHARSETS = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    numbers: '0123456789',
    symbols: '!@#$%^&*()-_=+[]{}<>?/.,~',
  };

  const AMBIGUOUS = 'Il1O0o';

  // Rejection sampling keeps every character in `chars` equally likely, unlike a plain modulo.
  function randomIndex(max) {
    const range = 256 - (256 % max);
    let byte;
    do {
      byte = crypto.getRandomValues(new Uint8Array(1))[0];
    } while (byte >= range);
    return byte % max;
  }

  function randomChar(chars) {
    return chars[randomIndex(chars.length)];
  }

  function generatePassword(length, sets, excludeAmbiguous) {
    const cleaned = sets
      .map((chars) =>
        excludeAmbiguous
          ? [...chars].filter((c) => !AMBIGUOUS.includes(c)).join('')
          : chars,
      )
      .filter(Boolean);
    const pool = cleaned.join('') || CHARSETS.lower;
    const chars = Array.from({ length }, () => randomChar(pool));
    // Guarantee at least one character from each selected set, so a short
    // password with symbols enabled doesn't come back with none by chance.
    cleaned.forEach((set, i) => {
      if (i < length && !chars.some((c) => set.includes(c)))
        chars[randomIndex(length)] = randomChar(set);
    });
    return chars.join('');
  }

  const COMMON_PASSWORDS = new Set([
    'password',
    '123456',
    '123456789',
    'qwerty',
    'abc123',
    'password1',
    'letmein',
    'admin',
    'welcome',
    'monkey',
    'iloveyou',
    '111111',
    '12345678',
  ]);

  function poolSizeOf(password) {
    let size = 0;
    if (/[a-z]/.test(password)) size += 26;
    if (/[A-Z]/.test(password)) size += 26;
    if (/[0-9]/.test(password)) size += 10;
    if (/[^a-zA-Z0-9]/.test(password)) size += 33;
    return size || 1;
  }

  function formatDuration(seconds) {
    if (seconds < 1) return 'instantly';
    const units = [
      ['century', 3153600000],
      ['year', 31536000],
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60],
      ['second', 1],
    ];
    for (const [name, secs] of units) {
      if (seconds >= secs) {
        const n = Math.round(seconds / secs);
        const plural = name === 'century' ? 'centuries' : `${name}s`;
        return `${n.toLocaleString()} ${n === 1 ? name : plural}`;
      }
    }
    return 'instantly';
  }

  // Assumes a fast offline attack (~10 billion guesses/second) against a leaked hash.
  const GUESSES_PER_SECOND = 1e10;

  function assessPassword(password) {
    if (!password)
      return {
        entropy: 0,
        crackTime: 'instantly',
        rating: 'none',
        ratingLabel: 'Enter a password',
        percent: 0,
      };
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      return {
        entropy: 0,
        crackTime: 'instantly',
        rating: 'weak',
        ratingLabel: 'Very weak: one of the most common passwords',
        percent: 5,
      };
    }
    const entropy = password.length * Math.log2(poolSizeOf(password));
    const seconds = 2 ** entropy / GUESSES_PER_SECOND;
    let rating, ratingLabel, percent;
    if (entropy < 28)
      [rating, ratingLabel, percent] = ['weak', 'Very weak', 15];
    else if (entropy < 36)
      [rating, ratingLabel, percent] = ['weak', 'Weak', 35];
    else if (entropy < 60)
      [rating, ratingLabel, percent] = ['fair', 'Reasonable', 55];
    else if (entropy < 100)
      [rating, ratingLabel, percent] = ['strong', 'Strong', 80];
    else [rating, ratingLabel, percent] = ['strong', 'Very strong', 100];
    return {
      entropy: Math.round(entropy),
      crackTime: formatDuration(seconds),
      rating,
      ratingLabel,
      percent,
    };
  }

  class PasswordGeneratorPage extends Component {
    length = $state.raw(16);
    useLower = $state.raw(true);
    useUpper = $state.raw(true);
    useNumbers = $state.raw(true);
    useSymbols = $state.raw(true);
    excludeAmbiguous = $state.raw(false);
    password = $state.raw('');

    checkValue = $state.raw('');
    showCheckValue = $state.raw(false);

    constructor(args) {
      super(args);
      keepState(this, 'password-generator', [
        'length',
        'useLower',
        'useUpper',
        'useNumbers',
        'useSymbols',
        'excludeAmbiguous',
      ]);
      this.regenerate();
    }

    get selectedSets() {
      const sets = [];
      if (this.useLower) sets.push(CHARSETS.lower);
      if (this.useUpper) sets.push(CHARSETS.upper);
      if (this.useNumbers) sets.push(CHARSETS.numbers);
      if (this.useSymbols) sets.push(CHARSETS.symbols);
      return sets;
    }

    get assessment() {
      return assessPassword(this.password);
    }

    get checkAssessment() {
      return assessPassword(this.checkValue);
    }

    regenerate = () => {
      this.password = generatePassword(
        this.length,
        this.selectedSets,
        this.excludeAmbiguous,
      );
    };

    setLength = (event) => {
      this.length = Math.min(128, Math.max(4, +event.target.value || 4));
      this.regenerate();
    };

    toggle(key) {
      this[key] = !this[key];
      if (this.selectedSets.length === 0) this.useLower = true; // never generate from an empty pool
      this.regenerate();
    }

    toggleLower = () => this.toggle('useLower');
    toggleUpper = () => this.toggle('useUpper');
    toggleNumbers = () => this.toggle('useNumbers');
    toggleSymbols = () => this.toggle('useSymbols');
    toggleAmbiguous = () => this.toggle('excludeAmbiguous');

    setCheckValue = (event) => (this.checkValue = event.target.value);
    toggleShowCheck = () => (this.showCheckValue = !this.showCheckValue);
  }
</script>

<script>
  let args = $props();
  const self = new PasswordGeneratorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="password-generator"
  subtitle="Generate a strong random password, or test the one you already use (it never leaves your device)."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <h3 class="qr-heading">Generate</h3>
      <div class="math-row is-aligned">
        <input
          type="text"
          class="math-input pw-output"
          readonly
          {@attach prop('value', () => self.password)}
          aria-label="Generated password"
        />
        <CopyButton value={self.password} />
        <button type="button" class="btn math-use" onclick={self.regenerate}
          ><Icon name="refresh-cw" size={13} /> New</button
        >
      </div>

      <div class="pw-meter" data-rating={self.assessment?.rating}>
        <div class="pw-meter-bar"
          ><div
            class="pw-meter-fill"
            style={meterWidth(self.assessment?.percent)}
          ></div></div
        >
        <span class="tool-hint"
          >{self.assessment?.ratingLabel}
          · would take about
          {self.assessment?.crackTime}
          to crack</span
        >
      </div>

      <label class="math-field">
        <span class="qr-label is-muted">Length: {self.length}</span>
        <input
          type="range"
          min="4"
          max="64"
          {@attach prop('value', () => self.length)}
          oninput={self.setLength}
        />
      </label>

      <div class="math-row">
        <label class="math-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.useLower)}
            onchange={self.toggleLower}
          />
          Lowercase (a-z)</label
        >
        <label class="math-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.useUpper)}
            onchange={self.toggleUpper}
          />
          Uppercase (A-Z)</label
        >
        <label class="math-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.useNumbers)}
            onchange={self.toggleNumbers}
          />
          Numbers (0-9)</label
        >
        <label class="math-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.useSymbols)}
            onchange={self.toggleSymbols}
          />
          Symbols (!@#…)</label
        >
        <label class="math-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.excludeAmbiguous)}
            onchange={self.toggleAmbiguous}
          />
          Exclude ambiguous (Il1O0o)</label
        >
      </div>
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Check a password's strength</h3>
      <div class="math-row is-aligned">
        <input
          type={truthy(self.showCheckValue) ? 'text' : 'password'}
          class="math-input"
          placeholder="Paste or type a password"
          aria-label="Password to check"
          {@attach prop('value', () => self.checkValue)}
          autocomplete="off"
          oninput={self.setCheckValue}
        />
        <button
          type="button"
          class="btn math-use"
          onclick={self.toggleShowCheck}
          ><Icon
            name={truthy(self.showCheckValue) ? 'eye-off' : 'eye'}
            size={13}
          /></button
        >
      </div>
      <div class="pw-meter" data-rating={self.checkAssessment?.rating}>
        <div class="pw-meter-bar"
          ><div
            class="pw-meter-fill"
            style={meterWidth(self.checkAssessment?.percent)}
          ></div></div
        >
        <span class="tool-hint"
          >{self.checkAssessment?.ratingLabel}{#if truthy(self.checkValue)}
            · about
            {self.checkAssessment?.entropy}
            bits of entropy · would take about
            {self.checkAssessment?.crackTime}
            to crack{/if}</span
        >
      </div>
      <p class="tool-hint"
        >Nothing you type here ever leaves your browser; the check runs entirely
        on your device.</p
      >
    </section>
  </div>
</ToolPage>
