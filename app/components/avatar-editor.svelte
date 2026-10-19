<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import ColourField from './colour-field.svelte';
  import AvatarPortrait from './avatar-portrait.svelte';
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
  } from '../utils/avatar.js';
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
  } from '../utils/pose.js';
  import { loadSaves, storeSaves, MAX_SAVES } from '../utils/avatar-saves.js';
  import { sfx } from '../utils/sound.svelte.js';
  import { askConfirm } from '../utils/confirm.svelte.js';

  const eq = (a, b) => a === b;
  const has = (list, id) => list.includes(id);
  const swatch = (color) => `background: ${color}`;

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
  class AvatarEditor extends Component {
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
    noWebGL = $state.raw(false);
    tab = $state.raw('face');
    saves = $state.raw(loadSaves());
    joint = $state.raw('armR');
    framing = $state.raw('full');
    photoSize = $state.raw(1024);
    transparent = $state.raw(true);
    background = $state.raw('#F7F5EF');
    photoUrl = $state.raw(null);
    photoNote = $state.raw('');
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
      import('../lazy/avatar-model.js')
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
        setPoseAngle(
          this.pose,
          this.joint,
          axis.key,
          Number(event.target.value),
        ),
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
        this.photoNote =
          "This browser can't copy images. Use Download instead.";
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
        s.id === current.id
          ? { ...s, avatar: this.avatar, pose: this.pose }
          : s,
      );
      storeSaves(this.saves);
      sfx('ui.confirm');
      this.args.onSaved?.(this.saves.find((s) => s.id === current.id));
    };

    wear = (save) => {
      if (this.args.onWear)
        this.args.onWear({
          avatar: save.avatar,
          pose: save.pose,
          look: save.id,
        });
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
  }

  function pick(object, key) {
    return object[key];
  }

  function bgActive(transparent, background, color) {
    return !transparent && background.toLowerCase() === color.toLowerCase();
  }

  // Chips you can switch on in any combination.

  // Preset swatches plus an editable hex field for each colour.
</script>

<script>
  let args = $props();
  const self = new AvatarEditor(args);
  onDestroy(() => destroy(self));
</script>

{#snippet OptionRow(args)}
  <div class="avatar-option-row">
    <span class="qr-label is-muted">{args.label}</span>
    <div class="avatar-chips" role="group" aria-label={args.label}>
      {#each args.options ?? [] as o}
        <button
          type="button"
          class="home-chip {truthy(eq(args.value, o?.id)) ? 'active' : ''}"
          aria-pressed={truthy(eq(args.value, o?.id)) ? 'true' : 'false'}
          onclick={(..._r) => args.onPick(o?.id, ..._r)}>{o?.label}</button
        >
      {/each}
    </div>
  </div>
{/snippet}

{#snippet MultiRow(args)}
  <div class="avatar-option-row">
    <span class="qr-label is-muted"
      >{args.label}
      <span class="tool-hint">(pick any)</span></span
    >
    <div class="avatar-chips" role="group" aria-label={args.label}>
      {#each args.options ?? [] as o}
        <button
          type="button"
          class="home-chip {truthy(has(args.values, o?.id)) ? 'active' : ''}"
          aria-pressed={truthy(has(args.values, o?.id)) ? 'true' : 'false'}
          onclick={(..._r) => args.onToggle(o?.id, ..._r)}>{o?.label}</button
        >
      {/each}
    </div>
  </div>
{/snippet}

{#snippet ColourRows(args)}
  {#each args.rows ?? [] as row}
    <div class="avatar-color-row">
      <span class="qr-label is-muted">{row?.label}</span>
      <div
        class="avatar-swatches"
        role="group"
        aria-label="{row?.label} colours"
      >
        {#each row?.presets ?? [] as color}
          <button
            type="button"
            class="avatar-swatch
              {truthy(eq(pick(args.avatar, row?.key), color)) ? 'active' : ''}"
            style={swatch(color)}
            aria-label={color}
            onclick={(..._r) => args.onPick(row?.key, color, ..._r)}
          ></button>
        {/each}
      </div>
      <ColourField
        value={pick(args.avatar, row?.key)}
        label="{row?.label} colour"
        onChange={(..._r) => args.onPick(row?.key, ..._r)}
      />
    </div>
  {/each}
{/snippet}

<div class="avatar-editor is-tool">
  <div
    class="avatar-stage"
    {@attach self.follow?.([self.avatar, self.pose, self.posing, self.joint])}
  >
    {#if truthy(self.noWebGL)}
      <AvatarPortrait avatar={self.avatar} size={150} />
    {:else}
      <canvas
        class="avatar-canvas {truthy(self.posing) ? 'is-posing' : ''}"
        aria-label={truthy(self.posing)
          ? 'Your avatar. Drag a joint handle to pose it, or drag the background to turn it.'
          : 'Your avatar. Drag to turn it around.'}
        {@attach self.preview?.()}
      ></canvas>
    {/if}
    {#if !truthy(self.noWebGL)}
      <div class="avatar-view-buttons" role="group" aria-label="View">
        <button type="button" class="btn" onclick={self.viewFront}>Front</button
        >
        <button type="button" class="btn" onclick={self.viewSide}>Side</button>
        <button type="button" class="btn" onclick={self.viewBack}>Back</button>
      </div>
    {/if}
    <div class="avatar-stage-actions">
      <button type="button" class="btn" onclick={self.shuffle}
        ><Icon name="shuffle" size={13} />
        Surprise me</button
      >
      {#if truthy(self.unsaved)}
        <button type="button" class="btn active" onclick={self.updateLook}
          ><Icon name="save" size={13} />
          Update “{self.currentSave?.label}”</button
        >
      {/if}
      <button
        type="button"
        class="btn"
        disabled={truthy(self.canSave) ? false : true}
        onclick={self.saveLook}
        ><Icon name="star" size={13} /> Save as new look</button
      >
    </div>
  </div>

  <div class="avatar-options">
    <div
      class="math-tabs avatar-tabs"
      role="tablist"
      aria-label="Avatar options"
    >
      {#each self.tabs ?? [] as t}
        <button
          type="button"
          role="tab"
          class="qr-tab {truthy(eq(self.tab, t?.id)) ? 'active' : ''}"
          aria-selected={truthy(eq(self.tab, t?.id)) ? 'true' : 'false'}
          onclick={(..._r) => self.setTab(t?.id, ..._r)}
          >{t?.label}{#if truthy(eq(t?.id, 'saved'))}
            ({self.saves?.length}){/if}</button
        >
      {/each}
    </div>

    {#if truthy(eq(self.tab, 'face'))}
      {@render OptionRow({
        label: 'Eyes',
        options: self.eyes,
        value: self.avatar?.eyes,
        onPick: (..._r) => self.update('eyes', ..._r),
      })}
      {@render OptionRow({
        label: 'Eyebrows',
        options: self.brows,
        value: self.avatar?.brows,
        onPick: (..._r) => self.update('brows', ..._r),
      })}
      {@render OptionRow({
        label: 'Nose',
        options: self.noses,
        value: self.avatar?.nose,
        onPick: (..._r) => self.update('nose', ..._r),
      })}
      {@render OptionRow({
        label: 'Mouth',
        options: self.mouths,
        value: self.avatar?.mouth,
        onPick: (..._r) => self.update('mouth', ..._r),
      })}
      {@render MultiRow({
        label: 'Marks',
        options: self.marks,
        values: self.avatar?.marks,
        onToggle: (..._r) => self.toggleIn('marks', ..._r),
      })}
      <div class="avatar-option-row">
        <span class="qr-label is-muted">Positions</span>
        <div class="avatar-sliders">
          {#each self.sliders ?? [] as slider}
            <div class="avatar-slider">
              <span class="avatar-slider-label">{slider?.label}</span>
              <button
                type="button"
                class="qr-icon-btn"
                aria-label="{slider?.label}: less"
                onclick={(..._r) => self.nudge(slider, -1, ..._r)}
                ><Icon name="minus" size={12} /></button
              >
              <input
                type="range"
                min={slider?.min}
                max={slider?.max}
                step="1"
                {@attach prop('value', () => pick(self.avatar, slider?.key))}
                aria-label={slider?.label}
                oninput={(..._r) => self.slide(slider, ..._r)}
              />
              <button
                type="button"
                class="qr-icon-btn"
                aria-label="{slider?.label}: more"
                onclick={(..._r) => self.nudge(slider, 1, ..._r)}
                ><Icon name="plus" size={12} /></button
              >
              <span class="avatar-slider-value"
                >{pick(self.avatar, slider?.key)}</span
              >
            </div>
          {/each}
        </div>
        <button
          type="button"
          class="btn avatar-reset"
          disabled={truthy(self.nudged) ? false : true}
          onclick={self.resetPositions}
          ><Icon name="rotate-ccw" size={13} /> Reset positions</button
        >
      </div>
      {@render ColourRows({
        rows: self.faceColours,
        avatar: self.avatar,
        onPick: self.update,
      })}
    {:else if truthy(eq(self.tab, 'hair'))}
      {@render OptionRow({
        label: 'Hairstyle',
        options: self.hairStyles,
        value: self.avatar?.hair,
        onPick: (..._r) => self.update('hair', ..._r),
      })}
      <label class="qr-switch">
        <input
          type="checkbox"
          role="switch"
          {@attach prop('checked', () => self.avatar?.ahoge)}
          aria-checked={truthy(self.avatar?.ahoge) ? 'true' : 'false'}
          onchange={(..._r) => self.toggle('ahoge', ..._r)}
        />
        <span class="qr-switch-track" aria-hidden="true"></span>
        Stray strand
      </label>
      {@render ColourRows({
        rows: self.hairColours,
        avatar: self.avatar,
        onPick: self.update,
      })}
    {:else if truthy(eq(self.tab, 'clothes'))}
      {@render OptionRow({
        label: 'Top',
        options: self.topsList,
        value: self.avatar?.top,
        onPick: (..._r) => self.update('top', ..._r),
      })}
      {@render OptionRow({
        label: 'Pattern',
        options: self.patterns,
        value: self.avatar?.pattern,
        onPick: (..._r) => self.update('pattern', ..._r),
      })}
      {#if !truthy(eq(self.avatar?.top, 'dress'))}
        {@render OptionRow({
          label: 'Bottoms',
          options: self.bottoms,
          value: self.avatar?.bottom,
          onPick: (..._r) => self.update('bottom', ..._r),
        })}
      {/if}
      {@render OptionRow({
        label: 'Shoes',
        options: self.shoes,
        value: self.avatar?.shoes,
        onPick: (..._r) => self.update('shoes', ..._r),
      })}
      {@render ColourRows({
        rows: self.clothesColours,
        avatar: self.avatar,
        onPick: self.update,
      })}
    {:else if truthy(eq(self.tab, 'extras'))}
      {@render OptionRow({
        label: 'Head',
        options: self.hats,
        value: self.avatar?.hat,
        onPick: (..._r) => self.update('hat', ..._r),
      })}
      {@render OptionRow({
        label: 'Eyewear',
        options: self.eyewear,
        value: self.avatar?.eyewear,
        onPick: (..._r) => self.update('eyewear', ..._r),
      })}
      {@render OptionRow({
        label: 'Mask',
        options: self.masks,
        value: self.avatar?.mask,
        onPick: (..._r) => self.update('mask', ..._r),
      })}
      {@render OptionRow({
        label: 'Neck',
        options: self.neckwear,
        value: self.avatar?.neck,
        onPick: (..._r) => self.update('neck', ..._r),
      })}
      {@render OptionRow({
        label: 'Back',
        options: self.backs,
        value: self.avatar?.back,
        onPick: (..._r) => self.update('back', ..._r),
      })}
      {@render MultiRow({
        label: 'Piercings',
        options: self.piercings,
        values: self.avatar?.piercings,
        onToggle: (..._r) => self.toggleIn('piercings', ..._r),
      })}
      {@render ColourRows({
        rows: self.extraColours,
        avatar: self.avatar,
        onPick: self.update,
      })}
      <p class="tool-hint"
        >Scarves, ties, capes and backpacks use the pattern and details colour
        from Clothes.</p
      >
    {:else if truthy(eq(self.tab, 'pose'))}
      <div class="avatar-option-row">
        <span class="qr-label is-muted">Presets</span>
        <div class="avatar-chips" role="group" aria-label="Pose presets">
          {#each self.posePresets ?? [] as p}
            <button
              type="button"
              class="home-chip {truthy(eq(self.activePreset, p?.id))
                ? 'active'
                : ''}"
              aria-pressed={truthy(eq(self.activePreset, p?.id))
                ? 'true'
                : 'false'}
              onclick={(..._r) => self.pickPreset(p, ..._r)}>{p?.label}</button
            >
          {/each}
        </div>
      </div>
      {@render OptionRow({
        label: 'Expression',
        options: self.expressions,
        value: self.pose?.expression,
        onPick: self.pickExpression,
      })}
      <div class="avatar-option-row">
        <span class="qr-label is-muted"
          >Joint
          <span class="tool-hint"
            >(or click a dot on the avatar and drag it)</span
          ></span
        >
        <div class="avatar-chips" role="group" aria-label="Joint to pose">
          {#each self.joints ?? [] as j}
            <button
              type="button"
              class="home-chip {truthy(eq(self.joint, j?.id)) ? 'active' : ''}"
              aria-pressed={truthy(eq(self.joint, j?.id)) ? 'true' : 'false'}
              onclick={(..._r) => self.pickJoint(j?.id, ..._r)}
              >{j?.label}</button
            >
          {/each}
        </div>
      </div>
      <div
        class="avatar-sliders pose-sliders"
        aria-label="{self.jointInfo?.label} angles"
      >
        {#each self.jointInfo?.axes ?? [] as axis}
          <div class="avatar-slider">
            <span class="avatar-slider-label">{axis?.label}</span>
            <button
              type="button"
              class="qr-icon-btn"
              aria-label="{axis?.label}: less"
              onclick={(..._r) => self.nudgeAngle(axis, -5, ..._r)}
              ><Icon name="minus" size={12} /></button
            >
            <input
              type="range"
              min={axis?.min}
              max={axis?.max}
              step="1"
              {@attach prop('value', () => axis?.value)}
              aria-label="{self.jointInfo?.label} {axis?.label}"
              oninput={(..._r) => self.setAngle(axis, ..._r)}
            />
            <button
              type="button"
              class="qr-icon-btn"
              aria-label="{axis?.label}: more"
              onclick={(..._r) => self.nudgeAngle(axis, 5, ..._r)}
              ><Icon name="plus" size={12} /></button
            >
            <span class="avatar-slider-value">{axis?.value}°</span>
          </div>
        {/each}
      </div>
      <div class="avatar-stage-actions">
        <button type="button" class="btn" onclick={self.resetJoint}
          ><Icon name="rotate-ccw" size={13} />
          Reset
          {self.jointInfo?.label}</button
        >
        <button type="button" class="btn" onclick={self.mirror}
          ><Icon name="arrow-right-left" size={13} />
          Mirror</button
        >
        <button type="button" class="btn" onclick={self.randomise}
          ><Icon name="dices" size={13} /> Random</button
        >
        <button type="button" class="btn" onclick={self.resetPose}
          ><Icon name="person-standing" size={13} /> Reset pose</button
        >
      </div>
      <p class="tool-hint"
        >Strike a pose! It shows on your portrait wherever your avatar appears.
        Save the look to keep it.</p
      >
      <h4 class="avatar-section-title"
        ><Icon name="camera" size={14} />
        Photo</h4
      >
      <div class="avatar-photo" {@attach self.photoFrame?.()}>
        <div class="avatar-option-row">
          <span class="qr-label is-muted">Framing</span>
          <div class="math-tabs" role="group" aria-label="Framing">
            {#each self.framings ?? [] as f}
              <button
                type="button"
                class="qr-tab {truthy(eq(self.framing, f?.id)) ? 'active' : ''}"
                aria-pressed={truthy(eq(self.framing, f?.id))
                  ? 'true'
                  : 'false'}
                onclick={(..._r) => self.setFraming(f?.id, ..._r)}
                >{f?.label}</button
              >
            {/each}
          </div>
        </div>
        <div class="avatar-option-row">
          <span class="qr-label is-muted">Size</span>
          <div class="math-tabs" role="group" aria-label="Image size">
            {#each self.photoSizes ?? [] as s}
              <button
                type="button"
                class="qr-tab {truthy(eq(self.photoSize, s?.id))
                  ? 'active'
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
        <label class="qr-switch">
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
        <div class="avatar-color-row">
          <span class="qr-label is-muted">Background</span>
          <div
            class="avatar-swatches"
            role="group"
            aria-label="Background colours"
          >
            {#each self.backgroundSwatches ?? [] as color}
              <button
                type="button"
                class="avatar-swatch
                      {truthy(
                  bgActive(self.transparent, self.background, color),
                )
                  ? 'active'
                  : ''}"
                style={swatch(color)}
                aria-label={color}
                onclick={(..._r) => self.setBackground(color, ..._r)}
              ></button>
            {/each}
          </div>
          <ColourField
            value={self.background}
            label="Background colour"
            onChange={self.setBackground}
          />
        </div>
        <p class="tool-hint"
          >Turn the avatar to the angle you like first; the photo uses the view
          as it is now, with the pose you set.</p
        >
        <div class="avatar-stage-actions">
          <button
            type="button"
            class="btn active"
            disabled={self.noWebGL}
            onclick={self.takePhoto}
            ><Icon name="camera" size={13} /> Download PNG</button
          >
          <button
            type="button"
            class="btn"
            disabled={self.noWebGL}
            onclick={self.copyPhoto}
            ><Icon name="copy" size={13} /> Copy image</button
          >
        </div>
        {#if truthy(self.photoNote)}<p class="tool-hint" role="status"
            >{self.photoNote}</p
          >{/if}
        {#if truthy(self.photoUrl)}<img
            class="avatar-photo-preview"
            src={self.photoUrl}
            alt="The avatar you last captured"
          />{/if}
      </div>
    {:else}
      {#if truthy(self.saves?.length)}
        <ul class="avatar-saves">
          {#each self.saves ?? [] as save (save?.id)}
            <li
              class="avatar-save {truthy(eq(save?.id, args.lookId))
                ? 'is-worn'
                : ''}"
            >
              <button
                type="button"
                class="avatar-save-wear"
                aria-label="Wear {save?.label}"
                title="Wear this look"
                onclick={(..._r) => self.wear(save, ..._r)}
              >
                <AvatarPortrait
                  avatar={save?.avatar}
                  pose={save?.pose}
                  size={56}
                />
              </button>
              <input
                type="text"
                class="avatar-save-name"
                maxlength="24"
                {@attach prop('value', () => save?.label)}
                aria-label="Name of this look"
                onchange={(..._r) => self.rename(save, ..._r)}
              />
              {#if truthy(eq(save?.id, args.lookId))}<span class="lobby-tag"
                  >In use</span
                >{/if}
              <button
                type="button"
                class="qr-icon-btn"
                aria-label="Delete {save?.label}"
                onclick={(..._r) => self.forget(save, ..._r)}
                ><Icon name="trash-2" size={13} /></button
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="tool-hint"
          >Nothing saved yet. Hit Save as new look to keep this one. Make as
          many characters as you like and swap between them in Settings or any
          lobby.</p
        >
      {/if}
      <p class="tool-hint"
        >Up to
        {self.maxSaves}
        characters, poses and all, kept in this browser.</p
      >
    {/if}
  </div>
</div>
