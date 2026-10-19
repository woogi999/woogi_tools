<script module>
  import { onDestroy } from 'svelte';
  import Component from '../../core/component.js';
  import { truthy } from '../../core/helpers.js';
  import { destroy } from '../../core/destroyable.js';
  import Icon from '../icon.svelte';
  import StNum from './num.svelte';

  // The tool strip down the left of the viewport. What's on it depends on the
  // workspace; the common transform tools and snapping sit at the bottom.

  const eq = (a, b) => a === b;
  const or = (...xs) => xs.some(Boolean);

  const TRANSFORM = [
    { id: 'select', label: 'Select (Ctrl 1)', icon: 'mouse-pointer-2' },
    { id: 'move', label: 'Move (Ctrl 2)', icon: 'move-3d' },
    { id: 'scale', label: 'Scale (Ctrl 3)', icon: 'scale-3d' },
    { id: 'rotate', label: 'Rotate (Ctrl 4)', icon: 'rotate-3d' },
  ];

  const PAINT_TOOLS = [
    { id: 'brush', label: 'Brush', icon: 'paintbrush' },
    { id: 'eraser', label: 'Eraser', icon: 'eraser' },
    { id: 'fill', label: 'Fill', icon: 'paint-bucket' },
    { id: 'picker', label: 'Colour picker', icon: 'pipette' },
    { id: 'smudge', label: 'Smudge', icon: 'hand' },
    { id: 'blur', label: 'Blur', icon: 'droplet' },
    { id: 'projection', label: 'Texture projection', icon: 'image' },
    { id: 'stencil', label: 'Stencil', icon: 'stamp' },
    { id: 'decal', label: 'Decal', icon: 'sticker' },
    { id: 'gradient', label: 'Gradient', icon: 'blend' },
  ];

  const EDIT_OPS = [
    ['extrude', { distance: 0.25 }],
    ['inset', { amount: 0.08 }],
    ['bevel', { width: 0.05, segments: 1 }],
    ['loopcut', { cuts: 1, offset: 0 }],
    ['bridge', {}],
    ['merge', { at: 'center' }],
    ['weld', { distance: 0.001 }],
    ['flip', {}],
    ['subdivide', { levels: 1, smooth: false }],
    ['smooth', { iterations: 2, factor: 0.5 }],
    ['delete', {}],
  ];

  class StudioToolbar extends Component {
    transform = TRANSFORM;
    paintTools = PAINT_TOOLS;

    get s() {
      return this.args.s;
    }

    get editOps() {
      const defs = this.s.opDefs;
      return EDIT_OPS.map(([name, params]) => ({
        ...defs[name],
        name,
        params,
      }));
    }

    get sculptBrushes() {
      return Object.entries(this.s.E.sculpt.SCULPT_BRUSHES).map(([id, v]) => ({
        id,
        ...v,
      }));
    }

    get weightTools() {
      return Object.entries(this.s.E.sculpt.WEIGHT_TOOLS).map(([id, v]) => ({
        id,
        ...v,
      }));
    }

    get primitives() {
      return Object.entries(this.s.E.PRIMITIVES).map(([id, v]) => ({
        id,
        label: v.label,
        icon: v.icon,
      }));
    }

    get showTransform() {
      const s = this.s;
      return ['object', 'edit', 'pose', 'bones'].includes(s.mode);
    }

    toggleAdd = () => (this.s.addMenu = !this.s.addMenu);
    flipSpace = () =>
      (this.s.space = this.s.space === 'local' ? 'world' : 'local');
    run = (name, params) => this.s.runOp(name, { ...params });
    gridSize = (v) => this.s.setSnap('gridSize', v);
    rotStep = (v) => this.s.setSnap('rotateStep', v);
  }

  function concat(...parts) {
    return parts.join('');
  }
</script>

<script>
  let args = $props();
  const self = new StudioToolbar(args);
  onDestroy(() => destroy(self));
</script>

<nav class="st-tools" aria-label="Tools">
  {#if truthy(or(eq(args.s?.workspace, 'model'), eq(args.s?.workspace, 'material'), eq(args.s?.workspace, 'uv')))}
    <div class="st-tool-group">
      <button
        type="button"
        class="st-tool {truthy(eq(args.s?.mode, 'object')) ? 'active' : ''}"
        title="Object mode"
        aria-label="Object mode"
        onclick={(..._r) => args.s?.setMode('object', ..._r)}
        ><Icon name="box" size={16} /></button
      >
      <button
        type="button"
        class="st-tool st-edit-mode {truthy(eq(args.s?.mode, 'edit'))
          ? 'active'
          : ''}"
        title="Edit mode (Tab)"
        aria-label="Edit mode"
        onclick={(..._r) => args.s?.setMode('edit', ..._r)}
        ><Icon name="spline-pointer" size={16} /></button
      >
    </div>
  {/if}

  {#if truthy(eq(args.s?.mode, 'edit'))}
    <div class="st-tool-group">
      <button
        type="button"
        class="st-tool st-sel-vert {truthy(eq(args.s?.edit?.mode, 'vert'))
          ? 'active'
          : ''}"
        title="Vertices (1)"
        aria-label="Vertex select"
        onclick={(..._r) => args.s?.setSelectMode('vert', ..._r)}
        ><Icon name="dot" size={16} /></button
      >
      <button
        type="button"
        class="st-tool st-sel-edge {truthy(eq(args.s?.edit?.mode, 'edge'))
          ? 'active'
          : ''}"
        title="Edges (2)"
        aria-label="Edge select"
        onclick={(..._r) => args.s?.setSelectMode('edge', ..._r)}
        ><Icon name="minus" size={16} /></button
      >
      <button
        type="button"
        class="st-tool st-sel-face {truthy(eq(args.s?.edit?.mode, 'face'))
          ? 'active'
          : ''}"
        title="Faces (3)"
        aria-label="Face select"
        onclick={(..._r) => args.s?.setSelectMode('face', ..._r)}
        ><Icon name="square" size={16} /></button
      >
    </div>
    {#if truthy(eq(args.s?.workspace, 'model'))}
      <div class="st-tool-group">
        {#each self.editOps ?? [] as op}
          <button
            type="button"
            class="st-tool st-op-{op?.name}"
            title="{op?.label}{truthy(op?.key)
              ? concat(' (', op?.key, ')')
              : ''}"
            aria-label={op?.label}
            onclick={(..._r) => self.run(op?.name, op?.params, ..._r)}
            ><Icon name={op?.icon} size={16} /></button
          >
        {/each}
        <button
          type="button"
          class="st-tool"
          title="Separate (P)"
          aria-label="Separate"
          onclick={args.s?.separateSel}><Icon name="split" size={16} /></button
        >
      </div>
    {/if}
  {/if}

  {#if truthy(eq(args.s?.workspace, 'sculpt'))}
    <div class="st-tool-group">
      {#each self.sculptBrushes ?? [] as b}
        <button
          type="button"
          class="st-tool st-sculpt-{b?.id}
                {truthy(eq(args.s?.sculptBrush?.tool, b?.id)) ? 'active' : ''}"
          title={b?.label}
          aria-label={b?.label}
          onclick={(..._r) => args.s?.setBrush('sculpt', 'tool', b?.id, ..._r)}
          ><Icon name={b?.icon} size={16} /></button
        >
      {/each}
    </div>
  {/if}

  {#if truthy(eq(args.s?.workspace, 'texture'))}
    <div class="st-tool-group">
      {#each self.paintTools ?? [] as t}
        <button
          type="button"
          class="st-tool st-paint-{t?.id}
                {truthy(eq(args.s?.brush?.tool, t?.id)) ? 'active' : ''}"
          title={t?.label}
          aria-label={t?.label}
          onclick={(..._r) => args.s?.setBrush('paint', 'tool', t?.id, ..._r)}
          ><Icon name={t?.icon} size={16} /></button
        >
      {/each}
    </div>
  {/if}

  {#if truthy(eq(args.s?.workspace, 'rig'))}
    <div class="st-tool-group">
      <button
        type="button"
        class="st-tool {truthy(eq(args.s?.mode, 'object')) ? 'active' : ''}"
        title="Object mode"
        aria-label="Object mode"
        onclick={(..._r) => args.s?.setMode('object', ..._r)}
        ><Icon name="box" size={16} /></button
      >
      <button
        type="button"
        class="st-tool st-bones-mode {truthy(eq(args.s?.mode, 'bones'))
          ? 'active'
          : ''}"
        title="Edit bones"
        aria-label="Edit bones"
        onclick={(..._r) => args.s?.setMode('bones', ..._r)}
        ><Icon name="bone" size={16} /></button
      >
      <button
        type="button"
        class="st-tool st-pose-mode {truthy(eq(args.s?.mode, 'pose'))
          ? 'active'
          : ''}"
        title="Pose"
        aria-label="Pose mode"
        onclick={(..._r) => args.s?.setMode('pose', ..._r)}
        ><Icon name="person-standing" size={16} /></button
      >
      <button
        type="button"
        class="st-tool st-weight-mode {truthy(eq(args.s?.mode, 'weight'))
          ? 'active'
          : ''}"
        title="Weight paint"
        aria-label="Weight paint"
        onclick={args.s?.paintWeights}
        ><Icon name="spray-can" size={16} /></button
      >
    </div>
    {#if truthy(eq(args.s?.mode, 'weight'))}
      <div class="st-tool-group">
        {#each self.weightTools ?? [] as t}
          <button
            type="button"
            class="st-tool {truthy(eq(args.s?.weightBrush?.tool, t?.id))
              ? 'active'
              : ''}"
            title={t?.label}
            aria-label={t?.label}
            onclick={(..._r) =>
              args.s?.setBrush('weight', 'tool', t?.id, ..._r)}
            ><Icon name={t?.icon} size={16} /></button
          >
        {/each}
      </div>
    {/if}
  {/if}

  {#if truthy(eq(args.s?.workspace, 'animate'))}
    <div class="st-tool-group">
      <button
        type="button"
        class="st-tool {truthy(eq(args.s?.mode, 'object')) ? 'active' : ''}"
        title="Animate objects"
        aria-label="Object mode"
        onclick={(..._r) => args.s?.setMode('object', ..._r)}
        ><Icon name="box" size={16} /></button
      >
      <button
        type="button"
        class="st-tool {truthy(eq(args.s?.mode, 'pose')) ? 'active' : ''}"
        title="Pose bones"
        aria-label="Pose mode"
        onclick={(..._r) => args.s?.setMode('pose', ..._r)}
        ><Icon name="person-standing" size={16} /></button
      >
      <button
        type="button"
        class="st-tool st-insert-key"
        title="Insert key (I)"
        aria-label="Insert key"
        onclick={(..._r) => args.s?.insertKeys(undefined, ..._r)}
        ><Icon name="diamond" size={16} /></button
      >
    </div>
  {/if}

  {#if truthy(self.showTransform)}
    <div class="st-tool-group">
      {#each self.transform ?? [] as t}
        <button
          type="button"
          class="st-tool st-t-{t?.id} {truthy(eq(args.s?.tool, t?.id))
            ? 'active'
            : ''}"
          title={t?.label}
          aria-label={t?.label}
          onclick={(..._r) => args.s?.setTool(t?.id, ..._r)}
          ><Icon name={t?.icon} size={16} /></button
        >
      {/each}
    </div>
  {/if}

  {#if truthy(or(eq(args.s?.mode, 'object'), eq(args.s?.workspace, 'model')))}
    <div class="st-tool-group">
      <button
        type="button"
        class="st-tool st-add {truthy(args.s?.addMenu) ? 'active' : ''}"
        title="Add"
        aria-label="Add"
        aria-expanded={truthy(args.s?.addMenu) ? 'true' : 'false'}
        onclick={self.toggleAdd}><Icon name="plus" size={16} /></button
      >
    </div>
  {/if}

  <span class="st-spacer"></span>

  {#if truthy(self.showTransform)}
    <div class="st-tool-group st-snaps">
      <div class="st-axes" role="group" aria-label="Axes">
        <button
          type="button"
          class="st-axis x {truthy(args.s?.axes?.x) ? 'on' : ''}"
          title="X axis (click: only X)"
          onclick={(..._r) => args.s?.onlyAxis('x', ..._r)}>X</button
        >
        <button
          type="button"
          class="st-axis y {truthy(args.s?.axes?.y) ? 'on' : ''}"
          title="Y axis (click: only Y)"
          onclick={(..._r) => args.s?.onlyAxis('y', ..._r)}>Y</button
        >
        <button
          type="button"
          class="st-axis z {truthy(args.s?.axes?.z) ? 'on' : ''}"
          title="Z axis (click: only Z)"
          onclick={(..._r) => args.s?.onlyAxis('z', ..._r)}>Z</button
        >
      </div>
      <button
        type="button"
        class="st-tool {truthy(eq(args.s?.space, 'local')) ? 'active' : ''}"
        title={truthy(eq(args.s?.space, 'local')) ? 'Local axes' : 'World axes'}
        aria-label="Axis space"
        onclick={self.flipSpace}
        ><Icon
          name={truthy(eq(args.s?.space, 'local')) ? 'box' : 'globe'}
          size={16}
        /></button
      >
      <button
        type="button"
        class="st-tool st-snap-grid {truthy(args.s?.snap?.grid)
          ? 'active'
          : ''}"
        title="Grid snapping"
        aria-label="Grid snapping"
        onclick={(..._r) => args.s?.toggleSnap('grid', ..._r)}
        ><Icon name="grid-3x3" size={16} /></button
      >
      {#if truthy(args.s?.snap?.grid)}
        <StNum
          value={args.s?.snap?.gridSize}
          min={0.01}
          max={100}
          step={0.05}
          title="Grid size"
          onChange={self.gridSize}
        />
      {/if}
      <button
        type="button"
        class="st-tool {truthy(args.s?.snap?.rotate) ? 'active' : ''}"
        title="Rotation snapping"
        aria-label="Rotation snapping"
        onclick={(..._r) => args.s?.toggleSnap('rotate', ..._r)}
        ><Icon name="rotate-cw" size={16} /></button
      >
      {#if truthy(args.s?.snap?.rotate)}
        <StNum
          value={args.s?.snap?.rotateStep}
          min={1}
          max={180}
          step={1}
          int={true}
          title="Rotation step (degrees)"
          onChange={self.rotStep}
        />
      {/if}
      <button
        type="button"
        class="st-tool st-snap-surface {truthy(args.s?.snap?.surface)
          ? 'active'
          : ''}"
        title="Surface snapping: moved objects rest on what's under the cursor"
        aria-label="Surface snapping"
        onclick={(..._r) => args.s?.toggleSnap('surface', ..._r)}
        ><Icon name="magnet" size={16} /></button
      >
      <button
        type="button"
        class="st-tool st-snap-vertex {truthy(args.s?.snap?.vertex)
          ? 'active'
          : ''}"
        title="Vertex snapping: the nearest vertex lands on the one under the cursor"
        aria-label="Vertex snapping"
        onclick={(..._r) => args.s?.toggleSnap('vertex', ..._r)}
        ><Icon name="crosshair" size={16} /></button
      >
    </div>
  {/if}
</nav>

{#if truthy(args.s?.addMenu)}
  <div class="st-add-menu" role="dialog" aria-label="Add">
    <p class="st-menu-head">Primitives</p>
    <div class="st-add-grid">
      {#each self.primitives ?? [] as p}
        <button
          type="button"
          class="st-add-item st-add-{p?.id}"
          onclick={(..._r) => args.s?.addPrimitive(p?.id, ..._r)}
        >
          <Icon name={p?.icon} size={18} /><span>{p?.label}</span>
        </button>
      {/each}
    </div>
    <p class="st-menu-head">Scene</p>
    <div class="st-add-grid">
      <button
        type="button"
        class="st-add-item"
        onclick={(..._r) => args.s?.addObject('group', ..._r)}
        ><Icon name="folder" size={18} /><span>Group</span></button
      >
      <button
        type="button"
        class="st-add-item"
        onclick={(..._r) => args.s?.addObject('empty', ..._r)}
        ><Icon name="crosshair" size={18} /><span>Empty</span></button
      >
      <button
        type="button"
        class="st-add-item"
        onclick={(..._r) => args.s?.addObject('camera', ..._r)}
        ><Icon name="camera" size={18} /><span>Camera</span></button
      >
      <button
        type="button"
        class="st-add-item"
        onclick={(..._r) => args.s?.addObject('light:point', ..._r)}
        ><Icon name="lightbulb" size={18} /><span>Point light</span></button
      >
      <button
        type="button"
        class="st-add-item"
        onclick={(..._r) => args.s?.addObject('light:spot', ..._r)}
        ><Icon name="flashlight" size={18} /><span>Spot light</span></button
      >
      <button
        type="button"
        class="st-add-item"
        onclick={(..._r) => args.s?.addObject('light:directional', ..._r)}
        ><Icon name="sun" size={18} /><span>Sun</span></button
      >
      <button
        type="button"
        class="st-add-item"
        onclick={(..._r) => args.s?.addObject('light:ambient', ..._r)}
        ><Icon name="sun-moon" size={18} /><span>Ambient</span></button
      >
      <button
        type="button"
        class="st-add-item"
        onclick={(..._r) => args.s?.addObject('armature', ..._r)}
        ><Icon name="bone" size={18} /><span>Armature</span></button
      >
    </div>
  </div>
{/if}
