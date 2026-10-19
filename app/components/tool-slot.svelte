<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { service } from '../core/services.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy } from '../core/helpers.js';
  import Icon from './icon.svelte';
  import { TOOLS } from '../tools.js';

  // Where a route's tool appears on its own page. The tool itself lives in the
  // picture-in-picture service (see services/pip.js), so it can outlive this
  // page: this slot only asks for it and gives it a place to sit.
  class ToolSlot extends Component {
    pip = service('pip');

    constructor(args) {
      super(args);
      // Runs during render, before the PipLayer (after the outlet) reads the sessions.
      this.pip.enter(args.route, args.component);
      // Deferred: the decision (float or discard) must not change tracked state mid-teardown.
      registerDestructor(this, () =>
        queueMicrotask(() => this.pip.leave(args.route)),
      );
    }

    get session() {
      return this.pip.sessionFor(this.args.route);
    }

    get isAway() {
      return this.session && this.session.mode !== 'inline';
    }

    get tool() {
      return TOOLS.find((t) => t.route === this.args.route);
    }

    bind = modifier((element) => {
      const route = this.args.route;
      this.pip.bindSlot(route, element);
      return () => this.pip.unbindSlot(route, element);
    });
  }
</script>

<script>
  let args = $props();
  const self = new ToolSlot(args);
  onDestroy(() => destroy(self));
</script>

<div class="tool-slot" {@attach self.bind?.()}></div>
{#if truthy(self.isAway)}
  <div class="container">
    <div class="pip-placeholder pop-in">
      <Icon name="picture-in-picture" size={28} />
      <p
        ><strong>{self.tool?.label}</strong>
        is open in picture-in-picture.</p
      >
      <button
        type="button"
        class="btn active"
        onclick={(..._r) => self.pip?.expand(self.session, ..._r)}
        ><Icon name="maximize" size={13} /> Bring it back here</button
      >
    </div>
  </div>
{/if}
