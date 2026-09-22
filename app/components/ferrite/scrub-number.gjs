import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';

// A pointer that has already gone throws rather than returning, and optional
// chaining does not help: the method is there, it just refuses. A capture that
// cannot be taken is not worth failing a gesture over.
function grabPointer(element, event) {
  try {
    element?.setPointerCapture?.(event.pointerId);
  } catch {
    // The gesture still works; it just will not follow the pointer off the
    // element.
  }
}

function freePointer(element, event) {
  try {
    element?.releasePointerCapture?.(event.pointerId);
  } catch {
    // Already released.
  }
}

// Ferrite's scrubby number: a value you can drag sideways as well as type into.
//
// Every number in the inspector and every property row in the timeline is one
// of these, because a motion graphic is dialled in rather than typed — you want
// to see the picture move while the number changes, and a text field only tells
// you what happened after you press Enter.
//
// Args: @value, @onChange, @step, @min, @max, @unit, @disabled.
export default class ScrubNumber extends Component {
  @tracked editing = false;
  @tracked draft = '';

  drag = null;

  get step() {
    return this.args.step ?? 1;
  }

  get shown() {
    const v = this.args.value ?? 0;
    // Trailing zeroes on a value nobody set to a fraction are noise.
    return Math.abs(v - Math.round(v)) < 0.0005
      ? String(Math.round(v))
      : String(Math.round(v * 100) / 100);
  }

  clamp(v) {
    return Math.min(
      this.args.max ?? Infinity,
      Math.max(this.args.min ?? -Infinity, v),
    );
  }

  bind = modifier((element) => {
    const down = (event) => {
      if (this.args.disabled || this.editing) return;
      grabPointer(element, event);
      this.drag = {
        x: event.clientX,
        from: this.args.value ?? 0,
        moved: false,
      };
    };
    const move = (event) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x;
      if (Math.abs(dx) < 3 && !this.drag.moved) return;
      this.drag.moved = true;
      // Shift is the fine adjustment, the way every other scrubby number in
      // the business does it.
      const scale = event.shiftKey ? 0.1 : 1;
      this.args.onChange(this.clamp(this.drag.from + dx * this.step * scale));
    };
    const up = (event) => {
      freePointer(element, event);
      // A press that never travelled is a click, and a click starts typing.
      if (this.drag && !this.drag.moved) {
        this.draft = this.shown;
        this.editing = true;
      }
      this.drag = null;
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
    };
  });

  focusIn = modifier((element) => element.select());

  commit = (event) => {
    const v = Number(event.target.value);
    if (!Number.isNaN(v)) this.args.onChange(this.clamp(v));
    this.editing = false;
  };

  keyed = (event) => {
    if (event.key === 'Enter') event.target.blur();
    if (event.key === 'Escape') this.editing = false;
    // The arrows step, because a keyboard is sometimes the faster hand.
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const by =
        (event.key === 'ArrowUp' ? 1 : -1) *
        this.step *
        (event.shiftKey ? 10 : 1);
      this.args.onChange(this.clamp((this.args.value ?? 0) + by));
    }
  };

  <template>
    {{! template-lint-disable no-pointer-down-event-binding }}
    {{#if this.editing}}
      <input
        type="text"
        class="fr-num is-editing"
        aria-label={{@label}}
        value={{this.draft}}
        {{this.focusIn}}
        {{on "blur" this.commit}}
        {{on "keydown" this.keyed}}
      />
    {{else}}
      <span
        class="fr-num {{if @disabled 'is-disabled'}}"
        role="spinbutton"
        tabindex="0"
        aria-valuenow={{@value}}
        aria-label={{@label}}
        title="Drag to change, click to type"
        {{this.bind}}
        {{on "keydown" this.keyed}}
      >{{this.shown}}{{#if @unit}}<i class="fr-unit">{{@unit}}</i>{{/if}}</span>
    {{/if}}
  </template>
}
