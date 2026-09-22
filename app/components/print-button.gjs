import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import Icon from './icon';
import { printFile, canPrint } from '../utils/print';

// A Print button for anything a tool has made.
//
//   @blob / @file: what to print, @url: a blob/data URL of it, or
//   @get: () => Blob|File|Promise, for results made on demand
//   @name:  the file name (decides how it's printed when there's no type)
//   @label: the button's text (default "Print")

export default class PrintButton extends Component {
  @tracked busy = false;

  get name() {
    return this.args.name ?? this.args.file?.name ?? '';
  }

  get shown() {
    // Made on demand: all we can go on is the name.
    if (this.args.get) return canPrint('', this.name);
    if (this.args.url) return canPrint('', this.name);
    const blob = this.args.blob ?? this.args.file;
    return Boolean(blob) && canPrint(blob.type, this.name);
  }

  // A blob: URL is this page's own memory, so reading it back costs nothing.
  async blobOf() {
    if (this.args.get) return this.args.get();
    if (this.args.blob ?? this.args.file)
      return this.args.blob ?? this.args.file;
    if (!this.args.url) return null;
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- reading back a blob: URL this page made, not app data
    const response = await fetch(this.args.url);
    return response.blob();
  }

  print = async () => {
    if (this.busy) return;
    this.busy = true;
    try {
      const blob = await this.blobOf();
      if (blob) await printFile(blob, { name: this.name || blob.name || '' });
    } finally {
      this.busy = false;
    }
  };

  <template>
    {{#if this.shown}}
      <button
        type="button"
        class="btn"
        title="Print this"
        disabled={{this.busy}}
        {{on "click" this.print}}
      >
        <Icon @name="printer" @size={{13}} />
        {{if @label @label "Print"}}
      </button>
    {{/if}}
  </template>
}
