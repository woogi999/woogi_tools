export default {
  compilerOptions: {
    // Runes everywhere, including files that do not use one.
    runes: true,
    // Keep whitespace exactly as written, the way the Ember templates did.
    // By default Svelte drops the spaces at the start and end of {#if} and
    // {#each} blocks, which ran words together ("1 · 16:9" became "1· 16:9").
    preserveWhitespace: true,
    // A class component gets the whole props object: `new ThingPage(args)`.
    // That object is a live proxy that never changes identity, so Svelte's
    // "only captures the initial value" warning is a false alarm for it.
    // Every other case of the warning still shows.
    warningFilter: (warning) =>
      !(
        warning.code === 'state_referenced_locally' &&
        /new [A-Z]\w*\(args\)/.test(warning.frame ?? '')
      ),
  },
};
