import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import ColourField from './colour-field';
import { sfx } from '../utils/sound';
import {
  JOINTS,
  JOINT_GROUPS,
  DEFAULT_POSE,
  POSE_PRESETS,
  SHADING,
  DEFAULT_SETTINGS,
  jointById,
  normalisePose,
  poseKey,
  setAngle,
  mirrorPose,
  randomPose,
  loadSaves,
  storeSaves,
  loadState,
  storeState,
} from '../utils/mannequin';

// Pose Reference: a posable 3D mannequin to draw from. It takes the page the
// way the games do, a 16:9 stage with the controls floating over it. The
// figure is in lazy/pose-scene.js and everything about it is data in
// utils/mannequin.js; this is the panel of chips and sliders on the stage.

const eq = (a, b) => a === b;
const swatch = (colour) => htmlSafe(`background: ${colour}`);

const TABS = [
  { id: 'pose', label: 'Pose', icon: 'person-standing' },
  { id: 'look', label: 'Look', icon: 'sun' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
];

const VIEWS = [
  { id: 'front', label: 'Front' },
  { id: 'quarter', label: '¾' },
  { id: 'side', label: 'Side' },
  { id: 'back', label: 'Back' },
  { id: 'top', label: 'Above' },
  { id: 'low', label: 'Below' },
];

const PHOTO_SIZES = [
  { id: 1080, label: 'Small' },
  { id: 2160, label: 'Large' },
  { id: 3240, label: 'Huge' },
];

const FIGURE_COLOURS = [
  '#D8D2C4',
  '#B8B4AC',
  '#6E6A66',
  '#C9A27E',
  '#8C5A3C',
  '#E8B4A0',
  '#7FA6C9',
  '#9BC27A',
];
const BACKGROUNDS = [
  '#2B2B30',
  '#151518',
  '#F2EFE8',
  '#FFFFFF',
  '#6B7280',
  '#3B4C63',
  '#5E4B3C',
  '#2F5D4A',
];

export default class PoseReferencePage extends Component {
  tabs = TABS;
  views = VIEWS;
  presets = POSE_PRESETS;
  shadings = SHADING;
  photoSizes = PHOTO_SIZES;
  figureColours = FIGURE_COLOURS;
  backgrounds = BACKGROUNDS;

  @tracked tab = 'pose';
  @tracked panelOpen = true;
  @tracked pose;
  @tracked settings;
  @tracked joint = 'armR';
  @tracked saves = loadSaves();
  @tracked saveName = '';
  @tracked photoSize = 2160;
  @tracked transparent = false;
  @tracked loading = true;
  @tracked error = '';
  handle = null;
  photoUrl = '';

  constructor(owner, args) {
    super(owner, args);
    const state = loadState();
    this.pose = state.pose;
    this.settings = state.settings;
  }

  // ─── The stage ───────────────────────────────────────────────────────

  stage = modifier((canvas) => {
    let handle = null;
    let cancelled = false;
    import('../lazy/pose-scene')
      .then(({ createPoseScene }) => {
        if (cancelled) return;
        handle = createPoseScene(canvas, {
          onPose: (pose) => this.setPose(pose, false),
          onSelect: (joint) => {
            if (joint) this.joint = joint;
          },
          onReady: (error) => {
            this.loading = false;
            if (error) this.error = error.message;
          },
        });
        handle.setSettings(this.settings);
        handle.setPose(this.pose);
        handle.select(this.joint);
        this.handle = handle;
      })
      .catch(() => {
        this.loading = false;
        this.error =
          "This browser can't draw 3D here. Try another one, or turn hardware acceleration on.";
      });
    return () => {
      cancelled = true;
      handle?.dispose();
      this.handle = null;
    };
  });

  // Keeps the scene in step without rebuilding it on every change.
  follow = modifier((_element, [pose, settings, joint]) => {
    const handle = this.handle;
    if (!handle) return;
    handle.setSettings(settings);
    handle.setPose(pose);
    handle.select(joint);
  });

  // ─── Pose ────────────────────────────────────────────────────────────

  get jointInfo() {
    return jointById(this.joint);
  }

  get jointsByGroup() {
    return JOINT_GROUPS.map((group) => ({
      group,
      joints: JOINTS.filter((joint) => joint.group === group),
    }));
  }

  get axes() {
    const values = this.pose[this.joint] ?? {};
    return this.jointInfo.axes.map((axis) => ({
      ...axis,
      value: values[axis.key] ?? 0,
    }));
  }

  get activePreset() {
    const key = poseKey(this.pose);
    return this.presets.find((p) => poseKey(p.pose) === key)?.id ?? null;
  }

  get isDefault() {
    return poseKey(this.pose) === poseKey(DEFAULT_POSE);
  }

  setPose(pose, push = true) {
    this.pose = normalisePose(pose);
    if (push) this.handle?.setPose(this.pose);
    this.remember();
  }

  remember() {
    storeState({ pose: this.pose, settings: this.settings });
  }

  setTab = (id) => {
    this.tab = id;
    this.panelOpen = true;
  };
  togglePanel = () => (this.panelOpen = !this.panelOpen);
  pickJoint = (id) => (this.joint = id);
  pickPreset = (preset) => this.setPose(preset.pose);
  setAxis = (axis, event) =>
    this.setPose(
      setAngle(this.pose, this.joint, axis.key, Number(event.target.value)),
    );
  nudgeAxis = (axis, step) =>
    this.setPose(setAngle(this.pose, this.joint, axis.key, axis.value + step));
  resetJoint = () =>
    this.setPose({ ...this.pose, [this.joint]: DEFAULT_POSE[this.joint] });
  resetPose = () => this.setPose(DEFAULT_POSE);
  mirror = () => this.setPose(mirrorPose(this.pose));
  randomise = () => {
    sfx('ui.toggle');
    this.setPose(randomPose());
  };

  // ─── Saved poses ─────────────────────────────────────────────────────

  setSaveName = (event) => (this.saveName = event.target.value);

  savePose = (event) => {
    event.preventDefault();
    const label = this.saveName.trim() || `Pose ${this.saves.length + 1}`;
    const save = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      label: label.slice(0, 40),
      pose: this.pose,
      at: Date.now(),
    };
    this.saves = storeSaves([save, ...this.saves]);
    this.saveName = '';
  };

  loadSave = (save) => this.setPose(save.pose);
  deleteSave = (save) =>
    (this.saves = storeSaves(
      this.saves.filter((other) => other.id !== save.id),
    ));

  get activeSave() {
    const key = poseKey(this.pose);
    return this.saves.find((save) => poseKey(save.pose) === key)?.id ?? null;
  }

  // ─── Settings ────────────────────────────────────────────────────────

  update = (key, value) => {
    this.settings = { ...this.settings, [key]: value };
    this.remember();
  };
  toggle = (key, event) => this.update(key, event.target.checked);
  slide = (key, event) => this.update(key, Number(event.target.value));
  setColour = (colour) => this.update('colour', colour);
  setBackground = (colour) => this.update('background', colour);
  resetLight = () => {
    const { lightAngle, lightHeight, lightPower } = DEFAULT_SETTINGS;
    this.settings = { ...this.settings, lightAngle, lightHeight, lightPower };
    this.remember();
  };

  // ─── Camera and pictures ─────────────────────────────────────────────

  lookFrom = (id) => this.handle?.setView(id);
  setPhotoSize = (id) => (this.photoSize = id);
  setTransparent = (event) => (this.transparent = event.target.checked);

  download = () => {
    const canvas = this.handle?.snapshot({
      width: Math.round((this.photoSize * 16) / 9),
      height: this.photoSize,
      transparent: this.transparent,
    });
    if (!canvas) return;
    sfx('ui.shutter');
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
      this.photoUrl = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), {
        href: this.photoUrl,
        download: `pose-${Date.now().toString(36)}.png`,
      });
      link.click();
    }, 'image/png');
  };

  <template>
    <ToolPage
      @route="pose-reference"
      @game={{true}}
      @subtitle="A 3D mannequin to draw from. Drag its limbs into a pose, turn it, light it, and take a picture. Clay, toon, wireframe or X-ray."
    >
      <div class="game-shell pose-shell">
        <div class="pose-stage {{unless this.panelOpen 'is-panel-closed'}}">
          {{#if this.error}}
            <p class="tool-error pose-error">{{this.error}}</p>
          {{else}}
            <canvas
              class="pose-canvas"
              aria-label="The mannequin. Drag a body part to pose it, drag empty space to turn around it, scroll to zoom."
              {{this.stage}}
              {{this.follow this.pose this.settings this.joint}}
            ></canvas>
          {{/if}}
          {{#if this.loading}}
            <div class="pose-loading" aria-live="polite">
              <Icon @name="loader-pinwheel" @size={{18}} />
              Loading the figure…
            </div>
          {{/if}}

          {{! ─── Views, bottom left ─────────────────────────────── }}
          <div class="pose-views" role="group" aria-label="Look from">
            {{#each this.views as |view|}}
              <button
                type="button"
                class="pose-chip"
                {{on "click" (fn this.lookFrom view.id)}}
              >{{view.label}}</button>
            {{/each}}
          </div>
          <p class="pose-help">Drag a limb to move it, drag around the figure to
            orbit, scroll to zoom.</p>

          {{! ─── The panel, on the right ────────────────────────── }}
          <div class="pose-tabs" role="group" aria-label="Controls">
            {{#each this.tabs as |t|}}
              <button
                type="button"
                class="pose-tab
                  {{if (eq this.tab t.id) 'is-active'}}
                  {{unless this.panelOpen 'is-closed'}}"
                aria-pressed={{if (eq this.tab t.id) "true" "false"}}
                title={{t.label}}
                {{on "click" (fn this.setTab t.id)}}
              ><Icon @name={{t.icon}} @size={{15}} />
                <span>{{t.label}}</span></button>
            {{/each}}
            <button
              type="button"
              class="pose-tab is-toggle"
              aria-label={{if this.panelOpen "Hide the panel" "Show the panel"}}
              title={{if this.panelOpen "Hide the panel" "Show the panel"}}
              {{on "click" this.togglePanel}}
            ><Icon
                @name={{if
                  this.panelOpen
                  "panel-right-close"
                  "panel-right-open"
                }}
                @size={{15}}
              /></button>
          </div>

          {{#if this.panelOpen}}
            <div class="pose-panel">
              {{#if (eq this.tab "pose")}}
                <div class="pose-row">
                  <span class="pose-label">Start from</span>
                  <div class="pose-chips">
                    {{#each this.presets as |p|}}
                      <button
                        type="button"
                        class="pose-chip
                          {{if (eq this.activePreset p.id) 'is-active'}}"
                        aria-pressed={{if
                          (eq this.activePreset p.id)
                          "true"
                          "false"
                        }}
                        {{on "click" (fn this.pickPreset p)}}
                      >{{p.label}}</button>
                    {{/each}}
                  </div>
                </div>

                {{#each this.jointsByGroup as |row|}}
                  <div class="pose-row">
                    <span class="pose-label">{{row.group}}</span>
                    <div class="pose-chips">
                      {{#each row.joints as |j|}}
                        <button
                          type="button"
                          class="pose-chip
                            {{if (eq this.joint j.id) 'is-active'}}"
                          aria-pressed={{if
                            (eq this.joint j.id)
                            "true"
                            "false"
                          }}
                          {{on "click" (fn this.pickJoint j.id)}}
                        >{{j.label}}</button>
                      {{/each}}
                    </div>
                  </div>
                {{/each}}

                <div
                  class="pose-sliders"
                  aria-label="{{this.jointInfo.label}} angles"
                >
                  {{#each this.axes key="key" as |axis|}}
                    <div class="pose-slider">
                      <span class="pose-slider-label">{{axis.label}}</span>
                      <button
                        type="button"
                        class="pose-nudge"
                        aria-label="{{axis.label}}: less"
                        {{on "click" (fn this.nudgeAxis axis -5)}}
                      ><Icon @name="minus" @size={{11}} /></button>
                      <input
                        type="range"
                        min={{axis.min}}
                        max={{axis.max}}
                        step="1"
                        value={{axis.value}}
                        aria-label="{{this.jointInfo.label}} {{axis.label}}"
                        {{on "input" (fn this.setAxis axis)}}
                      />
                      <button
                        type="button"
                        class="pose-nudge"
                        aria-label="{{axis.label}}: more"
                        {{on "click" (fn this.nudgeAxis axis 5)}}
                      ><Icon @name="plus" @size={{11}} /></button>
                      <span class="pose-slider-value">{{axis.value}}°</span>
                    </div>
                  {{/each}}
                </div>

                <div class="pose-actions">
                  <button
                    type="button"
                    class="pose-btn"
                    {{on "click" this.resetJoint}}
                  ><Icon @name="rotate-ccw" @size={{12}} />
                    Reset
                    {{this.jointInfo.label}}</button>
                  <button
                    type="button"
                    class="pose-btn"
                    {{on "click" this.mirror}}
                  ><Icon @name="arrow-right-left" @size={{12}} />
                    Mirror</button>
                  <button
                    type="button"
                    class="pose-btn"
                    {{on "click" this.randomise}}
                  ><Icon @name="dices" @size={{12}} /> Random</button>
                  <button
                    type="button"
                    class="pose-btn"
                    disabled={{this.isDefault}}
                    {{on "click" this.resetPose}}
                  ><Icon @name="rotate-ccw" @size={{12}} /> Reset all</button>
                </div>

                <form class="pose-save" {{on "submit" this.savePose}}>
                  <span class="pose-label">Saved poses</span>
                  <div class="pose-save-row">
                    <input
                      type="text"
                      maxlength="40"
                      placeholder="Name this pose"
                      aria-label="Name for the saved pose"
                      value={{this.saveName}}
                      {{on "input" this.setSaveName}}
                    />
                    <button type="submit" class="pose-btn is-primary"><Icon
                        @name="save"
                        @size={{12}}
                      />
                      Save</button>
                  </div>
                  {{#if this.saves.length}}
                    <ul class="pose-saves">
                      {{#each this.saves key="id" as |save|}}
                        <li>
                          <button
                            type="button"
                            class="pose-chip
                              {{if (eq this.activeSave save.id) 'is-active'}}"
                            aria-pressed={{if
                              (eq this.activeSave save.id)
                              "true"
                              "false"
                            }}
                            {{on "click" (fn this.loadSave save)}}
                          >{{save.label}}</button>
                          <button
                            type="button"
                            class="pose-nudge"
                            aria-label="Delete {{save.label}}"
                            title="Delete"
                            {{on "click" (fn this.deleteSave save)}}
                          ><Icon @name="trash-2" @size={{11}} /></button>
                        </li>
                      {{/each}}
                    </ul>
                  {{else}}
                    <p class="pose-hint">Poses are saved in this browser only.</p>
                  {{/if}}
                </form>
              {{else if (eq this.tab "look")}}
                <div class="pose-row">
                  <span class="pose-label">Surface</span>
                  <div class="pose-chips">
                    {{#each this.shadings as |s|}}
                      <button
                        type="button"
                        class="pose-chip
                          {{if (eq this.settings.shading s.id) 'is-active'}}"
                        aria-pressed={{if
                          (eq this.settings.shading s.id)
                          "true"
                          "false"
                        }}
                        {{on "click" (fn this.update "shading" s.id)}}
                      >{{s.label}}</button>
                    {{/each}}
                  </div>
                </div>

                <div class="pose-row">
                  <span class="pose-label">Figure</span>
                  <div
                    class="pose-swatches"
                    role="group"
                    aria-label="Figure colours"
                  >
                    {{#each this.figureColours as |colour|}}
                      <button
                        type="button"
                        class="avatar-swatch
                          {{if (eq this.settings.colour colour) 'active'}}"
                        style={{swatch colour}}
                        aria-label={{colour}}
                        {{on "click" (fn this.setColour colour)}}
                      ></button>
                    {{/each}}
                    <ColourField
                      @value={{this.settings.colour}}
                      @label="Figure colour"
                      @onChange={{this.setColour}}
                    />
                  </div>
                </div>

                <div class="pose-row">
                  <span class="pose-label">Background</span>
                  <div
                    class="pose-swatches"
                    role="group"
                    aria-label="Background colours"
                  >
                    {{#each this.backgrounds as |colour|}}
                      <button
                        type="button"
                        class="avatar-swatch
                          {{if (eq this.settings.background colour) 'active'}}"
                        style={{swatch colour}}
                        aria-label={{colour}}
                        {{on "click" (fn this.setBackground colour)}}
                      ></button>
                    {{/each}}
                    <ColourField
                      @value={{this.settings.background}}
                      @label="Background colour"
                      @onChange={{this.setBackground}}
                    />
                  </div>
                </div>

                <div class="pose-switches">
                  <label class="qr-switch pose-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={{this.settings.grid}}
                      aria-checked={{if this.settings.grid "true" "false"}}
                      {{on "change" (fn this.toggle "grid")}}
                    />
                    <span class="qr-switch-track" aria-hidden="true"></span>
                    Floor grid
                  </label>
                  <label class="qr-switch pose-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={{this.settings.shadows}}
                      aria-checked={{if this.settings.shadows "true" "false"}}
                      {{on "change" (fn this.toggle "shadows")}}
                    />
                    <span class="qr-switch-track" aria-hidden="true"></span>
                    Shadows
                  </label>
                  <label class="qr-switch pose-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={{this.settings.dots}}
                      aria-checked={{if this.settings.dots "true" "false"}}
                      {{on "change" (fn this.toggle "dots")}}
                    />
                    <span class="qr-switch-track" aria-hidden="true"></span>
                    Joint dots
                  </label>
                </div>
                <p class="pose-hint">The figure is Mannequiny, GDQuest's open
                  mannequin, with seventeen joints you can turn. Fingers and
                  toes go with the hand and foot.</p>

                <span class="pose-label">Light</span>
                <div class="pose-sliders">
                  <div class="pose-slider">
                    <span class="pose-slider-label">Around</span>
                    <span></span>
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      step="1"
                      value={{this.settings.lightAngle}}
                      aria-label="Light angle around the figure"
                      {{on "input" (fn this.slide "lightAngle")}}
                    />
                    <span></span>
                    <span
                      class="pose-slider-value"
                    >{{this.settings.lightAngle}}°</span>
                  </div>
                  <div class="pose-slider">
                    <span class="pose-slider-label">Height</span>
                    <span></span>
                    <input
                      type="range"
                      min="-10"
                      max="89"
                      step="1"
                      value={{this.settings.lightHeight}}
                      aria-label="Light height"
                      {{on "input" (fn this.slide "lightHeight")}}
                    />
                    <span></span>
                    <span
                      class="pose-slider-value"
                    >{{this.settings.lightHeight}}°</span>
                  </div>
                  <div class="pose-slider">
                    <span class="pose-slider-label">Strength</span>
                    <span></span>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      step="1"
                      value={{this.settings.lightPower}}
                      aria-label="Light strength"
                      {{on "input" (fn this.slide "lightPower")}}
                    />
                    <span></span>
                    <span
                      class="pose-slider-value"
                    >{{this.settings.lightPower}}%</span>
                  </div>
                </div>
                <div class="pose-actions">
                  <button
                    type="button"
                    class="pose-btn"
                    {{on "click" this.resetLight}}
                  ><Icon @name="rotate-ccw" @size={{12}} />
                    Reset the light</button>
                </div>
              {{else}}
                <div class="pose-sliders">
                  <div class="pose-slider">
                    <span class="pose-slider-label">Lens</span>
                    <span></span>
                    <input
                      type="range"
                      min="12"
                      max="100"
                      step="1"
                      value={{this.settings.fov}}
                      aria-label="Field of view"
                      {{on "input" (fn this.slide "fov")}}
                    />
                    <span></span>
                    <span
                      class="pose-slider-value"
                    >{{this.settings.fov}}°</span>
                  </div>
                </div>
                <p class="pose-hint">A narrow lens flattens the figure like a
                  telephoto; a wide one exaggerates whatever is nearest, the way
                  a low camera makes legs long.</p>

                <div class="pose-row">
                  <span class="pose-label">Picture</span>
                  <div class="pose-chips">
                    {{#each this.photoSizes as |s|}}
                      <button
                        type="button"
                        class="pose-chip
                          {{if (eq this.photoSize s.id) 'is-active'}}"
                        aria-pressed={{if
                          (eq this.photoSize s.id)
                          "true"
                          "false"
                        }}
                        {{on "click" (fn this.setPhotoSize s.id)}}
                      >{{s.label}}</button>
                    {{/each}}
                  </div>
                </div>
                <label class="qr-switch pose-switch">
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
                <div class="pose-actions">
                  <button
                    type="button"
                    class="pose-btn is-primary"
                    {{on "click" this.download}}
                  ><Icon @name="download" @size={{12}} />
                    Save a picture</button>
                </div>
                <p class="pose-hint">Pictures are 16:9, the same framing as the
                  stage, without the dots.</p>
              {{/if}}
            </div>
          {{/if}}
        </div>
      </div>
    </ToolPage>
  </template>
}
