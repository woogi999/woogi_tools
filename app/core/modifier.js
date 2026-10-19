import { untrack } from 'svelte';

// DOM setup tied to an element's life: `fn(element, positional, named)` runs
// when the element appears and may return a cleanup function.
//
//   watch = modifier((element, [route]) => { ...; return () => ...; });
//   <aside {@attach self.watch([route])}>
//
// It runs again (after its cleanup) only when the arguments in the template
// change. State read inside `fn` does not make it run again, so a modifier
// can read and write the component's fields freely.
export function modifier(fn) {
  return (positional = [], named = {}) =>
    (element) =>
      untrack(() => fn(element, positional, named));
}
