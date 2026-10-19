<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { service } from '../core/services.js';
  import { omit, truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import { originOf } from '../utils/theme-origin.js';

  class ThemeToggle extends Component {
    settings = service('settings');

    toggle = (event) => this.settings.toggleTheme(originOf(event));
  }
</script>

<script>
  let args = $props();
  const self = new ThemeToggle(args);
  onDestroy(() => destroy(self));
  const attrs = $derived(omit(args, ['children', 'name', 'size', 'class']));
</script>

<button
  type="button"
  class="theme-toggle {args.class ?? ''}"
  aria-label="Switch to {truthy(self.settings?.isDark) ? 'light' : 'dark'} mode"
  {...attrs}
  onclick={self.toggle}
>
  {#if truthy(self.settings?.isDark)}
    <Icon name="moon" size={15} />
  {:else}
    <Icon name="sun" size={19} />
  {/if}
</button>
