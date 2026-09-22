import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import ColourField from './colour-field';
import AvatarPortrait from './avatar-portrait';
import {
  HAIR_STYLES,
  EYES,
  BROWS,
  NOSES,
  MOUTHS,
  FACE_SLIDERS,
  TOPS,
  PATTERNS,
  BOTTOMS,
  SHOES,
  HATS,
  EYEWEAR,
  MASKS,
  NECKWEAR,
  BACKS,
  PIERCINGS,
  MARKS,
  SKIN_TONES,
  HAIR_COLORS,
  EYE_COLORS,
  SHIRT_COLORS,
  ACCENT_COLORS,
  PANTS_COLORS,
  SHOE_COLORS,
  HAT_COLORS,
  randomAvatar,
  playerAvatar,
  avatarKey,
} from '../utils/avatar';
import {
  JOINTS,
  EXPRESSIONS,
  POSE_PRESETS,
  DEFAULT_POSE,
  normalisePose,
  poseKey,
  setPoseAngle,
  mirrorPose,
  randomPose,
} from '../utils/pose';
import { loadSaves, storeSaves, MAX_SAVES } from '../utils/avatar-saves';
import { sfx } from '../utils/sound';
import { askConfirm } from '../utils/confirm';

const eq = (a, b) => a === b;
const has = (list, id) => list.includes(id);
const swatch = (color) => htmlSafe(`background: ${color}`);

const TABS = [
  { id: 'face', label: 'Face' },
  { id: 'hair', label: 'Hair' },
  { id: 'clothes', label: 'Clothes' },
  { id: 'extras', label: 'Accessories' },
  { id: 'pose', label: 'Pose & Photo' },
  { id: 'saved', label: 'Saved' },
];
const FACE_COLOURS = [
  { key: 'skin', label: 'Skin', presets: SKIN_TONES },
  { key: 'eyeColor', label: 'Eyes', presets: EYE_COLORS },
];
const HAIR_COLOURS = [
  { key: 'hairColor', label: 'Hair colour', presets: HAIR_COLORS },
];
const CLOTHES_COLOURS = [
  { key: 'shirt', label: 'Top', presets: SHIRT_COLORS },
  { key: 'accent', label: 'Pattern and details', presets: ACCENT_COLORS },
  { key: 'pants', label: 'Bottoms', presets: PANTS_COLORS },
  { key: 'shoeColor', label: 'Shoes', presets: SHOE_COLORS },
];
const EXTRA_COLOURS = [
  { key: 'hatColor', label: 'Hat and hair accessories', presets: HAT_COLORS },
];

const FRAMINGS = [
  { id: 'full', label: 'Full body' },
  { id: 'portrait', label: 'Head & shoulders' },
];
const PHOTO_SIZES = [
  { id: 512, label: '512 px' },
  { id: 1024, label: '1024 px' },
  { id: 2048, label: '2048 px' },
];
const BACKGROUND_SWATCHES = [
  '#F7F5EF',
  '#FFFFFF',
  '#141414',
  '#FFD166',
  '#7BDFF2',
  '#B388EB',
  '#FF8FAB',
  '#95D5B2',
];

// The avatar maker: a 3D preview you can spin (or pose), every option in
// tabs, poses with presets or joint-by-joint controls, photos, and saved looks.
//
// Args: @avatar, @pose, @name, @lookId (the saved look being worn, if any),
//       @onChange(avatar), @onPoseChange(pose), @onWear({ avatar, pose, look }), @onSaved(save)
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
  joints = JOINTS;
  expressions = EXPRESSIONS;
  posePresets = POSE_PRESETS;
  framings = FRAMINGS;
  photoSizes = PHOTO_SIZES;
  backgroundSwatches = BACKGROUND_SWATCHES;

  // Falls back to the flat portrait if WebGL isn't available.
  @tracked noWebGL = false;
  @tracked tab = 'face';
  @tracked saves = loadSaves();
  @tracked joint = 'armR';
  @tracked framing = 'full';
  @tracked photoSize = 1024;
  @tracked transparent = true;
  @tracked background = '#F7F5EF';
  @tracked photoUrl = null;
  @tracked photoNote = '';
  previewHandle = null;

  willDestroy() {
    super.willDestroy();
    if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
  }

  get avatar() {
    return playerAvatar(this.args.avatar);
  }

  get pose() {
    return normalisePose(this.args.pose);
  }

  get posing() {
    return this.tab === 'pose';
  }

  get canSave() {
    return this.saves.length < MAX_SAVES;
  }

  get nudged() {
    return FACE_SLIDERS.some((s) => this.avatar[s.key] !== 0);
  }

  get currentSave() {
    return this.saves.find((s) => s.id === this.args.lookId) ?? null;
  }

  // The worn saved look, changed since it was saved.
  get unsaved() {
    const save = this.currentSave;
    return (
      Boolean(save) &&
      (avatarKey(save.avatar) !== avatarKey(this.avatar) ||
        poseKey(save.pose) !== poseKey(this.pose))
    );
  }

  get jointInfo() {
    const joint = JOINTS.find((j) => j.id === this.joint) ?? JOINTS[0];
    const values = this.pose[joint.id];
    return {
      ...joint,
      axes: joint.axes.map((a) => ({ ...a, value: values[a.key] })),
    };
  }

  get activePreset() {
    const key = poseKey(this.pose);
    return POSE_PRESETS.find((p) => poseKey(p.pose) === key)?.id ?? null;
  }

  // Takes no arguments on purpose: it sets up the renderer once, and `follow` feeds it changes.
  preview = modifier((canvas) => {
    let handle = null;
    let cancelled = false;
    import('../lazy/avatar-model')
      .then(({ createAvatarPreview }) => {
        if (cancelled) return;
        handle = createAvatarPreview(canvas, {
          onPose: (pose) => this.args.onPoseChange?.(pose),
          onSelect: (joint) => (this.joint = joint),
        });
        handle.setAvatar(this.avatar);
        handle.setPose(this.pose);
        handle.setPosing(this.posing);
        handle.select(this.joint);
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
  follow = modifier((_element, [avatar, pose, posing, joint]) => {
    const handle = this.previewHandle;
    if (!handle) return;
    handle.setAvatar(avatar);
    handle.setPose(pose);
    handle.setPosing(posing);
    handle.select(posing ? joint : null);
  });

  change(avatar) {
    this.args.onChange(playerAvatar(avatar));
  }

  setTab = (id) => {
    this.tab = id;
  };
  update = (key, value) => this.change({ ...this.avatar, [key]: value });
  toggle = (key, event) => this.update(key, event.target.checked);
  toggleIn = (key, id) => {
    const list = this.avatar[key];
    this.update(
      key,
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    );
  };
  nudge = (slider, step) =>
    this.update(
      slider.key,
      Math.max(
        slider.min,
        Math.min(slider.max, this.avatar[slider.key] + step),
      ),
    );
  slide = (slider, event) =>
    this.update(slider.key, Number(event.target.value));
  resetPositions = () =>
    this.change({
      ...this.avatar,
      ...Object.fromEntries(FACE_SLIDERS.map((s) => [s.key, 0])),
    });
  shuffle = () => {
    sfx('ui.toggle');
    this.change(randomAvatar());
  };

  // ─── Pose ────────────────────────────────────────────────────────────

  setPose(pose) {
    this.args.onPoseChange?.(normalisePose(pose));
  }

  pickPreset = (preset) => {
    this.setPose(preset.pose);
  };
  pickExpression = (id) => this.setPose({ ...this.pose, expression: id });
  pickJoint = (id) => (this.joint = id);
  setAngle = (axis, event) =>
    this.setPose(
      setPoseAngle(this.pose, this.joint, axis.key, Number(event.target.value)),
    );
  nudgeAngle = (axis, step) =>
    this.setPose(
      setPoseAngle(this.pose, this.joint, axis.key, axis.value + step),
    );
  resetJoint = () =>
    this.setPose({ ...this.pose, [this.joint]: DEFAULT_POSE[this.joint] });
  resetPose = () => this.setPose(DEFAULT_POSE);
  mirror = () => this.setPose(mirrorPose(this.pose));
  randomise = () => {
    sfx('ui.toggle');
    this.setPose(randomPose());
  };
  viewFront = () => this.previewHandle?.setView(0);
  viewSide = () => this.previewHandle?.setView(90);
  viewBack = () => this.previewHandle?.setView(180);

  // ─── Photo ───────────────────────────────────────────────────────────

  setFraming = (id) => {
    this.framing = id;
    this.previewHandle?.setFrame(id);
  };
  setPhotoSize = (id) => (this.photoSize = id);
  setTransparent = (event) => (this.transparent = event.target.checked);
  setBackground = (color) => {
    this.background = color;
    this.transparent = false;
  };

  snapshot() {
    const canvas = this.previewHandle?.snapshot({
      width: this.photoSize,
      height:
        this.framing === 'full'
          ? Math.round((this.photoSize * 9) / 16)
          : this.photoSize,
      frame: this.framing,
      background: this.transparent ? null : this.background,
    });
    return canvas;
  }

  // Resets the live view's framing when leaving the Photo tab.
  photoFrame = modifier(() => {
    this.previewHandle?.setFrame(this.framing);
    return () => this.previewHandle?.setFrame('full');
  });

  takePhoto = () => {
    const canvas = this.snapshot();
    if (!canvas) return;
    sfx('ui.shutter');
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
      this.photoUrl = URL.createObjectURL(blob);
      const name = `${
        (this.args.name || 'avatar')
          .trim()
          .replace(/[^\w-]+/g, '-')
          .toLowerCase() || 'avatar'
      }-${Date.now().toString(36)}.png`;
      const link = Object.assign(document.createElement('a'), {
        href: this.photoUrl,
        download: name,
      });
      link.click();
      this.photoNote = 'Saved as a PNG in your downloads.';
    }, 'image/png');
  };

  copyPhoto = async () => {
    const canvas = this.snapshot();
    if (!canvas) return;
    sfx('ui.shutter');
    try {
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      this.photoNote = 'Copied the image. Paste it anywhere.';
    } catch {
      this.photoNote = "This browser can't copy images. Use Download instead.";
    }
  };

  // ─── Saved looks ─────────────────────────────────────────────────────

  saveLook = () => {
    if (!this.canSave) return;
    const label = `${this.args.name?.trim() || 'Look'} ${this.saves.length + 1}`;
    const save = {
      id: Date.now().toString(36),
      label,
      avatar: this.avatar,
      pose: this.pose,
    };
    this.saves = [...this.saves, save];
    storeSaves(this.saves);
    sfx('ui.confirm');
    this.args.onSaved?.(save);
  };

  updateLook = () => {
    const current = this.currentSave;
    if (!current) return;
    this.saves = this.saves.map((s) =>
      s.id === current.id ? { ...s, avatar: this.avatar, pose: this.pose } : s,
    );
    storeSaves(this.saves);
    sfx('ui.confirm');
    this.args.onSaved?.(this.saves.find((s) => s.id === current.id));
  };

  wear = (save) => {
    if (this.args.onWear)
      this.args.onWear({ avatar: save.avatar, pose: save.pose, look: save.id });
    else {
      this.change(save.avatar);
      this.setPose(save.pose);
    }
  };

  forget = async (save) => {
    if (
      !(await askConfirm({
        title: `Delete “${save.label}”?`,
        message:
          'This saved avatar will be gone from your profile and lobby pickers.',
        confirmLabel: 'Hold to delete',
        holdMs: 1500,
      }))
    )
      return;
    this.saves = this.saves.filter((s) => s.id !== save.id);
    storeSaves(this.saves);
  };

  rename = (save, event) => {
    const label = event.target.value.slice(0, 24) || save.label;
    this.saves = this.saves.map((s) =>
      s.id === save.id ? { ...s, label } : s,
    );
    storeSaves(this.saves);
  };

  <template>
    <div class="avatar-editor is-tool">
      <div
        class="avatar-stage"
        {{this.follow this.avatar this.pose this.posing this.joint}}
      >
        {{#if this.noWebGL}}
          <AvatarPortrait @avatar={{this.avatar}} @size={{150}} />
        {{else}}
          <canvas
            class="avatar-canvas {{if this.posing 'is-posing'}}"
            aria-label={{if
              this.posing
              "Your avatar. Drag a joint handle to pose it, or drag the background to turn it."
              "Your avatar. Drag to turn it around."
            }}
            {{this.preview}}
          ></canvas>
        {{/if}}
        {{#unless this.noWebGL}}
          <div class="avatar-view-buttons" role="group" aria-label="View">
            <button
              type="button"
              class="btn"
              {{on "click" this.viewFront}}
            >Front</button>
            <button
              type="button"
              class="btn"
              {{on "click" this.viewSide}}
            >Side</button>
            <button
              type="button"
              class="btn"
              {{on "click" this.viewBack}}
            >Back</button>
          </div>
        {{/unless}}
        <div class="avatar-stage-actions">
          <button type="button" class="btn" {{on "click" this.shuffle}}><Icon
              @name="shuffle"
              @size={{13}}
            />
            Surprise me</button>
          {{#if this.unsaved}}
            <button
              type="button"
              class="btn active"
              {{on "click" this.updateLook}}
            ><Icon @name="save" @size={{13}} />
              Update “{{this.currentSave.label}}”</button>
          {{/if}}
          <button
            type="button"
            class="btn"
            disabled={{if this.canSave false true}}
            {{on "click" this.saveLook}}
          ><Icon @name="star" @size={{13}} /> Save as new look</button>
        </div>
      </div>

      <div class="avatar-options">
        <div
          class="math-tabs avatar-tabs"
          role="tablist"
          aria-label="Avatar options"
        >
          {{#each this.tabs as |t|}}
            <button
              type="button"
              role="tab"
              class="qr-tab {{if (eq this.tab t.id) 'active'}}"
              aria-selected={{if (eq this.tab t.id) "true" "false"}}
              {{on "click" (fn this.setTab t.id)}}
            >{{t.label}}{{#if (eq t.id "saved")}}
                ({{this.saves.length}}){{/if}}</button>
          {{/each}}
        </div>

        {{#if (eq this.tab "face")}}
          <OptionRow
            @label="Eyes"
            @options={{this.eyes}}
            @value={{this.avatar.eyes}}
            @onPick={{fn this.update "eyes"}}
          />
          <OptionRow
            @label="Eyebrows"
            @options={{this.brows}}
            @value={{this.avatar.brows}}
            @onPick={{fn this.update "brows"}}
          />
          <OptionRow
            @label="Nose"
            @options={{this.noses}}
            @value={{this.avatar.nose}}
            @onPick={{fn this.update "nose"}}
          />
          <OptionRow
            @label="Mouth"
            @options={{this.mouths}}
            @value={{this.avatar.mouth}}
            @onPick={{fn this.update "mouth"}}
          />
          <MultiRow
            @label="Marks"
            @options={{this.marks}}
            @values={{this.avatar.marks}}
            @onToggle={{fn this.toggleIn "marks"}}
          />
          <div class="avatar-option-row">
            <span class="qr-label is-muted">Positions</span>
            <div class="avatar-sliders">
              {{#each this.sliders as |slider|}}
                <div class="avatar-slider">
                  <span class="avatar-slider-label">{{slider.label}}</span>
                  <button
                    type="button"
                    class="qr-icon-btn"
                    aria-label="{{slider.label}}: less"
                    {{on "click" (fn this.nudge slider -1)}}
                  ><Icon @name="minus" @size={{12}} /></button>
                  <input
                    type="range"
                    min={{slider.min}}
                    max={{slider.max}}
                    step="1"
                    value={{pick this.avatar slider.key}}
                    aria-label={{slider.label}}
                    {{on "input" (fn this.slide slider)}}
                  />
                  <button
                    type="button"
                    class="qr-icon-btn"
                    aria-label="{{slider.label}}: more"
                    {{on "click" (fn this.nudge slider 1)}}
                  ><Icon @name="plus" @size={{12}} /></button>
                  <span class="avatar-slider-value">{{pick
                      this.avatar
                      slider.key
                    }}</span>
                </div>
              {{/each}}
            </div>
            <button
              type="button"
              class="btn avatar-reset"
              disabled={{if this.nudged false true}}
              {{on "click" this.resetPositions}}
            ><Icon @name="rotate-ccw" @size={{13}} /> Reset positions</button>
          </div>
          <ColourRows
            @rows={{this.faceColours}}
            @avatar={{this.avatar}}
            @onPick={{this.update}}
          />
        {{else if (eq this.tab "hair")}}
          <OptionRow
            @label="Hairstyle"
            @options={{this.hairStyles}}
            @value={{this.avatar.hair}}
            @onPick={{fn this.update "hair"}}
          />
          <label class="qr-switch">
            <input
              type="checkbox"
              role="switch"
              checked={{this.avatar.ahoge}}
              aria-checked={{if this.avatar.ahoge "true" "false"}}
              {{on "change" (fn this.toggle "ahoge")}}
            />
            <span class="qr-switch-track" aria-hidden="true"></span>
            Stray strand
          </label>
          <ColourRows
            @rows={{this.hairColours}}
            @avatar={{this.avatar}}
            @onPick={{this.update}}
          />
        {{else if (eq this.tab "clothes")}}
          <OptionRow
            @label="Top"
            @options={{this.topsList}}
            @value={{this.avatar.top}}
            @onPick={{fn this.update "top"}}
          />
          <OptionRow
            @label="Pattern"
            @options={{this.patterns}}
            @value={{this.avatar.pattern}}
            @onPick={{fn this.update "pattern"}}
          />
          {{#unless (eq this.avatar.top "dress")}}
            <OptionRow
              @label="Bottoms"
              @options={{this.bottoms}}
              @value={{this.avatar.bottom}}
              @onPick={{fn this.update "bottom"}}
            />
          {{/unless}}
          <OptionRow
            @label="Shoes"
            @options={{this.shoes}}
            @value={{this.avatar.shoes}}
            @onPick={{fn this.update "shoes"}}
          />
          <ColourRows
            @rows={{this.clothesColours}}
            @avatar={{this.avatar}}
            @onPick={{this.update}}
          />
        {{else if (eq this.tab "extras")}}
          <OptionRow
            @label="Head"
            @options={{this.hats}}
            @value={{this.avatar.hat}}
            @onPick={{fn this.update "hat"}}
          />
          <OptionRow
            @label="Eyewear"
            @options={{this.eyewear}}
            @value={{this.avatar.eyewear}}
            @onPick={{fn this.update "eyewear"}}
          />
          <OptionRow
            @label="Mask"
            @options={{this.masks}}
            @value={{this.avatar.mask}}
            @onPick={{fn this.update "mask"}}
          />
          <OptionRow
            @label="Neck"
            @options={{this.neckwear}}
            @value={{this.avatar.neck}}
            @onPick={{fn this.update "neck"}}
          />
          <OptionRow
            @label="Back"
            @options={{this.backs}}
            @value={{this.avatar.back}}
            @onPick={{fn this.update "back"}}
          />
          <MultiRow
            @label="Piercings"
            @options={{this.piercings}}
            @values={{this.avatar.piercings}}
            @onToggle={{fn this.toggleIn "piercings"}}
          />
          <ColourRows
            @rows={{this.extraColours}}
            @avatar={{this.avatar}}
            @onPick={{this.update}}
          />
          <p class="tool-hint">Scarves, ties, capes and backpacks use the
            pattern and details colour from Clothes.</p>
        {{else if (eq this.tab "pose")}}
          <div class="avatar-option-row">
            <span class="qr-label is-muted">Presets</span>
            <div class="avatar-chips" role="group" aria-label="Pose presets">
              {{#each this.posePresets as |p|}}
                <button
                  type="button"
                  class="home-chip {{if (eq this.activePreset p.id) 'active'}}"
                  aria-pressed={{if (eq this.activePreset p.id) "true" "false"}}
                  {{on "click" (fn this.pickPreset p)}}
                >{{p.label}}</button>
              {{/each}}
            </div>
          </div>
          <OptionRow
            @label="Expression"
            @options={{this.expressions}}
            @value={{this.pose.expression}}
            @onPick={{this.pickExpression}}
          />
          <div class="avatar-option-row">
            <span class="qr-label is-muted">Joint
              <span class="tool-hint">(or click a dot on the avatar and drag it)</span></span>
            <div class="avatar-chips" role="group" aria-label="Joint to pose">
              {{#each this.joints as |j|}}
                <button
                  type="button"
                  class="home-chip {{if (eq this.joint j.id) 'active'}}"
                  aria-pressed={{if (eq this.joint j.id) "true" "false"}}
                  {{on "click" (fn this.pickJoint j.id)}}
                >{{j.label}}</button>
              {{/each}}
            </div>
          </div>
          <div
            class="avatar-sliders pose-sliders"
            aria-label="{{this.jointInfo.label}} angles"
          >
            {{#each this.jointInfo.axes key="key" as |axis|}}
              <div class="avatar-slider">
                <span class="avatar-slider-label">{{axis.label}}</span>
                <button
                  type="button"
                  class="qr-icon-btn"
                  aria-label="{{axis.label}}: less"
                  {{on "click" (fn this.nudgeAngle axis -5)}}
                ><Icon @name="minus" @size={{12}} /></button>
                <input
                  type="range"
                  min={{axis.min}}
                  max={{axis.max}}
                  step="1"
                  value={{axis.value}}
                  aria-label="{{this.jointInfo.label}} {{axis.label}}"
                  {{on "input" (fn this.setAngle axis)}}
                />
                <button
                  type="button"
                  class="qr-icon-btn"
                  aria-label="{{axis.label}}: more"
                  {{on "click" (fn this.nudgeAngle axis 5)}}
                ><Icon @name="plus" @size={{12}} /></button>
                <span class="avatar-slider-value">{{axis.value}}°</span>
              </div>
            {{/each}}
          </div>
          <div class="avatar-stage-actions">
            <button
              type="button"
              class="btn"
              {{on "click" this.resetJoint}}
            ><Icon @name="rotate-ccw" @size={{13}} />
              Reset
              {{this.jointInfo.label}}</button>
            <button type="button" class="btn" {{on "click" this.mirror}}><Icon
                @name="arrow-right-left"
                @size={{13}}
              />
              Mirror</button>
            <button
              type="button"
              class="btn"
              {{on "click" this.randomise}}
            ><Icon @name="dices" @size={{13}} /> Random</button>
            <button
              type="button"
              class="btn"
              {{on "click" this.resetPose}}
            ><Icon @name="person-standing" @size={{13}} /> Reset pose</button>
          </div>
          <p class="tool-hint">Strike a pose! It shows on your portrait wherever
            your avatar appears. Save the look to keep it.</p>
          <h4 class="avatar-section-title"><Icon @name="camera" @size={{14}} />
            Photo</h4>
          <div class="avatar-photo" {{this.photoFrame}}>
            <div class="avatar-option-row">
              <span class="qr-label is-muted">Framing</span>
              <div class="math-tabs" role="group" aria-label="Framing">
                {{#each this.framings as |f|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.framing f.id) 'active'}}"
                    aria-pressed={{if (eq this.framing f.id) "true" "false"}}
                    {{on "click" (fn this.setFraming f.id)}}
                  >{{f.label}}</button>
                {{/each}}
              </div>
            </div>
            <div class="avatar-option-row">
              <span class="qr-label is-muted">Size</span>
              <div class="math-tabs" role="group" aria-label="Image size">
                {{#each this.photoSizes as |s|}}
                  <button
                    type="button"
                    class="qr-tab {{if (eq this.photoSize s.id) 'active'}}"
                    aria-pressed={{if (eq this.photoSize s.id) "true" "false"}}
                    {{on "click" (fn this.setPhotoSize s.id)}}
                  >{{s.label}}</button>
                {{/each}}
              </div>
            </div>
            <label class="qr-switch">
              <input
                type="checkbox"
                role="switch"
                checked={{this.transparent}}
                aria-checked={{if this.transparent "true" "false"}}
                {{on "change" this.setTransparent}}
              />
              <span class="qr-switch-track" aria-hidden="true"></span>
              Transparent background
            </label>
            <div class="avatar-color-row">
              <span class="qr-label is-muted">Background</span>
              <div
                class="avatar-swatches"
                role="group"
                aria-label="Background colours"
              >
                {{#each this.backgroundSwatches as |color|}}
                  <button
                    type="button"
                    class="avatar-swatch
                      {{if
                        (bgActive this.transparent this.background color)
                        'active'
                      }}"
                    style={{swatch color}}
                    aria-label={{color}}
                    {{on "click" (fn this.setBackground color)}}
                  ></button>
                {{/each}}
              </div>
              <ColourField
                @value={{this.background}}
                @label="Background colour"
                @onChange={{this.setBackground}}
              />
            </div>
            <p class="tool-hint">Turn the avatar to the angle you like first;
              the photo uses the view as it is now, with the pose you set.</p>
            <div class="avatar-stage-actions">
              <button
                type="button"
                class="btn active"
                disabled={{this.noWebGL}}
                {{on "click" this.takePhoto}}
              ><Icon @name="camera" @size={{13}} /> Download PNG</button>
              <button
                type="button"
                class="btn"
                disabled={{this.noWebGL}}
                {{on "click" this.copyPhoto}}
              ><Icon @name="copy" @size={{13}} /> Copy image</button>
            </div>
            {{#if this.photoNote}}<p
                class="tool-hint"
                role="status"
              >{{this.photoNote}}</p>{{/if}}
            {{#if this.photoUrl}}<img
                class="avatar-photo-preview"
                src={{this.photoUrl}}
                alt="The avatar you last captured"
              />{{/if}}
          </div>
        {{else}}
          {{#if this.saves.length}}
            <ul class="avatar-saves">
              {{#each this.saves key="id" as |save|}}
                <li class="avatar-save {{if (eq save.id @lookId) 'is-worn'}}">
                  <button
                    type="button"
                    class="avatar-save-wear"
                    aria-label="Wear {{save.label}}"
                    title="Wear this look"
                    {{on "click" (fn this.wear save)}}
                  >
                    <AvatarPortrait
                      @avatar={{save.avatar}}
                      @pose={{save.pose}}
                      @size={{56}}
                    />
                  </button>
                  <input
                    type="text"
                    class="avatar-save-name"
                    maxlength="24"
                    value={{save.label}}
                    aria-label="Name of this look"
                    {{on "change" (fn this.rename save)}}
                  />
                  {{#if (eq save.id @lookId)}}<span class="lobby-tag">In use</span>{{/if}}
                  <button
                    type="button"
                    class="qr-icon-btn"
                    aria-label="Delete {{save.label}}"
                    {{on "click" (fn this.forget save)}}
                  ><Icon @name="trash-2" @size={{13}} /></button>
                </li>
              {{/each}}
            </ul>
          {{else}}
            <p class="tool-hint">Nothing saved yet. Hit Save as new look to keep
              this one. Make as many characters as you like and swap between
              them in Settings or any lobby.</p>
          {{/if}}
          <p class="tool-hint">Up to
            {{this.maxSaves}}
            characters, poses and all, kept in this browser.</p>
        {{/if}}
      </div>
    </div>
  </template>
}

function pick(object, key) {
  return object[key];
}

function bgActive(transparent, background, color) {
  return !transparent && background.toLowerCase() === color.toLowerCase();
}

const OptionRow = <template>
  <div class="avatar-option-row">
    <span class="qr-label is-muted">{{@label}}</span>
    <div class="avatar-chips" role="group" aria-label={{@label}}>
      {{#each @options as |o|}}
        <button
          type="button"
          class="home-chip {{if (eq @value o.id) 'active'}}"
          aria-pressed={{if (eq @value o.id) "true" "false"}}
          {{on "click" (fn @onPick o.id)}}
        >{{o.label}}</button>
      {{/each}}
    </div>
  </div>
</template>;

// Chips you can switch on in any combination.
const MultiRow = <template>
  <div class="avatar-option-row">
    <span class="qr-label is-muted">{{@label}}
      <span class="tool-hint">(pick any)</span></span>
    <div class="avatar-chips" role="group" aria-label={{@label}}>
      {{#each @options as |o|}}
        <button
          type="button"
          class="home-chip {{if (has @values o.id) 'active'}}"
          aria-pressed={{if (has @values o.id) "true" "false"}}
          {{on "click" (fn @onToggle o.id)}}
        >{{o.label}}</button>
      {{/each}}
    </div>
  </div>
</template>;

// Preset swatches plus an editable hex field for each colour.
const ColourRows = <template>
  {{#each @rows as |row|}}
    <div class="avatar-color-row">
      <span class="qr-label is-muted">{{row.label}}</span>
      <div
        class="avatar-swatches"
        role="group"
        aria-label="{{row.label}} colours"
      >
        {{#each row.presets as |color|}}
          <button
            type="button"
            class="avatar-swatch
              {{if (eq (pick @avatar row.key) color) 'active'}}"
            style={{swatch color}}
            aria-label={{color}}
            {{on "click" (fn @onPick row.key color)}}
          ></button>
        {{/each}}
      </div>
      <ColourField
        @value={{pick @avatar row.key}}
        @label="{{row.label}} colour"
        @onChange={{fn @onPick row.key}}
      />
    </div>
  {{/each}}
</template>;
