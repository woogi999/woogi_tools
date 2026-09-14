import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import ColourField from './colour-field';
import AvatarPortrait from './avatar-portrait';
import { HAIR_STYLES, EYES, BROWS, NOSES, MOUTHS, FACE_SLIDERS, TOPS, PATTERNS, BOTTOMS, SHOES, HATS, EYEWEAR, MASKS, NECKWEAR, BACKS, PIERCINGS, MARKS, SKIN_TONES, HAIR_COLORS, EYE_COLORS, SHIRT_COLORS, ACCENT_COLORS, PANTS_COLORS, SHOE_COLORS, HAT_COLORS, randomAvatar, playerAvatar } from '../utils/avatar';
import { loadSaves, storeSaves, MAX_SAVES } from '../utils/avatar-saves';

const eq = (a, b) => a === b;
const has = (list, id) => list.includes(id);
const swatch = (color) => htmlSafe(`background: ${color}`);

const TABS = [
  { id: 'face', label: 'Face' },
  { id: 'hair', label: 'Hair' },
  { id: 'clothes', label: 'Clothes' },
  { id: 'extras', label: 'Accessories' },
  { id: 'saved', label: 'Saved' },
];
const FACE_COLOURS = [
  { key: 'skin', label: 'Skin', presets: SKIN_TONES },
  { key: 'eyeColor', label: 'Eyes', presets: EYE_COLORS },
];
const HAIR_COLOURS = [{ key: 'hairColor', label: 'Hair colour', presets: HAIR_COLORS }];
const CLOTHES_COLOURS = [
  { key: 'shirt', label: 'Top', presets: SHIRT_COLORS },
  { key: 'accent', label: 'Pattern and details', presets: ACCENT_COLORS },
  { key: 'pants', label: 'Bottoms', presets: PANTS_COLORS },
  { key: 'shoeColor', label: 'Shoes', presets: SHOE_COLORS },
];
const EXTRA_COLOURS = [{ key: 'hatColor', label: 'Hat and hair accessories', presets: HAT_COLORS }];

// The avatar maker, in game lobbies and in Settings: a 3D preview you can
// spin, every option in tabs, and saved looks.
export default class AvatarEditor extends Component {
  tabs = TABS;
  hairStyles = HAIR_STYLES;
  eyes = EYES;
  brows = BROWS;
  noses = NOSES;
  mouths = MOUTHS;
  sliders = FACE_SLIDERS;
  topsList = TOPS;
  patterns = PATTERNS;
  bottoms = BOTTOMS;
  shoes = SHOES;
  hats = HATS;
  eyewear = EYEWEAR;
  masks = MASKS;
  neckwear = NECKWEAR;
  backs = BACKS;
  piercings = PIERCINGS;
  marks = MARKS;
  faceColours = FACE_COLOURS;
  hairColours = HAIR_COLOURS;
  clothesColours = CLOTHES_COLOURS;
  extraColours = EXTRA_COLOURS;
  maxSaves = MAX_SAVES;

  // Falls back to the flat portrait if WebGL isn't available.
  @tracked noWebGL = false;
  @tracked tab = 'face';
  @tracked saves = loadSaves();

  get avatar() {
    return playerAvatar(this.args.avatar);
  }

  get canSave() {
    return this.saves.length < MAX_SAVES;
  }

  get nudged() {
    return FACE_SLIDERS.some((s) => this.avatar[s.key] !== 0);
  }

  // Takes no arguments on purpose: it sets up the renderer once, and `follow` feeds it changes.
  preview = modifier((canvas) => {
    let handle = null;
    let cancelled = false;
    import('../lazy/avatar-model')
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

  change(avatar) {
    this.args.onChange(playerAvatar(avatar));
  }

  setTab = (id) => (this.tab = id);
  update = (key, value) => this.change({ ...this.avatar, [key]: value });
  toggle = (key, event) => this.update(key, event.target.checked);
  toggleIn = (key, id) => {
    const list = this.avatar[key];
    this.update(key, list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };
  nudge = (slider, step) => this.update(slider.key, Math.max(slider.min, Math.min(slider.max, this.avatar[slider.key] + step)));
  slide = (slider, event) => this.update(slider.key, Number(event.target.value));
  resetPositions = () => this.change({ ...this.avatar, ...Object.fromEntries(FACE_SLIDERS.map((s) => [s.key, 0])) });
  shuffle = () => this.change(randomAvatar());

  saveLook = () => {
    if (!this.canSave) return;
    const label = `${this.args.name?.trim() || 'Look'} ${this.saves.length + 1}`;
    this.saves = [...this.saves, { id: Date.now().toString(36), label, avatar: this.avatar }];
    storeSaves(this.saves);
  };

  wear = (save) => this.change(save.avatar);

  forget = (save) => {
    this.saves = this.saves.filter((s) => s.id !== save.id);
    storeSaves(this.saves);
  };

  rename = (save, event) => {
    const label = event.target.value.slice(0, 24) || save.label;
    this.saves = this.saves.map((s) => (s.id === save.id ? { ...s, label } : s));
    storeSaves(this.saves);
  };

  <template>
    <div class="avatar-editor">
      <div class="avatar-stage" {{this.follow this.avatar}}>
        {{#if this.noWebGL}}
          <AvatarPortrait @avatar={{this.avatar}} @size={{150}} />
        {{else}}
          <canvas class="avatar-canvas" aria-label="Your avatar. Drag to turn it." {{this.preview}}></canvas>
        {{/if}}
        <div class="avatar-stage-actions">
          <button type="button" class="btn" {{on "click" this.shuffle}}><Icon @name="shuffle" @size={{13}} /> Surprise me</button>
          <button type="button" class="btn" disabled={{if this.canSave false true}} {{on "click" this.saveLook}}><Icon @name="star" @size={{13}} /> Save look</button>
        </div>
      </div>

      <div class="avatar-options">
        <div class="math-tabs avatar-tabs" role="tablist" aria-label="Avatar options">
          {{#each this.tabs as |t|}}
            <button type="button" role="tab" class="qr-tab {{if (eq this.tab t.id) 'active'}}" aria-selected={{if (eq this.tab t.id) "true" "false"}} {{on "click" (fn this.setTab t.id)}}>{{t.label}}{{#if (eq t.id "saved")}} ({{this.saves.length}}){{/if}}</button>
          {{/each}}
        </div>

        {{#if (eq this.tab "face")}}
          <OptionRow @label="Eyes" @options={{this.eyes}} @value={{this.avatar.eyes}} @onPick={{fn this.update "eyes"}} />
          <OptionRow @label="Eyebrows" @options={{this.brows}} @value={{this.avatar.brows}} @onPick={{fn this.update "brows"}} />
          <OptionRow @label="Nose" @options={{this.noses}} @value={{this.avatar.nose}} @onPick={{fn this.update "nose"}} />
          <OptionRow @label="Mouth" @options={{this.mouths}} @value={{this.avatar.mouth}} @onPick={{fn this.update "mouth"}} />
          <MultiRow @label="Marks" @options={{this.marks}} @values={{this.avatar.marks}} @onToggle={{fn this.toggleIn "marks"}} />
          <div class="avatar-option-row">
            <span class="qr-label is-muted">Positions</span>
            <div class="avatar-sliders">
              {{#each this.sliders as |slider|}}
                <div class="avatar-slider">
                  <span class="avatar-slider-label">{{slider.label}}</span>
                  <button type="button" class="qr-icon-btn" aria-label="{{slider.label}}: less" {{on "click" (fn this.nudge slider -1)}}><Icon @name="minus" @size={{12}} /></button>
                  <input type="range" min={{slider.min}} max={{slider.max}} step="1" value={{pick this.avatar slider.key}} aria-label={{slider.label}} {{on "input" (fn this.slide slider)}} />
                  <button type="button" class="qr-icon-btn" aria-label="{{slider.label}}: more" {{on "click" (fn this.nudge slider 1)}}><Icon @name="plus" @size={{12}} /></button>
                  <span class="avatar-slider-value">{{pick this.avatar slider.key}}</span>
                </div>
              {{/each}}
            </div>
            <button type="button" class="btn avatar-reset" disabled={{if this.nudged false true}} {{on "click" this.resetPositions}}><Icon @name="rotate-ccw" @size={{13}} /> Reset positions</button>
          </div>
          <ColourRows @rows={{this.faceColours}} @avatar={{this.avatar}} @onPick={{this.update}} />
        {{else if (eq this.tab "hair")}}
          <OptionRow @label="Hairstyle" @options={{this.hairStyles}} @value={{this.avatar.hair}} @onPick={{fn this.update "hair"}} />
          <label class="qr-switch">
            <input type="checkbox" role="switch" checked={{this.avatar.ahoge}} aria-checked={{if this.avatar.ahoge "true" "false"}} {{on "change" (fn this.toggle "ahoge")}} />
            <span class="qr-switch-track" aria-hidden="true"></span>
            Stray strand
          </label>
          <ColourRows @rows={{this.hairColours}} @avatar={{this.avatar}} @onPick={{this.update}} />
        {{else if (eq this.tab "clothes")}}
          <OptionRow @label="Top" @options={{this.topsList}} @value={{this.avatar.top}} @onPick={{fn this.update "top"}} />
          <OptionRow @label="Pattern" @options={{this.patterns}} @value={{this.avatar.pattern}} @onPick={{fn this.update "pattern"}} />
          {{#unless (eq this.avatar.top "dress")}}
            <OptionRow @label="Bottoms" @options={{this.bottoms}} @value={{this.avatar.bottom}} @onPick={{fn this.update "bottom"}} />
          {{/unless}}
          <OptionRow @label="Shoes" @options={{this.shoes}} @value={{this.avatar.shoes}} @onPick={{fn this.update "shoes"}} />
          <ColourRows @rows={{this.clothesColours}} @avatar={{this.avatar}} @onPick={{this.update}} />
        {{else if (eq this.tab "extras")}}
          <OptionRow @label="Head" @options={{this.hats}} @value={{this.avatar.hat}} @onPick={{fn this.update "hat"}} />
          <OptionRow @label="Eyewear" @options={{this.eyewear}} @value={{this.avatar.eyewear}} @onPick={{fn this.update "eyewear"}} />
          <OptionRow @label="Mask" @options={{this.masks}} @value={{this.avatar.mask}} @onPick={{fn this.update "mask"}} />
          <OptionRow @label="Neck" @options={{this.neckwear}} @value={{this.avatar.neck}} @onPick={{fn this.update "neck"}} />
          <OptionRow @label="Back" @options={{this.backs}} @value={{this.avatar.back}} @onPick={{fn this.update "back"}} />
          <MultiRow @label="Piercings" @options={{this.piercings}} @values={{this.avatar.piercings}} @onToggle={{fn this.toggleIn "piercings"}} />
          <ColourRows @rows={{this.extraColours}} @avatar={{this.avatar}} @onPick={{this.update}} />
          <p class="tool-hint">Scarves, ties, capes and backpacks use the pattern and details colour from Clothes.</p>
        {{else}}
          {{#if this.saves.length}}
            <ul class="avatar-saves">
              {{#each this.saves key="id" as |save|}}
                <li class="avatar-save">
                  <button type="button" class="avatar-save-wear" aria-label="Wear {{save.label}}" title="Wear this look" {{on "click" (fn this.wear save)}}>
                    <AvatarPortrait @avatar={{save.avatar}} @size={{56}} />
                  </button>
                  <input type="text" class="avatar-save-name" maxlength="24" value={{save.label}} aria-label="Name of this look" {{on "change" (fn this.rename save)}} />
                  <button type="button" class="qr-icon-btn" aria-label="Delete {{save.label}}" {{on "click" (fn this.forget save)}}><Icon @name="trash-2" @size={{13}} /></button>
                </li>
              {{/each}}
            </ul>
          {{else}}
            <p class="tool-hint">No saved looks yet. Press Save look to keep this one, then tap a saved portrait to wear it again.</p>
          {{/if}}
          <p class="tool-hint">Up to {{this.maxSaves}} looks, kept in this browser.</p>
        {{/if}}
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

// Chips you can switch on in any combination.
const MultiRow = <template>
  <div class="avatar-option-row">
    <span class="qr-label is-muted">{{@label}} <span class="tool-hint">(pick any)</span></span>
    <div class="avatar-chips" role="group" aria-label={{@label}}>
      {{#each @options as |o|}}
        <button type="button" class="home-chip {{if (has @values o.id) 'active'}}" aria-pressed={{if (has @values o.id) "true" "false"}} {{on "click" (fn @onToggle o.id)}}>{{o.label}}</button>
      {{/each}}
    </div>
  </div>
</template>;

// Preset swatches plus an editable hex field for each colour.
const ColourRows = <template>
  {{#each @rows as |row|}}
    <div class="avatar-color-row">
      <span class="qr-label is-muted">{{row.label}}</span>
      <div class="avatar-swatches" role="group" aria-label="{{row.label}} colours">
        {{#each row.presets as |color|}}
          <button type="button" class="avatar-swatch {{if (eq (pick @avatar row.key) color) 'active'}}" style={{swatch color}} aria-label={{color}} {{on "click" (fn @onPick row.key color)}}></button>
        {{/each}}
      </div>
      <ColourField @value={{pick @avatar row.key}} @label="{{row.label}} colour" @onChange={{fn @onPick row.key}} />
    </div>
  {{/each}}
</template>;
