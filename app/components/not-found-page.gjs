import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import CardHand from './card-hand';
import Icon from './icon';
import ThemeToggle from './theme-toggle';
import VolumeButton from './volume-button';
import { TOOLS } from '../tools';

// One of these greets you on a dead link, picked fresh each shuffle.
const MESSAGES = [
  {
    title: "We can't find this page gng...",
    body: "We looked everywhere. Under the couch, behind the fridge, nothing. It's just not here.",
  },
  {
    title: 'Houston, we have a 404',
    body: 'This page drifted off into space and mission control lost the signal. Best to head back to base.',
  },
  {
    title: 'Well, this is awkward...',
    body: "You showed up, the page didn't. Let's both pretend this never happened.",
  },
  {
    title: 'You entered left on the crossroads',
    body: 'Should have gone right. No worries though, the way home is right here.',
  },
  {
    title: 'This page left the group chat',
    body: "No goodbye, no forwarding address. It's gone and it's not coming back.",
  },
  {
    title: 'Nothing to see here, fr',
    body: 'Either the link is broken, the page moved, or someone made a typo. (Not naming names.)',
  },
  {
    title: 'You found the void',
    body: "Congrats, you've reached the end of the internet. There's nothing out here except this message.",
  },
  {
    title: 'Plot twist: no page',
    body: 'You were expecting content. The writers had other plans.',
  },
  {
    title: 'The dog ate this page',
    body: "We'd rewrite it, but we don't remember what was on it either.",
  },
  {
    title: 'Page is in another castle',
    body: "Sorry! The page you're looking for isn't here. Maybe one of these cards is?",
  },
  {
    title: 'Wrong door, buddy',
    body: 'This room is empty. The good stuff is back through the front door.',
  },
  {
    title: 'Page went out for milk',
    body: "Said it'd be right back. That was a while ago. Maybe try a different one?",
  },
  {
    title: 'Lost? Same.',
    body: "We don't know where this page went either. Let's find our way back together.",
  },
  {
    title: 'Page? I barely know her',
    body: "Whatever you were looking for isn't here. Could be a typo, could be fate.",
  },
  {
    title: "It's giving... nothing",
    body: "This link leads nowhere. Might've moved, might've never existed at all.",
  },
  {
    title: 'You took a wrong turn at Albuquerque',
    body: "Happens to the best of us. Turn around, we'll get you back on the road.",
  },
  {
    title: 'This page is on vacation',
    body: "Out of office, no return date. Pick a card while you're here?",
  },
  {
    title: 'Oops, all nothing',
    body: "We checked twice. There's really nothing at this address.",
  },
  {
    title: 'Error 404: skill issue',
    body: "Kidding, it's probably our fault. Either way, this page doesn't exist.",
  },
  {
    title: 'The link lied to you',
    body: "Whoever sent you here promised a page. We're sorry to report there isn't one.",
  },
  {
    title: 'Not all who wander are lost',
    body: "But you kinda are. That's okay, home is one click away.",
  },
  {
    title: 'Bro got ghosted by a URL',
    body: 'The page left you on read. Time to move on to better things.',
  },
  {
    title: 'You drew a blank',
    body: 'No page in this hand. Try drawing again from the deck below.',
  },
];

const RANKS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
];
const SUITS = [
  { symbol: '♠', black: true },
  { symbol: '♥', black: false },
  { symbol: '♣', black: true },
  { symbol: '♦', black: false },
];
const HAND_SIZE = 10;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default class NotFoundPage extends Component {
  @service router;
  @service toolVisibility;

  @tracked message = pick(MESSAGES);
  @tracked cards = this.deal();
  @tracked activeRoute = null;

  deal() {
    const tools = TOOLS.filter(
      (t) => t.category && t.route && this.toolVisibility.isVisible(t),
    );
    return shuffled(tools)
      .slice(0, HAND_SIZE)
      .map((tool) => ({ tool, rank: pick(RANKS), suit: pick(SUITS) }));
  }

  shuffle = () => {
    let next;
    do next = pick(MESSAGES);
    while (next === this.message && MESSAGES.length > 1);
    this.message = next;
    this.cards = this.deal();
    this.activeRoute = null;
  };

  goBack = () => history.back();

  setActive = (route) => (this.activeRoute = route);

  <template>
    <main class="nf">
      <header class="nf-top">
        <LinkTo @route="index" class="nf-brand">
          <img
            src="/icon_expanded.png"
            alt="Woogi Tools"
            class="brand-logo-static"
          />
          <img
            src="/icon_expanded.gif"
            alt=""
            aria-hidden="true"
            class="brand-logo-gif"
          />
        </LinkTo>
        <div class="top-controls">
          <VolumeButton />
          <ThemeToggle />
        </div>
      </header>

      <div class="nf-deck" aria-hidden="true">
        <div class="nf-card"><span class="nf-pip tl">4<br />♠</span>4<span
            class="nf-pip br"
          >4<br />♠</span></div>
        <div class="nf-card is-back">?</div>
        <div class="nf-card is-red"><span class="nf-pip tl">4<br
            />♥</span>4<span class="nf-pip br">4<br />♥</span></div>
      </div>

      <div class="nf-copy">
        <h1 class="nf-title">{{this.message.title}}</h1>
        <p class="nf-body">{{this.message.body}}</p>
        <div class="nf-actions">
          <LinkTo @route="index" class="btn active">
            <Icon @name="house" @size={{16}} />
            Back to home
          </LinkTo>
          <button type="button" class="btn" {{on "click" this.goBack}}>
            <Icon @name="arrow-left" @size={{16}} />
            Go back
          </button>
          <button type="button" class="btn" {{on "click" this.shuffle}}>
            <Icon @name="shuffle" @size={{16}} />
            Shuffle
          </button>
        </div>
      </div>

      <section class="nf-pick">
        <div class="nf-hand">
          <CardHand
            @cards={{this.cards}}
            @activeRoute={{this.activeRoute}}
            @onActivate={{this.setActive}}
          />
        </div>
      </section>
    </main>
  </template>
}
