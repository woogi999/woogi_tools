import Service from '@ember/service';

// A file dropped on the home page's search bar, carried over to the tool you
// pick from the results. The app shell feeds it into the tool's file input
// once the tool is on screen, as if you had chosen it there.
export default class HandoffService extends Service {
  file = null;

  take() {
    const file = this.file;
    this.file = null;
    return file;
  }

  // Puts the file into the first file input on the page and fires `change`,
  // which is the same path a picked file takes. Returns whether one was found.
  feed(root = document.querySelector('main')) {
    const file = this.take();
    const input = root?.querySelector('input[type="file"]');
    if (!file || !input) return false;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
}
