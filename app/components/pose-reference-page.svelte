<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import ColourField from './colour-field.svelte';
  import { sfx } from '../utils/sound.svelte.js';
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
  } from '../utils/mannequin.js';

  // Pose Reference: a posable 3D mannequin to draw from. It takes the page the
  // way the games do, a 16:9 stage with the controls floating over it. The
  // figure is in lazy/pose-scene.js and everything about it is data in
  // utils/mannequin.js; this is the panel of chips and sliders on the stage.

  const eq = (a, b) => a === b;
  const swatch = (colour) => `background: ${colour}`;

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

  class PoseReferencePage extends Component {
    tabs = TABS;
    views = VIEWS;
    presets = POSE_PRESETS;
    shadings = SHADING;
    photoSizes = PHOTO_SIZES;
    figureColours = FIGURE_COLOURS;
    backgrounds = BACKGROUNDS;

    tab = $state.raw('pose');
    panelOpen = $state.raw(true);
    pose = $state.raw();
    settings = $state.raw();
    joint = $state.raw('armR');
    saves = $state.raw(loadSaves());
    saveName = $state.raw('');
    photoSize = $state.raw(2160);
    transparent = $state.raw(false);
    loading = $state.raw(true);
    error = $state.raw('');
    handle = null;
    photoUrl = '';

    constructor(args) {
      super(args);
      const state = loadState();
      this.pose = state.pose;
      this.settings = state.settings;
    }

    // ─── The stage ───────────────────────────────────────────────────────

    stage = modifier((canvas) => {
      let handle = null;
      let cancelled = false;
      import('../lazy/pose-scene.js')
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
      this.setPose(
        setAngle(this.pose, this.joint, axis.key, axis.value + step),
      );
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
  }
</script>

<script>
  let args = $props();
  const self = new PoseReferencePage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="pose-reference"
  game={true}
  subtitle="A 3D mannequin to draw from. Drag its limbs into a pose, turn it, light it, and take a picture. Clay, toon, wireframe or X-ray."
>
  <div class="game-shell pose-shell">
    <div class="pose-stage {!truthy(self.panelOpen) ? 'is-panel-closed' : ''}">
      {#if truthy(self.error)}
        <p class="tool-error pose-error">{self.error}</p>
      {:else}
        <canvas
          class="pose-canvas"
          aria-label="The mannequin. Drag a body part to pose it, drag empty space to turn around it, scroll to zoom."
          {@attach self.stage?.()}
          {@attach self.follow?.([self.pose, self.settings, self.joint])}
        ></canvas>
      {/if}
      {#if truthy(self.loading)}
        <div class="pose-loading" aria-live="polite">
          <Icon name="loader-pinwheel" size={18} />
          Loading the figure…
        </div>
      {/if}

      <!-- ─── Views, bottom left ─────────────────────────────── -->
      <div class="pose-views" role="group" aria-label="Look from">
        {#each self.views ?? [] as view}
          <button
            type="button"
            class="pose-chip"
            onclick={(..._r) => self.lookFrom(view?.id, ..._r)}
            >{view?.label}</button
          >
        {/each}
      </div>
      <p class="pose-help"
        >Drag a limb to move it, drag around the figure to orbit, scroll to
        zoom.</p
      >

      <!-- ─── The panel, on the right ────────────────────────── -->
      <div class="pose-tabs" role="group" aria-label="Controls">
        {#each self.tabs ?? [] as t}
          <button
            type="button"
            class="pose-tab
                  {truthy(eq(self.tab, t?.id)) ? 'is-active' : ''}
                  {!truthy(self.panelOpen) ? 'is-closed' : ''}"
            aria-pressed={truthy(eq(self.tab, t?.id)) ? 'true' : 'false'}
            title={t?.label}
            onclick={(..._r) => self.setTab(t?.id, ..._r)}
            ><Icon name={t?.icon} size={15} />
            <span>{t?.label}</span></button
          >
        {/each}
        <button
          type="button"
          class="pose-tab is-toggle"
          aria-label={truthy(self.panelOpen)
            ? 'Hide the panel'
            : 'Show the panel'}
          title={truthy(self.panelOpen) ? 'Hide the panel' : 'Show the panel'}
          onclick={self.togglePanel}
          ><Icon
            name={truthy(self.panelOpen)
              ? 'panel-right-close'
              : 'panel-right-open'}
            size={15}
          /></button
        >
      </div>

      {#if truthy(self.panelOpen)}
        <div class="pose-panel">
          {#if truthy(eq(self.tab, 'pose'))}
            <div class="pose-row">
              <span class="pose-label">Start from</span>
              <div class="pose-chips">
                {#each self.presets ?? [] as p}
                  <button
                    type="button"
                    class="pose-chip
                          {truthy(eq(self.activePreset, p?.id))
                      ? 'is-active'
                      : ''}"
                    aria-pressed={truthy(eq(self.activePreset, p?.id))
                      ? 'true'
                      : 'false'}
                    onclick={(..._r) => self.pickPreset(p, ..._r)}
                    >{p?.label}</button
                  >
                {/each}
              </div>
            </div>

            {#each self.jointsByGroup ?? [] as row}
              <div class="pose-row">
                <span class="pose-label">{row?.group}</span>
                <div class="pose-chips">
                  {#each row?.joints ?? [] as j}
                    <button
                      type="button"
                      class="pose-chip
                            {truthy(eq(self.joint, j?.id)) ? 'is-active' : ''}"
                      aria-pressed={truthy(eq(self.joint, j?.id))
                        ? 'true'
                        : 'false'}
                      onclick={(..._r) => self.pickJoint(j?.id, ..._r)}
                      >{j?.label}</button
                    >
                  {/each}
                </div>
              </div>
            {/each}

            <div
              class="pose-sliders"
              aria-label="{self.jointInfo?.label} angles"
            >
              {#each self.axes ?? [] as axis}
                <div class="pose-slider">
                  <span class="pose-slider-label">{axis?.label}</span>
                  <button
                    type="button"
                    class="pose-nudge"
                    aria-label="{axis?.label}: less"
                    onclick={(..._r) => self.nudgeAxis(axis, -5, ..._r)}
                    ><Icon name="minus" size={11} /></button
                  >
                  <input
                    type="range"
                    min={axis?.min}
                    max={axis?.max}
                    step="1"
                    {@attach prop('value', () => axis?.value)}
                    aria-label="{self.jointInfo?.label} {axis?.label}"
                    oninput={(..._r) => self.setAxis(axis, ..._r)}
                  />
                  <button
                    type="button"
                    class="pose-nudge"
                    aria-label="{axis?.label}: more"
                    onclick={(..._r) => self.nudgeAxis(axis, 5, ..._r)}
                    ><Icon name="plus" size={11} /></button
                  >
                  <span class="pose-slider-value">{axis?.value}°</span>
                </div>
              {/each}
            </div>

            <div class="pose-actions">
              <button type="button" class="pose-btn" onclick={self.resetJoint}
                ><Icon name="rotate-ccw" size={12} />
                Reset
                {self.jointInfo?.label}</button
              >
              <button type="button" class="pose-btn" onclick={self.mirror}
                ><Icon name="arrow-right-left" size={12} />
                Mirror</button
              >
              <button type="button" class="pose-btn" onclick={self.randomise}
                ><Icon name="dices" size={12} /> Random</button
              >
              <button
                type="button"
                class="pose-btn"
                disabled={self.isDefault}
                onclick={self.resetPose}
                ><Icon name="rotate-ccw" size={12} /> Reset all</button
              >
            </div>

            <form class="pose-save" onsubmit={self.savePose}>
              <span class="pose-label">Saved poses</span>
              <div class="pose-save-row">
                <input
                  type="text"
                  maxlength="40"
                  placeholder="Name this pose"
                  aria-label="Name for the saved pose"
                  {@attach prop('value', () => self.saveName)}
                  oninput={self.setSaveName}
                />
                <button type="submit" class="pose-btn is-primary"
                  ><Icon name="save" size={12} />
                  Save</button
                >
              </div>
              {#if truthy(self.saves?.length)}
                <ul class="pose-saves">
                  {#each self.saves ?? [] as save (save?.id)}
                    <li>
                      <button
                        type="button"
                        class="pose-chip
                              {truthy(eq(self.activeSave, save?.id))
                          ? 'is-active'
                          : ''}"
                        aria-pressed={truthy(eq(self.activeSave, save?.id))
                          ? 'true'
                          : 'false'}
                        onclick={(..._r) => self.loadSave(save, ..._r)}
                        >{save?.label}</button
                      >
                      <button
                        type="button"
                        class="pose-nudge"
                        aria-label="Delete {save?.label}"
                        title="Delete"
                        onclick={(..._r) => self.deleteSave(save, ..._r)}
                        ><Icon name="trash-2" size={11} /></button
                      >
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="pose-hint">Poses are saved in this browser only.</p>
              {/if}
            </form>
          {:else if truthy(eq(self.tab, 'look'))}
            <div class="pose-row">
              <span class="pose-label">Surface</span>
              <div class="pose-chips">
                {#each self.shadings ?? [] as s}
                  <button
                    type="button"
                    class="pose-chip
                          {truthy(eq(self.settings?.shading, s?.id))
                      ? 'is-active'
                      : ''}"
                    aria-pressed={truthy(eq(self.settings?.shading, s?.id))
                      ? 'true'
                      : 'false'}
                    onclick={(..._r) => self.update('shading', s?.id, ..._r)}
                    >{s?.label}</button
                  >
                {/each}
              </div>
            </div>

            <div class="pose-row">
              <span class="pose-label">Figure</span>
              <div
                class="pose-swatches"
                role="group"
                aria-label="Figure colours"
              >
                {#each self.figureColours ?? [] as colour}
                  <button
                    type="button"
                    class="avatar-swatch
                          {truthy(eq(self.settings?.colour, colour))
                      ? 'active'
                      : ''}"
                    style={swatch(colour)}
                    aria-label={colour}
                    onclick={(..._r) => self.setColour(colour, ..._r)}
                  ></button>
                {/each}
                <ColourField
                  value={self.settings?.colour}
                  label="Figure colour"
                  onChange={self.setColour}
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
                {#each self.backgrounds ?? [] as colour}
                  <button
                    type="button"
                    class="avatar-swatch
                          {truthy(eq(self.settings?.background, colour))
                      ? 'active'
                      : ''}"
                    style={swatch(colour)}
                    aria-label={colour}
                    onclick={(..._r) => self.setBackground(colour, ..._r)}
                  ></button>
                {/each}
                <ColourField
                  value={self.settings?.background}
                  label="Background colour"
                  onChange={self.setBackground}
                />
              </div>
            </div>

            <div class="pose-switches">
              <label class="qr-switch pose-switch">
                <input
                  type="checkbox"
                  role="switch"
                  {@attach prop('checked', () => self.settings?.grid)}
                  aria-checked={truthy(self.settings?.grid) ? 'true' : 'false'}
                  onchange={(..._r) => self.toggle('grid', ..._r)}
                />
                <span class="qr-switch-track" aria-hidden="true"></span>
                Floor grid
              </label>
              <label class="qr-switch pose-switch">
                <input
                  type="checkbox"
                  role="switch"
                  {@attach prop('checked', () => self.settings?.shadows)}
                  aria-checked={truthy(self.settings?.shadows)
                    ? 'true'
                    : 'false'}
                  onchange={(..._r) => self.toggle('shadows', ..._r)}
                />
                <span class="qr-switch-track" aria-hidden="true"></span>
                Shadows
              </label>
              <label class="qr-switch pose-switch">
                <input
                  type="checkbox"
                  role="switch"
                  {@attach prop('checked', () => self.settings?.dots)}
                  aria-checked={truthy(self.settings?.dots) ? 'true' : 'false'}
                  onchange={(..._r) => self.toggle('dots', ..._r)}
                />
                <span class="qr-switch-track" aria-hidden="true"></span>
                Joint dots
              </label>
            </div>
            <p class="pose-hint"
              >The figure is Mannequiny, GDQuest's open mannequin, with
              seventeen joints you can turn. Fingers and toes go with the hand
              and foot.</p
            >

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
                  {@attach prop('value', () => self.settings?.lightAngle)}
                  aria-label="Light angle around the figure"
                  oninput={(..._r) => self.slide('lightAngle', ..._r)}
                />
                <span></span>
                <span class="pose-slider-value"
                  >{self.settings?.lightAngle}°</span
                >
              </div>
              <div class="pose-slider">
                <span class="pose-slider-label">Height</span>
                <span></span>
                <input
                  type="range"
                  min="-10"
                  max="89"
                  step="1"
                  {@attach prop('value', () => self.settings?.lightHeight)}
                  aria-label="Light height"
                  oninput={(..._r) => self.slide('lightHeight', ..._r)}
                />
                <span></span>
                <span class="pose-slider-value"
                  >{self.settings?.lightHeight}°</span
                >
              </div>
              <div class="pose-slider">
                <span class="pose-slider-label">Strength</span>
                <span></span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="1"
                  {@attach prop('value', () => self.settings?.lightPower)}
                  aria-label="Light strength"
                  oninput={(..._r) => self.slide('lightPower', ..._r)}
                />
                <span></span>
                <span class="pose-slider-value"
                  >{self.settings?.lightPower}%</span
                >
              </div>
            </div>
            <div class="pose-actions">
              <button type="button" class="pose-btn" onclick={self.resetLight}
                ><Icon name="rotate-ccw" size={12} />
                Reset the light</button
              >
            </div>
          {:else}
            <div class="pose-sliders">
              <div class="pose-slider">
                <span class="pose-slider-label">Lens</span>
                <span></span>
                <input
                  type="range"
                  min="12"
                  max="100"
                  step="1"
                  {@attach prop('value', () => self.settings?.fov)}
                  aria-label="Field of view"
                  oninput={(..._r) => self.slide('fov', ..._r)}
                />
                <span></span>
                <span class="pose-slider-value">{self.settings?.fov}°</span>
              </div>
            </div>
            <p class="pose-hint"
              >A narrow lens flattens the figure like a telephoto; a wide one
              exaggerates whatever is nearest, the way a low camera makes legs
              long.</p
            >

            <div class="pose-row">
              <span class="pose-label">Picture</span>
              <div class="pose-chips">
                {#each self.photoSizes ?? [] as s}
                  <button
                    type="button"
                    class="pose-chip
                          {truthy(eq(self.photoSize, s?.id))
                      ? 'is-active'
                      : ''}"
                    aria-pressed={truthy(eq(self.photoSize, s?.id))
                      ? 'true'
                      : 'false'}
                    onclick={(..._r) => self.setPhotoSize(s?.id, ..._r)}
                    >{s?.label}</button
                  >
                {/each}
              </div>
            </div>
            <label class="qr-switch pose-switch">
              <input
                type="checkbox"
                role="switch"
                {@attach prop('checked', () => self.transparent)}
                aria-checked={truthy(self.transparent) ? 'true' : 'false'}
                onchange={self.setTransparent}
              />
              <span class="qr-switch-track" aria-hidden="true"></span>
              Transparent background
            </label>
            <div class="pose-actions">
              <button
                type="button"
                class="pose-btn is-primary"
                onclick={self.download}
                ><Icon name="download" size={12} />
                Save a picture</button
              >
            </div>
            <p class="pose-hint"
              >Pictures are 16:9, the same framing as the stage, without the
              dots.</p
            >
          {/if}
        </div>
      {/if}
    </div>
  </div>
</ToolPage>
