// Class fields declared with $state / $state.raw tell their readers about
// every assignment, even of the value they already hold, the way Ember's
// @tracked did. Plain Svelte skips an assignment of the same value, and the
// site relies on the Ember rule in places: a number field clamped back to the
// value it had (Number Base's base, 2 to 36) must still put that value back
// into the input the person typed over.
//
// Svelte compiles such a field to `#name = $.state(value)` (wrapped in
// `$.tag(..., 'Class.name')` in development) and skips a write when
// `source.equals(value)` is true. This replaces that check for class fields
// only. Local `let x = $state()` variables keep Svelte's own rule.
//
// tests/unit/tracked-fields-test.js fails if a Svelte update changes the
// compiled shape and this stops applying.
const FIELD = /(#[A-Za-z_$][\w$]* = (?:\$\.tag\()?)\$\.state\(/g;

// A function declaration, so it exists before the module body runs (some
// modules make instances at the top level).
const HELPER = `
function __tracked_state(value) {
  const source = $.state(value);
  source.equals = () => false;
  return source;
}
`;

export default function trackedFields() {
  return {
    name: 'woogi-tracked-fields',
    enforce: 'post',
    transform(code, id) {
      if (!/\.svelte(\.js)?(\?|$)/.test(id) || !code.includes('$.state('))
        return null;
      let found = false;
      const out = code.replace(FIELD, (_, head) => {
        found = true;
        return `${head}__tracked_state(`;
      });
      if (!found) return null;
      // `$` is the svelte/internal/client namespace the compiled module imports.
      return { code: out + HELPER, map: null };
    },
  };
}
