<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import { printFile, canPrint } from '../utils/print.js';

  // A Print button for anything a tool has made.
  //
  //   @blob / @file: what to print, @url: a blob/data URL of it, or
  //   @get: () => Blob|File|Promise, for results made on demand
  //   @name:  the file name (decides how it's printed when there's no type)
  //   @label: the button's text (default "Print")

  class PrintButton extends Component {
    busy = $state.raw(false);

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
  }
</script>

<script>
  let args = $props();
  const self = new PrintButton(args);
  onDestroy(() => destroy(self));
</script>

{#if truthy(self.shown)}
  <button
    type="button"
    class="btn"
    title="Print this"
    disabled={self.busy}
    onclick={self.print}
  >
    <Icon name="printer" size={13} />
    {truthy(args.label) ? args.label : 'Print'}
  </button>
{/if}
