import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

export default class CopyButton extends Component {
  @tracked copied = false;

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

  <template>
    <button
      type="button"
      class="btn copy-btn {{if this.copied "copied"}}"
      {{on "click" this.copy}}
    >
      {{if this.copied "Copied" "Copy"}}
    </button>
  </template>
}
