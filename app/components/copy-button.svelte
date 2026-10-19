<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  class CopyButton extends Component {
    copied = $state.raw(false);

    copy = async () => {
      try {
        await navigator.clipboard.writeText(this.args.value);
      } catch {
        // clipboard permission denied, nothing more we can do here
      }
      this.copied = true;
      setTimeout(() => {
        this.copied = false;
      }, 1200);
    };

    get label() {
      return this.copied ? 'Copied' : (this.args.label ?? 'Copy');
    }
  }
</script>

<script>
  let args = $props();
  const self = new CopyButton(args);
  onDestroy(() => destroy(self));
</script>

<button
  type="button"
  class="btn copy-btn {truthy(self.copied) ? 'copied' : ''}"
  onclick={self.copy}
>
  {self.label}
</button>
