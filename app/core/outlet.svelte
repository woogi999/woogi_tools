<script>
  import { service } from './services.js';

  // The current route's page (see router.svelte.js).
  const router = service('router');
  const Page = $derived(router.page);
</script>

{#if Page}
  <Page />
{/if}
