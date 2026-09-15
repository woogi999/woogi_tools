import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import { sfx } from '../utils/sound';

// A warning dialog whose confirm button has to be held down (3 seconds by
// default) before it goes through, for things that are easy to hit by accident
// and can't be undone, like abandoning a game in progress.
//
// Args: @title, @message, @confirmLabel, @cancelLabel, @holdMs, @onConfirm, @onCancel. Block: extra details under the message.
// Render it only while it should be open; it opens as a modal on insert.
export default class HoldConfirm extends Component {
  @tracked progress = 0;
  holding = null;
  frame = null;

  get holdMs() {
    return this.args.holdMs ?? 3000;
  }

  get seconds() {
    return Math.ceil((this.holdMs * (1 - this.progress)) / 1000);
  }

  get fillStyle() {
    return htmlSafe(`--hold: ${this.progress}`);
  }

  open = modifier((dialog) => {
    // The top layer shows above fullscreen elements too.
    dialog.showModal?.();
    sfx('ui.open');
    return () => {
      cancelAnimationFrame(this.frame);
      if (dialog.open) dialog.close();
    };
  });

  start = (event) => {
    if (event.type === 'keydown' && event.key !== ' ' && event.key !== 'Enter') return;
    if (event.type === 'keydown' && event.repeat) return;
    event.preventDefault();
    if (this.holding !== null) return;
    if (event.pointerId !== undefined) event.currentTarget.setPointerCapture?.(event.pointerId);
    this.holding = performance.now();
    sfx('ui.hold');
    const tick = (now) => {
      if (this.holding === null) return;
      this.progress = Math.min(1, (now - this.holding) / this.holdMs);
      if (this.progress >= 1) {
        this.holding = null;
        sfx('ui.confirm');
        this.args.onConfirm?.();
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  };

  stop = (event) => {
    if (event?.type === 'keyup' && event.key !== ' ' && event.key !== 'Enter') return;
    if (this.holding === null) return;
    this.holding = null;
    cancelAnimationFrame(this.frame);
    this.progress = 0;
  };

  cancel = (event) => {
    event?.preventDefault();
    this.stop();
    this.args.onCancel?.();
  };

  <template>
    <dialog class="hold-confirm" aria-labelledby="hold-confirm-title" {{this.open}} {{on "cancel" this.cancel}}>
      <div class="hold-confirm-body pop-in">
        <span class="hold-confirm-icon"><Icon @name="triangle-alert" @size={{22}} /></span>
        <h2 id="hold-confirm-title" class="hold-confirm-title">{{@title}}</h2>
        <p class="hold-confirm-text">{{@message}}</p>
        {{yield}}
        <div class="hold-confirm-actions">
          <button type="button" class="btn" {{on "click" this.cancel}}>{{if @cancelLabel @cancelLabel "Keep playing"}}</button>
          <button
            type="button"
            class="btn hold-btn {{if this.progress 'is-holding'}}"
            style={{this.fillStyle}}
            aria-label="{{if @confirmLabel @confirmLabel 'Confirm'}}: press and hold for {{this.seconds}} seconds"
            {{on "pointerdown" this.start}}
            {{on "pointerup" this.stop}}
            {{on "pointercancel" this.stop}}
            {{on "pointerleave" this.stop}}
            {{on "keydown" this.start}}
            {{on "keyup" this.stop}}
            {{on "contextmenu" this.preventMenu}}
          >
            <span class="hold-btn-fill" aria-hidden="true"></span>
            <span class="hold-btn-label"><Icon @name="hand" @size={{13}} /> {{if this.progress (holdText this.seconds) (if @confirmLabel @confirmLabel "Hold to confirm")}}</span>
          </button>
        </div>
        <p class="hold-confirm-hint">Press and hold for {{secondsOf this.holdMs}} seconds.</p>
      </div>
    </dialog>
  </template>

  preventMenu = (event) => event.preventDefault();
}

function holdText(seconds) {
  return `Keep holding… ${seconds}`;
}

function secondsOf(ms) {
  return Math.round(ms / 1000);
}
