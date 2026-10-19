<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import { sfx } from '../utils/sound.svelte.js';

  // A warning dialog whose confirm button has to be held down (3 seconds by
  // default) before it goes through, for things that are easy to hit by accident
  // and can't be undone, like abandoning a game in progress.
  //
  // Args: @title, @message, @confirmLabel, @cancelLabel, @holdMs, @onConfirm, @onCancel. Block: extra details under the message.
  // Render it only while it should be open; it opens as a modal on insert.
  class HoldConfirm extends Component {
    progress = $state.raw(0);
    holding = null;
    frame = null;

    get holdMs() {
      return this.args.holdMs ?? 3000;
    }

    get seconds() {
      return Math.ceil((this.holdMs * (1 - this.progress)) / 1000);
    }

    get fillStyle() {
      return `--hold: ${this.progress}`;
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

    // The hold begins on pointerdown and is the confirmation itself, so the
    // press cannot wait for pointerup; hence the lint waiver in the template.
    start = (event) => {
      if (
        event.type === 'keydown' &&
        event.key !== ' ' &&
        event.key !== 'Enter'
      )
        return;
      if (event.type === 'keydown' && event.repeat) return;
      event.preventDefault();
      if (this.holding !== null) return;
      if (event.pointerId !== undefined)
        event.currentTarget.setPointerCapture?.(event.pointerId);
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
      if (event?.type === 'keyup' && event.key !== ' ' && event.key !== 'Enter')
        return;
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

    preventMenu = (event) => event.preventDefault();
  }

  function holdText(seconds) {
    return `Keep holding… ${seconds}`;
  }

  function secondsOf(ms) {
    return Math.round(ms / 1000);
  }
</script>

<script>
  let args = $props();
  const self = new HoldConfirm(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable no-pointer-down-event-binding -->
<dialog
  class="hold-confirm"
  aria-labelledby="hold-confirm-title"
  oncancel={self.cancel}
  {@attach self.open?.()}
>
  <div class="hold-confirm-body pop-in">
    <span class="hold-confirm-icon"
      ><Icon name="triangle-alert" size={22} /></span
    >
    <h2 id="hold-confirm-title" class="hold-confirm-title">{args.title}</h2>
    <p class="hold-confirm-text">{args.message}</p>
    {@render args.children?.()}
    <div class="hold-confirm-actions">
      <button type="button" class="btn" onclick={self.cancel}
        >{truthy(args.cancelLabel) ? args.cancelLabel : 'Keep playing'}</button
      >
      <button
        type="button"
        class="btn hold-btn {truthy(self.progress) ? 'is-holding' : ''}"
        style={self.fillStyle}
        aria-label="{truthy(args.confirmLabel)
          ? args.confirmLabel
          : 'Confirm'}: press and hold for {self.seconds} seconds"
        oncontextmenu={self.preventMenu}
        onkeyup={self.stop}
        onkeydown={self.start}
        onpointerleave={self.stop}
        onpointercancel={self.stop}
        onpointerup={self.stop}
        onpointerdown={self.start}
      >
        <span class="hold-btn-fill" aria-hidden="true"></span>
        <span class="hold-btn-label"
          ><Icon name="hand" size={13} />
          {truthy(self.progress)
            ? holdText(self.seconds)
            : truthy(args.confirmLabel)
              ? args.confirmLabel
              : 'Hold to confirm'}</span
        >
      </button>
    </div>
    <p class="hold-confirm-hint"
      >Press and hold for
      {secondsOf(self.holdMs)}
      seconds.</p
    >
  </div>
</dialog>
