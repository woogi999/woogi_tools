import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Icon from './icon';

// Picks a picture for the Progress Bar Maker: a fill, a segment's shape, a
// pattern. It's kept in the design as a data URL, so the design carries its
// own pictures wherever it's saved.
// Args: @src (current), @label, @onPick(dataUrl | null).
export default class PbImagePick extends Component {
  @tracked error = null;

  get thumbStyle() {
    return htmlSafe(
      this.args.src ? `background-image:url("${this.args.src}")` : '',
    );
  }

  pick = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.error = `${file.name} isn’t a picture`;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.error = null;
      this.args.onPick(reader.result);
    };
    reader.onerror = () => (this.error = `Couldn’t read ${file.name}`);
    reader.readAsDataURL(file);
  };

  clear = () => this.args.onPick(null);

  <template>
    <div class="pb-image-pick">
      <span class="pb-image-thumb checkerboard" style={{this.thumbStyle}}>
        {{#unless @src}}<Icon @name="image" @size={{16}} />{{/unless}}
      </span>
      <label class="btn pb-image-btn" title={{@label}}>
        <Icon @name="upload" @size={{12}} />
        {{if @src "Change picture" "Choose a picture"}}
        <input
          type="file"
          accept="image/*"
          class="sr-only"
          {{on "change" this.pick}}
        />
      </label>
      {{#if @src}}
        <button
          type="button"
          class="btn pb-icon-btn"
          title="Remove the picture"
          aria-label="Remove the picture"
          {{on "click" this.clear}}
        ><Icon @name="x" @size={{12}} /></button>
      {{/if}}
      {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
    </div>
  </template>
}
