import { actionForKey, actionForPad, isTyping } from './keybinds';
import { pushPadHandler } from './gamepad';

// Wires a game's keyboard and controller bindings (utils/keybinds.js) to its actions.
//
//   const stop = listenForActions('woono', {
//     active: () => this.mode === 'playing',
//     onAction: (action, { repeat, source }) => true if handled,
//   });
//
// Keys are ignored while typing (chat, rule boxes), and everything is ignored while `active()` is false,
// so the site's own controls take over again in the lobby or once the game is minimised.

export function listenForActions(game, { active, onAction }) {
  const onKey = (event) => {
    if (event.defaultPrevented || isTyping(event) || !active()) return;
    // A dialog on top (hold to confirm, the command palette) has the keyboard.
    if (document.querySelector('dialog[open]')) return;
    const action = actionForKey(game, event);
    if (
      action &&
      onAction(action, { repeat: event.repeat, source: 'key', event }) !== false
    )
      event.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  const release = pushPadHandler((button, { down, repeat }) => {
    if (!down || !active() || document.querySelector('dialog[open]'))
      return false;
    const action = actionForPad(game, button);
    if (!action) return false;
    return onAction(action, { repeat, source: 'pad' }) !== false;
  });
  return () => {
    window.removeEventListener('keydown', onKey);
    release();
  };
}

// Whether a game's element is really on screen (not minimised to a picture-in-picture pill).
export const onScreen = (element) =>
  Boolean(element?.isConnected) && element.offsetParent !== null;

// Opens a game's floating chat and puts the cursor in it.
export function openChat(root = document) {
  const chat = root.querySelector('.game-chat.is-floating');
  if (!chat) return;
  if (!chat.classList.contains('is-open'))
    chat.querySelector('.game-chat-toggle')?.click();
  requestAnimationFrame(() =>
    chat.querySelector('.game-chat-form input')?.focus(),
  );
}
