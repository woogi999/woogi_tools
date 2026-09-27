import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from '../icon';
import StNum from './num';

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

export default class StudioToolbar extends Component {
  transform = TRANSFORM;
  paintTools = PAINT_TOOLS;

  get s() {
    return this.args.s;
  }

  get editOps() {
    const defs = this.s.opDefs;
    return EDIT_OPS.map(([name, params]) => ({ ...defs[name], name, params }));
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

  <template>
    <nav class="st-tools" aria-label="Tools">
      {{#if
        (or
          (eq @s.workspace "model")
          (eq @s.workspace "material")
          (eq @s.workspace "uv")
        )
      }}
        <div class="st-tool-group">
          <button
            type="button"
            class="st-tool {{if (eq @s.mode 'object') 'active'}}"
            title="Object mode"
            aria-label="Object mode"
            {{on "click" (fn @s.setMode "object")}}
          ><Icon @name="box" @size={{16}} /></button>
          <button
            type="button"
            class="st-tool st-edit-mode {{if (eq @s.mode 'edit') 'active'}}"
            title="Edit mode (Tab)"
            aria-label="Edit mode"
            {{on "click" (fn @s.setMode "edit")}}
          ><Icon @name="spline-pointer" @size={{16}} /></button>
        </div>
      {{/if}}

      {{#if (eq @s.mode "edit")}}
        <div class="st-tool-group">
          <button
            type="button"
            class="st-tool st-sel-vert {{if (eq @s.edit.mode 'vert') 'active'}}"
            title="Vertices (1)"
            aria-label="Vertex select"
            {{on "click" (fn @s.setSelectMode "vert")}}
          ><Icon @name="dot" @size={{16}} /></button>
          <button
            type="button"
            class="st-tool st-sel-edge {{if (eq @s.edit.mode 'edge') 'active'}}"
            title="Edges (2)"
            aria-label="Edge select"
            {{on "click" (fn @s.setSelectMode "edge")}}
          ><Icon @name="minus" @size={{16}} /></button>
          <button
            type="button"
            class="st-tool st-sel-face {{if (eq @s.edit.mode 'face') 'active'}}"
            title="Faces (3)"
            aria-label="Face select"
            {{on "click" (fn @s.setSelectMode "face")}}
          ><Icon @name="square" @size={{16}} /></button>
        </div>
        {{#if (eq @s.workspace "model")}}
          <div class="st-tool-group">
            {{#each this.editOps as |op|}}
              <button
                type="button"
                class="st-tool st-op-{{op.name}}"
                title="{{op.label}}{{if op.key (concat ' (' op.key ')')}}"
                aria-label={{op.label}}
                {{on "click" (fn this.run op.name op.params)}}
              ><Icon @name={{op.icon}} @size={{16}} /></button>
            {{/each}}
            <button
              type="button"
              class="st-tool"
              title="Separate (P)"
              aria-label="Separate"
              {{on "click" @s.separateSel}}
            ><Icon @name="split" @size={{16}} /></button>
          </div>
        {{/if}}
      {{/if}}

      {{#if (eq @s.workspace "sculpt")}}
        <div class="st-tool-group">
          {{#each this.sculptBrushes as |b|}}
            <button
              type="button"
              class="st-tool st-sculpt-{{b.id}}
                {{if (eq @s.sculptBrush.tool b.id) 'active'}}"
              title={{b.label}}
              aria-label={{b.label}}
              {{on "click" (fn @s.setBrush "sculpt" "tool" b.id)}}
            ><Icon @name={{b.icon}} @size={{16}} /></button>
          {{/each}}
        </div>
      {{/if}}

      {{#if (eq @s.workspace "texture")}}
        <div class="st-tool-group">
          {{#each this.paintTools as |t|}}
            <button
              type="button"
              class="st-tool st-paint-{{t.id}}
                {{if (eq @s.brush.tool t.id) 'active'}}"
              title={{t.label}}
              aria-label={{t.label}}
              {{on "click" (fn @s.setBrush "paint" "tool" t.id)}}
            ><Icon @name={{t.icon}} @size={{16}} /></button>
          {{/each}}
        </div>
      {{/if}}

      {{#if (eq @s.workspace "rig")}}
        <div class="st-tool-group">
          <button
            type="button"
            class="st-tool {{if (eq @s.mode 'object') 'active'}}"
            title="Object mode"
            aria-label="Object mode"
            {{on "click" (fn @s.setMode "object")}}
          ><Icon @name="box" @size={{16}} /></button>
          <button
            type="button"
            class="st-tool st-bones-mode {{if (eq @s.mode 'bones') 'active'}}"
            title="Edit bones"
            aria-label="Edit bones"
            {{on "click" (fn @s.setMode "bones")}}
          ><Icon @name="bone" @size={{16}} /></button>
          <button
            type="button"
            class="st-tool st-pose-mode {{if (eq @s.mode 'pose') 'active'}}"
            title="Pose"
            aria-label="Pose mode"
            {{on "click" (fn @s.setMode "pose")}}
          ><Icon @name="person-standing" @size={{16}} /></button>
          <button
            type="button"
            class="st-tool st-weight-mode {{if (eq @s.mode 'weight') 'active'}}"
            title="Weight paint"
            aria-label="Weight paint"
            {{on "click" @s.paintWeights}}
          ><Icon @name="spray-can" @size={{16}} /></button>
        </div>
        {{#if (eq @s.mode "weight")}}
          <div class="st-tool-group">
            {{#each this.weightTools as |t|}}
              <button
                type="button"
                class="st-tool {{if (eq @s.weightBrush.tool t.id) 'active'}}"
                title={{t.label}}
                aria-label={{t.label}}
                {{on "click" (fn @s.setBrush "weight" "tool" t.id)}}
              ><Icon @name={{t.icon}} @size={{16}} /></button>
            {{/each}}
          </div>
        {{/if}}
      {{/if}}

      {{#if (eq @s.workspace "animate")}}
        <div class="st-tool-group">
          <button
            type="button"
            class="st-tool {{if (eq @s.mode 'object') 'active'}}"
            title="Animate objects"
            aria-label="Object mode"
            {{on "click" (fn @s.setMode "object")}}
          ><Icon @name="box" @size={{16}} /></button>
          <button
            type="button"
            class="st-tool {{if (eq @s.mode 'pose') 'active'}}"
            title="Pose bones"
            aria-label="Pose mode"
            {{on "click" (fn @s.setMode "pose")}}
          ><Icon @name="person-standing" @size={{16}} /></button>
          <button
            type="button"
            class="st-tool st-insert-key"
            title="Insert key (I)"
            aria-label="Insert key"
            {{on "click" (fn @s.insertKeys undefined)}}
          ><Icon @name="diamond" @size={{16}} /></button>
        </div>
      {{/if}}

      {{#if this.showTransform}}
        <div class="st-tool-group">
          {{#each this.transform as |t|}}
            <button
              type="button"
              class="st-tool st-t-{{t.id}} {{if (eq @s.tool t.id) 'active'}}"
              title={{t.label}}
              aria-label={{t.label}}
              {{on "click" (fn @s.setTool t.id)}}
            ><Icon @name={{t.icon}} @size={{16}} /></button>
          {{/each}}
        </div>
      {{/if}}

      {{#if (or (eq @s.mode "object") (eq @s.workspace "model"))}}
        <div class="st-tool-group">
          <button
            type="button"
            class="st-tool st-add {{if @s.addMenu 'active'}}"
            title="Add"
            aria-label="Add"
            aria-expanded={{if @s.addMenu "true" "false"}}
            {{on "click" this.toggleAdd}}
          ><Icon @name="plus" @size={{16}} /></button>
        </div>
      {{/if}}

      <span class="st-spacer"></span>

      {{#if this.showTransform}}
        <div class="st-tool-group st-snaps">
          <div class="st-axes" role="group" aria-label="Axes">
            <button
              type="button"
              class="st-axis x {{if @s.axes.x 'on'}}"
              title="X axis (click: only X)"
              {{on "click" (fn @s.onlyAxis "x")}}
            >X</button>
            <button
              type="button"
              class="st-axis y {{if @s.axes.y 'on'}}"
              title="Y axis (click: only Y)"
              {{on "click" (fn @s.onlyAxis "y")}}
            >Y</button>
            <button
              type="button"
              class="st-axis z {{if @s.axes.z 'on'}}"
              title="Z axis (click: only Z)"
              {{on "click" (fn @s.onlyAxis "z")}}
            >Z</button>
          </div>
          <button
            type="button"
            class="st-tool {{if (eq @s.space 'local') 'active'}}"
            title={{if (eq @s.space "local") "Local axes" "World axes"}}
            aria-label="Axis space"
            {{on "click" this.flipSpace}}
          ><Icon
              @name={{if (eq @s.space "local") "box" "globe"}}
              @size={{16}}
            /></button>
          <button
            type="button"
            class="st-tool st-snap-grid {{if @s.snap.grid 'active'}}"
            title="Grid snapping"
            aria-label="Grid snapping"
            {{on "click" (fn @s.toggleSnap "grid")}}
          ><Icon @name="grid-3x3" @size={{16}} /></button>
          {{#if @s.snap.grid}}
            <StNum
              @value={{@s.snap.gridSize}}
              @min={{0.01}}
              @max={{100}}
              @step={{0.05}}
              @title="Grid size"
              @onChange={{this.gridSize}}
            />
          {{/if}}
          <button
            type="button"
            class="st-tool {{if @s.snap.rotate 'active'}}"
            title="Rotation snapping"
            aria-label="Rotation snapping"
            {{on "click" (fn @s.toggleSnap "rotate")}}
          ><Icon @name="rotate-cw" @size={{16}} /></button>
          {{#if @s.snap.rotate}}
            <StNum
              @value={{@s.snap.rotateStep}}
              @min={{1}}
              @max={{180}}
              @step={{1}}
              @int={{true}}
              @title="Rotation step (degrees)"
              @onChange={{this.rotStep}}
            />
          {{/if}}
          <button
            type="button"
            class="st-tool st-snap-surface {{if @s.snap.surface 'active'}}"
            title="Surface snapping: moved objects rest on what's under the cursor"
            aria-label="Surface snapping"
            {{on "click" (fn @s.toggleSnap "surface")}}
          ><Icon @name="magnet" @size={{16}} /></button>
          <button
            type="button"
            class="st-tool st-snap-vertex {{if @s.snap.vertex 'active'}}"
            title="Vertex snapping: the nearest vertex lands on the one under the cursor"
            aria-label="Vertex snapping"
            {{on "click" (fn @s.toggleSnap "vertex")}}
          ><Icon @name="crosshair" @size={{16}} /></button>
        </div>
      {{/if}}
    </nav>

    {{#if @s.addMenu}}
      <div class="st-add-menu" role="dialog" aria-label="Add">
        <p class="st-menu-head">Primitives</p>
        <div class="st-add-grid">
          {{#each this.primitives as |p|}}
            <button
              type="button"
              class="st-add-item st-add-{{p.id}}"
              {{on "click" (fn @s.addPrimitive p.id)}}
            >
              <Icon @name={{p.icon}} @size={{18}} /><span>{{p.label}}</span>
            </button>
          {{/each}}
        </div>
        <p class="st-menu-head">Scene</p>
        <div class="st-add-grid">
          <button
            type="button"
            class="st-add-item"
            {{on "click" (fn @s.addObject "group")}}
          ><Icon @name="folder" @size={{18}} /><span>Group</span></button>
          <button
            type="button"
            class="st-add-item"
            {{on "click" (fn @s.addObject "empty")}}
          ><Icon @name="crosshair" @size={{18}} /><span>Empty</span></button>
          <button
            type="button"
            class="st-add-item"
            {{on "click" (fn @s.addObject "camera")}}
          ><Icon @name="camera" @size={{18}} /><span>Camera</span></button>
          <button
            type="button"
            class="st-add-item"
            {{on "click" (fn @s.addObject "light:point")}}
          ><Icon @name="lightbulb" @size={{18}} /><span>Point light</span></button>
          <button
            type="button"
            class="st-add-item"
            {{on "click" (fn @s.addObject "light:spot")}}
          ><Icon @name="flashlight" @size={{18}} /><span>Spot light</span></button>
          <button
            type="button"
            class="st-add-item"
            {{on "click" (fn @s.addObject "light:directional")}}
          ><Icon @name="sun" @size={{18}} /><span>Sun</span></button>
          <button
            type="button"
            class="st-add-item"
            {{on "click" (fn @s.addObject "light:ambient")}}
          ><Icon @name="sun-moon" @size={{18}} /><span>Ambient</span></button>
          <button
            type="button"
            class="st-add-item"
            {{on "click" (fn @s.addObject "armature")}}
          ><Icon @name="bone" @size={{18}} /><span>Armature</span></button>
        </div>
      </div>
    {{/if}}
  </template>
}

function concat(...parts) {
  return parts.join('');
}
