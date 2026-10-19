// Teardown for any object: a component, a service, a tool's saved state.
// Code registers what to undo with registerDestructor(); whoever owns the
// object calls destroy() once, and every destructor runs.

const destructors = new WeakMap();
const states = new WeakMap(); // object -> 'destroying' | 'destroyed'

export function registerDestructor(object, destructor) {
  // Too late to wait for destroy(): run it now, so nothing is left running.
  if (states.has(object)) {
    destructor(object);
    return destructor;
  }
  if (!destructors.has(object)) destructors.set(object, []);
  destructors.get(object).push(destructor);
  return destructor;
}

export function destroy(object) {
  if (!object || states.has(object)) return;
  states.set(object, 'destroying');
  try {
    object.willDestroy?.();
  } finally {
    const list = destructors.get(object) ?? [];
    destructors.delete(object);
    for (const destructor of list) {
      try {
        destructor(object);
      } catch (error) {
        console.error(error);
      }
    }
    states.set(object, 'destroyed');
  }
}

export const isDestroying = (object) => states.has(object);
export const isDestroyed = (object) => states.get(object) === 'destroyed';
