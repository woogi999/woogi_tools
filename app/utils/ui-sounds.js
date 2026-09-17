import { sfx } from './sound';

// Sounds for the whole site, wired once at the top of the page instead of in
// every component: a soft tick when the mouse moves onto something you can
// press, a click when you press it, a switch sound for toggles, a typing tick
// in search boxes, and card sounds on the home page's tool cards.
//
// Anything inside [data-sound="off"] stays quiet (the games' 3D tables and
// boards make their own sounds).

const PRESSABLE =
  'button, a[href], [role="button"], [role="tab"], [role="radio"], summary, select, label.btn, label.qr-switch, .home-chip';
const SEARCH =
  '.home-search-input, .sidebar-search input, input[type="search"], .command-palette input';

let installed = false;

export function installUiSounds() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  let hovered = null;

  const quiet = (el) =>
    !el ||
    el.closest('[data-sound="off"]') ||
    el.matches(':disabled, [aria-disabled="true"]');

  document.addEventListener(
    'pointerover',
    (event) => {
      if (event.pointerType !== 'mouse') return;
      const card = event.target.closest?.('.tool-card');
      const target = card ?? event.target.closest?.(PRESSABLE);
      if (target === hovered) return;
      hovered = target;
      if (!target || quiet(target)) return;
      sfx(card ? 'cards.hover' : 'ui.hover');
    },
    { passive: true },
  );

  document.addEventListener(
    'click',
    (event) => {
      const el = event.target;
      if (!el?.closest || quiet(el)) return;
      // A checkbox or switch: its label's click and the input's own both arrive; answer the input's.
      if (el.matches('input[type="checkbox"], input[type="radio"]')) {
        sfx('ui.toggle');
        return;
      }
      if (el.closest('label.qr-switch, label.settings-tool-item')) return;
      if (el.closest('.tool-card')) {
        sfx('cards.place');
        return;
      }
      if (el.closest(PRESSABLE)) sfx('ui.click');
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    'input',
    (event) => {
      const el = event.target;
      if (el?.matches?.(SEARCH) && !quiet(el)) sfx('ui.type');
      else if (el?.matches?.('input[type="range"]') && !quiet(el))
        sfx('ui.tick');
    },
    { passive: true },
  );
}
