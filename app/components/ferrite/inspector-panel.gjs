import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn, hash } from '@ember/helper';
import Icon from '../icon';
import ColourField from '../colour-field';
import ScrubNumber from './scrub-number';
import {
  BLEND_MODES,
  FITS,
  ALIGNS,
  CASES,
  MATTES,
  KINDS,
} from '../../utils/ferrite/model';

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

export default class InspectorPanel extends Component {
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

  <template>
    <div class="fr-panel-body">
      <div class="fr-head"><Icon @name="sliders-horizontal" @size={{11}} />
        LAYER</div>
      {{#if this.layer}}
        <div class="fr-scroll fr-insp">

          <div class="fr-section"><Icon @name={{this.kindIcon}} @size={{10}} />
            Layer</div>
          <div class="fr-row"><span class="fr-label">Name</span>
            <input
              type="text"
              class="fr-field"
              value={{this.layer.name}}
              aria-label="Layer name"
              {{on "change" @editor.renameLayer}}
            /></div>
          <div class="fr-row"><span class="fr-label">Type</span>
            <span class="fr-faint">{{this.kindLabel}}</span></div>

          {{#if this.isText}}
            <div class="fr-section"><Icon @name="type" @size={{10}} />
              Content</div>
            <div class="fr-row-wide"><textarea
                class="fr-field"
                rows="3"
                aria-label="Text content"
                {{on "change" (fn @editor.setString "content")}}
              >{{this.layer.content}}</textarea></div>
          {{/if}}

          {{#if this.isMedia}}
            <div class="fr-section"><Icon
                @name={{this.kindIcon}}
                @size={{10}}
              />
              Source</div>
            <div class="fr-row"><span class="fr-label">File</span>
              <label class="fr-btn fr-file">Browse
                <input
                  type="file"
                  class="sr-only"
                  accept="image/*,video/*,audio/*"
                  {{on "change" @editor.replaceSource}}
                /></label></div>
            <div class="fr-row"><span class="fr-label">Name</span>
              <span class="fr-faint fr-ellipsis">{{this.layer.src}}</span></div>
            {{#if this.hasSound}}
              <div class="fr-row"><span class="fr-label">Loop</span>
                <button
                  type="button"
                  class="fr-icon-btn {{if this.layer.loop 'is-on'}}"
                  aria-label="Loop the file until the layer's out point"
                  {{on "click" (fn @editor.toggleFlag "loop")}}
                ><Icon @name="repeat" @size={{12}} /></button></div>
            {{/if}}
          {{/if}}

          {{#if this.isMarkup}}
            <div class="fr-section"><Icon @name="code" @size={{10}} />
              Markup</div>
            <div class="fr-row-wide"><textarea
                class="fr-field fr-mono"
                rows="4"
                aria-label="Markup"
                {{on "change" (fn @editor.setString "markup")}}
              >{{this.layer.markup}}</textarea></div>
          {{/if}}

          {{#if this.hasBox}}
            <div class="fr-section"><Icon @name="move" @size={{10}} />
              Transform</div>
            {{#each @editor.transformRows key="prop" as |row|}}
              <div class="fr-row">
                <button
                  type="button"
                  class="fr-watch {{if row.keyed 'is-on'}}"
                  title="Animate {{row.label}}"
                  aria-label="Animate {{row.label}}"
                  {{on "click" (fn @editor.stopwatch row.prop)}}
                ><Icon @name="clock" @size={{10}} /></button>
                <span class="fr-label">{{row.label}}</span>
                <ScrubNumber
                  @value={{row.value}}
                  @step={{row.step}}
                  @min={{row.min}}
                  @max={{row.max}}
                  @unit={{row.unit}}
                  @label={{row.label}}
                  @onChange={{fn @editor.setSelectedProp row.prop}}
                />
                {{#if row.pair}}
                  <ScrubNumber
                    @value={{row.pairValue}}
                    @step={{row.step}}
                    @min={{row.min}}
                    @max={{row.max}}
                    @unit={{row.pairUnit}}
                    @label="{{row.label}} (second)"
                    @onChange={{fn @editor.setPairValue row}}
                  />
                {{/if}}
              </div>
            {{/each}}
            <div class="fr-row-wide fr-actions">
              <button
                type="button"
                class="fr-btn"
                {{on "click" @editor.alignHorizontal}}
              >Centre H</button>
              <button
                type="button"
                class="fr-btn"
                {{on "click" @editor.alignVertical}}
              >Centre V</button>
              <button
                type="button"
                class="fr-btn"
                {{on "click" @editor.centreAnchor}}
              >Reset anchor</button>
              <button
                type="button"
                class="fr-btn"
                {{on "click" @editor.fitToScene}}
              >Fit to scene</button>
            </div>

            <div class="fr-section"><Icon @name="droplet" @size={{10}} />
              Appearance</div>
            {{#each @editor.appearanceRows key="prop" as |row|}}
              <div class="fr-row">
                <button
                  type="button"
                  class="fr-watch {{if row.keyed 'is-on'}}"
                  title="Animate {{row.label}}"
                  aria-label="Animate {{row.label}}"
                  {{on "click" (fn @editor.stopwatch row.prop)}}
                ><Icon @name="clock" @size={{10}} /></button>
                <span class="fr-label">{{row.label}}</span>
                <ScrubNumber
                  @value={{row.value}}
                  @step={{row.step}}
                  @min={{row.min}}
                  @max={{row.max}}
                  @unit={{row.unit}}
                  @label={{row.label}}
                  @onChange={{fn @editor.setSelectedProp row.prop}}
                />
                {{#if row.pair}}
                  <ScrubNumber
                    @value={{row.pairValue}}
                    @step={{row.step}}
                    @min={{row.min}}
                    @max={{row.max}}
                    @unit={{row.pairUnit}}
                    @label="{{row.label}} (second)"
                    @onChange={{fn @editor.setPairValue row}}
                  />
                {{/if}}
              </div>
            {{/each}}
            <div class="fr-row"><span class="fr-label">Fill</span>
              <ColourField
                @label="Fill"
                @value={{@editor.fillColour}}
                @onChange={{fn @editor.setColour "background"}}
              /></div>
            <div class="fr-row"><span class="fr-label">Border colour</span>
              <ColourField
                @label="Border colour"
                @value={{this.layer.style.borderColor}}
                @onChange={{fn @editor.setColour "borderColor"}}
              /></div>
            <div class="fr-row"><span class="fr-label">Shadow</span>
              <input
                type="text"
                class="fr-field fr-mono"
                placeholder="0 10px 30px rgba(0,0,0,.5)"
                value={{this.layer.style.shadow}}
                aria-label="Shadow"
                {{on "change" (fn @editor.setStyleString "shadow")}}
              /></div>
            <div class="fr-row"><span class="fr-label">Blend</span>
              <select
                class="fr-field"
                aria-label="Blend mode"
                {{on "change" (fn @editor.setStyleString "mixBlendMode")}}
              >
                {{#each this.blendModes as |m|}}
                  <option
                    value={{m}}
                    selected={{eq this.layer.style.mixBlendMode m}}
                  >{{m}}</option>
                {{/each}}
              </select></div>
            <div class="fr-row"><span class="fr-label">Clip</span>
              <button
                type="button"
                class="fr-icon-btn {{if this.layer.style.clip 'is-on'}}"
                aria-label="Clip to the layer's box"
                {{on "click" (fn @editor.toggleStyleFlag "clip")}}
              ><Icon @name="scissors" @size={{12}} /></button></div>
            {{#if this.isMedia}}
              <div class="fr-row"><span class="fr-label">Fit</span>
                <div class="fr-tabs">
                  {{#each this.fits as |f|}}
                    <button
                      type="button"
                      class="fr-chip
                        {{if (eq this.layer.style.objectFit f) 'is-on'}}"
                      {{on "click" (fn @editor.setStyle (hash objectFit=f))}}
                    >{{f}}</button>
                  {{/each}}
                </div></div>
            {{/if}}
          {{/if}}

          {{#if this.isText}}
            <div class="fr-section"><Icon @name="type" @size={{10}} />
              Type</div>
            <div class="fr-row"><span class="fr-label">Font</span>
              <select
                class="fr-field"
                aria-label="Font"
                {{on "change" (fn @editor.setStyleString "fontFamily")}}
              >
                {{#each this.fonts as |f|}}
                  <option
                    value={{f}}
                    selected={{eq this.layer.style.fontFamily f}}
                  >{{f}}</option>
                {{/each}}
              </select></div>
            {{#each @editor.typeRows key="prop" as |row|}}
              <div class="fr-row">
                <button
                  type="button"
                  class="fr-watch {{if row.keyed 'is-on'}}"
                  title="Animate {{row.label}}"
                  aria-label="Animate {{row.label}}"
                  {{on "click" (fn @editor.stopwatch row.prop)}}
                ><Icon @name="clock" @size={{10}} /></button>
                <span class="fr-label">{{row.label}}</span>
                <ScrubNumber
                  @value={{row.value}}
                  @step={{row.step}}
                  @min={{row.min}}
                  @max={{row.max}}
                  @unit={{row.unit}}
                  @label={{row.label}}
                  @onChange={{fn @editor.setSelectedProp row.prop}}
                />
                {{#if row.pair}}
                  <ScrubNumber
                    @value={{row.pairValue}}
                    @step={{row.step}}
                    @min={{row.min}}
                    @max={{row.max}}
                    @unit={{row.pairUnit}}
                    @label="{{row.label}} (second)"
                    @onChange={{fn @editor.setPairValue row}}
                  />
                {{/if}}
              </div>
            {{/each}}
            <div class="fr-row"><span class="fr-label">Colour</span>
              <ColourField
                @label="Text colour"
                @value={{this.layer.style.color}}
                @onChange={{fn @editor.setColour "color"}}
              /></div>
            <div class="fr-row"><span class="fr-label">Align</span>
              <div class="fr-tabs">
                {{#each this.aligns as |a|}}
                  <button
                    type="button"
                    class="fr-chip
                      {{if (eq this.layer.style.textAlign a) 'is-on'}}"
                    aria-label="Align {{a}}"
                    {{on "click" (fn @editor.setStyle (hash textAlign=a))}}
                  ><Icon @name="align-{{a}}" @size={{11}} /></button>
                {{/each}}
              </div></div>
            <div class="fr-row"><span class="fr-label">Case</span>
              <select
                class="fr-field"
                aria-label="Text case"
                {{on "change" (fn @editor.setStyleString "textTransform")}}
              >
                {{#each this.cases as |t|}}
                  <option
                    value={{t}}
                    selected={{eq this.layer.style.textTransform t}}
                  >{{t}}</option>
                {{/each}}
              </select></div>
          {{/if}}

          {{#if this.hasSound}}
            <div class="fr-section"><Icon @name="volume-2" @size={{10}} />
              Audio</div>
            {{#each @editor.audioRows key="prop" as |row|}}
              <div class="fr-row">
                <button
                  type="button"
                  class="fr-watch {{if row.keyed 'is-on'}}"
                  title="Animate {{row.label}}"
                  aria-label="Animate {{row.label}}"
                  {{on "click" (fn @editor.stopwatch row.prop)}}
                ><Icon @name="clock" @size={{10}} /></button>
                <span class="fr-label">{{row.label}}</span>
                <ScrubNumber
                  @value={{row.value}}
                  @step={{row.step}}
                  @min={{row.min}}
                  @max={{row.max}}
                  @unit={{row.unit}}
                  @label={{row.label}}
                  @onChange={{fn @editor.setSelectedProp row.prop}}
                />
                {{#if row.pair}}
                  <ScrubNumber
                    @value={{row.pairValue}}
                    @step={{row.step}}
                    @min={{row.min}}
                    @max={{row.max}}
                    @unit={{row.pairUnit}}
                    @label="{{row.label}} (second)"
                    @onChange={{fn @editor.setPairValue row}}
                  />
                {{/if}}
              </div>
            {{/each}}
            <p class="fr-hint">Trim it on the timeline. An audio layer draws
              nothing, so it has no box to place.</p>
          {{/if}}

          <div class="fr-section"><Icon @name="link-2" @size={{10}} />
            Links</div>
          <div class="fr-row"><span class="fr-label">Follows</span>
            <select
              class="fr-field"
              aria-label="Parent layer"
              {{on "change" @editor.setParent}}
            >
              <option
                value=""
                selected={{eq this.layer.parent null}}
              >Nothing</option>
              {{#each this.parentChoices key="id" as |l|}}
                <option
                  value={{l.id}}
                  selected={{eq this.layer.parent l.id}}
                >{{l.name}}</option>
              {{/each}}
            </select></div>
          <div class="fr-row"><span class="fr-label">Track matte</span>
            <select
              class="fr-field"
              aria-label="Track matte"
              {{on "change" @editor.setMatte}}
            >
              {{#each this.mattes key="id" as |m|}}
                <option
                  value={{m.id}}
                  selected={{eq this.layer.matte m.id}}
                >{{m.label}}</option>
              {{/each}}
            </select></div>
          <p class="fr-hint">A matte is cut out of the layer directly above this
            one, which then draws nothing of its own.</p>

          <div class="fr-section"><Icon @name="sparkles" @size={{10}} />
            Effects</div>
          {{#each @editor.effectRows key="id" as |fx|}}
            <div class="fr-fx {{if fx.selected 'is-selected'}}">
              <div class="fr-fx-head">
                <button
                  type="button"
                  class="fr-icon-btn {{if fx.enabled 'is-on'}}"
                  aria-label="Enable {{fx.name}}"
                  {{on "click" (fn @editor.toggleEffect fx.id)}}
                ><Icon
                    @name={{if fx.enabled "eye" "eye-off"}}
                    @size={{11}}
                  /></button>
                <strong>{{fx.name}}</strong>
                <span class="fr-spacer"></span>
                <button
                  type="button"
                  class="fr-icon-btn"
                  aria-label="Move up"
                  {{on "click" (fn @editor.moveEffect fx.id -1)}}
                ><Icon @name="arrow-up" @size={{11}} /></button>
                <button
                  type="button"
                  class="fr-icon-btn"
                  aria-label="Move down"
                  {{on "click" (fn @editor.moveEffect fx.id 1)}}
                ><Icon @name="arrow-down" @size={{11}} /></button>
                <button
                  type="button"
                  class="fr-icon-btn"
                  aria-label="Remove effect"
                  {{on "click" (fn @editor.removeEffect fx.id)}}
                ><Icon @name="trash-2" @size={{11}} /></button>
              </div>
              {{#each fx.params key="index" as |param|}}
                <div class="fr-row">
                  <button
                    type="button"
                    class="fr-watch {{if param.keyed 'is-on'}}"
                    title="Animate {{param.label}}"
                    aria-label="Animate {{param.label}}"
                    {{on "click" (fn @editor.paramStopwatch fx.id param.index)}}
                  ><Icon @name="clock" @size={{10}} /></button>
                  <span class="fr-label">{{param.label}}</span>
                  {{#if param.choices.length}}
                    <select
                      class="fr-field"
                      aria-label={{param.label}}
                      {{on
                        "change"
                        (fn @editor.setParamChoice fx.id param.index)
                      }}
                    >
                      {{#each param.choices as |name i|}}
                        <option
                          value={{i}}
                          selected={{eq param.index0 i}}
                        >{{name}}</option>
                      {{/each}}
                    </select>
                  {{else}}
                    <ScrubNumber
                      @value={{param.value}}
                      @step={{param.step}}
                      @min={{param.min}}
                      @max={{param.max}}
                      @unit={{param.suffix}}
                      @label={{param.label}}
                      @onChange={{fn @editor.setParam fx.id param.index}}
                    />
                  {{/if}}
                </div>
              {{/each}}
              {{#each fx.colors key="index" as |colour|}}
                <div class="fr-row"><span
                    class="fr-label"
                  >{{colour.label}}</span>
                  <ColourField
                    @label={{colour.label}}
                    @value={{colour.hex}}
                    @onChange={{fn @editor.setEffectColour fx.id colour.index}}
                  /></div>
              {{/each}}
            </div>
          {{else}}
            <p class="fr-hint">Nothing applied. Pick one from the Effects
              browser; they are applied in the order they are listed, and any
              one can be switched off without losing its settings.</p>
          {{/each}}

          <div class="fr-row-wide fr-actions">
            <button
              type="button"
              class="fr-btn"
              {{on "click" @editor.duplicateSelected}}
            >Duplicate</button>
            <button
              type="button"
              class="fr-btn is-danger"
              {{on "click" @editor.deleteSelected}}
            >Delete</button>
            <button
              type="button"
              class="fr-btn"
              {{on "click" (fn @editor.selectLayer null)}}
            >Deselect</button>
          </div>
        </div>
      {{else}}
        <p class="fr-faint fr-pad">Select a layer to see its properties.</p>
      {{/if}}
    </div>
  </template>
}
