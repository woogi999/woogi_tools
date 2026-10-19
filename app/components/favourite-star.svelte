<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { service } from '../core/services.js';
  import { omit, truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';

  class FavouriteStar extends Component {
    favourites = service('favourites');

    get starred() {
      return this.favourites.has(this.args.route);
    }

    toggle = () => this.favourites.toggle(this.args.route);
  }
</script>

<script>
  let args = $props();
  const self = new FavouriteStar(args);
  onDestroy(() => destroy(self));
  const attrs = $derived(
    omit(args, ['children', 'name', 'size', 'fill', 'route', 'class']),
  );
</script>

<button
  type="button"
  class="star-btn {truthy(self.starred) ? 'starred' : ''} {args.class ?? ''}"
  aria-pressed={truthy(self.starred) ? 'true' : 'false'}
  aria-label="{truthy(self.starred) ? 'Remove from' : 'Add to'} favourites"
  title="{truthy(self.starred) ? 'Remove from' : 'Add to'} favourites"
  {...attrs}
  onclick={self.toggle}
>
  <Icon
    name="star"
    size={args.size}
    fill={truthy(self.starred) ? 'currentColor' : 'none'}
  />
</button>
