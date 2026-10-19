// Promises the tests wait for before they look at the page (see
// tests/helpers/index.js, settled()). In the app it only keeps a list.

const pending = new Set();

export function waitForPromise(promise) {
  pending.add(promise);
  const done = () => pending.delete(promise);
  Promise.resolve(promise).then(done, done);
  return promise;
}

export const pendingPromises = () => [...pending];
