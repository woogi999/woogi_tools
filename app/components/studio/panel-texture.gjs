import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import Icon from '../icon';
import StNum from './num';
import StParams from './params';

// The Texture workspace's panel: the active material's layer stack (top
// of the list is the top of the stack), the selected layer's settings, the
// brush, smart materials and bakes.

const eq = (a, b) => a === b;
const neq = (a, b) => a !== b;
const or = (...xs) => xs.some(Boolean);
const swatch = (c) => htmlSafe(`background:${c}`);
const pct = (v) => Math.round(v * 100);

const SIZES = [256, 512, 1024, 2048];
const CHANNELS = [
  { key: 'color', label: 'Colour' },
  { key: 'rough', label: 'Rough' },
  { key: 'metal', label: 'Metal' },
  { key: 'height', label: 'Height' },
];

export default class StudioTexturePanel extends Component {
  sizes = SIZES;
  channels = CHANNELS;
  @tracked section = 'layers';
  @tracked dragId = null;

  get s() {
    return this.args.s;
  }

  get l() {
    return this.s.layer;
  }

  get noMesh() {
    return !this.s.isMesh;
  }

  get blendModes() {
    return this.s.E.tex.BLEND_MODES;
  }

  get generators() {
    return Object.entries(this.s.E.tex.GENERATORS).map(([value, v]) => ({
      value,
      label: v.label,
    }));
  }

  get fillGenDef() {
    const l = this.l;
    return l?.fill.mode === 'generator'
      ? this.s.E.tex.GENERATORS[l.fill.gen.type]
      : null;
  }

  get fillGenValues() {
    const def = this.fillGenDef;
    return def ? { ...def.defaults, ...this.l.fill.gen.params } : {};
  }

  get maskGenDef() {
    const l = this.l;
    return l?.mask?.mode === 'generator'
      ? this.s.E.tex.GENERATORS[l.mask.gen.type]
      : null;
  }

  get maskGenValues() {
    const def = this.maskGenDef;
    return def ? { ...def.defaults, ...this.l.mask.gen.params } : {};
  }

  get fillSource() {
    const l = this.l;
    if (!l) return 'solid';
    return l.fill.mode === 'generator' ? l.fill.gen.type : l.fill.mode;
  }

  get tool() {
    return this.s.brush.tool;
  }

  get usesImage() {
    return ['projection', 'stencil', 'decal'].includes(this.tool);
  }

  get falloffs() {
    return ['smooth', 'linear', 'sharp', 'soft', 'constant'];
  }

  get bakeProgress() {
    const p = this.s.paintState.bakeProgress;
    return p ? `${Math.round(p.value * 100)}%` : null;
  }

  get setInfo() {
    const set = this.s.texSet;
    if (!set?.map) return null;
    return `${set.size}×${set.size} on ${this.s.doc.objects[set.objectId]?.name ?? '?'}`;
  }

  setSection = (name) => (this.section = name);
  b = (key, v) => this.s.setBrush('paint', key, v);
  bColor = (key, e) => this.s.setBrush('paint', key, e.target.value);
  bCheck = (key, e) => this.s.setBrush('paint', key, e.target.checked);
  bFalloff = (e) => this.s.setBrush('paint', 'falloff', e.target.value);
  layerNum = (key, v, final) => this.s.setLayerProp(key, v, final);
  setBlend = (e) => this.s.setLayerProp('blend', e.target.value, true);
  fillNum = (key, v, final) => this.s.setFill(key, v, final);
  fillColor = (key, e) => this.s.setFill(key, e.target.value, true);
  setSource = (e) => {
    const v = e.target.value;
    if (v === 'image') return;
    this.s.setFillGen(v);
  };
  fillImage = (e) => {
    this.s.setFillImage(e.target.files?.[0]);
    e.target.value = '';
  };
  maskGen = (e) => this.s.setMaskGen(e.target.value);
  addMask = (e) => {
    if (e.target.value) this.s.addMask(e.target.value);
    e.target.value = '';
  };
  brushImage = (e) => {
    this.s.loadBrushImage(e.target.files?.[0]);
    e.target.value = '';
  };
  texSize = (e) => this.s.setTexSize(e.target.value);
  pickSlot = (e) => this.s.pickSlot(Number(e.target.value));
  maskPaint = (v) => (this.s.maskValue = v);
  stop = (e) => e.stopPropagation();

  dragStart = (id, e) => {
    this.dragId = id;
    e.dataTransfer.setData('text/x-studio-layer', id);
    e.dataTransfer.effectAllowed = 'move';
  };
  dragOver = (e) => {
    if (this.dragId) e.preventDefault();
  };
  dropOn = (id, e) => {
    e.preventDefault();
    if (this.dragId && this.dragId !== id) this.s.dropLayer(this.dragId, id);
    this.dragId = null;
  };

  <template>
    {{! template-lint-disable no-invalid-interactive }}
    {{#if this.noMesh}}
      <section class="st-section"><p class="st-note">Select a mesh to paint.</p></section>
    {{else}}
      <div class="st-subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="{{if (eq this.section 'layers') 'active'}}"
          {{on "click" (fn this.setSection "layers")}}
        >Layers</button>
        <button
          type="button"
          role="tab"
          class="st-brush-tab {{if (eq this.section 'brush') 'active'}}"
          {{on "click" (fn this.setSection "brush")}}
        >Brush</button>
        <button
          type="button"
          role="tab"
          class="st-smart-tab {{if (eq this.section 'smart') 'active'}}"
          {{on "click" (fn this.setSection "smart")}}
        >Smart</button>
        <button
          type="button"
          role="tab"
          class="st-bake-tab {{if (eq this.section 'bake') 'active'}}"
          {{on "click" (fn this.setSection "bake")}}
        >Bake</button>
      </div>

      <section class="st-section">
        <div class="st-row-fields">
          <label class="st-field"><span>Material</span>
            <select {{on "change" this.pickSlot}}>
              {{#each @s.slots as |slot|}}<option
                  value={{slot.index}}
                  selected={{eq slot.index @s.slotIndex}}
                >{{slot.mat.name}}</option>{{/each}}
            </select>
          </label>
          <label class="st-field"><span>Texture</span>
            <select {{on "change" this.texSize}}>
              {{#each this.sizes as |n|}}<option
                  value={{n}}
                  selected={{eq n @s.mat.texSize}}
                >{{n}}</option>{{/each}}
            </select>
          </label>
        </div>
        {{#if this.setInfo}}<p class="st-note">{{this.setInfo}}</p>{{/if}}
      </section>

      {{#if (eq this.section "layers")}}
        <section class="st-section st-layers">
          <div class="st-btns">
            <button
              type="button"
              class="st-btn st-add-paint"
              {{on "click" (fn @s.addLayer "paint")}}
            ><Icon @name="paintbrush" @size={{13}} />Paint layer</button>
            <button
              type="button"
              class="st-btn st-add-fill"
              {{on "click" (fn @s.addLayer "fill")}}
            ><Icon @name="paint-bucket" @size={{13}} />Fill layer</button>
          </div>
          <ul class="st-layer-list">
            {{#each @s.layerRows key="layer.id" as |row|}}
              <li
                class="st-layer
                  {{if row.active 'active'}}
                  {{if row.layer.visible '' 'is-hidden'}}"
                draggable="true"
                {{on "click" (fn @s.setActiveLayer row.layer.id)}}
                {{on "dragstart" (fn this.dragStart row.layer.id)}}
                {{on "dragover" this.dragOver}}
                {{on "drop" (fn this.dropOn row.layer.id)}}
              >
                <button
                  type="button"
                  class="st-mini"
                  title={{if row.layer.visible "Hide" "Show"}}
                  aria-label="Toggle visibility"
                  {{on "click" (fn @s.toggleLayerVisible row.layer.id)}}
                ><Icon
                    @name={{if row.layer.visible "eye" "eye-off"}}
                    @size={{11}}
                  /></button>
                {{#if row.swatch}}
                  <span class="st-swatch" style={{swatch row.swatch}}></span>
                {{else}}
                  <Icon @name="paintbrush" @size={{12}} />
                {{/if}}
                <span class="st-layer-name">{{row.layer.name}}</span>
                {{#if row.layer.mask}}<Icon
                    @name="circle-dashed"
                    @size={{11}}
                    class="st-layer-mask"
                  />{{/if}}
                <span class="st-layer-meta">{{pct row.layer.opacity}}%{{#if
                    (neq row.layer.blend "normal")
                  }} · {{row.layer.blend}}{{/if}}</span>
              </li>
            {{else}}
              <li class="st-empty">No layers yet: paint to start one, add a
                fill, or pick a smart material.</li>
            {{/each}}
          </ul>
        </section>

        {{#if this.l}}
          <section class="st-section st-layer-props">
            <input
              type="text"
              class="st-inline-name"
              value={{this.l.name}}
              aria-label="Layer name"
              {{on "change" (fn @s.renameLayer this.l.id)}}
              {{on "keydown" this.stop}}
            />
            <div class="st-btns">
              <button
                type="button"
                class="st-mini"
                title="Move up"
                aria-label="Move up"
                {{on "click" (fn @s.moveLayer this.l.id 1)}}
              ><Icon @name="arrow-up" @size={{11}} /></button>
              <button
                type="button"
                class="st-mini"
                title="Move down"
                aria-label="Move down"
                {{on "click" (fn @s.moveLayer this.l.id -1)}}
              ><Icon @name="arrow-down" @size={{11}} /></button>
              <button
                type="button"
                class="st-mini"
                title="Duplicate"
                aria-label="Duplicate layer"
                {{on "click" (fn @s.duplicateLayer this.l.id)}}
              ><Icon @name="copy" @size={{11}} /></button>
              {{#if (eq this.l.kind "paint")}}
                <button
                  type="button"
                  class="st-mini"
                  title="Clear"
                  aria-label="Clear layer"
                  {{on "click" @s.clearLayer}}
                ><Icon @name="eraser" @size={{11}} /></button>
              {{/if}}
              <button
                type="button"
                class="st-mini"
                title="Delete"
                aria-label="Delete layer"
                {{on "click" (fn @s.removeLayer this.l.id)}}
              ><Icon @name="trash-2" @size={{11}} /></button>
            </div>
            <label class="st-field"><span>Blend</span>
              <select {{on "change" this.setBlend}}>
                {{#each this.blendModes as |m|}}<option
                    value={{m}}
                    selected={{eq m this.l.blend}}
                  >{{m}}</option>{{/each}}
              </select>
            </label>
            <StNum
              @label="Opacity"
              @value={{this.l.opacity}}
              @min={{0}}
              @max={{1}}
              @step={{0.01}}
              @onChange={{fn this.layerNum "opacity"}}
            />
            <div class="st-chips" role="group" aria-label="Channels">
              {{#each this.channels as |c|}}
                <button
                  type="button"
                  class="st-chip {{if (chan this.l.channels c.key) 'on'}}"
                  {{on "click" (fn @s.toggleLayerChannel c.key)}}
                >{{c.label}}</button>
              {{/each}}
            </div>

            {{#if (eq this.l.kind "fill")}}
              <label class="st-field"><span>Source</span>
                <select {{on "change" this.setSource}}>
                  <option
                    value="solid"
                    selected={{eq this.fillSource "solid"}}
                  >Flat material</option>
                  {{#each this.generators as |g|}}<option
                      value={{g.value}}
                      selected={{eq this.fillSource g.value}}
                    >{{g.label}}</option>{{/each}}
                  {{#if (eq this.fillSource "image")}}<option
                      value="image"
                      selected
                    >Image</option>{{/if}}
                </select>
              </label>
              <label class="st-btn st-wide st-upload"><Icon
                  @name="image"
                  @size={{13}}
                />Use an image…<input
                  type="file"
                  accept="image/*"
                  hidden
                  {{on "change" this.fillImage}}
                /></label>
              <div class="st-row-fields">
                <label class="st-field"><span>{{if
                      this.fillGenDef
                      "High"
                      "Colour"
                    }}</span><input
                    type="color"
                    value={{this.l.fill.color}}
                    {{on "change" (fn this.fillColor "color")}}
                  /></label>
                {{#if this.fillGenDef}}
                  <label class="st-field"><span>Low</span><input
                      type="color"
                      value={{this.l.fill.color2}}
                      {{on "change" (fn this.fillColor "color2")}}
                    /></label>
                {{/if}}
              </div>
              <StNum
                @label="Roughness"
                @value={{this.l.fill.rough}}
                @min={{0}}
                @max={{1}}
                @step={{0.01}}
                @onChange={{fn this.fillNum "rough"}}
              />
              <StNum
                @label="Metallic"
                @value={{this.l.fill.metal}}
                @min={{0}}
                @max={{1}}
                @step={{0.01}}
                @onChange={{fn this.fillNum "metal"}}
              />
              <StNum
                @label="Height"
                @value={{this.l.fill.height}}
                @min={{0}}
                @max={{1}}
                @step={{0.01}}
                @onChange={{fn this.fillNum "height"}}
              />
              {{#if this.fillGenDef}}
                <StParams
                  @params={{this.fillGenDef.params}}
                  @values={{this.fillGenValues}}
                  @onChange={{@s.setFillGenParam}}
                />
              {{/if}}
            {{/if}}

            <h4 class="st-h4">Mask</h4>
            {{#if this.l.mask}}
              {{#if (eq this.l.mask.mode "generator")}}
                <label class="st-field"><span>Generator</span>
                  <select {{on "change" this.maskGen}}>
                    {{#each this.generators as |g|}}<option
                        value={{g.value}}
                        selected={{eq this.l.mask.gen.type g.value}}
                      >{{g.label}}</option>{{/each}}
                  </select>
                </label>
                <StParams
                  @params={{this.maskGenDef.params}}
                  @values={{this.maskGenValues}}
                  @onChange={{@s.setMaskParam}}
                />
              {{else}}
                <button
                  type="button"
                  class="st-btn st-wide {{if @s.paintState.maskEdit 'active'}}"
                  {{on "click" @s.toggleMaskEdit}}
                ><Icon @name="brush" @size={{13}} />{{if
                    @s.paintState.maskEdit
                    "Painting the mask"
                    "Paint the mask"
                  }}</button>
                {{#if @s.paintState.maskEdit}}
                  <div class="st-chips">
                    <button
                      type="button"
                      class="st-chip {{if (eq @s.maskValue 1) 'on'}}"
                      {{on "click" (fn this.maskPaint 1)}}
                    >Reveal</button>
                    <button
                      type="button"
                      class="st-chip {{if (eq @s.maskValue 0) 'on'}}"
                      {{on "click" (fn this.maskPaint 0)}}
                    >Hide</button>
                  </div>
                {{/if}}
              {{/if}}
              <div class="st-btns">
                <button
                  type="button"
                  class="st-btn"
                  {{on "click" @s.toggleMaskInvert}}
                ><Icon @name="contrast" @size={{13}} />{{if
                    this.l.mask.invert
                    "Inverted"
                    "Invert"
                  }}</button>
                <button
                  type="button"
                  class="st-btn"
                  {{on "click" @s.removeMask}}
                ><Icon @name="x" @size={{13}} />Remove</button>
              </div>
            {{else}}
              <select aria-label="Add a mask" {{on "change" this.addMask}}>
                <option value="">Add a mask…</option>
                <option value="paint">Painted mask</option>
                {{#each this.generators as |g|}}<option
                    value={{g.value}}
                  >{{g.label}}</option>{{/each}}
              </select>
            {{/if}}
          </section>
        {{/if}}
      {{/if}}

      {{#if (eq this.section "brush")}}
        <section class="st-section st-brush">
          <h3 class="st-h">{{this.tool}}</h3>
          <StNum
            @label="Size (px)"
            @value={{@s.brush.size}}
            @min={{1}}
            @max={{500}}
            @step={{1}}
            @int={{true}}
            @onChange={{fn this.b "size"}}
          />
          <StNum
            @label="Hardness"
            @value={{@s.brush.hardness}}
            @min={{0}}
            @max={{0.99}}
            @step={{0.01}}
            @onChange={{fn this.b "hardness"}}
          />
          <StNum
            @label="Opacity"
            @value={{@s.brush.opacity}}
            @min={{0}}
            @max={{1}}
            @step={{0.01}}
            @onChange={{fn this.b "opacity"}}
          />
          <StNum
            @label="Flow"
            @value={{@s.brush.flow}}
            @min={{0.01}}
            @max={{1}}
            @step={{0.01}}
            @onChange={{fn this.b "flow"}}
          />
          <StNum
            @label="Spacing"
            @value={{@s.brush.spacing}}
            @min={{0.02}}
            @max={{2}}
            @step={{0.01}}
            @onChange={{fn this.b "spacing"}}
          />
          <label class="st-field"><span>Falloff</span>
            <select {{on "change" this.bFalloff}}>
              {{#each this.falloffs as |f|}}<option
                  value={{f}}
                  selected={{eq f @s.brush.falloff}}
                >{{f}}</option>{{/each}}
            </select>
          </label>
          <div class="st-row-fields">
            <label class="st-field"><span>Colour</span><input
                type="color"
                class="st-brush-color"
                value={{@s.brush.color}}
                {{on "change" (fn this.bColor "color")}}
              /></label>
            {{#if (eq this.tool "gradient")}}
              <label class="st-field"><span>To</span><input
                  type="color"
                  value={{@s.brush.color2}}
                  {{on "change" (fn this.bColor "color2")}}
                /></label>
            {{/if}}
          </div>
          <h4 class="st-h4">Paints</h4>
          <div class="st-chips" role="group" aria-label="Brush channels">
            {{#each this.channels as |c|}}
              <button
                type="button"
                class="st-chip {{if (chan @s.brush.channels c.key) 'on'}}"
                {{on "click" (fn @s.toggleBrushChannel c.key)}}
              >{{c.label}}</button>
            {{/each}}
          </div>
          {{#if
            (or
              @s.brush.channels.rough
              @s.brush.channels.metal
              @s.brush.channels.height
            )
          }}
            <StNum
              @label="Roughness"
              @value={{@s.brush.rough}}
              @min={{0}}
              @max={{1}}
              @step={{0.01}}
              @onChange={{fn this.b "rough"}}
            />
            <StNum
              @label="Metallic"
              @value={{@s.brush.metal}}
              @min={{0}}
              @max={{1}}
              @step={{0.01}}
              @onChange={{fn this.b "metal"}}
            />
            <StNum
              @label="Height"
              @value={{@s.brush.height}}
              @min={{0}}
              @max={{1}}
              @step={{0.01}}
              @onChange={{fn this.b "height"}}
            />
          {{/if}}
          <label class="st-check"><input
              type="checkbox"
              checked={{@s.brush.backfaces}}
              {{on "change" (fn this.bCheck "backfaces")}}
            /><span>Paint faces turned away</span></label>
          {{#if (eq this.tool "fill")}}
            <label class="st-check"><input
                type="checkbox"
                checked={{@s.brush.fillIsland}}
                {{on "change" (fn this.bCheck "fillIsland")}}
              /><span>Only the UV island clicked</span></label>
          {{/if}}
          {{#if this.usesImage}}
            <h4 class="st-h4">Image</h4>
            {{#if @s.brush.image}}
              <p class="st-note">{{@s.brush.image.name}}</p>
              <button
                type="button"
                class="st-btn"
                {{on "click" @s.clearBrushImage}}
              ><Icon @name="x" @size={{13}} />Remove image</button>
            {{/if}}
            <label class="st-btn st-wide st-upload"><Icon
                @name="upload"
                @size={{13}}
              />Load image…<input
                type="file"
                accept="image/*"
                hidden
                {{on "change" this.brushImage}}
              /></label>
            {{#if (eq this.tool "decal")}}
              <StNum
                @label="Decal size"
                @value={{@s.brush.decalSize}}
                @min={{0.01}}
                @max={{20}}
                @step={{0.01}}
                @onChange={{fn this.b "decalSize"}}
              />
              <StNum
                @label="Rotation"
                @value={{@s.brush.decalRotation}}
                @min={{-180}}
                @max={{180}}
                @step={{1}}
                @onChange={{fn this.b "decalRotation"}}
              />
            {{else}}
              <StNum
                @label="Overlay"
                @value={{@s.brush.overlayOpacity}}
                @min={{0}}
                @max={{1}}
                @step={{0.01}}
                @onChange={{fn this.b "overlayOpacity"}}
              />
              <p class="st-note">The image covers the view; paint to press it
                onto the model. Move the camera to place it.</p>
            {{/if}}
          {{/if}}
          <h4 class="st-h4">Material brushes</h4>
          <div class="st-smart-grid">
            {{#each @s.smartMaterials as |sm|}}
              <button
                type="button"
                class="st-smart"
                {{on "click" (fn @s.brushFromSmart sm.key)}}
              ><span
                  class="st-swatch"
                  style={{swatch sm.swatch}}
                ></span>{{sm.label}}</button>
            {{/each}}
          </div>
        </section>
      {{/if}}

      {{#if (eq this.section "smart")}}
        <section class="st-section">
          <h3 class="st-h"><Icon @name="sparkles" @size={{13}} />Smart materials</h3>
          <p class="st-note">Each is a stack of ordinary layers (fills,
            generators, masks) you can open up and change.</p>
          <div class="st-smart-grid">
            {{#each @s.smartMaterials as |sm|}}
              <button
                type="button"
                class="st-smart st-smart-{{sm.key}}"
                {{on "click" (fn @s.applySmartMaterial sm.key)}}
              ><span
                  class="st-swatch"
                  style={{swatch sm.swatch}}
                ></span>{{sm.label}}</button>
            {{/each}}
          </div>
        </section>
      {{/if}}

      {{#if (eq this.section "bake")}}
        <section class="st-section st-bake">
          <h3 class="st-h"><Icon @name="flame" @size={{13}} />Bake maps</h3>
          <p class="st-note">Bakes for the active material on
            {{@s.obj.name}}. To bake a detailed mesh onto this one, select it
            too (this one last) and bake a normal map.</p>
          <div class="st-btns">
            {{#each @s.bakers as |bk|}}
              <button
                type="button"
                class="st-btn st-bake-{{bk.key}}"
                disabled={{if @s.paintState.bakeProgress true false}}
                {{on "click" (fn @s.bake bk.key undefined)}}
              >{{bk.label}}</button>
            {{/each}}
          </div>
          {{#if this.bakeProgress}}
            <div
              class="st-progress"
              role="progressbar"
              aria-valuetext={{this.bakeProgress}}
            ><span
                style={{htmlSafe (concat "width:" this.bakeProgress)}}
              ></span></div>
          {{/if}}
          <p class="st-note">Ambient occlusion and normal maps go straight into
            the material; the others download and are kept with the scene.</p>
        </section>
      {{/if}}
    {{/if}}
  </template>
}

function chan(obj, key) {
  return obj?.[key];
}

function concat(...parts) {
  return parts.join('');
}
