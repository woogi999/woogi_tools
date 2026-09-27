import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from '../icon';
import StNum from './num';
import StParams from './params';

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

export default class StudioObjectPanel extends Component {
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
  modParam = (modId, key, v, final) => this.s.setModParam(modId, key, v, final);
  setFalloff = (which, e) => this.s.setBrush(which, 'falloff', e.target.value);
  sculptNum = (key, v) => this.s.setBrush('sculpt', key, v);
  setUvAngle = (v) => (this.s.uvAngle = v);
  shade = (smooth) => {
    if (this.s.mode !== 'edit') {
      this.s.enterEdit('face');
      this.s.runOp('shade', { smooth });
      this.s.exitEdit();
    } else this.s.runOp('shade', { smooth });
  };

  <template>
    {{#if (eq @s.workspace "sculpt")}}
      <section class="st-section">
        <h3 class="st-h">Sculpt brush</h3>
        <StNum
          @label="Radius (px)"
          @value={{@s.sculptBrush.size}}
          @min={{2}}
          @max={{400}}
          @step={{1}}
          @int={{true}}
          @onChange={{fn this.sculptNum "size"}}
        />
        <StNum
          @label="Strength"
          @value={{@s.sculptBrush.strength}}
          @min={{0}}
          @max={{1}}
          @step={{0.01}}
          @onChange={{fn this.sculptNum "strength"}}
        />
        <StNum
          @label="Hardness"
          @value={{@s.sculptBrush.hardness}}
          @min={{0}}
          @max={{0.95}}
          @step={{0.01}}
          @onChange={{fn this.sculptNum "hardness"}}
        />
        <label class="st-field"><span>Falloff</span>
          <select {{on "change" (fn this.setFalloff "sculpt")}}>
            {{#each this.falloffs as |f|}}<option
                value={{f}}
                selected={{eq f @s.sculptBrush.falloff}}
              >{{f}}</option>{{/each}}
          </select>
        </label>
        <div class="st-row-btns">
          <span class="st-label">Symmetry</span>
          {{#each this.axes as |a|}}
            <button
              type="button"
              class="st-axis
                {{at this.axisName a}}
                {{if (at @s.sculptBrush.symmetry a) 'on'}}"
              {{on "click" (fn @s.toggleSymmetry "sculpt" a)}}
            >{{at this.axisName a}}</button>
          {{/each}}
        </div>
        <label class="st-check"><input
            type="checkbox"
            checked={{@s.sculptBrush.invert}}
            {{on
              "change"
              (fn @s.setBrush "sculpt" "invert" (not @s.sculptBrush.invert))
            }}
          /><span>Invert (dig in)</span></label>
      </section>
      <section class="st-section">
        <h3 class="st-h">Detail</h3>
        <p class="st-note">Sculpting moves vertices, so it needs enough of them.</p>
        <div class="st-btns">
          <button
            type="button"
            class="st-btn st-subdivide"
            {{on "click" (fn @s.sculptSubdivide 1)}}
          ><Icon @name="grid-3x3" @size={{13}} />Subdivide</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" @s.sculptSmoothAll}}
          ><Icon @name="waves" @size={{13}} />Smooth all</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" @s.sculptDecimate}}
          ><Icon @name="shrink" @size={{13}} />Decimate</button>
        </div>
      </section>
    {{/if}}

    {{#if (eq @s.workspace "uv")}}
      <section class="st-section">
        <h3 class="st-h">Unwrap</h3>
        <p class="st-note">Works on the selected faces (all of them if none
          are).</p>
        <div class="st-btns">
          <button
            type="button"
            class="st-btn st-uv-auto"
            {{on "click" (fn @s.uvOp "auto")}}
          ><Icon @name="wand-sparkles" @size={{13}} />Auto unwrap</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "view")}}
          ><Icon @name="camera" @size={{13}} />From view</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "planar")}}
          ><Icon @name="square" @size={{13}} />Planar</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "box")}}
          ><Icon @name="box" @size={{13}} />Box</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "cylinder")}}
          ><Icon @name="cylinder" @size={{13}} />Cylinder</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "sphere")}}
          ><Icon @name="globe" @size={{13}} />Sphere</button>
        </div>
        <StNum
          @label="Auto angle"
          @value={{@s.uvAngle}}
          @min={{5}}
          @max={{89}}
          @step={{1}}
          @int={{true}}
          @onChange={{this.setUvAngle}}
        />
      </section>
      <section class="st-section">
        <h3 class="st-h">Arrange</h3>
        <div class="st-btns">
          <button
            type="button"
            class="st-btn st-uv-pack"
            {{on "click" (fn @s.uvOp "pack")}}
          ><Icon @name="layout-grid" @size={{13}} />Pack</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "relax")}}
          ><Icon @name="waves" @size={{13}} />Relax</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "fit")}}
          ><Icon @name="maximize" @size={{13}} />Fit</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "rotate" 90)}}
          ><Icon @name="rotate-cw" @size={{13}} />Rotate 90°</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "flipU")}}
          ><Icon @name="flip-horizontal" @size={{13}} />Flip U</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "flipV")}}
          ><Icon @name="flip-vertical" @size={{13}} />Flip V</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "grow")}}
          ><Icon @name="zoom-in" @size={{13}} />Scale up</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.uvOp "shrink")}}
          ><Icon @name="zoom-out" @size={{13}} />Scale down</button>
        </div>
        {{#if @s.uvStats}}
          <p class="st-note st-uv-stats">{{@s.uvStats.islands}}
            islands ·
            {{@s.uvStats.coverage}}% of the texture used{{#if
              @s.uvStats.overlap
            }} · {{@s.uvStats.overlap}}% overlapping{{/if}}</p>
        {{/if}}
      </section>
    {{/if}}

    {{#if this.o}}
      <section class="st-section">
        <h3 class="st-h"><Icon @name="box" @size={{13}} />{{this.o.name}}</h3>
        <div class="st-vec">
          <span class="st-label">Location</span>
          {{#each this.axes as |a|}}
            <StNum
              @axis={{at this.axisName a}}
              @value={{at this.pos a}}
              @step={{0.05}}
              @onChange={{fn this.setPos a}}
            />
          {{/each}}
          <button
            type="button"
            class="st-mini"
            title="Clear location"
            aria-label="Clear location"
            {{on "click" (fn @s.resetTransform "pos")}}
          ><Icon @name="x" @size={{11}} /></button>
        </div>
        <div class="st-vec">
          <span class="st-label">Rotation</span>
          {{#each this.axes as |a|}}
            <StNum
              @axis={{at this.axisName a}}
              @value={{at this.rot a}}
              @step={{1}}
              @onChange={{fn this.setRot a}}
            />
          {{/each}}
          <button
            type="button"
            class="st-mini"
            title="Clear rotation"
            aria-label="Clear rotation"
            {{on "click" (fn @s.resetTransform "rot")}}
          ><Icon @name="x" @size={{11}} /></button>
        </div>
        <div class="st-vec">
          <span class="st-label">Scale</span>
          {{#each this.axes as |a|}}
            <StNum
              @axis={{at this.axisName a}}
              @value={{at this.scl a}}
              @step={{0.02}}
              @onChange={{fn this.setScl a}}
            />
          {{/each}}
          <button
            type="button"
            class="st-mini"
            title="Clear scale"
            aria-label="Clear scale"
            {{on "click" (fn @s.resetTransform "scl")}}
          ><Icon @name="x" @size={{11}} /></button>
        </div>
        {{#unless @compact}}
          <div class="st-btns">
            <button
              type="button"
              class="st-btn"
              {{on "click" @s.duplicateSelected}}
            ><Icon @name="copy" @size={{13}} />Duplicate</button>
            <button
              type="button"
              class="st-btn"
              {{on "click" @s.dropToGround}}
            ><Icon @name="arrow-down" @size={{13}} />To ground</button>
            <button
              type="button"
              class="st-btn"
              {{on "click" @s.groupSelected}}
            ><Icon @name="folder" @size={{13}} />Group</button>
            {{#if (or (eq this.o.type "group") this.o.children.length)}}
              <button
                type="button"
                class="st-btn"
                {{on "click" (fn @s.ungroup this.o.id)}}
              ><Icon @name="ungroup" @size={{13}} />Ungroup</button>
            {{/if}}
            {{#if (neq @s.selected.length 1)}}
              <button
                type="button"
                class="st-btn"
                title="Parent the other selected objects to this one"
                {{on "click" @s.parentToActive}}
              ><Icon @name="link" @size={{13}} />Parent</button>
            {{/if}}
            {{#if this.o.parent}}
              <button
                type="button"
                class="st-btn"
                {{on "click" @s.unparentSelected}}
              ><Icon @name="unlink" @size={{13}} />Unparent</button>
            {{/if}}
            <button
              type="button"
              class="st-btn st-danger"
              {{on "click" @s.deleteSelected}}
            ><Icon @name="trash-2" @size={{13}} />Delete</button>
          </div>
        {{/unless}}
      </section>

      {{#if @compact}}
        {{! The Animate workspace only needs the transform. }}
      {{else if (eq this.o.type "mesh")}}
        {{#if (eq this.o.source.kind "primitive")}}
          <section class="st-section st-prim">
            <h3 class="st-h"><Icon
                @name={{@s.primDef.icon}}
                @size={{13}}
              />{{@s.primDef.label}}
              <span class="st-h-note">recipe, editable any time</span></h3>
            <StParams
              @params={{@s.primDef.params}}
              @values={{@s.primValues}}
              @onChange={{@s.setPrimParam}}
            />
            {{#if @s.primDef.radius}}
              <StNum
                @label="Radius (both ends)"
                @value={{@s.primValues.radiusBottom}}
                @min={{0}}
                @max={{100}}
                @step={{0.05}}
                @onChange={{fn @s.setPrimParam "radius"}}
              />
            {{/if}}
            <div class="st-btns">
              <button
                type="button"
                class="st-btn"
                {{on "click" @s.resetPrim}}
              ><Icon @name="rotate-ccw" @size={{13}} />Reset</button>
              <button
                type="button"
                class="st-btn"
                title="Freeze the recipe into an editable mesh"
                {{on "click" (fn @s.convertToMesh this.o.id)}}
              ><Icon @name="spline-pointer" @size={{13}} />Convert to mesh</button>
            </div>
          </section>
        {{else if (eq this.o.source.kind "outline")}}
          <section class="st-section">
            <h3 class="st-h"><Icon @name="circle-dashed" @size={{13}} />Linked
              outline</h3>
            <StParams
              @params={{this.outlineParams}}
              @values={{this.o.source}}
              @onChange={{@s.setOutline}}
            />
            <label class="st-field"><span>Colour</span><input
                type="color"
                value={{@s.mat.color}}
                {{on "change" this.setOutlineColor}}
              /></label>
          </section>
        {{else}}
          <section class="st-section">
            <h3 class="st-h"><Icon
                @name="spline-pointer"
                @size={{13}}
              />Editable mesh</h3>
            <div class="st-btns">
              <button
                type="button"
                class="st-btn"
                {{on "click" (fn @s.setMode "edit")}}
              ><Icon @name="spline-pointer" @size={{13}} />Edit (Tab)</button>
              <button
                type="button"
                class="st-btn"
                {{on "click" (fn this.shade true)}}
              ><Icon @name="circle" @size={{13}} />Shade smooth</button>
              <button
                type="button"
                class="st-btn"
                {{on "click" (fn this.shade false)}}
              ><Icon @name="hexagon" @size={{13}} />Shade flat</button>
            </div>
          </section>
        {{/if}}

        <section class="st-section st-stack">
          <h3 class="st-h"><Icon @name="layers" @size={{13}} />Modifiers</h3>
          {{#each @s.stackRows key="mod.id" as |row|}}
            <div
              class="st-mod {{if row.mod.on '' 'is-off'}}"
              data-type={{row.mod.type}}
            >
              <div class="st-mod-head">
                <Icon @name={{row.def.icon}} @size={{13}} />
                <span class="st-mod-name">{{row.def.label}}{{#if
                    (eq row.mod.type "boolean")
                  }} · {{row.values.op}}{{/if}}</span>
                <button
                  type="button"
                  class="st-mini"
                  title={{if row.mod.on "Turn off" "Turn on"}}
                  aria-label="Toggle"
                  {{on "click" (fn @s.toggleMod row.mod.id)}}
                ><Icon
                    @name={{if row.mod.on "eye" "eye-off"}}
                    @size={{11}}
                  /></button>
                <button
                  type="button"
                  class="st-mini"
                  title="Move up"
                  aria-label="Move up"
                  disabled={{row.first}}
                  {{on "click" (fn @s.moveMod row.mod.id -1)}}
                ><Icon @name="arrow-up" @size={{11}} /></button>
                <button
                  type="button"
                  class="st-mini"
                  title="Move down"
                  aria-label="Move down"
                  disabled={{row.last}}
                  {{on "click" (fn @s.moveMod row.mod.id 1)}}
                ><Icon @name="arrow-down" @size={{11}} /></button>
                <button
                  type="button"
                  class="st-mini"
                  title="Apply (bake into the mesh)"
                  aria-label="Apply"
                  {{on "click" (fn @s.applyMod row.mod.id)}}
                ><Icon @name="check" @size={{11}} /></button>
                <button
                  type="button"
                  class="st-mini"
                  title="Remove"
                  aria-label="Remove"
                  {{on "click" (fn @s.removeMod row.mod.id)}}
                ><Icon @name="x" @size={{11}} /></button>
              </div>
              <StParams
                @params={{row.def.params}}
                @values={{row.values}}
                @objects={{@s.objectChoices}}
                @onChange={{fn this.modParam row.mod.id}}
              />
            </div>
          {{else}}
            <p class="st-note">No modifiers. They change the mesh without
              touching its recipe, and can be retuned, reordered or removed at
              any time.</p>
          {{/each}}
          <select
            class="st-add-mod"
            aria-label="Add modifier"
            {{on "change" this.addMod}}
          >
            <option value="">Add modifier…</option>
            {{#each @s.modifierTypes as |m|}}<option
                value={{m.type}}
              >{{m.label}}</option>{{/each}}
          </select>
          {{#if @s.stackRows.length}}
            <button
              type="button"
              class="st-btn st-wide"
              {{on "click" (fn @s.applyAll this.o.id)}}
            ><Icon @name="check" @size={{13}} />Apply all modifiers</button>
          {{/if}}
        </section>

        <section class="st-section">
          <h3 class="st-h"><Icon @name="combine" @size={{13}} />Booleans</h3>
          <p class="st-note">Adds a cutter you can move and reshape; the result
            updates as you do.</p>
          <div class="st-btns">
            <button
              type="button"
              class="st-btn st-bool-subtract"
              {{on "click" (fn @s.addBoolean "subtract" "cylinder")}}
            >Subtract</button>
            <button
              type="button"
              class="st-btn"
              {{on "click" (fn @s.addBoolean "union" "cube")}}
            >Union</button>
            <button
              type="button"
              class="st-btn"
              {{on "click" (fn @s.addBoolean "intersect" "sphere")}}
            >Intersect</button>
          </div>
          {{#if (neq @s.selected.length 1)}}
            <p class="st-note">Or use the other selected objects as cutters:</p>
            <div class="st-btns">
              <button
                type="button"
                class="st-btn"
                {{on "click" (fn @s.booleanFromSelection "subtract")}}
              >Subtract selected</button>
              <button
                type="button"
                class="st-btn"
                {{on "click" (fn @s.booleanFromSelection "union")}}
              >Union selected</button>
              <button
                type="button"
                class="st-btn"
                {{on "click" (fn @s.booleanFromSelection "intersect")}}
              >Intersect selected</button>
            </div>
          {{/if}}
          <button
            type="button"
            class="st-btn st-wide st-create-outline"
            {{on "click" @s.createOutline}}
          ><Icon @name="circle-dashed" @size={{13}} />Create outline</button>
        </section>
      {{else if (eq this.o.type "light")}}
        <section class="st-section">
          <h3 class="st-h"><Icon @name="lightbulb" @size={{13}} />Light</h3>
          <label class="st-field"><span>Kind</span>
            <select {{on "change" this.setLightKind}}>
              {{#each this.lightKinds as |k|}}<option
                  value={{k.value}}
                  selected={{eq k.value this.o.light.kind}}
                >{{k.label}}</option>{{/each}}
            </select>
          </label>
          <label class="st-field"><span>Colour</span><input
              type="color"
              value={{this.o.light.color}}
              {{on "change" this.setLightColor}}
            /></label>
          <StParams
            @params={{this.lightParams}}
            @values={{this.o.light}}
            @onChange={{@s.setLight}}
          />
        </section>
      {{else if (eq this.o.type "camera")}}
        <section class="st-section">
          <h3 class="st-h"><Icon @name="camera" @size={{13}} />Camera</h3>
          <StParams
            @params={{this.cameraParams}}
            @values={{this.o.camera}}
            @onChange={{@s.setCamera}}
          />
          <button
            type="button"
            class="st-btn st-wide"
            {{on "click" @s.lookThrough}}
          ><Icon @name="eye" @size={{13}} />Look through</button>
        </section>
      {{else if (eq this.o.type "control")}}
        <section class="st-section">
          <h3 class="st-h"><Icon
              @name="circle-dot"
              @size={{13}}
            />Controller</h3>
          <label class="st-field"><span>Shape</span>
            <select {{on "change" this.setControlShape}}>
              {{#each this.controlShapes as |sh|}}<option
                  value={{sh}}
                  selected={{eq sh this.o.control.shape}}
                >{{sh}}</option>{{/each}}
            </select>
          </label>
          <StNum
            @label="Size"
            @value={{this.o.control.size}}
            @min={{0.01}}
            @max={{20}}
            @step={{0.01}}
            @onChange={{this.setControlSize}}
          />
          <label class="st-field"><span>Colour</span><input
              type="color"
              value={{this.o.control.color}}
              {{on "change" this.setControlColor}}
            /></label>
        </section>
      {{else if (eq this.o.type "armature")}}
        <section class="st-section">
          <h3 class="st-h"><Icon @name="bone" @size={{13}} />Armature</h3>
          <p class="st-note">{{this.o.bones.length}}
            bones. Rig it in the Rig workspace (F6).</p>
        </section>
      {{/if}}
    {{else if (not (or (eq @s.workspace "sculpt") @compact))}}
      <section class="st-section">
        <p class="st-note">Select something to see its properties, or add a
          shape with
          <strong>+</strong>
          in the tool strip.</p>
      </section>
    {{/if}}
  </template>
}
