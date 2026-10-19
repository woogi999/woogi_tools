<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import HoldConfirm from './hold-confirm.svelte';
  import { confirmState } from '../utils/confirm.svelte.js';

  // Shows whichever prompt askConfirm() (utils/confirm.js) has open. Rendered once, in the application template.
  class ConfirmHost extends Component {
    state = confirmState;

    confirm = () => this.state.request?.answer(true);
    cancel = () => this.state.request?.answer(false);
  }
</script>

<script>
  let args = $props();
  const self = new ConfirmHost(args);
  onDestroy(() => destroy(self));
</script>

{#if truthy(self.state?.request)}
  {#if true}{@const r = self.state?.request}
    <HoldConfirm
      title={r?.title}
      message={r?.message}
      confirmLabel={r?.confirmLabel}
      cancelLabel={r?.cancelLabel}
      holdMs={r?.holdMs}
      onConfirm={self.confirm}
      onCancel={self.cancel}
    />
  {/if}
{/if}
