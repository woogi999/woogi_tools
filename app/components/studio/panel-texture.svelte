<script module>
  import { onDestroy } from 'svelte';
  import Component from '../../core/component.js';
  import { truthy, on, prop } from '../../core/helpers.js';
  import { destroy } from '../../core/destroyable.js';
  import Icon from '../icon.svelte';
  import StNum from './num.svelte';
  import StParams from './params.svelte';

  // The Texture workspace's panel: the active material's layer stack (top
  // of the list is the top of the stack), the selected layer's settings, the
  // brush, smart materials and bakes.

  const eq = (a, b) => a === b;
  const neq = (a, b) => a !== b;
  const or = (...xs) => xs.some(Boolean);
  const swatch = (c) => `background:${c}`;
  const pct = (v) => Math.round(v * 100);

  const SIZES = [256, 512, 1024, 2048];
  const CHANNELS = [
    { key: 'color', label: 'Colour' },
    { key: 'rough', label: 'Rough' },
    { key: 'metal', label: 'Metal' },
    { key: 'height', label: 'Height' },
  ];

  class StudioTexturePanel extends Component {
    sizes = SIZES;
    channels = CHANNELS;
    section = $state.raw('layers');
    dragId = $state.raw(null);

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
  }

  function chan(obj, key) {
    return obj?.[key];
  }

  function concat(...parts) {
    return parts.join('');
  }
</script>

<script>
  let args = $props();
  const self = new StudioTexturePanel(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable no-invalid-interactive -->
{#if truthy(self.noMesh)}
  <section class="st-section"
    ><p class="st-note">Select a mesh to paint.</p></section
  >
{:else}
  <div class="st-subtabs" role="tablist">
    <button
      type="button"
      role="tab"
      class={truthy(eq(self.section, 'layers')) ? 'active' : ''}
      onclick={(..._r) => self.setSection('layers', ..._r)}>Layers</button
    >
    <button
      type="button"
      role="tab"
      class="st-brush-tab {truthy(eq(self.section, 'brush')) ? 'active' : ''}"
      onclick={(..._r) => self.setSection('brush', ..._r)}>Brush</button
    >
    <button
      type="button"
      role="tab"
      class="st-smart-tab {truthy(eq(self.section, 'smart')) ? 'active' : ''}"
      onclick={(..._r) => self.setSection('smart', ..._r)}>Smart</button
    >
    <button
      type="button"
      role="tab"
      class="st-bake-tab {truthy(eq(self.section, 'bake')) ? 'active' : ''}"
      onclick={(..._r) => self.setSection('bake', ..._r)}>Bake</button
    >
  </div>

  <section class="st-section">
    <div class="st-row-fields">
      <label class="st-field"
        ><span>Material</span>
        <select onchange={self.pickSlot}>
          {#each args.s?.slots ?? [] as slot}<option
              value={slot?.index}
              {@attach prop('selected', () =>
                eq(slot?.index, args.s?.slotIndex),
              )}>{slot?.mat?.name}</option
            >{/each}
        </select>
      </label>
      <label class="st-field"
        ><span>Texture</span>
        <select onchange={self.texSize}>
          {#each self.sizes ?? [] as n}<option
              value={n}
              {@attach prop('selected', () => eq(n, args.s?.mat?.texSize))}
              >{n}</option
            >{/each}
        </select>
      </label>
    </div>
    {#if truthy(self.setInfo)}<p class="st-note">{self.setInfo}</p>{/if}
  </section>

  {#if truthy(eq(self.section, 'layers'))}
    <section class="st-section st-layers">
      <div class="st-btns">
        <button
          type="button"
          class="st-btn st-add-paint"
          onclick={(..._r) => args.s?.addLayer('paint', ..._r)}
          ><Icon name="paintbrush" size={13} />Paint layer</button
        >
        <button
          type="button"
          class="st-btn st-add-fill"
          onclick={(..._r) => args.s?.addLayer('fill', ..._r)}
          ><Icon name="paint-bucket" size={13} />Fill layer</button
        >
      </div>
      <ul class="st-layer-list">
        {#each args.s?.layerRows ?? [] as row (row?.layer?.id)}
          <li
            class="st-layer
                  {truthy(row?.active) ? 'active' : ''}
                  {truthy(row?.layer?.visible) ? '' : 'is-hidden'}"
            draggable="true"
            ondrop={(..._r) => self.dropOn(row?.layer?.id, ..._r)}
            ondragover={self.dragOver}
            ondragstart={(..._r) => self.dragStart(row?.layer?.id, ..._r)}
            onclick={(..._r) => args.s?.setActiveLayer(row?.layer?.id, ..._r)}
          >
            <button
              type="button"
              class="st-mini"
              title={truthy(row?.layer?.visible) ? 'Hide' : 'Show'}
              aria-label="Toggle visibility"
              onclick={(..._r) =>
                args.s?.toggleLayerVisible(row?.layer?.id, ..._r)}
              ><Icon
                name={truthy(row?.layer?.visible) ? 'eye' : 'eye-off'}
                size={11}
              /></button
            >
            {#if truthy(row?.swatch)}
              <span class="st-swatch" style={swatch(row?.swatch)}></span>
            {:else}
              <Icon name="paintbrush" size={12} />
            {/if}
            <span class="st-layer-name">{row?.layer?.name}</span>
            {#if truthy(row?.layer?.mask)}<Icon
                name="circle-dashed"
                size={11}
                class="st-layer-mask"
              />{/if}
            <span class="st-layer-meta"
              >{pct(
                row?.layer?.opacity,
              )}%{#if truthy(neq(row?.layer?.blend, 'normal'))}
                · {row?.layer?.blend}{/if}</span
            >
          </li>
        {:else}
          <li class="st-empty"
            >No layers yet: paint to start one, add a fill, or pick a smart
            material.</li
          >
        {/each}
      </ul>
    </section>

    {#if truthy(self.l)}
      <section class="st-section st-layer-props">
        <input
          type="text"
          class="st-inline-name"
          {@attach prop('value', () => self.l?.name)}
          aria-label="Layer name"
          {@attach on('keydown', self.stop)}
          onchange={(..._r) => args.s?.renameLayer(self.l?.id, ..._r)}
        />
        <div class="st-btns">
          <button
            type="button"
            class="st-mini"
            title="Move up"
            aria-label="Move up"
            onclick={(..._r) => args.s?.moveLayer(self.l?.id, 1, ..._r)}
            ><Icon name="arrow-up" size={11} /></button
          >
          <button
            type="button"
            class="st-mini"
            title="Move down"
            aria-label="Move down"
            onclick={(..._r) => args.s?.moveLayer(self.l?.id, -1, ..._r)}
            ><Icon name="arrow-down" size={11} /></button
          >
          <button
            type="button"
            class="st-mini"
            title="Duplicate"
            aria-label="Duplicate layer"
            onclick={(..._r) => args.s?.duplicateLayer(self.l?.id, ..._r)}
            ><Icon name="copy" size={11} /></button
          >
          {#if truthy(eq(self.l?.kind, 'paint'))}
            <button
              type="button"
              class="st-mini"
              title="Clear"
              aria-label="Clear layer"
              onclick={args.s?.clearLayer}
              ><Icon name="eraser" size={11} /></button
            >
          {/if}
          <button
            type="button"
            class="st-mini"
            title="Delete"
            aria-label="Delete layer"
            onclick={(..._r) => args.s?.removeLayer(self.l?.id, ..._r)}
            ><Icon name="trash-2" size={11} /></button
          >
        </div>
        <label class="st-field"
          ><span>Blend</span>
          <select onchange={self.setBlend}>
            {#each self.blendModes ?? [] as m}<option
                value={m}
                {@attach prop('selected', () => eq(m, self.l?.blend))}
                >{m}</option
              >{/each}
          </select>
        </label>
        <StNum
          label="Opacity"
          value={self.l?.opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(..._r) => self.layerNum('opacity', ..._r)}
        />
        <div class="st-chips" role="group" aria-label="Channels">
          {#each self.channels ?? [] as c}
            <button
              type="button"
              class="st-chip {truthy(chan(self.l?.channels, c?.key))
                ? 'on'
                : ''}"
              onclick={(..._r) => args.s?.toggleLayerChannel(c?.key, ..._r)}
              >{c?.label}</button
            >
          {/each}
        </div>

        {#if truthy(eq(self.l?.kind, 'fill'))}
          <label class="st-field"
            ><span>Source</span>
            <select onchange={self.setSource}>
              <option
                value="solid"
                {@attach prop('selected', () => eq(self.fillSource, 'solid'))}
                >Flat material</option
              >
              {#each self.generators ?? [] as g}<option
                  value={g?.value}
                  {@attach prop('selected', () =>
                    eq(self.fillSource, g?.value),
                  )}>{g?.label}</option
                >{/each}
              {#if truthy(eq(self.fillSource, 'image'))}<option
                  value="image"
                  selected>Image</option
                >{/if}
            </select>
          </label>
          <label class="st-btn st-wide st-upload"
            ><Icon name="image" size={13} />Use an image…<input
              type="file"
              accept="image/*"
              hidden
              onchange={self.fillImage}
            /></label
          >
          <div class="st-row-fields">
            <label class="st-field"
              ><span>{truthy(self.fillGenDef) ? 'High' : 'Colour'}</span><input
                type="color"
                {@attach prop('value', () => self.l?.fill?.color)}
                onchange={(..._r) => self.fillColor('color', ..._r)}
              /></label
            >
            {#if truthy(self.fillGenDef)}
              <label class="st-field"
                ><span>Low</span><input
                  type="color"
                  {@attach prop('value', () => self.l?.fill?.color2)}
                  onchange={(..._r) => self.fillColor('color2', ..._r)}
                /></label
              >
            {/if}
          </div>
          <StNum
            label="Roughness"
            value={self.l?.fill?.rough}
            min={0}
            max={1}
            step={0.01}
            onChange={(..._r) => self.fillNum('rough', ..._r)}
          />
          <StNum
            label="Metallic"
            value={self.l?.fill?.metal}
            min={0}
            max={1}
            step={0.01}
            onChange={(..._r) => self.fillNum('metal', ..._r)}
          />
          <StNum
            label="Height"
            value={self.l?.fill?.height}
            min={0}
            max={1}
            step={0.01}
            onChange={(..._r) => self.fillNum('height', ..._r)}
          />
          {#if truthy(self.fillGenDef)}
            <StParams
              params={self.fillGenDef?.params}
              values={self.fillGenValues}
              onChange={args.s?.setFillGenParam}
            />
          {/if}
        {/if}

        <h4 class="st-h4">Mask</h4>
        {#if truthy(self.l?.mask)}
          {#if truthy(eq(self.l?.mask?.mode, 'generator'))}
            <label class="st-field"
              ><span>Generator</span>
              <select onchange={self.maskGen}>
                {#each self.generators ?? [] as g}<option
                    value={g?.value}
                    {@attach prop('selected', () =>
                      eq(self.l?.mask?.gen?.type, g?.value),
                    )}>{g?.label}</option
                  >{/each}
              </select>
            </label>
            <StParams
              params={self.maskGenDef?.params}
              values={self.maskGenValues}
              onChange={args.s?.setMaskParam}
            />
          {:else}
            <button
              type="button"
              class="st-btn st-wide {truthy(args.s?.paintState?.maskEdit)
                ? 'active'
                : ''}"
              onclick={args.s?.toggleMaskEdit}
              ><Icon name="brush" size={13} />{truthy(
                args.s?.paintState?.maskEdit,
              )
                ? 'Painting the mask'
                : 'Paint the mask'}</button
            >
            {#if truthy(args.s?.paintState?.maskEdit)}
              <div class="st-chips">
                <button
                  type="button"
                  class="st-chip {truthy(eq(args.s?.maskValue, 1)) ? 'on' : ''}"
                  onclick={(..._r) => self.maskPaint(1, ..._r)}>Reveal</button
                >
                <button
                  type="button"
                  class="st-chip {truthy(eq(args.s?.maskValue, 0)) ? 'on' : ''}"
                  onclick={(..._r) => self.maskPaint(0, ..._r)}>Hide</button
                >
              </div>
            {/if}
          {/if}
          <div class="st-btns">
            <button
              type="button"
              class="st-btn"
              onclick={args.s?.toggleMaskInvert}
              ><Icon name="contrast" size={13} />{truthy(self.l?.mask?.invert)
                ? 'Inverted'
                : 'Invert'}</button
            >
            <button type="button" class="st-btn" onclick={args.s?.removeMask}
              ><Icon name="x" size={13} />Remove</button
            >
          </div>
        {:else}
          <select aria-label="Add a mask" onchange={self.addMask}>
            <option value="">Add a mask…</option>
            <option value="paint">Painted mask</option>
            {#each self.generators ?? [] as g}<option value={g?.value}
                >{g?.label}</option
              >{/each}
          </select>
        {/if}
      </section>
    {/if}
  {/if}

  {#if truthy(eq(self.section, 'brush'))}
    <section class="st-section st-brush">
      <h3 class="st-h">{self.tool}</h3>
      <StNum
        label="Size (px)"
        value={args.s?.brush?.size}
        min={1}
        max={500}
        step={1}
        int={true}
        onChange={(..._r) => self.b('size', ..._r)}
      />
      <StNum
        label="Hardness"
        value={args.s?.brush?.hardness}
        min={0}
        max={0.99}
        step={0.01}
        onChange={(..._r) => self.b('hardness', ..._r)}
      />
      <StNum
        label="Opacity"
        value={args.s?.brush?.opacity}
        min={0}
        max={1}
        step={0.01}
        onChange={(..._r) => self.b('opacity', ..._r)}
      />
      <StNum
        label="Flow"
        value={args.s?.brush?.flow}
        min={0.01}
        max={1}
        step={0.01}
        onChange={(..._r) => self.b('flow', ..._r)}
      />
      <StNum
        label="Spacing"
        value={args.s?.brush?.spacing}
        min={0.02}
        max={2}
        step={0.01}
        onChange={(..._r) => self.b('spacing', ..._r)}
      />
      <label class="st-field"
        ><span>Falloff</span>
        <select onchange={self.bFalloff}>
          {#each self.falloffs ?? [] as f}<option
              value={f}
              {@attach prop('selected', () => eq(f, args.s?.brush?.falloff))}
              >{f}</option
            >{/each}
        </select>
      </label>
      <div class="st-row-fields">
        <label class="st-field"
          ><span>Colour</span><input
            type="color"
            class="st-brush-color"
            {@attach prop('value', () => args.s?.brush?.color)}
            onchange={(..._r) => self.bColor('color', ..._r)}
          /></label
        >
        {#if truthy(eq(self.tool, 'gradient'))}
          <label class="st-field"
            ><span>To</span><input
              type="color"
              {@attach prop('value', () => args.s?.brush?.color2)}
              onchange={(..._r) => self.bColor('color2', ..._r)}
            /></label
          >
        {/if}
      </div>
      <h4 class="st-h4">Paints</h4>
      <div class="st-chips" role="group" aria-label="Brush channels">
        {#each self.channels ?? [] as c}
          <button
            type="button"
            class="st-chip {truthy(chan(args.s?.brush?.channels, c?.key))
              ? 'on'
              : ''}"
            onclick={(..._r) => args.s?.toggleBrushChannel(c?.key, ..._r)}
            >{c?.label}</button
          >
        {/each}
      </div>
      {#if truthy(or(args.s?.brush?.channels?.rough, args.s?.brush?.channels?.metal, args.s?.brush?.channels?.height))}
        <StNum
          label="Roughness"
          value={args.s?.brush?.rough}
          min={0}
          max={1}
          step={0.01}
          onChange={(..._r) => self.b('rough', ..._r)}
        />
        <StNum
          label="Metallic"
          value={args.s?.brush?.metal}
          min={0}
          max={1}
          step={0.01}
          onChange={(..._r) => self.b('metal', ..._r)}
        />
        <StNum
          label="Height"
          value={args.s?.brush?.height}
          min={0}
          max={1}
          step={0.01}
          onChange={(..._r) => self.b('height', ..._r)}
        />
      {/if}
      <label class="st-check"
        ><input
          type="checkbox"
          {@attach prop('checked', () => args.s?.brush?.backfaces)}
          onchange={(..._r) => self.bCheck('backfaces', ..._r)}
        /><span>Paint faces turned away</span></label
      >
      {#if truthy(eq(self.tool, 'fill'))}
        <label class="st-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => args.s?.brush?.fillIsland)}
            onchange={(..._r) => self.bCheck('fillIsland', ..._r)}
          /><span>Only the UV island clicked</span></label
        >
      {/if}
      {#if truthy(self.usesImage)}
        <h4 class="st-h4">Image</h4>
        {#if truthy(args.s?.brush?.image)}
          <p class="st-note">{args.s?.brush?.image?.name}</p>
          <button type="button" class="st-btn" onclick={args.s?.clearBrushImage}
            ><Icon name="x" size={13} />Remove image</button
          >
        {/if}
        <label class="st-btn st-wide st-upload"
          ><Icon name="upload" size={13} />Load image…<input
            type="file"
            accept="image/*"
            hidden
            onchange={self.brushImage}
          /></label
        >
        {#if truthy(eq(self.tool, 'decal'))}
          <StNum
            label="Decal size"
            value={args.s?.brush?.decalSize}
            min={0.01}
            max={20}
            step={0.01}
            onChange={(..._r) => self.b('decalSize', ..._r)}
          />
          <StNum
            label="Rotation"
            value={args.s?.brush?.decalRotation}
            min={-180}
            max={180}
            step={1}
            onChange={(..._r) => self.b('decalRotation', ..._r)}
          />
        {:else}
          <StNum
            label="Overlay"
            value={args.s?.brush?.overlayOpacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(..._r) => self.b('overlayOpacity', ..._r)}
          />
          <p class="st-note"
            >The image covers the view; paint to press it onto the model. Move
            the camera to place it.</p
          >
        {/if}
      {/if}
      <h4 class="st-h4">Material brushes</h4>
      <div class="st-smart-grid">
        {#each args.s?.smartMaterials ?? [] as sm}
          <button
            type="button"
            class="st-smart"
            onclick={(..._r) => args.s?.brushFromSmart(sm?.key, ..._r)}
            ><span class="st-swatch" style={swatch(sm?.swatch)}
            ></span>{sm?.label}</button
          >
        {/each}
      </div>
    </section>
  {/if}

  {#if truthy(eq(self.section, 'smart'))}
    <section class="st-section">
      <h3 class="st-h"><Icon name="sparkles" size={13} />Smart materials</h3>
      <p class="st-note"
        >Each is a stack of ordinary layers (fills, generators, masks) you can
        open up and change.</p
      >
      <div class="st-smart-grid">
        {#each args.s?.smartMaterials ?? [] as sm}
          <button
            type="button"
            class="st-smart st-smart-{sm?.key}"
            onclick={(..._r) => args.s?.applySmartMaterial(sm?.key, ..._r)}
            ><span class="st-swatch" style={swatch(sm?.swatch)}
            ></span>{sm?.label}</button
          >
        {/each}
      </div>
    </section>
  {/if}

  {#if truthy(eq(self.section, 'bake'))}
    <section class="st-section st-bake">
      <h3 class="st-h"><Icon name="flame" size={13} />Bake maps</h3>
      <p class="st-note"
        >Bakes for the active material on
        {args.s?.obj?.name}. To bake a detailed mesh onto this one, select it
        too (this one last) and bake a normal map.</p
      >
      <div class="st-btns">
        {#each args.s?.bakers ?? [] as bk}
          <button
            type="button"
            class="st-btn st-bake-{bk?.key}"
            disabled={truthy(args.s?.paintState?.bakeProgress) ? true : false}
            onclick={(..._r) => args.s?.bake(bk?.key, undefined, ..._r)}
            >{bk?.label}</button
          >
        {/each}
      </div>
      {#if truthy(self.bakeProgress)}
        <div
          class="st-progress"
          role="progressbar"
          aria-valuetext={self.bakeProgress}
          ><span style={concat('width:', self.bakeProgress)}></span></div
        >
      {/if}
      <p class="st-note"
        >Ambient occlusion and normal maps go straight into the material; the
        others download and are kept with the scene.</p
      >
    </section>
  {/if}
{/if}
