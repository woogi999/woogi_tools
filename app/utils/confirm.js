import { tracked } from '@glimmer/tracking';

// The site's one confirmation prompt: the hold-to-confirm dialog
// (components/hold-confirm.gjs), opened from anywhere instead of window.confirm.
//
//   if (!(await askConfirm({ title: 'Delete this note?', message: '…', confirmLabel: 'Hold to delete' }))) return;
//
// Options: title, message, confirmLabel, cancelLabel, holdMs. Resolves true once held, false if cancelled.
// A single <ConfirmHost /> in the application template shows it.

class ConfirmState {
  @tracked request = null;
}

export const confirmState = new ConfirmState();

export function askConfirm(options) {
  // A newer prompt replaces one still open; the old one counts as cancelled.
  confirmState.request?.answer(false);
  return new Promise((resolve) => {
    const request = {
      cancelLabel: 'Cancel',
      ...options,
      answer(value) {
        if (confirmState.request === request) confirmState.request = null;
        resolve(value);
      },
    };
    confirmState.request = request;
  });
}
