import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

// An on-screen joystick for touch screens. Press anywhere on the base and drag:
// the knob follows your thumb (held inside the rim).
//
//   <Joystick @label="Steer" @onMove={{this.stickMoved}} @onEnd={{this.stickReleased}} />
//
// @onMove(x, y) gets each axis from -1 to 1 (down and right are positive).
export default class Joystick extends Component {
  stick = modifier((base) => {
    const knob = base.querySelector('.joystick-knob');
    let pointer = null;
    const move = (event) => {
      if (event.pointerId !== pointer) return;
      const rect = base.getBoundingClientRect();
      const r = rect.width / 2;
      let dx = event.clientX - (rect.left + r);
      let dy = event.clientY - (rect.top + r);
      const length = Math.hypot(dx, dy);
      if (length > r) {
        dx *= r / length;
        dy *= r / length;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.args.onMove?.(dx / r, dy / r);
    };
    const down = (event) => {
      if (pointer !== null) return;
      event.preventDefault();
      pointer = event.pointerId;
      base.setPointerCapture?.(pointer);
      base.classList.add('is-active');
      move(event);
    };
    const up = (event) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      knob.style.transform = '';
      base.classList.remove('is-active');
      this.args.onEnd?.();
    };
    base.addEventListener('pointerdown', down);
    base.addEventListener('pointermove', move);
    base.addEventListener('pointerup', up);
    base.addEventListener('pointercancel', up);
    return () => {
      base.removeEventListener('pointerdown', down);
      base.removeEventListener('pointermove', move);
      base.removeEventListener('pointerup', up);
      base.removeEventListener('pointercancel', up);
    };
  });

  <template>
    <div class="joystick {{@class}}" role="application" aria-label={{@label}} data-sound="off" {{this.stick}}>
      <span class="joystick-knob"></span>
    </div>
  </template>
}
