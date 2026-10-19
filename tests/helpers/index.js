// The tests drive the real app in the browser: visit a page, click, type, and
// look at the DOM. These helpers mount the app into #app-testing (see
// tests/index.html), and each one waits for the page to settle before it
// returns, so a test can look at the result straight away.
import { mount, unmount, tick, flushSync } from 'svelte';
import App from '../../app/app.svelte';
import { service, resetServices } from '../../app/core/services.js';
import { pendingPromises } from '../../app/core/waiters.js';

let app = null;

export const rootElement = () => document.querySelector('#app-testing');

// Waits until Svelte has nothing left to render and every promise handed to
// waitForPromise() (app/core/waiters.js) is done.
export async function settled() {
  for (let round = 0; round < 100; round++) {
    flushSync();
    await tick();
    const pending = pendingPromises();
    if (!pending.length) {
      // One more turn, for promise callbacks that just ran.
      await new Promise((resolve) => setTimeout(resolve, 0));
      flushSync();
      if (!pendingPromises().length) return;
      continue;
    }
    await Promise.allSettled(pending);
  }
}

export function setupApplicationTest(hooks) {
  hooks.beforeEach(function () {
    resetServices();
    this.owner = { lookup: (key) => service(key.replace(/^service:/, '')) };
  });
  hooks.afterEach(async function () {
    if (app) {
      unmount(app);
      app = null;
    }
    resetServices();
    rootElement().innerHTML = '';
    await settled();
  });
}

export async function visit(url) {
  const router = service('router');
  if (!app) {
    router.start(url);
    app = mount(App, { target: rootElement() });
  } else {
    await router.transitionTo(url);
  }
  await settled();
}

export const currentURL = () => service('router').currentURL;

export const getPageTitle = () => document.title;

export function find(selector) {
  return rootElement().querySelector(selector);
}

export function findAll(selector) {
  return [...rootElement().querySelectorAll(selector)];
}

function target(selectorOrElement) {
  const element =
    typeof selectorOrElement === 'string'
      ? find(selectorOrElement)
      : selectorOrElement;
  if (!element) throw new Error(`Element not found: ${selectorOrElement}`);
  return element;
}

const MOUSE = new Set([
  'click',
  'mousedown',
  'mouseup',
  'dblclick',
  'mouseenter',
  'mouseleave',
  'mousemove',
  'mouseout',
  'mouseover',
]);
const KEYS = new Set(['keydown', 'keyup', 'keypress']);

// An event the way the tests have always had them built: mouse and keyboard events
// are real ones, anything else is a plain Event with the options copied on.
function buildEvent(type, options = {}) {
  const init = { bubbles: true, cancelable: true, ...options };
  if (MOUSE.has(type)) return new MouseEvent(type, { view: window, ...init });
  if (KEYS.has(type)) return new KeyboardEvent(type, init);
  const event = new Event(type, init);
  for (const [key, value] of Object.entries(options)) {
    if (key === 'bubbles' || key === 'cancelable') continue;
    Object.defineProperty(event, key, { value, configurable: true });
  }
  return event;
}

function fire(element, type, options) {
  const event = buildEvent(type, options);
  element.dispatchEvent(event);
  return event;
}

const focusable = (element) =>
  element.matches?.(
    'input, select, textarea, button, a[href], [tabindex], [contenteditable]',
  ) && !element.disabled;

function focus(element) {
  if (!focusable(element) || document.activeElement === element) return;
  element.focus();
}

export async function click(selectorOrElement, options = {}) {
  const element = target(selectorOrElement);
  const down = fire(element, 'mousedown', options);
  if (!down.defaultPrevented) focus(element);
  fire(element, 'mouseup', options);
  fire(element, 'click', options);
  await settled();
}

export async function fillIn(selectorOrElement, text) {
  const element = target(selectorOrElement);
  focus(element);
  if (element.isContentEditable) element.innerHTML = text;
  else element.value = text;
  fire(element, 'input');
  fire(element, 'change');
  await settled();
}

export async function triggerEvent(selectorOrElement, type, options = {}) {
  const element = target(selectorOrElement);
  if (type === 'change' && options.files) {
    Object.defineProperty(element, 'files', {
      value: options.files,
      configurable: true,
    });
    const { files: _files, ...rest } = options;
    fire(element, type, rest);
  } else fire(element, type, options);
  await settled();
}

export async function triggerKeyEvent(
  selectorOrElement,
  type,
  key,
  modifiers = {},
) {
  const element = target(selectorOrElement);
  const keyCode =
    typeof key === 'number'
      ? key
      : key.length === 1
        ? key.toUpperCase().charCodeAt(0)
        : undefined;
  fire(element, type, {
    key: typeof key === 'number' ? String.fromCharCode(key) : key,
    keyCode,
    which: keyCode,
    ...modifiers,
  });
  await settled();
}

export async function waitUntil(
  callback,
  { timeout = 1000, timeoutMessage } = {},
) {
  const start = Date.now();
  for (;;) {
    const value = callback();
    if (value) return value;
    if (Date.now() - start > timeout)
      throw new Error(timeoutMessage ?? 'waitUntil timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
