import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';

// Widest the whole fan opens, and the most any two neighbours spread apart.
const MAX_FAN_DEG = 140;
const MAX_STEP_DEG = 17;
// However many cards are dealt, the whole deal animation takes at most this long.
const DEAL_MS = 400;
// Above this many cards, only the lifted card and the top card get a full face;
// the rest are covered by their neighbours, so they draw just their corner.
const FULL_FACE_LIMIT = 8;
// Above this many cards, the fan fades in as one piece instead of card by card.
const STAGGER_LIMIT = 16;
// A touch that moves less than this is a tap, not a drag.
const TAP_SLOP_PX = 10;

const eq = (a, b) => a === b;
const showFace = (slot, activeKey) => !slot.lite || slot.key === activeKey;
const slotAt = (slots, i) => slots[i];
// A spare card in the pool is hidden; a dealt one keeps `is-dealing` (restarted by `redeal`).
const cardClass = (slot, activeKey) => (slot ? `fan-card is-dealing ${slot.item.className ?? ''}${slot.key === activeKey ? ' is-active' : ''}` : 'fan-card is-pooled');

// A fan of cards held by a drawn hand. The hand is two drawings
// (public/search_assets) on the same 768×1924 canvas stacked in one spot:
// the curled fingers behind the cards, the thumb and wrist in front.
//
// Which card is "up" comes from the pointer's angle around the fan's pivot
// rather than :hover, so it tracks instantly and never flickers as a card
// lifts away. With a mouse, hover lifts and a click anywhere on the fan opens
// the lifted card. With touch, drag along the fan to flip through the cards;
// tap the lifted card again to open it.
//
// Args: @items [{ key, className }], @activeKey, @onActivate(key), @onOpen(key), @class.
// Yields each item, whether to draw its full face, and whether it's lifted.
//
// The cards are pooled: the <li> elements are kept by position and never
// thrown away, only hidden when the hand shrinks. A new search or a card
// played just changes what's written on the cards already on screen, instead
// of tearing down and rebuilding dozens of elements on every keystroke.
export default class FanHand extends Component {
  // The most cards this hand has ever held; that many <li>s stay alive.
  poolSize = 0;
  // Which item each pooled card showed last, to know which ones to re-deal.
  dealt = [];

  // Geometry only depends on the dealt cards, so lifting one doesn't rebuild it.
  @cached
  get layout() {
    const items = this.args.items ?? [];
    const count = items.length;
    const step = count > 1 ? Math.min(MAX_STEP_DEG, MAX_FAN_DEG / (count - 1)) : 0;
    const middle = (count - 1) / 2;
    const stagger = count > STAGGER_LIMIT ? 0 : Math.min(25, DEAL_MS / Math.max(1, count));
    // A high-water mark, not state anything renders from: the pool only ever grows.
    // eslint-disable-next-line ember/no-side-effects
    this.poolSize = Math.max(this.poolSize, count);
    return {
      step,
      many: count > STAGGER_LIMIT,
      key: items.map((item) => item.key).join(','),
      slots: items.map((item, i) => ({
        item,
        key: item.key,
        lite: count > FULL_FACE_LIMIT && i !== count - 1,
        style: htmlSafe(`--angle: ${((i - middle) * step).toFixed(2)}deg; --delay: ${Math.round(i * stagger)}ms; z-index: ${i + 1}`),
      })),
      pool: Array.from({ length: this.poolSize }, (_, i) => i),
    };
  }

  // The card under a point, by its angle around the pivot; null when off the fan.
  cardAt(stage, x, y) {
    const { slots, step } = this.layout;
    const pivot = stage.querySelector('.card-hand-pivot')?.getBoundingClientRect();
    // offsetHeight ignores CSS zoom (the picture-in-picture window scales its
    // content down); the stage's on-screen size tells how much.
    const zoom = stage.getBoundingClientRect().width / (stage.offsetWidth || 1);
    const cardHeight = (stage.querySelector('.fan-card:not(.is-pooled)')?.offsetHeight ?? 0) * zoom;
    if (!pivot || !cardHeight || !slots.length) return null;
    const dx = x - pivot.left;
    const dy = y - pivot.top;
    if (Math.hypot(dx, dy) > cardHeight * 1.5 || dy > cardHeight * 0.15) return null;
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const first = -((slots.length - 1) / 2) * step;
    const edge = Math.max(step, 14);
    if (angle < first - edge || angle > -first + edge) return null;
    const index = step ? Math.round((angle - first) / step) : 0;
    return slots[Math.min(slots.length - 1, Math.max(0, index))].key;
  }

  track = modifier((stage) => {
    const activate = (key) => {
      if (key !== this.args.activeKey) this.args.onActivate?.(key);
    };
    const open = (key) => key !== null && key !== undefined && this.args.onOpen?.(key);

    // Hit-testing reads layout, so do it at most once per frame however fast the pointer moves.
    let frame = 0;
    let point = null;
    const scheduleHitTest = (keepOnMiss) => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        if (!point) return;
        const key = this.cardAt(stage, ...point);
        // While dragging, sliding off the fan keeps the last card up.
        if (key !== null || !keepOnMiss) activate(key);
      });
    };

    // Set on pointerdown for touch and pen; null for a mouse.
    let gesture = null;

    const onDown = (event) => {
      if (event.pointerType === 'mouse') return;
      const key = this.cardAt(stage, event.clientX, event.clientY);
      if (key === null) {
        activate(null);
        return;
      }
      // The cards have touch-action: none, so this drag won't scroll the page.
      stage.setPointerCapture?.(event.pointerId);
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false, startKey: key, wasUp: key === this.args.activeKey };
      activate(key);
    };

    const onMove = (event) => {
      point = [event.clientX, event.clientY];
      if (event.pointerType === 'mouse') {
        scheduleHitTest(false);
        return;
      }
      if (!gesture || event.pointerId !== gesture.id) return;
      if (!gesture.dragged && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > TAP_SLOP_PX) gesture.dragged = true;
      if (gesture.dragged) scheduleHitTest(true);
    };

    const onUp = (event) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      // A tap on the card that was already up opens it; anything else just lifts.
      if (!gesture.dragged && gesture.wasUp) open(gesture.startKey);
      gesture = null;
    };

    const onCancel = () => (gesture = null);

    const onLeave = (event) => {
      if (event.pointerType !== 'mouse') return;
      point = null;
      activate(null);
    };

    const onClick = (event) => {
      // Touch taps were already handled on pointerup.
      if (event.pointerType && event.pointerType !== 'mouse') return;
      open(this.args.activeKey);
    };

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onCancel);
    stage.addEventListener('pointerleave', onLeave);
    stage.addEventListener('click', onClick);
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onCancel);
      stage.removeEventListener('pointerleave', onLeave);
      stage.removeEventListener('click', onClick);
    };
  });

  // Replays the deal animation on the pooled cards whose content changed, with
  // one forced reflow for the whole batch rather than one per card.
  redeal = modifier((list, [slots]) => {
    const changed = [];
    slots.forEach((slot, i) => {
      if (this.dealt[i] !== slot.key && list.children[i]) changed.push(list.children[i]);
    });
    this.dealt = slots.map((slot) => slot.key);
    if (!changed.length) return;
    for (const card of changed) card.classList.remove('is-dealing');
    void list.offsetWidth;
    for (const card of changed) card.classList.add('is-dealing');
  });

  // Snaps the hand with a quick flick whenever the dealt cards actually change
  // (a fresh search, a card played). Skips the very first deal — nothing to react to yet.
  flick = modifier((stage, [key]) => {
    if (this.lastKey === undefined) {
      this.lastKey = key;
      return;
    }
    if (key === this.lastKey) return;
    this.lastKey = key;
    stage.classList.remove('is-flicking');
    void stage.offsetWidth; // force reflow so re-adding the class restarts the animation
    stage.classList.add('is-flicking');
    const timer = setTimeout(() => stage.classList.remove('is-flicking'), 550);
    return () => clearTimeout(timer);
  });

  <template>
    <section class="card-hand {{@class}}" aria-hidden="true">
      <div class="card-hand-stage" {{this.track}} {{this.flick this.layout.key}}>
        <img src="/search_assets/hand_back.png" alt="" class="hand-image" draggable="false" />
        <span class="card-hand-pivot"></span>
        <ul class="card-fan {{if this.layout.many 'is-many'}}" {{this.redeal this.layout.slots}}>
          {{#each this.layout.pool key="@index" as |i|}}
            {{#let (slotAt this.layout.slots i) as |slot|}}
              <li class={{cardClass slot @activeKey}} style={{slot.style}}>
                {{#if slot}}{{yield slot.item (showFace slot @activeKey) (eq slot.key @activeKey)}}{{/if}}
              </li>
            {{/let}}
          {{/each}}
        </ul>
        <img src="/search_assets/hand_front.png" alt="" class="hand-image hand-front" draggable="false" />
      </div>
    </section>
  </template>
}
