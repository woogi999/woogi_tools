import Component from '@glimmer/component';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { LinkTo } from '@ember/routing';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import FavouriteStar from './favourite-star';

// Widest the whole fan opens, and the most any two neighbours spread apart.
const MAX_FAN_DEG = 140;
const MAX_STEP_DEG = 17;
// However many cards are dealt, the whole deal animation takes at most this long.
const DEAL_MS = 400;

// Search results held as a fan of playing cards. The hand is two drawings
// (public/search_assets) on the same 768×1924 canvas stacked in one spot:
// the curled fingers behind the cards, the thumb and wrist in front.
//
// Which card is "up" comes from the pointer's angle around the fan's pivot
// rather than CSS :hover, so it tracks instantly, never flickers as a card
// lifts away, and a click anywhere on the fan opens the card that's up.
export default class CardHand extends Component {
  @service router;

  // Set when a touch only lifted a card; the click that follows is swallowed.
  swallowClick = false;

  // A route per card, in order — changes exactly when the dealt hand actually changes.
  get cardsKey() {
    return (this.args.cards ?? []).map((card) => card.tool.route).join(',');
  }

  get step() {
    const count = this.args.cards?.length ?? 0;
    return count > 1 ? Math.min(MAX_STEP_DEG, MAX_FAN_DEG / (count - 1)) : 0;
  }

  get fan() {
    const cards = this.args.cards ?? [];
    const middle = (cards.length - 1) / 2;
    const stagger = Math.min(25, DEAL_MS / Math.max(1, cards.length));
    return cards.map((card, i) => ({
      card,
      isActive: card.tool.route === this.args.activeRoute,
      style: htmlSafe(`--angle: ${((i - middle) * this.step).toFixed(2)}deg; --delay: ${Math.round(i * stagger)}ms; z-index: ${i + 1}`),
    }));
  }

  // The card under a point, by its angle around the pivot; null when off the fan.
  cardAt(stage, x, y) {
    const cards = this.args.cards ?? [];
    const pivot = stage.querySelector('.card-hand-pivot')?.getBoundingClientRect();
    const sample = stage.querySelector('.fan-card');
    if (!pivot || !sample || !cards.length) return null;
    const dx = x - pivot.left;
    const dy = y - pivot.top;
    if (Math.hypot(dx, dy) > sample.offsetHeight * 1.5 || dy > sample.offsetHeight * 0.15) return null;
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const first = -((cards.length - 1) / 2) * this.step;
    const edge = Math.max(this.step, 14);
    if (angle < first - edge || angle > -first + edge) return null;
    const index = this.step ? Math.round((angle - first) / this.step) : 0;
    return cards[Math.min(cards.length - 1, Math.max(0, index))].tool.route;
  }

  track = modifier((stage) => {
    const activate = (route) => {
      if (route !== this.args.activeRoute) this.args.onActivate?.(route);
    };
    // Hit-testing reads layout, so do it at most once per frame however fast the pointer moves.
    let frame = 0;
    let point = null;
    const onMove = (event) => {
      if (event.pointerType === 'touch') return;
      point = [event.clientX, event.clientY];
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        if (point) activate(this.cardAt(stage, ...point));
      });
    };
    const onLeave = (event) => {
      if (event.pointerType === 'touch') return;
      point = null;
      activate(null);
    };
    const onDown = (event) => {
      if (event.pointerType !== 'touch') return;
      const route = this.cardAt(stage, event.clientX, event.clientY);
      // First tap lifts a card to preview it; tapping it again opens it.
      this.swallowClick = Boolean(route) && route !== this.args.activeRoute;
      activate(route);
    };
    // Capture phase, so this decides before the card's own link does.
    const onClick = (event) => {
      if (event.target.closest('.star-btn')) return;
      // Keyboard "clicks" (Enter on a focused card) have no pointer position.
      const route = event.detail === 0 ? event.target.closest('.fan-card')?.dataset.route : this.args.activeRoute;
      if (!route) return;
      event.preventDefault();
      event.stopPropagation();
      if (this.swallowClick) {
        this.swallowClick = false;
        return;
      }
      this.router.transitionTo(route);
    };
    const onFocus = (event) => activate(event.target.closest('.fan-card')?.dataset.route ?? null);

    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('click', onClick, true);
    stage.addEventListener('focusin', onFocus);
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('click', onClick, true);
      stage.removeEventListener('focusin', onFocus);
    };
  });

  // Snaps the hand with a quick flick whenever the dealt cards actually change
  // (a fresh search, a filter). Skips the very first deal — nothing to react to yet.
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
    <section class="card-hand" aria-label="Search results in your hand">
      <div class="card-hand-stage" {{this.track}} {{this.flick this.cardsKey}}>
        <img src="/search_assets/hand_back.png" alt="" aria-hidden="true" class="hand-image" draggable="false" />
        <span class="card-hand-pivot" aria-hidden="true"></span>
        <ul class="card-fan">
          {{#each this.fan key="card.tool.route" as |slot|}}
            <li class="fan-card {{if slot.card.suit.black 'is-black' 'is-red'}} {{if slot.isActive 'is-active'}}" style={{slot.style}} data-route={{slot.card.tool.route}}>
              <span class="card-corner card-corner-tl"><span class="card-rank">{{slot.card.rank}}</span><span class="card-suit">{{slot.card.suit.symbol}}</span></span>
              <span class="card-corner card-corner-br"><span class="card-rank">{{slot.card.rank}}</span><span class="card-suit">{{slot.card.suit.symbol}}</span></span>
              {{#if slot.card.tool.category}}
                <FavouriteStar @route={{slot.card.tool.route}} @size={{14}} class="card-star" />
              {{/if}}
              <Icon @name={{slot.card.tool.icon}} @size={{34}} class="tool-icon" />
              <LinkTo @route={{slot.card.tool.route}} class="tool-card-link fan-card-title">{{slot.card.tool.label}}</LinkTo>
              {{#if slot.card.tool.category}}<span class="fan-card-category">{{slot.card.tool.category}}</span>{{/if}}
              {{#if slot.card.tool.description}}<p class="fan-card-description">{{slot.card.tool.description}}</p>{{/if}}
            </li>
          {{/each}}
        </ul>
        <img src="/search_assets/hand_front.png" alt="" aria-hidden="true" class="hand-image hand-front" draggable="false" />
      </div>
    </section>
  </template>
}
