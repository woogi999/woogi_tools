<script>
  import { service } from './services.js';

  // A link to one of the site's routes. A plain click changes the page in
  // place. A modified click (new tab, new window) or a middle click is left to
  // the browser. The current route's link gets `activeClass` ('active').
  let {
    route,
    query,
    activeClass = 'active',
    class: className,
    children,
    ...rest
  } = $props();

  const router = service('router');
  const active = $derived(router.currentRouteName === route);
  // A link to the page you are on, with no query of its own, keeps the
  // page's current query (/third-party-stuff?from=jjs-stuff), as Ember did.
  const href = $derived(
    active && query === undefined
      ? router.currentURL.split('#')[0]
      : router.urlFor(route, { queryParams: query }),
  );

  function onclick(event) {
    rest.onclick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (rest.target && rest.target !== '_self')
    )
      return;
    event.preventDefault();
    router.transitionTo(href);
  }
</script>

<a {...rest} {href} class={[className, active && activeClass]} {onclick}
  >{@render children?.()}</a
>
