import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import ColourField from './colour-field';
import AvatarPortrait from './avatar-portrait';
import { HAIR_STYLES, EYES, MOUTHS, EXTRAS, SKIN_TONES, HAIR_COLORS, SHIRT_COLORS, randomAvatar, normaliseAvatar } from '../utils/avatar';

const eq = (a, b) => a === b;
const swatch = (color) => htmlSafe(`background: ${color}`);

// The avatar maker in the Uno lobby: a 3D preview you can spin, plus every option.
export default class AvatarEditor extends Component {
  hairStyles = HAIR_STYLES;
  eyes = EYES;
  mouths = MOUTHS;
  extras = EXTRAS;
  colorRows = [
    { key: 'skin', label: 'Skin', presets: SKIN_TONES },
    { key: 'hairColor', label: 'Hair', presets: HAIR_COLORS },
    { key: 'shirt', label: 'Shirt', presets: SHIRT_COLORS },
  ];

  // Falls back to the flat portrait if WebGL isn't available.
  @tracked noWebGL = false;

  get avatar() {
    return normaliseAvatar(this.args.avatar);
  }

  // Takes no arguments on purpose: it sets up the renderer once, and `follow` feeds it changes.
  preview = modifier((canvas) => {
    let handle = null;
    let cancelled = false;
    import('../lazy/uno-scene')
      .then(({ createAvatarPreview }) => {
        if (cancelled) return;
        handle = createAvatarPreview(canvas);
        handle.setAvatar(this.avatar);
        this.previewHandle = handle;
      })
      .catch(() => (this.noWebGL = true));
    return () => {
      cancelled = true;
      handle?.dispose();
      this.previewHandle = null;
    };
  });

  // Keeps the 3D model in step without rebuilding the renderer on every change.
  follow = modifier((_element, [avatar]) => {
    this.previewHandle?.setAvatar(avatar);
  });

  update = (key, value) => this.args.onChange({ ...this.avatar, [key]: value });
  toggleBlush = (event) => this.update('blush', event.target.checked);
  shuffle = () => this.args.onChange(randomAvatar());

  <template>
    <div class="avatar-editor">
      <div class="avatar-stage" {{this.follow this.avatar}}>
        {{#if this.noWebGL}}
          <AvatarPortrait @avatar={{this.avatar}} @size={{150}} />
        {{else}}
          <canvas class="avatar-canvas" aria-label="Your avatar. Drag to turn it." {{this.preview}}></canvas>
        {{/if}}
        <button type="button" class="btn avatar-shuffle" {{on "click" this.shuffle}}><Icon @name="shuffle" @size={{13}} /> Surprise me</button>
      </div>

      <div class="avatar-options">
        <OptionRow @label="Hair" @options={{this.hairStyles}} @value={{this.avatar.hair}} @onPick={{fn this.update "hair"}} />
        <OptionRow @label="Eyes" @options={{this.eyes}} @value={{this.avatar.eyes}} @onPick={{fn this.update "eyes"}} />
        <OptionRow @label="Mouth" @options={{this.mouths}} @value={{this.avatar.mouth}} @onPick={{fn this.update "mouth"}} />
        <OptionRow @label="Extra" @options={{this.extras}} @value={{this.avatar.extra}} @onPick={{fn this.update "extra"}} />

        {{#each this.colorRows as |row|}}
          <div class="avatar-color-row">
            <span class="qr-label is-muted">{{row.label}}</span>
            <div class="avatar-swatches" role="group" aria-label="{{row.label}} colours">
              {{#each row.presets as |color|}}
                <button type="button" class="avatar-swatch {{if (eq (pick this.avatar row.key) color) 'active'}}" style={{swatch color}} aria-label={{color}} {{on "click" (fn this.update row.key color)}}></button>
              {{/each}}
            </div>
            <ColourField @value={{pick this.avatar row.key}} @label="{{row.label}} colour" @onChange={{fn this.update row.key}} />
          </div>
        {{/each}}

        <label class="qr-switch">
          <input type="checkbox" role="switch" checked={{this.avatar.blush}} aria-checked={{if this.avatar.blush "true" "false"}} {{on "change" this.toggleBlush}} />
          <span class="qr-switch-track" aria-hidden="true"></span>
          Rosy cheeks
        </label>
      </div>
    </div>
  </template>
}

function pick(object, key) {
  return object[key];
}

const OptionRow = <template>
  <div class="avatar-option-row">
    <span class="qr-label is-muted">{{@label}}</span>
    <div class="avatar-chips" role="group" aria-label={{@label}}>
      {{#each @options as |o|}}
        <button type="button" class="home-chip {{if (eq @value o.id) 'active'}}" aria-pressed={{if (eq @value o.id) "true" "false"}} {{on "click" (fn @onPick o.id)}}>{{o.label}}</button>
      {{/each}}
    </div>
  </div>
</template>;
