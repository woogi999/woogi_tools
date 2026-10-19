// Small helpers the templates use.

// The site's rule for a condition: an empty list counts as false.
export const truthy = (value) =>
  Array.isArray(value) ? value.length > 0 : Boolean(value);

// The first value that is not truthy (or the last), as `a && b` with truthy().
export function and(...values) {
  for (const value of values) if (!truthy(value)) return value;
  return values[values.length - 1];
}

// The first truthy value (or the last), as `a || b` with truthy().
export function or(...values) {
  for (const value of values) if (truthy(value)) return value;
  return values[values.length - 1];
}

// An event listener with options (passive, capture, once) or an event name
// that an `on...` attribute cannot spell: {@attach on('woogi:x', fn, opts)}.
export const on = (event, handler, options) => (element) => {
  if (!handler) return;
  element.addEventListener(event, handler, options);
  return () => element.removeEventListener(event, handler, options);
};

// A copy of `object` without `keys`: the props that are not the component's
// own arguments, for spreading onto its root element.
export function omit(object, keys) {
  const out = {};
  for (const key of Object.keys(object))
    if (!keys.includes(key)) out[key] = object[key];
  return out;
}

// Sets an element property the way the Ember templates did: every time the
// bound value is set (even to the value it had), and only when the element
// shows something else. So an input the person typed over gets the bound
// value back when the code sets it, as Number Base does when it clamps 42 to
// 36. Svelte's own `value={...}` skips that case.
//
//   <input {@attach prop('value', () => self.amount)} />
export const prop = (name, get) => (element) => {
  const value = get();
  const next =
    name === 'value' ? (value == null ? '' : String(value)) : Boolean(value);
  if (element[name] !== next) element[name] = next;
};
