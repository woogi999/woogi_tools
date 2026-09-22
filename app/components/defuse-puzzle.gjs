import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import { makePuzzle } from '../utils/defuse-puzzles';
import { pushPadHandler } from '../utils/gamepad';
import { isTyping } from '../utils/keybinds';
import { sfx } from '../utils/sound';

// The defuse panel over the minefield. Mouse, touch, keyboard (numbers, arrows or
// WASD, Space/Enter) and controller (D-pad and A) all work.
//
//   @defusing: { seed, level, ms, total } from the game
//   @onDone:   (ok) => void, called once

const KEY_DIRS = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};
const PAD_DIRS = {
  DPadUp: 'up',
  DPadDown: 'down',
  DPadLeft: 'left',
  DPadRight: 'right',
};
const ARROW_ICON = {
  up: 'arrow-up',
  down: 'arrow-down',
  left: 'arrow-left',
  right: 'arrow-right',
};
const KEYPAD = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const eq = (a, b) => a === b;
const lt = (a, b) => a < b;
const inc = (n) => n + 1;

export default class DefusePuzzle extends Component {
  @tracked progress = 0;
  @tracked selected = 0;
  @tracked codeHidden = false;
  @tracked cut = null;
  finished = false;
  needle = 0;
  keypad = KEYPAD;

  // One puzzle per component: the page keys it by seed, so a new mine gets a new one.
  puzzle = makePuzzle(
    this.args.defusing.seed,
    this.args.defusing.level,
    this.args.defusing.type,
  );
  // Read once: @defusing is replaced on every game update, and reading it in `setup` would restart the needle and timer each time.
  openedAt = performance.now();
  msAtOpen = this.args.defusing.ms;
  total = this.args.defusing.total;
  // Anything over `total` is the grace before it starts: presses are ignored until then.
  graceMs = Math.max(0, this.msAtOpen - this.total);
  @tracked ready = this.graceMs === 0;

  get live() {
    return this.ready && !this.finished;
  }

  get isWires() {
    return this.puzzle.type === 'wires';
  }
  get isCode() {
    return this.puzzle.type === 'code';
  }
  get isSequence() {
    return this.puzzle.type === 'sequence';
  }
  get isTiming() {
    return this.puzzle.type === 'timing';
  }

  get wires() {
    return this.puzzle.wires.map((w, i) => ({
      ...w,
      index: i,
      number: i + 1,
      style: htmlSafe(`--wire:${w.hex}`),
      selected: i === this.selected,
      cut: this.cut === i,
    }));
  }

  get codeSlots() {
    return this.puzzle.digits.map((d, i) => ({
      shown: i < this.progress ? d : this.codeHidden ? '•' : d,
      done: i < this.progress,
    }));
  }

  get arrows() {
    // Backwards puzzles still show the arrows in their original order; progress counts from the end.
    const { arrows, backwards } = this.puzzle;
    const n = arrows.length;
    return arrows.map((dir, i) => ({
      icon: ARROW_ICON[dir],
      done: backwards ? i >= n - this.progress : i < this.progress,
    }));
  }

  get zones() {
    return this.puzzle.zones.map(([a, b], i) => ({
      style: htmlSafe(`left:${a * 100}%;width:${(b - a) * 100}%`),
      active: i === this.progress,
      done: i < this.progress,
    }));
  }

  get hitsLeft() {
    return this.puzzle.zones.length - this.progress;
  }

  finish(ok) {
    if (this.finished) return;
    this.finished = true;
    sfx(ok ? 'mines.clear' : 'mines.boom');
    this.args.onDone?.(ok);
  }

  // ─── Moves ───────────────────────────────────────────────────────────

  cutWire = (i) => {
    if (!this.live) return;
    this.cut = i;
    this.finish(i === this.puzzle.answer);
  };

  pressDigit = (d) => {
    if (!this.live) return;
    if (d !== this.puzzle.digits[this.progress]) return this.finish(false);
    sfx('mines.flag');
    this.progress++;
    this.codeHidden = this.codeHidden || this.puzzle.hideAfter != null;
    if (this.progress >= this.puzzle.digits.length) this.finish(true);
  };

  pressArrow = (dir) => {
    if (!this.live) return;
    if (dir !== this.puzzle.answer[this.progress]) return this.finish(false);
    sfx('mines.flag');
    this.progress++;
    if (this.progress >= this.puzzle.answer.length) this.finish(true);
  };

  stopNeedle = () => {
    if (!this.live) return;
    const [a, b] = this.puzzle.zones[this.progress];
    if (this.needle < a || this.needle > b) return this.finish(false);
    sfx('mines.flag');
    this.progress++;
    if (this.progress >= this.puzzle.zones.length) this.finish(true);
  };

  // Moving the highlight: along the wires, or around the 3×3 keypad.
  move(dir) {
    if (this.isSequence) return this.pressArrow(dir);
    if (this.isWires) {
      const n = this.puzzle.wires.length;
      if (dir === 'left' || dir === 'up')
        this.selected = (this.selected + n - 1) % n;
      else this.selected = (this.selected + 1) % n;
    } else if (this.isCode) {
      const step = { left: -1, right: 1, up: -3, down: 3 }[dir];
      this.selected = (this.selected + step + 9) % 9;
    }
  }

  confirm() {
    if (this.isWires) this.cutWire(this.selected);
    else if (this.isCode) this.pressDigit(this.selected + 1);
    else if (this.isTiming) this.stopNeedle();
  }

  // ─── Input, timers and the needle ────────────────────────────────────

  setup = modifier((root) => {
    const started = this.openedAt + this.graceMs;
    const deadline = this.openedAt + this.msAtOpen;
    const total = this.total;
    const readyTimer = this.ready
      ? null
      : setTimeout(() => (this.ready = true), this.graceMs);
    const bar = root.querySelector('.defuse-timer-fill');
    const onKey = (event) => {
      if (
        this.finished ||
        isTyping(event) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1];
      let used = true;
      if (digit && this.isWires)
        Number(digit) <= this.puzzle.wires.length &&
          this.cutWire(Number(digit) - 1);
      else if (digit && this.isCode) this.pressDigit(Number(digit));
      else if (KEY_DIRS[event.code])
        !event.repeat && this.move(KEY_DIRS[event.code]);
      else if (event.code === 'Space' || event.code === 'Enter')
        !event.repeat && this.confirm();
      else used = false;
      if (used) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    // While the panel's up, the controller belongs to it (except Back, for chat).
    const releasePad = pushPadHandler((button, { down }) => {
      if (button === 'Back') return false;
      if (!down || this.finished) return true;
      if (PAD_DIRS[button]) this.move(PAD_DIRS[button]);
      else if (button === 'A') this.confirm();
      return true;
    });
    let hideTimer = null;
    if (this.isCode && this.puzzle.hideAfter != null)
      hideTimer = setTimeout(
        () => (this.codeHidden = true),
        this.graceMs + this.puzzle.hideAfter,
      );
    let frame = requestAnimationFrame(
      function step(now) {
        const left = Math.max(0, Math.min(total, deadline - now));
        if (bar) {
          bar.style.width = `${(left / total) * 100}%`;
          bar.classList.toggle('is-low', left < 2500);
        }
        if (this.isTiming) {
          // Back and forth across the bar.
          const t =
            ((Math.max(0, now - started) / 1000) * this.puzzle.speed) % 2;
          this.needle = t < 1 ? t : 2 - t;
          const needle = root.querySelector('.defuse-needle');
          if (needle) needle.style.left = `${this.needle * 100}%`;
        }
        frame = requestAnimationFrame(step.bind(this));
      }.bind(this),
    );
    return () => {
      window.removeEventListener('keydown', onKey, true);
      releasePad();
      clearTimeout(hideTimer);
      clearTimeout(readyTimer);
      cancelAnimationFrame(frame);
    };
  });

  <template>
    <div
      class="uno-overlay defuse-panel {{unless this.ready 'is-waiting'}}"
      role="dialog"
      aria-label="Defuse the mine"
      {{this.setup}}
    >
      <div class="defuse-head">
        <Icon @name="bomb" @size={{18}} />
        <strong>{{if this.ready "Defuse it!" "Get ready…"}}</strong>
        <span class="defuse-level">Mine {{inc @defusing.level}}</span>
      </div>
      <div class="defuse-timer"><span class="defuse-timer-fill"></span></div>
      <p class="defuse-text">{{this.puzzle.text}}</p>

      {{#if this.isWires}}
        <div class="defuse-wires">
          {{#each this.wires as |w|}}
            <button
              type="button"
              class="defuse-wire
                {{if w.selected 'is-selected'}}
                {{if w.cut 'is-cut'}}"
              style={{w.style}}
              data-sound="off"
              aria-label="Wire {{w.number}}, {{w.id}}"
              {{on "click" (fn this.cutWire w.index)}}
            >
              <span class="defuse-wire-number">{{w.number}}</span>
              <span class="defuse-wire-line"></span>
            </button>
          {{/each}}
        </div>
      {{else if this.isCode}}
        <div class="defuse-code">
          {{#each this.codeSlots as |slot|}}
            <span
              class="defuse-slot {{if slot.done 'is-done'}}"
            >{{slot.shown}}</span>
          {{/each}}
        </div>
        <div class="defuse-keypad">
          {{#each this.keypad as |d i|}}
            <button
              type="button"
              class="btn defuse-key {{if (eq i this.selected) 'is-selected'}}"
              data-sound="off"
              {{on "click" (fn this.pressDigit d)}}
            >{{d}}</button>
          {{/each}}
        </div>
      {{else if this.isSequence}}
        <div class="defuse-sequence">
          {{#each this.arrows as |a|}}
            <span class="defuse-arrow {{if a.done 'is-done'}}"><Icon
                @name={{a.icon}}
                @size={{20}}
              /></span>
          {{/each}}
        </div>
        <div class="defuse-dpad">
          <button
            type="button"
            class="btn defuse-dir is-up"
            data-sound="off"
            aria-label="Up"
            {{on "click" (fn this.pressArrow "up")}}
          ><Icon @name="arrow-up" @size={{18}} /></button>
          <button
            type="button"
            class="btn defuse-dir is-left"
            data-sound="off"
            aria-label="Left"
            {{on "click" (fn this.pressArrow "left")}}
          ><Icon @name="arrow-left" @size={{18}} /></button>
          <button
            type="button"
            class="btn defuse-dir is-right"
            data-sound="off"
            aria-label="Right"
            {{on "click" (fn this.pressArrow "right")}}
          ><Icon @name="arrow-right" @size={{18}} /></button>
          <button
            type="button"
            class="btn defuse-dir is-down"
            data-sound="off"
            aria-label="Down"
            {{on "click" (fn this.pressArrow "down")}}
          ><Icon @name="arrow-down" @size={{18}} /></button>
        </div>
      {{else if this.isTiming}}
        <div class="defuse-meter">
          {{#each this.zones as |z|}}
            {{#if z.active}}<span
                class="defuse-zone"
                style={{z.style}}
              ></span>{{/if}}
          {{/each}}
          <span class="defuse-needle"></span>
        </div>
        <button
          type="button"
          class="btn active defuse-stop"
          data-sound="off"
          {{on "click" this.stopNeedle}}
        >Stop{{#if (lt 1 this.hitsLeft)}}
            ({{this.hitsLeft}}
            left){{/if}}</button>
      {{/if}}
    </div>
  </template>
}
