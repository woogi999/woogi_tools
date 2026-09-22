import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';
import { service } from '@ember/service';
import FanHand from './fan-hand';
import Icon from './icon';

// Search results held as a fan of playing cards (see FanHand for the hand
// itself). Lifting a card previews it; opening it goes to the tool.
//
// The hand is a pointer-only visual (hidden from assistive tech): the grid of
// results beside it has the same tools as real, focusable links.
export default class CardHand extends Component {
  @service router;

  @cached
  get items() {
    return (this.args.cards ?? []).map((card) => ({
      key: card.tool.route,
      className: card.suit.black ? 'is-black' : 'is-red',
      card,
    }));
  }

  open = (route) => this.router.transitionTo(route);

  <template>
    <FanHand
      @items={{this.items}}
      @activeKey={{@activeRoute}}
      @onActivate={{@onActivate}}
      @onOpen={{this.open}}
      as |item showFace|
    >
      <span class="card-corner card-corner-tl"><span
          class="card-rank"
        >{{item.card.rank}}</span><span
          class="card-suit"
        >{{item.card.suit.symbol}}</span></span>
      {{#if showFace}}
        <span class="card-corner card-corner-br"><span
            class="card-rank"
          >{{item.card.rank}}</span><span
            class="card-suit"
          >{{item.card.suit.symbol}}</span></span>
        <Icon @name={{item.card.tool.icon}} @size={{34}} class="tool-icon" />
        <span class="fan-card-title">{{item.card.tool.label}}</span>
        {{#if item.card.tool.category}}<span
            class="fan-card-category"
          >{{item.card.tool.category}}</span>{{/if}}
        {{#if item.card.tool.description}}<p
            class="fan-card-description"
          >{{item.card.tool.description}}</p>{{/if}}
      {{/if}}
    </FanHand>
  </template>
}
