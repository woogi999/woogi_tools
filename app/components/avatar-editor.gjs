import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import ColourField from './colour-field';
import AvatarPortrait from './avatar-portrait';
import { TYPES, HAIR_STYLES, EYES, BROWS, NOSES, MOUTHS, HATS, EYEWEAR, PIERCINGS, MARKS, NECKWEAR, ROBOT_HEADS, ROBOT_EYES, ROBOT_MOUTHS, SKIN_TONES, HAIR_COLORS, EYE_COLORS, SHIRT_COLORS, PANTS_COLORS, METAL_COLORS, GLOW_COLORS, randomAvatar, robotAvatar, normaliseAvatar } from '../utils/avatar';
import { loadSaves, storeSaves, rememberType, recallType, MAX_SAVES } from '../utils/avatar-saves';

const eq = (a, b) => a === b;
const has = (list, id) => list.includes(id);
const swatch = (color) => htmlSafe(`background: ${color}`);
const labelled = (ids, labels) => ids.map((id) => ({ id, label: labels[id] ?? id }));

const HUMAN_TABS = [
  { id: 'face', label: 'Face' },
  { id: 'hair', label: 'Hair' },
  { id: 'extras', label: 'Accessories' },
  { id: 'colours', label: 'Colours' },
  { id: 'saved', label: 'Saved' },
];
const ROBOT_TABS = [
  { id: 'face', label: 'Robot' },
  { id: 'colours', label: 'Colours' },
  { id: 'saved', label: 'Saved' },
];
const HUMAN_COLOURS = [
  { key: 'skin', label: 'Skin', presets: SKIN_TONES },
  { key: 'hairColor', label: 'Hair', presets: HAIR_COLORS },
  { key: 'eyeColor', label: 'Eyes', presets: EYE_COLORS },
  { key: 'shirt', label: 'Shirt', presets: SHIRT_COLORS },
  { key: 'pants', label: 'Trousers', presets: PANTS_COLORS },
];
const ROBOT_COLOURS = [
  { key: 'skin', label: 'Metal', presets: METAL_COLORS },
  { key: 'hairColor', label: 'Glow', presets: GLOW_COLORS },
  { key: 'shirt', label: 'Body', presets: SHIRT_COLORS },
];

// The avatar maker in every game lobby: a 3D preview you can spin, every
// option in tabs, and saved looks. Switching between person and robot keeps
// the last one of each, so neither gets thrown away.
export default class AvatarEditor extends Component {
  types = TYPES;
  hairStyles = HAIR_STYLES;
  eyes = EYES;
  brows = BROWS;
  noses = NOSES;
  mouths = MOUTHS;
  hats = HATS;
  eyewear = EYEWEAR;
  piercings = PIERCINGS;
  marks = MARKS;
  neckwear = NECKWEAR;
  robotHeads = ROBOT_HEADS;
  robotEyes = labelled(ROBOT_EYES, { dots: 'Dots', big: 'Big', happy: 'Happy', sleepy: 'Sleepy', blank: 'Rings', x: 'X' });
  robotMouths = labelled(ROBOT_MOUTHS, { tiny: 'Tiny', smile: 'Smile', flat: 'Flat', grin: 'Equaliser' });
  maxSaves = MAX_SAVES;

  // Falls back to the flat portrait if WebGL isn't available.
  @tracked noWebGL = false;
  @tracked tab = 'face';
  @tracked saves = loadSaves();

  get avatar() {
    return normaliseAvatar(this.args.avatar);
  }

  get isRobot() {
    return this.avatar.type === 'robot';
  }

  get tabs() {
    return this.isRobot ? ROBOT_TABS : HUMAN_TABS;
  }

  get currentTab() {
    return this.tabs.some((t) => t.id === this.tab) ? this.tab : 'face';
  }

  get colorRows() {
    return this.isRobot ? ROBOT_COLOURS : HUMAN_COLOURS;
  }

  get canSave() {
    return this.saves.length < MAX_SAVES;
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

  change(avatar) {
    rememberType(avatar);
    this.args.onChange(avatar);
  }

  setTab = (id) => (this.tab = id);
  update = (key, value) => this.change({ ...this.avatar, [key]: value });
  toggle = (key, event) => this.update(key, event.target.checked);
  toggleIn = (key, id) => {
    const list = this.avatar[key];
    this.update(key, list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };
  shuffle = () => this.change(this.isRobot ? robotAvatar(Math.floor(Math.random() * 1e9), 0) : randomAvatar());

  // Swapping type brings back the last person or robot you made; your name never changes.
  setType = (type) => {
    if (type === this.avatar.type) return;
    rememberType(this.avatar);
    this.args.onChange(recallType(type));
  };

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
        <OptionRow @label="Type" @options={{this.types}} @value={{this.avatar.type}} @onPick={{this.setType}} />
        <div class="math-tabs avatar-tabs" role="tablist" aria-label="Avatar options">
          {{#each this.tabs as |t|}}
            <button type="button" role="tab" class="qr-tab {{if (eq this.currentTab t.id) 'active'}}" aria-selected={{if (eq this.currentTab t.id) "true" "false"}} {{on "click" (fn this.setTab t.id)}}>{{t.label}}{{#if (eq t.id "saved")}} ({{this.saves.length}}){{/if}}</button>
          {{/each}}
        </div>

        {{#if (eq this.currentTab "face")}}
          {{#if this.isRobot}}
            <OptionRow @label="Head" @options={{this.robotHeads}} @value={{this.avatar.head}} @onPick={{fn this.update "head"}} />
            <OptionRow @label="Eyes" @options={{this.robotEyes}} @value={{this.avatar.eyes}} @onPick={{fn this.update "eyes"}} />
            <OptionRow @label="Mouth" @options={{this.robotMouths}} @value={{this.avatar.mouth}} @onPick={{fn this.update "mouth"}} />
          {{else}}
            <OptionRow @label="Eyes" @options={{this.eyes}} @value={{this.avatar.eyes}} @onPick={{fn this.update "eyes"}} />
            <OptionRow @label="Eyebrows" @options={{this.brows}} @value={{this.avatar.brows}} @onPick={{fn this.update "brows"}} />
            <OptionRow @label="Nose" @options={{this.noses}} @value={{this.avatar.nose}} @onPick={{fn this.update "nose"}} />
            <OptionRow @label="Mouth" @options={{this.mouths}} @value={{this.avatar.mouth}} @onPick={{fn this.update "mouth"}} />
            <MultiRow @label="Marks" @options={{this.marks}} @values={{this.avatar.marks}} @onToggle={{fn this.toggleIn "marks"}} />
          {{/if}}
          <label class="qr-switch">
            <input type="checkbox" role="switch" checked={{this.avatar.blush}} aria-checked={{if this.avatar.blush "true" "false"}} {{on "change" (fn this.toggle "blush")}} />
            <span class="qr-switch-track" aria-hidden="true"></span>
            Rosy cheeks
          </label>
        {{else if (eq this.currentTab "hair")}}
          <OptionRow @label="Hairstyle" @options={{this.hairStyles}} @value={{this.avatar.hair}} @onPick={{fn this.update "hair"}} />
          <label class="qr-switch">
            <input type="checkbox" role="switch" checked={{this.avatar.ahoge}} aria-checked={{if this.avatar.ahoge "true" "false"}} {{on "change" (fn this.toggle "ahoge")}} />
            <span class="qr-switch-track" aria-hidden="true"></span>
            Stray strand
          </label>
        {{else if (eq this.currentTab "extras")}}
          <OptionRow @label="Head" @options={{this.hats}} @value={{this.avatar.hat}} @onPick={{fn this.update "hat"}} />
          <OptionRow @label="Eyewear" @options={{this.eyewear}} @value={{this.avatar.eyewear}} @onPick={{fn this.update "eyewear"}} />
          <MultiRow @label="Piercings" @options={{this.piercings}} @values={{this.avatar.piercings}} @onToggle={{fn this.toggleIn "piercings"}} />
          <OptionRow @label="Neck" @options={{this.neckwear}} @value={{this.avatar.neck}} @onPick={{fn this.update "neck"}} />
        {{else if (eq this.currentTab "colours")}}
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
