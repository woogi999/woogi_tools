<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import { parseHex, toHex } from '../utils/color.js';

  // Colour swatch + editable hex code, kept in sync. Calls @onChange with "#RRGGBB".
  class ColourField extends Component {
    draft = $state.raw(null);
    // The value the draft was typed against; if the colour changes from outside, the draft is stale.
    draftFor = null;

    get hex() {
      const value = this.args.value.toUpperCase();
      return this.draft !== null && this.draftFor === value
        ? this.draft
        : value;
    }

    get swatchStyle() {
      return `background:${this.args.value};`;
    }

    pick = (event) => {
      this.draft = null;
      this.args.onChange(event.target.value.toUpperCase());
    };

    type = (event) => {
      const rgb = parseHex(event.target.value);
      const next = rgb
        ? toHex(rgb.r, rgb.g, rgb.b)
        : this.args.value.toUpperCase();
      this.draftFor = next;
      this.draft = event.target.value;
      if (rgb) this.args.onChange(next);
    };

    settle = () => {
      this.draft = null;
    };
  }
</script>

<script>
  let args = $props();
  const self = new ColourField(args);
  onDestroy(() => destroy(self));
</script>

<div class="colour-field {truthy(args.disabled) ? 'is-disabled' : ''}">
  <span class="colour-swatch" style={self.swatchStyle}>
    <input
      type="color"
      {@attach prop('value', () => args.value)}
      disabled={args.disabled}
      aria-label="{args.label} picker"
      oninput={self.pick}
    />
  </span>
  <input
    type="text"
    class="colour-hex"
    {@attach prop('value', () => self.hex)}
    maxlength="7"
    spellcheck="false"
    disabled={args.disabled}
    aria-label="{args.label} hex code"
    onblur={self.settle}
    oninput={self.type}
  />
</div>
