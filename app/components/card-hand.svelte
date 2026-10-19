<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { service } from '../core/services.js';
  import { truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import FanHand from './fan-hand.svelte';
  import Icon from './icon.svelte';

  // Search results held as a fan of playing cards (see FanHand for the hand
  // itself). Lifting a card previews it; opening it goes to the tool.
  //
  // The hand is a pointer-only visual (hidden from assistive tech): the grid of
  // results beside it has the same tools as real, focusable links.
  class CardHand extends Component {
    router = service('router');

    items = $derived.by(() => {
      return (this.args.cards ?? []).map((card) => ({
        key: card.tool.route,
        className: card.suit.black ? 'is-black' : 'is-red',
        card,
      }));
    });

    open = (route) => this.router.transitionTo(route);
  }
</script>

<script>
  let args = $props();
  const self = new CardHand(args);
  onDestroy(() => destroy(self));
</script>

<FanHand
  items={self.items}
  activeKey={args.activeRoute}
  onActivate={args.onActivate}
  onOpen={self.open}
  >{#snippet children(item, showFace)}
    <span class="card-corner card-corner-tl"
      ><span class="card-rank">{item?.card?.rank}</span><span class="card-suit"
        >{item?.card?.suit?.symbol}</span
      ></span
    >
    {#if truthy(showFace)}
      <span class="card-corner card-corner-br"
        ><span class="card-rank">{item?.card?.rank}</span><span
          class="card-suit">{item?.card?.suit?.symbol}</span
        ></span
      >
      <Icon name={item?.card?.tool?.icon} size={34} class="tool-icon" />
      <span class="fan-card-title">{item?.card?.tool?.label}</span>
      {#if truthy(item?.card?.tool?.category)}<span class="fan-card-category"
          >{item?.card?.tool?.category}</span
        >{/if}
      {#if truthy(item?.card?.tool?.description)}<p class="fan-card-description"
          >{item?.card?.tool?.description}</p
        >{/if}
    {/if}
  {/snippet}</FanHand
>
