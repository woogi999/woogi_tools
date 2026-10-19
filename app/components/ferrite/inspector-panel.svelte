<script module>
  import { onDestroy } from 'svelte';
  import Component from '../../core/component.js';
  import { truthy, prop } from '../../core/helpers.js';
  import { destroy } from '../../core/destroyable.js';
  import Icon from '../icon.svelte';
  import ColourField from '../colour-field.svelte';
  import ScrubNumber from './scrub-number.svelte';
  import {
    BLEND_MODES,
    FITS,
    ALIGNS,
    CASES,
    MATTES,
    KINDS,
  } from '../../utils/ferrite/model.js';

  // The inspector, ported from `ferrite-app/src/ui/inspector.rs`.
  //
  // Everything about the current selection, and every control here writes a
  // property of the layer. There is no raw-CSS escape hatch, the way Ferrite
  // removed its: it was a second way to say what the rows above already say, in
  // a language the renderer only partly speaks.
  //
  // A stopwatch sits in front of every keyable row. Turning it on keys the value
  // where the playhead is; turning it off keeps whatever was on screen. That is
  // what makes it a switch rather than a mode.
  const eq = (a, b) => a === b;
  const FONTS = [
    'system-ui',
    'Inter',
    'Georgia',
    'Impact',
    'Times New Roman',
    'Courier New',
    'Trebuchet MS',
    'Verdana',
    'Arial Black',
  ];

  class InspectorPanel extends Component {
    blendModes = BLEND_MODES;
    fits = FITS;
    aligns = ALIGNS;
    cases = CASES;
    mattes = MATTES;
    fonts = FONTS;

    get layer() {
      return this.args.editor.layer;
    }

    get kindLabel() {
      return KINDS[this.layer?.kind]?.label ?? '';
    }

    get kindIcon() {
      return KINDS[this.layer?.kind]?.icon ?? 'layers';
    }

    get isText() {
      return this.layer?.kind === 'text';
    }

    get isMedia() {
      return ['image', 'video', 'audio'].includes(this.layer?.kind);
    }

    get hasSound() {
      return ['video', 'audio'].includes(this.layer?.kind);
    }

    get hasBox() {
      return this.layer && this.layer.kind !== 'audio';
    }

    get isMarkup() {
      return ['svg', 'html'].includes(this.layer?.kind);
    }

    get parentChoices() {
      return this.args.editor.parentChoices;
    }
  }
</script>

<script>
  let args = $props();
  const self = new InspectorPanel(args);
  onDestroy(() => destroy(self));
</script>

<div class="fr-panel-body">
  <div class="fr-head"
    ><Icon name="sliders-horizontal" size={11} />
    LAYER</div
  >
  {#if truthy(self.layer)}
    <div class="fr-scroll fr-insp">
      <div class="fr-section"
        ><Icon name={self.kindIcon} size={10} />
        Layer</div
      >
      <div class="fr-row"
        ><span class="fr-label">Name</span>
        <input
          type="text"
          class="fr-field"
          {@attach prop('value', () => self.layer?.name)}
          aria-label="Layer name"
          onchange={args.editor?.renameLayer}
        /></div
      >
      <div class="fr-row"
        ><span class="fr-label">Type</span>
        <span class="fr-faint">{self.kindLabel}</span></div
      >

      {#if truthy(self.isText)}
        <div class="fr-section"
          ><Icon name="type" size={10} />
          Content</div
        >
        <div class="fr-row-wide"
          ><textarea
            class="fr-field"
            rows="3"
            aria-label="Text content"
            onchange={(..._r) => args.editor?.setString('content', ..._r)}
            {@attach prop('value', () => self.layer?.content)}></textarea></div
        >
      {/if}

      {#if truthy(self.isMedia)}
        <div class="fr-section"
          ><Icon name={self.kindIcon} size={10} />
          Source</div
        >
        <div class="fr-row"
          ><span class="fr-label">File</span>
          <label class="fr-btn fr-file"
            >Browse
            <input
              type="file"
              class="sr-only"
              accept="image/*,video/*,audio/*"
              onchange={args.editor?.replaceSource}
            /></label
          ></div
        >
        <div class="fr-row"
          ><span class="fr-label">Name</span>
          <span class="fr-faint fr-ellipsis">{self.layer?.src}</span></div
        >
        {#if truthy(self.hasSound)}
          <div class="fr-row"
            ><span class="fr-label">Loop</span>
            <button
              type="button"
              class="fr-icon-btn {truthy(self.layer?.loop) ? 'is-on' : ''}"
              aria-label="Loop the file until the layer's out point"
              onclick={(..._r) => args.editor?.toggleFlag('loop', ..._r)}
              ><Icon name="repeat" size={12} /></button
            ></div
          >
        {/if}
      {/if}

      {#if truthy(self.isMarkup)}
        <div class="fr-section"
          ><Icon name="code" size={10} />
          Markup</div
        >
        <div class="fr-row-wide"
          ><textarea
            class="fr-field fr-mono"
            rows="4"
            aria-label="Markup"
            onchange={(..._r) => args.editor?.setString('markup', ..._r)}
            {@attach prop('value', () => self.layer?.markup)}></textarea></div
        >
      {/if}

      {#if truthy(self.hasBox)}
        <div class="fr-section"
          ><Icon name="move" size={10} />
          Transform</div
        >
        {#each args.editor?.transformRows ?? [] as row}
          <div class="fr-row">
            <button
              type="button"
              class="fr-watch {truthy(row?.keyed) ? 'is-on' : ''}"
              title="Animate {row?.label}"
              aria-label="Animate {row?.label}"
              onclick={(..._r) => args.editor?.stopwatch(row?.prop, ..._r)}
              ><Icon name="clock" size={10} /></button
            >
            <span class="fr-label">{row?.label}</span>
            <ScrubNumber
              value={row?.value}
              step={row?.step}
              min={row?.min}
              max={row?.max}
              unit={row?.unit}
              label={row?.label}
              onChange={(..._r) =>
                args.editor?.setSelectedProp(row?.prop, ..._r)}
            />
            {#if truthy(row?.pair)}
              <ScrubNumber
                value={row?.pairValue}
                step={row?.step}
                min={row?.min}
                max={row?.max}
                unit={row?.pairUnit}
                label="{row?.label} (second)"
                onChange={(..._r) => args.editor?.setPairValue(row, ..._r)}
              />
            {/if}
          </div>
        {/each}
        <div class="fr-row-wide fr-actions">
          <button
            type="button"
            class="fr-btn"
            onclick={args.editor?.alignHorizontal}>Centre H</button
          >
          <button
            type="button"
            class="fr-btn"
            onclick={args.editor?.alignVertical}>Centre V</button
          >
          <button
            type="button"
            class="fr-btn"
            onclick={args.editor?.centreAnchor}>Reset anchor</button
          >
          <button type="button" class="fr-btn" onclick={args.editor?.fitToScene}
            >Fit to scene</button
          >
        </div>

        <div class="fr-section"
          ><Icon name="droplet" size={10} />
          Appearance</div
        >
        {#each args.editor?.appearanceRows ?? [] as row}
          <div class="fr-row">
            <button
              type="button"
              class="fr-watch {truthy(row?.keyed) ? 'is-on' : ''}"
              title="Animate {row?.label}"
              aria-label="Animate {row?.label}"
              onclick={(..._r) => args.editor?.stopwatch(row?.prop, ..._r)}
              ><Icon name="clock" size={10} /></button
            >
            <span class="fr-label">{row?.label}</span>
            <ScrubNumber
              value={row?.value}
              step={row?.step}
              min={row?.min}
              max={row?.max}
              unit={row?.unit}
              label={row?.label}
              onChange={(..._r) =>
                args.editor?.setSelectedProp(row?.prop, ..._r)}
            />
            {#if truthy(row?.pair)}
              <ScrubNumber
                value={row?.pairValue}
                step={row?.step}
                min={row?.min}
                max={row?.max}
                unit={row?.pairUnit}
                label="{row?.label} (second)"
                onChange={(..._r) => args.editor?.setPairValue(row, ..._r)}
              />
            {/if}
          </div>
        {/each}
        <div class="fr-row"
          ><span class="fr-label">Fill</span>
          <ColourField
            label="Fill"
            value={args.editor?.fillColour}
            onChange={(..._r) => args.editor?.setColour('background', ..._r)}
          /></div
        >
        <div class="fr-row"
          ><span class="fr-label">Border colour</span>
          <ColourField
            label="Border colour"
            value={self.layer?.style?.borderColor}
            onChange={(..._r) => args.editor?.setColour('borderColor', ..._r)}
          /></div
        >
        <div class="fr-row"
          ><span class="fr-label">Shadow</span>
          <input
            type="text"
            class="fr-field fr-mono"
            placeholder="0 10px 30px rgba(0,0,0,.5)"
            {@attach prop('value', () => self.layer?.style?.shadow)}
            aria-label="Shadow"
            onchange={(..._r) => args.editor?.setStyleString('shadow', ..._r)}
          /></div
        >
        <div class="fr-row"
          ><span class="fr-label">Blend</span>
          <select
            class="fr-field"
            aria-label="Blend mode"
            onchange={(..._r) =>
              args.editor?.setStyleString('mixBlendMode', ..._r)}
          >
            {#each self.blendModes ?? [] as m}
              <option
                value={m}
                {@attach prop('selected', () =>
                  eq(self.layer?.style?.mixBlendMode, m),
                )}>{m}</option
              >
            {/each}
          </select></div
        >
        <div class="fr-row"
          ><span class="fr-label">Clip</span>
          <button
            type="button"
            class="fr-icon-btn {truthy(self.layer?.style?.clip) ? 'is-on' : ''}"
            aria-label="Clip to the layer's box"
            onclick={(..._r) => args.editor?.toggleStyleFlag('clip', ..._r)}
            ><Icon name="scissors" size={12} /></button
          ></div
        >
        {#if truthy(self.isMedia)}
          <div class="fr-row"
            ><span class="fr-label">Fit</span>
            <div class="fr-tabs">
              {#each self.fits ?? [] as f}
                <button
                  type="button"
                  class="fr-chip
                        {truthy(eq(self.layer?.style?.objectFit, f))
                    ? 'is-on'
                    : ''}"
                  onclick={(..._r) =>
                    args.editor?.setStyle({ objectFit: f }, ..._r)}>{f}</button
                >
              {/each}
            </div></div
          >
        {/if}
      {/if}

      {#if truthy(self.isText)}
        <div class="fr-section"
          ><Icon name="type" size={10} />
          Type</div
        >
        <div class="fr-row"
          ><span class="fr-label">Font</span>
          <select
            class="fr-field"
            aria-label="Font"
            onchange={(..._r) =>
              args.editor?.setStyleString('fontFamily', ..._r)}
          >
            {#each self.fonts ?? [] as f}
              <option
                value={f}
                {@attach prop('selected', () =>
                  eq(self.layer?.style?.fontFamily, f),
                )}>{f}</option
              >
            {/each}
          </select></div
        >
        {#each args.editor?.typeRows ?? [] as row}
          <div class="fr-row">
            <button
              type="button"
              class="fr-watch {truthy(row?.keyed) ? 'is-on' : ''}"
              title="Animate {row?.label}"
              aria-label="Animate {row?.label}"
              onclick={(..._r) => args.editor?.stopwatch(row?.prop, ..._r)}
              ><Icon name="clock" size={10} /></button
            >
            <span class="fr-label">{row?.label}</span>
            <ScrubNumber
              value={row?.value}
              step={row?.step}
              min={row?.min}
              max={row?.max}
              unit={row?.unit}
              label={row?.label}
              onChange={(..._r) =>
                args.editor?.setSelectedProp(row?.prop, ..._r)}
            />
            {#if truthy(row?.pair)}
              <ScrubNumber
                value={row?.pairValue}
                step={row?.step}
                min={row?.min}
                max={row?.max}
                unit={row?.pairUnit}
                label="{row?.label} (second)"
                onChange={(..._r) => args.editor?.setPairValue(row, ..._r)}
              />
            {/if}
          </div>
        {/each}
        <div class="fr-row"
          ><span class="fr-label">Colour</span>
          <ColourField
            label="Text colour"
            value={self.layer?.style?.color}
            onChange={(..._r) => args.editor?.setColour('color', ..._r)}
          /></div
        >
        <div class="fr-row"
          ><span class="fr-label">Align</span>
          <div class="fr-tabs">
            {#each self.aligns ?? [] as a}
              <button
                type="button"
                class="fr-chip
                      {truthy(eq(self.layer?.style?.textAlign, a))
                  ? 'is-on'
                  : ''}"
                aria-label="Align {a}"
                onclick={(..._r) =>
                  args.editor?.setStyle({ textAlign: a }, ..._r)}
                ><Icon name="align-{a}" size={11} /></button
              >
            {/each}
          </div></div
        >
        <div class="fr-row"
          ><span class="fr-label">Case</span>
          <select
            class="fr-field"
            aria-label="Text case"
            onchange={(..._r) =>
              args.editor?.setStyleString('textTransform', ..._r)}
          >
            {#each self.cases ?? [] as t}
              <option
                value={t}
                {@attach prop('selected', () =>
                  eq(self.layer?.style?.textTransform, t),
                )}>{t}</option
              >
            {/each}
          </select></div
        >
      {/if}

      {#if truthy(self.hasSound)}
        <div class="fr-section"
          ><Icon name="volume-2" size={10} />
          Audio</div
        >
        {#each args.editor?.audioRows ?? [] as row}
          <div class="fr-row">
            <button
              type="button"
              class="fr-watch {truthy(row?.keyed) ? 'is-on' : ''}"
              title="Animate {row?.label}"
              aria-label="Animate {row?.label}"
              onclick={(..._r) => args.editor?.stopwatch(row?.prop, ..._r)}
              ><Icon name="clock" size={10} /></button
            >
            <span class="fr-label">{row?.label}</span>
            <ScrubNumber
              value={row?.value}
              step={row?.step}
              min={row?.min}
              max={row?.max}
              unit={row?.unit}
              label={row?.label}
              onChange={(..._r) =>
                args.editor?.setSelectedProp(row?.prop, ..._r)}
            />
            {#if truthy(row?.pair)}
              <ScrubNumber
                value={row?.pairValue}
                step={row?.step}
                min={row?.min}
                max={row?.max}
                unit={row?.pairUnit}
                label="{row?.label} (second)"
                onChange={(..._r) => args.editor?.setPairValue(row, ..._r)}
              />
            {/if}
          </div>
        {/each}
        <p class="fr-hint"
          >Trim it on the timeline. An audio layer draws nothing, so it has no
          box to place.</p
        >
      {/if}

      <div class="fr-section"
        ><Icon name="link-2" size={10} />
        Links</div
      >
      <div class="fr-row"
        ><span class="fr-label">Follows</span>
        <select
          class="fr-field"
          aria-label="Parent layer"
          onchange={args.editor?.setParent}
        >
          <option
            value=""
            {@attach prop('selected', () => eq(self.layer?.parent, null))}
            >Nothing</option
          >
          {#each self.parentChoices ?? [] as l (l?.id)}
            <option
              value={l?.id}
              {@attach prop('selected', () => eq(self.layer?.parent, l?.id))}
              >{l?.name}</option
            >
          {/each}
        </select></div
      >
      <div class="fr-row"
        ><span class="fr-label">Track matte</span>
        <select
          class="fr-field"
          aria-label="Track matte"
          onchange={args.editor?.setMatte}
        >
          {#each self.mattes ?? [] as m (m?.id)}
            <option
              value={m?.id}
              {@attach prop('selected', () => eq(self.layer?.matte, m?.id))}
              >{m?.label}</option
            >
          {/each}
        </select></div
      >
      <p class="fr-hint"
        >A matte is cut out of the layer directly above this one, which then
        draws nothing of its own.</p
      >

      <div class="fr-section"
        ><Icon name="sparkles" size={10} />
        Effects</div
      >
      {#each args.editor?.effectRows ?? [] as fx (fx?.id)}
        <div class="fr-fx {truthy(fx?.selected) ? 'is-selected' : ''}">
          <div class="fr-fx-head">
            <button
              type="button"
              class="fr-icon-btn {truthy(fx?.enabled) ? 'is-on' : ''}"
              aria-label="Enable {fx?.name}"
              onclick={(..._r) => args.editor?.toggleEffect(fx?.id, ..._r)}
              ><Icon
                name={truthy(fx?.enabled) ? 'eye' : 'eye-off'}
                size={11}
              /></button
            >
            <strong>{fx?.name}</strong>
            <span class="fr-spacer"></span>
            <button
              type="button"
              class="fr-icon-btn"
              aria-label="Move up"
              onclick={(..._r) => args.editor?.moveEffect(fx?.id, -1, ..._r)}
              ><Icon name="arrow-up" size={11} /></button
            >
            <button
              type="button"
              class="fr-icon-btn"
              aria-label="Move down"
              onclick={(..._r) => args.editor?.moveEffect(fx?.id, 1, ..._r)}
              ><Icon name="arrow-down" size={11} /></button
            >
            <button
              type="button"
              class="fr-icon-btn"
              aria-label="Remove effect"
              onclick={(..._r) => args.editor?.removeEffect(fx?.id, ..._r)}
              ><Icon name="trash-2" size={11} /></button
            >
          </div>
          {#each fx?.params ?? [] as param}
            <div class="fr-row">
              <button
                type="button"
                class="fr-watch {truthy(param?.keyed) ? 'is-on' : ''}"
                title="Animate {param?.label}"
                aria-label="Animate {param?.label}"
                onclick={(..._r) =>
                  args.editor?.paramStopwatch(fx?.id, param?.index, ..._r)}
                ><Icon name="clock" size={10} /></button
              >
              <span class="fr-label">{param?.label}</span>
              {#if truthy(param?.choices?.length)}
                <select
                  class="fr-field"
                  aria-label={param?.label}
                  onchange={(..._r) =>
                    args.editor?.setParamChoice(fx?.id, param?.index, ..._r)}
                >
                  {#each param?.choices ?? [] as name, i}
                    <option
                      value={i}
                      {@attach prop('selected', () => eq(param?.index0, i))}
                      >{name}</option
                    >
                  {/each}
                </select>
              {:else}
                <ScrubNumber
                  value={param?.value}
                  step={param?.step}
                  min={param?.min}
                  max={param?.max}
                  unit={param?.suffix}
                  label={param?.label}
                  onChange={(..._r) =>
                    args.editor?.setParam(fx?.id, param?.index, ..._r)}
                />
              {/if}
            </div>
          {/each}
          {#each fx?.colors ?? [] as colour}
            <div class="fr-row"
              ><span class="fr-label">{colour?.label}</span>
              <ColourField
                label={colour?.label}
                value={colour?.hex}
                onChange={(..._r) =>
                  args.editor?.setEffectColour(fx?.id, colour?.index, ..._r)}
              /></div
            >
          {/each}
        </div>
      {:else}
        <p class="fr-hint"
          >Nothing applied. Pick one from the Effects browser; they are applied
          in the order they are listed, and any one can be switched off without
          losing its settings.</p
        >
      {/each}

      <div class="fr-row-wide fr-actions">
        <button
          type="button"
          class="fr-btn"
          onclick={args.editor?.duplicateSelected}>Duplicate</button
        >
        <button
          type="button"
          class="fr-btn is-danger"
          onclick={args.editor?.deleteSelected}>Delete</button
        >
        <button
          type="button"
          class="fr-btn"
          onclick={(..._r) => args.editor?.selectLayer(null, ..._r)}
          >Deselect</button
        >
      </div>
    </div>
  {:else}
    <p class="fr-faint fr-pad">Select a layer to see its properties.</p>
  {/if}
</div>
