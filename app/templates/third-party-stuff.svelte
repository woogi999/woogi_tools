<script>
  import { service } from '../core/services.js';
  import ThirdPartyStuffPage from '../components/third-party-stuff-page.svelte';

  // ?from= names the page an old link pointed at (see REDIRECTS in router.js),
  // so the page can say where it went. Dismissing the note drops it from the URL.
  const router = service('router');
  const dismiss = () => router.replaceWith('third-party-stuff');
</script>

<ThirdPartyStuffPage
  from={router.queryParams.from ?? null}
  onDismiss={dismiss}
/>
