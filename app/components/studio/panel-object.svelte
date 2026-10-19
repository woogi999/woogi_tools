<script module>
  import { onDestroy } from 'svelte';
  import Component from '../../core/component.js';
  import { truthy, prop } from '../../core/helpers.js';
  import { destroy } from '../../core/destroyable.js';
  import Icon from '../icon.svelte';
  import StNum from './num.svelte';
  import StParams from './params.svelte';

  // The Object tab: transform, how the object is made (primitive recipe or
  // mesh), its modifier stack, and type-specific settings. In the Sculpt and
  // UV workspaces it also carries their settings.

  const eq = (a, b) => a === b;
  const neq = (a, b) => a !== b;
  const not = (x) => !x;
  const or = (...xs) => xs.some(Boolean);
  const AXES = [0, 1, 2];
  const AXIS = ['x', 'y', 'z'];
  const at = (list, i) => list?.[i];

  const LIGHT_KINDS = [
    { value: 'point', label: 'Point' },
    { value: 'spot', label: 'Spot' },
    { value: 'directional', label: 'Sun' },
    { value: 'ambient', label: 'Ambient' },
  ];

  class StudioObjectPanel extends Component {
    axes = AXES;
    axisName = AXIS;
    lightKinds = LIGHT_KINDS;

    get s() {
      return this.args.s;
    }

    get o() {
      return this.s.obj;
    }

    // What the fields show: animated values in the Animate workspace.
    get pos() {
      return this.s.shown(this.o, 'pos');
    }
    get rot() {
      return this.s.shown(this.o, 'rot');
    }
    get scl() {
      return this.s.shown(this.o, 'scl');
    }

    get falloffs() {
      return ['smooth', 'linear', 'sharp', 'soft', 'constant'];
    }

    get outlineParams() {
      return [
        {
          key: 'thickness',
          label: 'Thickness',
          type: 'number',
          min: 0,
          max: 5,
          step: 0.002,
        },
        {
          key: 'smoothness',
          label: 'Smoothness',
          type: 'int',
          min: 0,
          max: 10,
          step: 1,
        },
        { key: 'invert', label: 'Inverted normals', type: 'bool' },
      ];
    }

    get lightParams() {
      const k = this.o?.light?.kind;
      const p = [
        {
          key: 'intensity',
          label: 'Intensity',
          type: 'number',
          min: 0,
          max: 1000,
          step: 0.1,
        },
      ];
      if (k === 'point' || k === 'spot')
        p.push({
          key: 'range',
          label: 'Range (0 = ∞)',
          type: 'number',
          min: 0,
          max: 1000,
          step: 0.1,
        });
      if (k === 'spot')
        p.push({
          key: 'angle',
          label: 'Angle',
          type: 'number',
          min: 1,
          max: 89,
          step: 1,
        });
      if (k !== 'ambient')
        p.push({ key: 'shadows', label: 'Shadows', type: 'bool' });
      return p;
    }

    get cameraParams() {
      return [
        {
          key: 'fov',
          label: 'Field of view',
          type: 'number',
          min: 5,
          max: 150,
          step: 1,
        },
        {
          key: 'near',
          label: 'Near',
          type: 'number',
          min: 0.001,
          max: 10,
          step: 0.01,
        },
        {
          key: 'far',
          label: 'Far',
          type: 'number',
          min: 1,
          max: 100000,
          step: 1,
        },
      ];
    }

    get controlShapes() {
      return this.s.E.CONTROL_SHAPES;
    }

    setPos = (axis, v, final) => this.s.setTransform('pos', axis, v, final);
    setRot = (axis, v, final) => this.s.setTransform('rot', axis, v, final);
    setScl = (axis, v, final) => this.s.setTransform('scl', axis, v, final);
    setUniform = (v, final) => {
      for (const a of AXES) this.s.setTransform('scl', a, v, final && a === 2);
    };

    addMod = (e) => {
      if (e.target.value) this.s.addModifier(e.target.value);
      e.target.value = '';
    };

    setLightKind = (e) => this.s.setLight('kind', e.target.value, true);
    setLightColor = (e) => this.s.setLight('color', e.target.value, true);
    setControlShape = (e) => this.s.setControl('shape', e.target.value, true);
    setControlColor = (e) => this.s.setControl('color', e.target.value, true);
    setControlSize = (v, final) => this.s.setControl('size', v, final);
    setOutlineColor = (e) => this.s.setMat('color', e.target.value, true);
    modParam = (modId, key, v, final) =>
      this.s.setModParam(modId, key, v, final);
    setFalloff = (which, e) =>
      this.s.setBrush(which, 'falloff', e.target.value);
    sculptNum = (key, v) => this.s.setBrush('sculpt', key, v);
    setUvAngle = (v) => (this.s.uvAngle = v);
    shade = (smooth) => {
      if (this.s.mode !== 'edit') {
        this.s.enterEdit('face');
        this.s.runOp('shade', { smooth });
        this.s.exitEdit();
      } else this.s.runOp('shade', { smooth });
    };
  }
</script>

<script>
  let args = $props();
  const self = new StudioObjectPanel(args);
  onDestroy(() => destroy(self));
</script>

{#if truthy(eq(args.s?.workspace, 'sculpt'))}
  <section class="st-section">
    <h3 class="st-h">Sculpt brush</h3>
    <StNum
      label="Radius (px)"
      value={args.s?.sculptBrush?.size}
      min={2}
      max={400}
      step={1}
      int={true}
      onChange={(..._r) => self.sculptNum('size', ..._r)}
    />
    <StNum
      label="Strength"
      value={args.s?.sculptBrush?.strength}
      min={0}
      max={1}
      step={0.01}
      onChange={(..._r) => self.sculptNum('strength', ..._r)}
    />
    <StNum
      label="Hardness"
      value={args.s?.sculptBrush?.hardness}
      min={0}
      max={0.95}
      step={0.01}
      onChange={(..._r) => self.sculptNum('hardness', ..._r)}
    />
    <label class="st-field"
      ><span>Falloff</span>
      <select onchange={(..._r) => self.setFalloff('sculpt', ..._r)}>
        {#each self.falloffs ?? [] as f}<option
            value={f}
            {@attach prop('selected', () =>
              eq(f, args.s?.sculptBrush?.falloff),
            )}>{f}</option
          >{/each}
      </select>
    </label>
    <div class="st-row-btns">
      <span class="st-label">Symmetry</span>
      {#each self.axes ?? [] as a}
        <button
          type="button"
          class="st-axis
                {at(self.axisName, a)}
                {truthy(at(args.s?.sculptBrush?.symmetry, a)) ? 'on' : ''}"
          onclick={(..._r) => args.s?.toggleSymmetry('sculpt', a, ..._r)}
          >{at(self.axisName, a)}</button
        >
      {/each}
    </div>
    <label class="st-check"
      ><input
        type="checkbox"
        {@attach prop('checked', () => args.s?.sculptBrush?.invert)}
        onchange={(..._r) =>
          args.s?.setBrush(
            'sculpt',
            'invert',
            not(args.s?.sculptBrush?.invert),
            ..._r,
          )}
      /><span>Invert (dig in)</span></label
    >
  </section>
  <section class="st-section">
    <h3 class="st-h">Detail</h3>
    <p class="st-note">Sculpting moves vertices, so it needs enough of them.</p>
    <div class="st-btns">
      <button
        type="button"
        class="st-btn st-subdivide"
        onclick={(..._r) => args.s?.sculptSubdivide(1, ..._r)}
        ><Icon name="grid-3x3" size={13} />Subdivide</button
      >
      <button type="button" class="st-btn" onclick={args.s?.sculptSmoothAll}
        ><Icon name="waves" size={13} />Smooth all</button
      >
      <button type="button" class="st-btn" onclick={args.s?.sculptDecimate}
        ><Icon name="shrink" size={13} />Decimate</button
      >
    </div>
  </section>
{/if}

{#if truthy(eq(args.s?.workspace, 'uv'))}
  <section class="st-section">
    <h3 class="st-h">Unwrap</h3>
    <p class="st-note">Works on the selected faces (all of them if none are).</p
    >
    <div class="st-btns">
      <button
        type="button"
        class="st-btn st-uv-auto"
        onclick={(..._r) => args.s?.uvOp('auto', ..._r)}
        ><Icon name="wand-sparkles" size={13} />Auto unwrap</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('view', ..._r)}
        ><Icon name="camera" size={13} />From view</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('planar', ..._r)}
        ><Icon name="square" size={13} />Planar</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('box', ..._r)}
        ><Icon name="box" size={13} />Box</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('cylinder', ..._r)}
        ><Icon name="cylinder" size={13} />Cylinder</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('sphere', ..._r)}
        ><Icon name="globe" size={13} />Sphere</button
      >
    </div>
    <StNum
      label="Auto angle"
      value={args.s?.uvAngle}
      min={5}
      max={89}
      step={1}
      int={true}
      onChange={self.setUvAngle}
    />
  </section>
  <section class="st-section">
    <h3 class="st-h">Arrange</h3>
    <div class="st-btns">
      <button
        type="button"
        class="st-btn st-uv-pack"
        onclick={(..._r) => args.s?.uvOp('pack', ..._r)}
        ><Icon name="layout-grid" size={13} />Pack</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('relax', ..._r)}
        ><Icon name="waves" size={13} />Relax</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('fit', ..._r)}
        ><Icon name="maximize" size={13} />Fit</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('rotate', 90, ..._r)}
        ><Icon name="rotate-cw" size={13} />Rotate 90°</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('flipU', ..._r)}
        ><Icon name="flip-horizontal" size={13} />Flip U</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('flipV', ..._r)}
        ><Icon name="flip-vertical" size={13} />Flip V</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('grow', ..._r)}
        ><Icon name="zoom-in" size={13} />Scale up</button
      >
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.uvOp('shrink', ..._r)}
        ><Icon name="zoom-out" size={13} />Scale down</button
      >
    </div>
    {#if truthy(args.s?.uvStats)}
      <p class="st-note st-uv-stats"
        >{args.s?.uvStats?.islands}
        islands ·
        {args.s?.uvStats?.coverage}% of the texture used{#if truthy(args.s?.uvStats?.overlap)}
          · {args.s?.uvStats?.overlap}% overlapping{/if}</p
      >
    {/if}
  </section>
{/if}

{#if truthy(self.o)}
  <section class="st-section">
    <h3 class="st-h"><Icon name="box" size={13} />{self.o?.name}</h3>
    <div class="st-vec">
      <span class="st-label">Location</span>
      {#each self.axes ?? [] as a}
        <StNum
          axis={at(self.axisName, a)}
          value={at(self.pos, a)}
          step={0.05}
          onChange={(..._r) => self.setPos(a, ..._r)}
        />
      {/each}
      <button
        type="button"
        class="st-mini"
        title="Clear location"
        aria-label="Clear location"
        onclick={(..._r) => args.s?.resetTransform('pos', ..._r)}
        ><Icon name="x" size={11} /></button
      >
    </div>
    <div class="st-vec">
      <span class="st-label">Rotation</span>
      {#each self.axes ?? [] as a}
        <StNum
          axis={at(self.axisName, a)}
          value={at(self.rot, a)}
          step={1}
          onChange={(..._r) => self.setRot(a, ..._r)}
        />
      {/each}
      <button
        type="button"
        class="st-mini"
        title="Clear rotation"
        aria-label="Clear rotation"
        onclick={(..._r) => args.s?.resetTransform('rot', ..._r)}
        ><Icon name="x" size={11} /></button
      >
    </div>
    <div class="st-vec">
      <span class="st-label">Scale</span>
      {#each self.axes ?? [] as a}
        <StNum
          axis={at(self.axisName, a)}
          value={at(self.scl, a)}
          step={0.02}
          onChange={(..._r) => self.setScl(a, ..._r)}
        />
      {/each}
      <button
        type="button"
        class="st-mini"
        title="Clear scale"
        aria-label="Clear scale"
        onclick={(..._r) => args.s?.resetTransform('scl', ..._r)}
        ><Icon name="x" size={11} /></button
      >
    </div>
    {#if !truthy(args.compact)}
      <div class="st-btns">
        <button type="button" class="st-btn" onclick={args.s?.duplicateSelected}
          ><Icon name="copy" size={13} />Duplicate</button
        >
        <button type="button" class="st-btn" onclick={args.s?.dropToGround}
          ><Icon name="arrow-down" size={13} />To ground</button
        >
        <button type="button" class="st-btn" onclick={args.s?.groupSelected}
          ><Icon name="folder" size={13} />Group</button
        >
        {#if truthy(or(eq(self.o?.type, 'group'), self.o?.children?.length))}
          <button
            type="button"
            class="st-btn"
            onclick={(..._r) => args.s?.ungroup(self.o?.id, ..._r)}
            ><Icon name="ungroup" size={13} />Ungroup</button
          >
        {/if}
        {#if truthy(neq(args.s?.selected?.length, 1))}
          <button
            type="button"
            class="st-btn"
            title="Parent the other selected objects to this one"
            onclick={args.s?.parentToActive}
            ><Icon name="link" size={13} />Parent</button
          >
        {/if}
        {#if truthy(self.o?.parent)}
          <button
            type="button"
            class="st-btn"
            onclick={args.s?.unparentSelected}
            ><Icon name="unlink" size={13} />Unparent</button
          >
        {/if}
        <button
          type="button"
          class="st-btn st-danger"
          onclick={args.s?.deleteSelected}
          ><Icon name="trash-2" size={13} />Delete</button
        >
      </div>
    {/if}
  </section>

  {#if truthy(args.compact)}
    <!-- The Animate workspace only needs the transform. -->
  {:else if truthy(eq(self.o?.type, 'mesh'))}
    {#if truthy(eq(self.o?.source?.kind, 'primitive'))}
      <section class="st-section st-prim">
        <h3 class="st-h"
          ><Icon name={args.s?.primDef?.icon} size={13} />{args.s?.primDef
            ?.label}
          <span class="st-h-note">recipe, editable any time</span></h3
        >
        <StParams
          params={args.s?.primDef?.params}
          values={args.s?.primValues}
          onChange={args.s?.setPrimParam}
        />
        {#if truthy(args.s?.primDef?.radius)}
          <StNum
            label="Radius (both ends)"
            value={args.s?.primValues?.radiusBottom}
            min={0}
            max={100}
            step={0.05}
            onChange={(..._r) => args.s?.setPrimParam('radius', ..._r)}
          />
        {/if}
        <div class="st-btns">
          <button type="button" class="st-btn" onclick={args.s?.resetPrim}
            ><Icon name="rotate-ccw" size={13} />Reset</button
          >
          <button
            type="button"
            class="st-btn"
            title="Freeze the recipe into an editable mesh"
            onclick={(..._r) => args.s?.convertToMesh(self.o?.id, ..._r)}
            ><Icon name="spline-pointer" size={13} />Convert to mesh</button
          >
        </div>
      </section>
    {:else if truthy(eq(self.o?.source?.kind, 'outline'))}
      <section class="st-section">
        <h3 class="st-h"
          ><Icon name="circle-dashed" size={13} />Linked outline</h3
        >
        <StParams
          params={self.outlineParams}
          values={self.o?.source}
          onChange={args.s?.setOutline}
        />
        <label class="st-field"
          ><span>Colour</span><input
            type="color"
            {@attach prop('value', () => args.s?.mat?.color)}
            onchange={self.setOutlineColor}
          /></label
        >
      </section>
    {:else}
      <section class="st-section">
        <h3 class="st-h"
          ><Icon name="spline-pointer" size={13} />Editable mesh</h3
        >
        <div class="st-btns">
          <button
            type="button"
            class="st-btn"
            onclick={(..._r) => args.s?.setMode('edit', ..._r)}
            ><Icon name="spline-pointer" size={13} />Edit (Tab)</button
          >
          <button
            type="button"
            class="st-btn"
            onclick={(..._r) => self.shade(true, ..._r)}
            ><Icon name="circle" size={13} />Shade smooth</button
          >
          <button
            type="button"
            class="st-btn"
            onclick={(..._r) => self.shade(false, ..._r)}
            ><Icon name="hexagon" size={13} />Shade flat</button
          >
        </div>
      </section>
    {/if}

    <section class="st-section st-stack">
      <h3 class="st-h"><Icon name="layers" size={13} />Modifiers</h3>
      {#each args.s?.stackRows ?? [] as row (row?.mod?.id)}
        <div
          class="st-mod {truthy(row?.mod?.on) ? '' : 'is-off'}"
          data-type={row?.mod?.type}
        >
          <div class="st-mod-head">
            <Icon name={row?.def?.icon} size={13} />
            <span class="st-mod-name"
              >{row?.def?.label}{#if truthy(eq(row?.mod?.type, 'boolean'))}
                · {row?.values?.op}{/if}</span
            >
            <button
              type="button"
              class="st-mini"
              title={truthy(row?.mod?.on) ? 'Turn off' : 'Turn on'}
              aria-label="Toggle"
              onclick={(..._r) => args.s?.toggleMod(row?.mod?.id, ..._r)}
              ><Icon
                name={truthy(row?.mod?.on) ? 'eye' : 'eye-off'}
                size={11}
              /></button
            >
            <button
              type="button"
              class="st-mini"
              title="Move up"
              aria-label="Move up"
              disabled={row?.first}
              onclick={(..._r) => args.s?.moveMod(row?.mod?.id, -1, ..._r)}
              ><Icon name="arrow-up" size={11} /></button
            >
            <button
              type="button"
              class="st-mini"
              title="Move down"
              aria-label="Move down"
              disabled={row?.last}
              onclick={(..._r) => args.s?.moveMod(row?.mod?.id, 1, ..._r)}
              ><Icon name="arrow-down" size={11} /></button
            >
            <button
              type="button"
              class="st-mini"
              title="Apply (bake into the mesh)"
              aria-label="Apply"
              onclick={(..._r) => args.s?.applyMod(row?.mod?.id, ..._r)}
              ><Icon name="check" size={11} /></button
            >
            <button
              type="button"
              class="st-mini"
              title="Remove"
              aria-label="Remove"
              onclick={(..._r) => args.s?.removeMod(row?.mod?.id, ..._r)}
              ><Icon name="x" size={11} /></button
            >
          </div>
          <StParams
            params={row?.def?.params}
            values={row?.values}
            objects={args.s?.objectChoices}
            onChange={(..._r) => self.modParam(row?.mod?.id, ..._r)}
          />
        </div>
      {:else}
        <p class="st-note"
          >No modifiers. They change the mesh without touching its recipe, and
          can be retuned, reordered or removed at any time.</p
        >
      {/each}
      <select
        class="st-add-mod"
        aria-label="Add modifier"
        onchange={self.addMod}
      >
        <option value="">Add modifier…</option>
        {#each args.s?.modifierTypes ?? [] as m}<option value={m?.type}
            >{m?.label}</option
          >{/each}
      </select>
      {#if truthy(args.s?.stackRows?.length)}
        <button
          type="button"
          class="st-btn st-wide"
          onclick={(..._r) => args.s?.applyAll(self.o?.id, ..._r)}
          ><Icon name="check" size={13} />Apply all modifiers</button
        >
      {/if}
    </section>

    <section class="st-section">
      <h3 class="st-h"><Icon name="combine" size={13} />Booleans</h3>
      <p class="st-note"
        >Adds a cutter you can move and reshape; the result updates as you do.</p
      >
      <div class="st-btns">
        <button
          type="button"
          class="st-btn st-bool-subtract"
          onclick={(..._r) => args.s?.addBoolean('subtract', 'cylinder', ..._r)}
          >Subtract</button
        >
        <button
          type="button"
          class="st-btn"
          onclick={(..._r) => args.s?.addBoolean('union', 'cube', ..._r)}
          >Union</button
        >
        <button
          type="button"
          class="st-btn"
          onclick={(..._r) => args.s?.addBoolean('intersect', 'sphere', ..._r)}
          >Intersect</button
        >
      </div>
      {#if truthy(neq(args.s?.selected?.length, 1))}
        <p class="st-note">Or use the other selected objects as cutters:</p>
        <div class="st-btns">
          <button
            type="button"
            class="st-btn"
            onclick={(..._r) => args.s?.booleanFromSelection('subtract', ..._r)}
            >Subtract selected</button
          >
          <button
            type="button"
            class="st-btn"
            onclick={(..._r) => args.s?.booleanFromSelection('union', ..._r)}
            >Union selected</button
          >
          <button
            type="button"
            class="st-btn"
            onclick={(..._r) =>
              args.s?.booleanFromSelection('intersect', ..._r)}
            >Intersect selected</button
          >
        </div>
      {/if}
      <button
        type="button"
        class="st-btn st-wide st-create-outline"
        onclick={args.s?.createOutline}
        ><Icon name="circle-dashed" size={13} />Create outline</button
      >
    </section>
  {:else if truthy(eq(self.o?.type, 'light'))}
    <section class="st-section">
      <h3 class="st-h"><Icon name="lightbulb" size={13} />Light</h3>
      <label class="st-field"
        ><span>Kind</span>
        <select onchange={self.setLightKind}>
          {#each self.lightKinds ?? [] as k}<option
              value={k?.value}
              {@attach prop('selected', () =>
                eq(k?.value, self.o?.light?.kind),
              )}>{k?.label}</option
            >{/each}
        </select>
      </label>
      <label class="st-field"
        ><span>Colour</span><input
          type="color"
          {@attach prop('value', () => self.o?.light?.color)}
          onchange={self.setLightColor}
        /></label
      >
      <StParams
        params={self.lightParams}
        values={self.o?.light}
        onChange={args.s?.setLight}
      />
    </section>
  {:else if truthy(eq(self.o?.type, 'camera'))}
    <section class="st-section">
      <h3 class="st-h"><Icon name="camera" size={13} />Camera</h3>
      <StParams
        params={self.cameraParams}
        values={self.o?.camera}
        onChange={args.s?.setCamera}
      />
      <button type="button" class="st-btn st-wide" onclick={args.s?.lookThrough}
        ><Icon name="eye" size={13} />Look through</button
      >
    </section>
  {:else if truthy(eq(self.o?.type, 'control'))}
    <section class="st-section">
      <h3 class="st-h"><Icon name="circle-dot" size={13} />Controller</h3>
      <label class="st-field"
        ><span>Shape</span>
        <select onchange={self.setControlShape}>
          {#each self.controlShapes ?? [] as sh}<option
              value={sh}
              {@attach prop('selected', () => eq(sh, self.o?.control?.shape))}
              >{sh}</option
            >{/each}
        </select>
      </label>
      <StNum
        label="Size"
        value={self.o?.control?.size}
        min={0.01}
        max={20}
        step={0.01}
        onChange={self.setControlSize}
      />
      <label class="st-field"
        ><span>Colour</span><input
          type="color"
          {@attach prop('value', () => self.o?.control?.color)}
          onchange={self.setControlColor}
        /></label
      >
    </section>
  {:else if truthy(eq(self.o?.type, 'armature'))}
    <section class="st-section">
      <h3 class="st-h"><Icon name="bone" size={13} />Armature</h3>
      <p class="st-note"
        >{self.o?.bones?.length}
        bones. Rig it in the Rig workspace (F6).</p
      >
    </section>
  {/if}
{:else if truthy(not(or(eq(args.s?.workspace, 'sculpt'), args.compact)))}
  <section class="st-section">
    <p class="st-note"
      >Select something to see its properties, or add a shape with
      <strong>+</strong>
      in the tool strip.</p
    >
  </section>
{/if}
