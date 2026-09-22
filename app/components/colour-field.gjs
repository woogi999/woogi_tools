import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { parseHex, toHex } from '../utils/color';

// Colour swatch + editable hex code, kept in sync. Calls @onChange with "#RRGGBB".
export default class ColourField extends Component {
  @tracked draft = null;
  // The value the draft was typed against; if the colour changes from outside, the draft is stale.
  draftFor = null;

  get hex() {
    const value = this.args.value.toUpperCase();
    return this.draft !== null && this.draftFor === value ? this.draft : value;
  }

  get swatchStyle() {
    return htmlSafe(`background:${this.args.value};`);
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

  <template>
    <div class="colour-field {{if @disabled 'is-disabled'}}">
      <span class="colour-swatch" style={{this.swatchStyle}}>
        <input
          type="color"
          value={{@value}}
          disabled={{@disabled}}
          aria-label="{{@label}} picker"
          {{on "input" this.pick}}
        />
      </span>
      <input
        type="text"
        class="colour-hex"
        value={{this.hex}}
        maxlength="7"
        spellcheck="false"
        disabled={{@disabled}}
        aria-label="{{@label}} hex code"
        {{on "input" this.type}}
        {{on "blur" this.settle}}
      />
    </div>
  </template>
}
