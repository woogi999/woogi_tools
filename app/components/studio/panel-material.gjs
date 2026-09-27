import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import Icon from '../icon';
import StNum from './num';

// The Material tab: an object's material slots, the scene's materials, and
// the active one's physically based settings and texture maps.

const eq = (a, b) => a === b;
const neq = (a, b) => a !== b;
const swatch = (c) => htmlSafe(`background:${c}`);

const MAPS = [
  { slot: 'color', label: 'Base colour' },
  { slot: 'normal', label: 'Normal' },
  { slot: 'rough', label: 'Roughness' },
  { slot: 'metal', label: 'Metallic' },
  { slot: 'ao', label: 'Ambient occlusion' },
  { slot: 'height', label: 'Height' },
  { slot: 'emissive', label: 'Emission' },
  { slot: 'opacity', label: 'Opacity' },
];

export default class StudioMaterialPanel extends Component {
  maps = MAPS;

  get s() {
    return this.args.s;
  }

  get m() {
    return this.s.mat;
  }

  get mapRows() {
    const m = this.m;
    return MAPS.map((x) => {
      const id = m?.maps?.[x.slot];
      const tex = id ? this.s.doc.textures[id] : null;
      return {
        ...x,
        tex,
        style: tex ? htmlSafe(`background-image:url("${tex.url}")`) : null,
      };
    });
  }

  get animating() {
    return this.s.workspace === 'animate';
  }

  num = (key, v, final) => this.s.setMat(key, v, final);
  color = (key, e) => this.s.setMat(key, e.target.value, true);
  check = (key, e) => this.s.setMat(key, e.target.checked, true);
  upload = (slot, e) => {
    this.s.uploadMap(slot, e.target.files?.[0]);
    e.target.value = '';
  };
  pickMaterial = (e) => this.s.assignMaterial(e.target.value);
  stop = (e) => e.stopPropagation();

  <template>
    {{#if @s.isMesh}}
      <section class="st-section">
        <h3 class="st-h"><Icon @name="layers" @size={{13}} />Slots on
          {{@s.obj.name}}</h3>
        <ul class="st-slots">
          {{#each @s.slots as |slot|}}
            <li class="st-slot {{if (eq slot.index @s.slotIndex) 'active'}}">
              <button
                type="button"
                class="st-slot-pick"
                {{on "click" (fn @s.pickSlot slot.index)}}
              >
                <span class="st-swatch" style={{swatch slot.mat.color}}></span>
                <span>{{slot.index}} · {{slot.mat.name}}</span>
              </button>
              {{#if (neq @s.slots.length 1)}}
                <button
                  type="button"
                  class="st-mini"
                  title="Remove slot"
                  aria-label="Remove slot"
                  {{on "click" (fn @s.removeSlot slot.index)}}
                ><Icon @name="x" @size={{11}} /></button>
              {{/if}}
            </li>
          {{/each}}
        </ul>
        <div class="st-btns">
          <button type="button" class="st-btn" {{on "click" @s.addSlot}}><Icon
              @name="plus"
              @size={{13}}
            />Slot</button>
          {{#if (eq @s.mode "edit")}}
            <button
              type="button"
              class="st-btn"
              title="Give the selected faces this slot's material"
              {{on "click" (fn @s.assignSlotToFaces @s.slotIndex)}}
            ><Icon @name="paint-bucket" @size={{13}} />Assign to faces</button>
          {{/if}}
        </div>
        <label class="st-field"><span>Material</span>
          <select {{on "change" this.pickMaterial}}>
            {{#each @s.materials as |mm|}}<option
                value={{mm.id}}
                selected={{eq mm.id this.m.id}}
              >{{mm.name}}</option>{{/each}}
          </select>
        </label>
      </section>
    {{/if}}

    {{#if this.m}}
      <section class="st-section st-material">
        <div class="st-mat-head">
          <span class="st-swatch big" style={{swatch this.m.color}}></span>
          <input
            type="text"
            class="st-inline-name"
            value={{this.m.name}}
            aria-label="Material name"
            {{on "change" @s.renameMaterial}}
            {{on "keydown" this.stop}}
          />
        </div>
        <div class="st-btns">
          <button
            type="button"
            class="st-btn"
            {{on "click" (fn @s.addMaterial undefined)}}
          ><Icon @name="plus" @size={{13}} />New</button>
          <button
            type="button"
            class="st-btn"
            {{on "click" @s.duplicateMaterial}}
          ><Icon @name="copy" @size={{13}} />Duplicate</button>
          {{#if (neq @s.selected.length 1)}}
            <button
              type="button"
              class="st-btn"
              {{on "click" (fn @s.assignToSelection this.m.id)}}
            ><Icon @name="paint-bucket" @size={{13}} />Use on selected</button>
          {{/if}}
        </div>
        {{#if this.m.layers.length}}
          <p class="st-note">This material has
            {{this.m.layers.length}}
            texture layers, which set its colour, roughness and metalness. Edit
            them in the Texture workspace (F4).</p>
        {{/if}}
        <div class="st-prop">
          <label class="st-field"><span>Base colour</span><input
              type="color"
              value={{this.m.color}}
              {{on "change" (fn this.color "color")}}
            /></label>
          {{#if this.animating}}<button
              type="button"
              class="st-key"
              title="Key base colour"
              aria-label="Key base colour"
              {{on "click" (fn @s.keyMaterial "color")}}
            ><Icon @name="diamond" @size={{11}} /></button>{{/if}}
        </div>
        <div class="st-prop">
          <StNum
            @label="Roughness"
            @value={{this.m.rough}}
            @min={{0}}
            @max={{1}}
            @step={{0.01}}
            @onChange={{fn this.num "rough"}}
          />
          {{#if this.animating}}<button
              type="button"
              class="st-key"
              title="Key roughness"
              aria-label="Key roughness"
              {{on "click" (fn @s.keyMaterial "rough")}}
            ><Icon @name="diamond" @size={{11}} /></button>{{/if}}
        </div>
        <div class="st-prop">
          <StNum
            @label="Metallic"
            @value={{this.m.metal}}
            @min={{0}}
            @max={{1}}
            @step={{0.01}}
            @onChange={{fn this.num "metal"}}
          />
          {{#if this.animating}}<button
              type="button"
              class="st-key"
              title="Key metallic"
              aria-label="Key metallic"
              {{on "click" (fn @s.keyMaterial "metal")}}
            ><Icon @name="diamond" @size={{11}} /></button>{{/if}}
        </div>
        <div class="st-prop">
          <StNum
            @label="Opacity"
            @value={{this.m.opacity}}
            @min={{0}}
            @max={{1}}
            @step={{0.01}}
            @onChange={{fn this.num "opacity"}}
          />
          {{#if this.animating}}<button
              type="button"
              class="st-key"
              title="Key opacity"
              aria-label="Key opacity"
              {{on "click" (fn @s.keyMaterial "opacity")}}
            ><Icon @name="diamond" @size={{11}} /></button>{{/if}}
        </div>
        <div class="st-prop">
          <label class="st-field"><span>Emission</span><input
              type="color"
              value={{this.m.emissive}}
              {{on "change" (fn this.color "emissive")}}
            /></label>
        </div>
        <div class="st-prop">
          <StNum
            @label="Emission strength"
            @value={{this.m.emissiveIntensity}}
            @min={{0}}
            @max={{50}}
            @step={{0.05}}
            @onChange={{fn this.num "emissiveIntensity"}}
          />
          {{#if this.animating}}<button
              type="button"
              class="st-key"
              title="Key emission"
              aria-label="Key emission"
              {{on "click" (fn @s.keyMaterial "emissiveIntensity")}}
            ><Icon @name="diamond" @size={{11}} /></button>{{/if}}
        </div>
        <StNum
          @label="Normal strength"
          @value={{this.m.normalScale}}
          @min={{-5}}
          @max={{5}}
          @step={{0.05}}
          @onChange={{fn this.num "normalScale"}}
        />
        <StNum
          @label="Height scale"
          @value={{this.m.heightScale}}
          @min={{0}}
          @max={{1}}
          @step={{0.005}}
          @onChange={{fn this.num "heightScale"}}
        />
        <StNum
          @label="AO strength"
          @value={{this.m.aoIntensity}}
          @min={{0}}
          @max={{2}}
          @step={{0.05}}
          @onChange={{fn this.num "aoIntensity"}}
        />
        <label class="st-check"><input
            type="checkbox"
            checked={{this.m.doubleSided}}
            {{on "change" (fn this.check "doubleSided")}}
          /><span>Double-sided</span></label>
        <label class="st-check"><input
            type="checkbox"
            checked={{this.m.flat}}
            {{on "change" (fn this.check "flat")}}
          /><span>Flat shading</span></label>
        <label class="st-field"><span>Outline colour</span><input
            type="color"
            value={{this.m.outline}}
            {{on "change" (fn this.color "outline")}}
          /></label>
      </section>

      <section class="st-section">
        <h3 class="st-h"><Icon @name="image" @size={{13}} />Texture maps</h3>
        <ul class="st-maps">
          {{#each this.mapRows as |row|}}
            <li class="st-map">
              <span class="st-map-thumb" style={{row.style}}></span>
              <span class="st-map-label">{{row.label}}</span>
              <label class="st-mini st-upload" title="Load an image">
                <Icon @name="upload" @size={{11}} />
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  {{on "change" (fn this.upload row.slot)}}
                />
              </label>
              {{#if row.tex}}
                <button
                  type="button"
                  class="st-mini"
                  title="Clear"
                  aria-label="Clear {{row.label}} map"
                  {{on "click" (fn @s.clearMap row.slot)}}
                ><Icon @name="x" @size={{11}} /></button>
              {{/if}}
            </li>
          {{/each}}
        </ul>
      </section>

      <section class="st-section">
        <h3 class="st-h"><Icon @name="sparkles" @size={{13}} />Smart materials</h3>
        <div class="st-smart-grid">
          {{#each @s.smartMaterials as |sm|}}
            <button
              type="button"
              class="st-smart"
              title="{{sm.label}}: editable procedural layers"
              {{on "click" (fn @s.applySmartMaterial sm.key)}}
            >
              <span
                class="st-swatch"
                style={{swatch sm.swatch}}
              ></span>{{sm.label}}
            </button>
          {{/each}}
        </div>
      </section>
    {{/if}}
  </template>
}
