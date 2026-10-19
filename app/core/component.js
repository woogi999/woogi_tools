import { isDestroyed, isDestroying } from './destroyable.js';

// The base for class components. A .svelte file makes one instance of its
// class with the component's props as `args`, and destroys it on unmount:
//
//   let args = $props();
//   const self = new ThingPage(args);
//   onDestroy(() => destroy(self));
//
// Reactive fields are `$state.raw(...)` class fields. `args` is the live props
// object, so `this.args.x` always reads the current value.
export default class Component {
  constructor(args) {
    this.args = args ?? {};
  }

  // Called once by destroy(), before the registered destructors.
  willDestroy() {}

  get isDestroying() {
    return isDestroying(this);
  }

  get isDestroyed() {
    return isDestroyed(this);
  }
}
