import Component from '@glimmer/component';
import { service } from '@ember/service';
import { LinkTo } from '@ember/routing';
import Icon from './icon';
import FavouriteStar from './favourite-star';
import CreditList from './credit-list';
import { TOOLS, SITE_CREDITS } from '../tools';

const CARDS = TOOLS.filter((t) => t.category);

// A tool's position in the list fixes its rank and suit, so a card keeps the
// same "identity" wherever it's shown (favourites or the full grid). Suits
// cycle in the classic alternating black/red order.
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = [
  { symbol: '♠', black: true },
  { symbol: '♥', black: false },
  { symbol: '♣', black: true },
  { symbol: '♦', black: false },
];

export default class HomePage extends Component {
  @service favourites;
  @service toolVisibility;

  get cards() {
    return CARDS.filter((tool) => this.toolVisibility.isVisible(tool)).map((tool, i) => ({
      tool,
      starred: this.favourites.has(tool.route),
      rank: RANKS[i % RANKS.length],
      suit: SUITS[i % SUITS.length],
    }));
  }

  get favouriteCards() {
    return this.cards.filter((c) => c.starred);
  }

  get groupedCards() {
    const groups = new Map();
    for (const card of this.cards) {
      const key = card.tool.category ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(card);
    }
    return [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]) => ({ name, items: items.sort((a, b) => a.tool.label.localeCompare(b.tool.label)) }));
  }

  <template>
    <div class="container">
      <section class="hero pop-in">
        <h1>Small tools, no bloat.</h1>
        <p>A handful of fast, single-purpose utilities with a bit of personality. No accounts, no tracking.</p>
      </section>

      <section class="home-section pop-in">
        <h2 class="section-title">Favourites</h2>
        {{#if this.favouriteCards.length}}
          <div class="tool-grid">
            {{#each this.favouriteCards key="tool.route" as |card|}}
              <ToolCard @card={{card}} />
            {{/each}}
          </div>
        {{else}}
          <p class="history-empty">Star a tool below and it will show up here.</p>
        {{/if}}
      </section>

      {{#each this.groupedCards key="name" as |group|}}
        <section class="home-section pop-in">
          <h2 class="section-title">{{group.name}}</h2>
          <div class="tool-grid">
            {{#each group.items key="tool.route" as |card|}}
              <ToolCard @card={{card}} />
            {{/each}}
          </div>
        </section>
      {{/each}}

      <section class="made-with pop-in">
        <h3 class="credit-heading">Site built with</h3>
        <CreditList @credits={{SITE_CREDITS}} />
      </section>
    </div>
  </template>
}

const ToolCard = <template>
  <div class="tool-card {{if @card.suit.black 'is-black' 'is-red'}}">
    <FavouriteStar @route={{@card.tool.route}} @size={{16}} class="card-star" />
    <span class="card-corner card-corner-tl"><span class="card-rank">{{@card.rank}}</span><span class="card-suit">{{@card.suit.symbol}}</span></span>
    <span class="card-corner card-corner-br"><span class="card-rank">{{@card.rank}}</span><span class="card-suit">{{@card.suit.symbol}}</span></span>
    <Icon @name={{@card.tool.icon}} @size={{34}} class="tool-icon" />
    <LinkTo @route={{@card.tool.route}} class="tool-card-link">{{@card.tool.label}}</LinkTo>
    <p>{{@card.tool.description}}</p>
  </div>
</template>;
