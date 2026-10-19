<script module>
  import { onDestroy } from 'svelte';
  import Component from '../../core/component.js';
  import { truthy, on, prop } from '../../core/helpers.js';
  import { destroy } from '../../core/destroyable.js';
  import Icon from '../icon.svelte';
  import StNum from './num.svelte';

  // The Material tab: an object's material slots, the scene's materials, and
  // the active one's physically based settings and texture maps.

  const eq = (a, b) => a === b;
  const neq = (a, b) => a !== b;
  const swatch = (c) => `background:${c}`;

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

  class StudioMaterialPanel extends Component {
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
          style: tex ? `background-image:url("${tex.url}")` : null,
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
  }
</script>

<script>
  let args = $props();
  const self = new StudioMaterialPanel(args);
  onDestroy(() => destroy(self));
</script>

{#if truthy(args.s?.isMesh)}
  <section class="st-section">
    <h3 class="st-h"
      ><Icon name="layers" size={13} />Slots on
      {args.s?.obj?.name}</h3
    >
    <ul class="st-slots">
      {#each args.s?.slots ?? [] as slot}
        <li
          class="st-slot {truthy(eq(slot?.index, args.s?.slotIndex))
            ? 'active'
            : ''}"
        >
          <button
            type="button"
            class="st-slot-pick"
            onclick={(..._r) => args.s?.pickSlot(slot?.index, ..._r)}
          >
            <span class="st-swatch" style={swatch(slot?.mat?.color)}></span>
            <span>{slot?.index} · {slot?.mat?.name}</span>
          </button>
          {#if truthy(neq(args.s?.slots?.length, 1))}
            <button
              type="button"
              class="st-mini"
              title="Remove slot"
              aria-label="Remove slot"
              onclick={(..._r) => args.s?.removeSlot(slot?.index, ..._r)}
              ><Icon name="x" size={11} /></button
            >
          {/if}
        </li>
      {/each}
    </ul>
    <div class="st-btns">
      <button type="button" class="st-btn" onclick={args.s?.addSlot}
        ><Icon name="plus" size={13} />Slot</button
      >
      {#if truthy(eq(args.s?.mode, 'edit'))}
        <button
          type="button"
          class="st-btn"
          title="Give the selected faces this slot's material"
          onclick={(..._r) =>
            args.s?.assignSlotToFaces(args.s?.slotIndex, ..._r)}
          ><Icon name="paint-bucket" size={13} />Assign to faces</button
        >
      {/if}
    </div>
    <label class="st-field"
      ><span>Material</span>
      <select onchange={self.pickMaterial}>
        {#each args.s?.materials ?? [] as mm}<option
            value={mm?.id}
            {@attach prop('selected', () => eq(mm?.id, self.m?.id))}
            >{mm?.name}</option
          >{/each}
      </select>
    </label>
  </section>
{/if}

{#if truthy(self.m)}
  <section class="st-section st-material">
    <div class="st-mat-head">
      <span class="st-swatch big" style={swatch(self.m?.color)}></span>
      <input
        type="text"
        class="st-inline-name"
        {@attach prop('value', () => self.m?.name)}
        aria-label="Material name"
        {@attach on('keydown', self.stop)}
        onchange={args.s?.renameMaterial}
      />
    </div>
    <div class="st-btns">
      <button
        type="button"
        class="st-btn"
        onclick={(..._r) => args.s?.addMaterial(undefined, ..._r)}
        ><Icon name="plus" size={13} />New</button
      >
      <button type="button" class="st-btn" onclick={args.s?.duplicateMaterial}
        ><Icon name="copy" size={13} />Duplicate</button
      >
      {#if truthy(neq(args.s?.selected?.length, 1))}
        <button
          type="button"
          class="st-btn"
          onclick={(..._r) => args.s?.assignToSelection(self.m?.id, ..._r)}
          ><Icon name="paint-bucket" size={13} />Use on selected</button
        >
      {/if}
    </div>
    {#if truthy(self.m?.layers?.length)}
      <p class="st-note"
        >This material has
        {self.m?.layers?.length}
        texture layers, which set its colour, roughness and metalness. Edit them in
        the Texture workspace (F4).</p
      >
    {/if}
    <div class="st-prop">
      <label class="st-field"
        ><span>Base colour</span><input
          type="color"
          {@attach prop('value', () => self.m?.color)}
          onchange={(..._r) => self.color('color', ..._r)}
        /></label
      >
      {#if truthy(self.animating)}<button
          type="button"
          class="st-key"
          title="Key base colour"
          aria-label="Key base colour"
          onclick={(..._r) => args.s?.keyMaterial('color', ..._r)}
          ><Icon name="diamond" size={11} /></button
        >{/if}
    </div>
    <div class="st-prop">
      <StNum
        label="Roughness"
        value={self.m?.rough}
        min={0}
        max={1}
        step={0.01}
        onChange={(..._r) => self.num('rough', ..._r)}
      />
      {#if truthy(self.animating)}<button
          type="button"
          class="st-key"
          title="Key roughness"
          aria-label="Key roughness"
          onclick={(..._r) => args.s?.keyMaterial('rough', ..._r)}
          ><Icon name="diamond" size={11} /></button
        >{/if}
    </div>
    <div class="st-prop">
      <StNum
        label="Metallic"
        value={self.m?.metal}
        min={0}
        max={1}
        step={0.01}
        onChange={(..._r) => self.num('metal', ..._r)}
      />
      {#if truthy(self.animating)}<button
          type="button"
          class="st-key"
          title="Key metallic"
          aria-label="Key metallic"
          onclick={(..._r) => args.s?.keyMaterial('metal', ..._r)}
          ><Icon name="diamond" size={11} /></button
        >{/if}
    </div>
    <div class="st-prop">
      <StNum
        label="Opacity"
        value={self.m?.opacity}
        min={0}
        max={1}
        step={0.01}
        onChange={(..._r) => self.num('opacity', ..._r)}
      />
      {#if truthy(self.animating)}<button
          type="button"
          class="st-key"
          title="Key opacity"
          aria-label="Key opacity"
          onclick={(..._r) => args.s?.keyMaterial('opacity', ..._r)}
          ><Icon name="diamond" size={11} /></button
        >{/if}
    </div>
    <div class="st-prop">
      <label class="st-field"
        ><span>Emission</span><input
          type="color"
          {@attach prop('value', () => self.m?.emissive)}
          onchange={(..._r) => self.color('emissive', ..._r)}
        /></label
      >
    </div>
    <div class="st-prop">
      <StNum
        label="Emission strength"
        value={self.m?.emissiveIntensity}
        min={0}
        max={50}
        step={0.05}
        onChange={(..._r) => self.num('emissiveIntensity', ..._r)}
      />
      {#if truthy(self.animating)}<button
          type="button"
          class="st-key"
          title="Key emission"
          aria-label="Key emission"
          onclick={(..._r) => args.s?.keyMaterial('emissiveIntensity', ..._r)}
          ><Icon name="diamond" size={11} /></button
        >{/if}
    </div>
    <StNum
      label="Normal strength"
      value={self.m?.normalScale}
      min={-5}
      max={5}
      step={0.05}
      onChange={(..._r) => self.num('normalScale', ..._r)}
    />
    <StNum
      label="Height scale"
      value={self.m?.heightScale}
      min={0}
      max={1}
      step={0.005}
      onChange={(..._r) => self.num('heightScale', ..._r)}
    />
    <StNum
      label="AO strength"
      value={self.m?.aoIntensity}
      min={0}
      max={2}
      step={0.05}
      onChange={(..._r) => self.num('aoIntensity', ..._r)}
    />
    <label class="st-check"
      ><input
        type="checkbox"
        {@attach prop('checked', () => self.m?.doubleSided)}
        onchange={(..._r) => self.check('doubleSided', ..._r)}
      /><span>Double-sided</span></label
    >
    <label class="st-check"
      ><input
        type="checkbox"
        {@attach prop('checked', () => self.m?.flat)}
        onchange={(..._r) => self.check('flat', ..._r)}
      /><span>Flat shading</span></label
    >
    <label class="st-field"
      ><span>Outline colour</span><input
        type="color"
        {@attach prop('value', () => self.m?.outline)}
        onchange={(..._r) => self.color('outline', ..._r)}
      /></label
    >
  </section>

  <section class="st-section">
    <h3 class="st-h"><Icon name="image" size={13} />Texture maps</h3>
    <ul class="st-maps">
      {#each self.mapRows ?? [] as row}
        <li class="st-map">
          <span class="st-map-thumb" style={row?.style}></span>
          <span class="st-map-label">{row?.label}</span>
          <label class="st-mini st-upload" title="Load an image">
            <Icon name="upload" size={11} />
            <input
              type="file"
              accept="image/*"
              hidden
              onchange={(..._r) => self.upload(row?.slot, ..._r)}
            />
          </label>
          {#if truthy(row?.tex)}
            <button
              type="button"
              class="st-mini"
              title="Clear"
              aria-label="Clear {row?.label} map"
              onclick={(..._r) => args.s?.clearMap(row?.slot, ..._r)}
              ><Icon name="x" size={11} /></button
            >
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section class="st-section">
    <h3 class="st-h"><Icon name="sparkles" size={13} />Smart materials</h3>
    <div class="st-smart-grid">
      {#each args.s?.smartMaterials ?? [] as sm}
        <button
          type="button"
          class="st-smart"
          title="{sm?.label}: editable procedural layers"
          onclick={(..._r) => args.s?.applySmartMaterial(sm?.key, ..._r)}
        >
          <span class="st-swatch" style={swatch(sm?.swatch)}></span>{sm?.label}
        </button>
      {/each}
    </div>
  </section>
{/if}
