import { flushSync } from 'svelte';

// A class with a reactive field, as every converted component has, for
// tracked-fields-test.js.
class Holder {
  value = $state.raw(1);
}

// How many times an effect that reads `holder.value` runs when the field is
// first set to the same value, then to a new one.
export function countRuns() {
  const holder = new Holder();
  const runs = [];
  const stop = $effect.root(() => {
    $effect(() => {
      runs.push(holder.value);
    });
  });
  flushSync();
  holder.value = 1;
  flushSync();
  holder.value = 2;
  flushSync();
  stop();
  return runs;
}
