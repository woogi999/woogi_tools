import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import Icon from '../icon';
import {
  FORMATS,
  RESOLUTIONS,
  QUALITIES,
  formatById,
  sizeFor,
  estimate,
} from '../../utils/ferrite/export';
import { formatBytes } from '../../utils/file-share';
import { timecode } from '../../utils/ferrite/model';

// The render queue, in the shape After Effects gives it: what to render
// (Render Settings) above how to write it (Output Module), with the numbers
// that follow from both shown at the bottom before anything starts.
//
// The one place it departs is the engine switch, which After Effects has no
// use for. A browser can either record the canvas as it plays — fast, carries
// the sound, drops frames when the comp is heavy — or draw every frame in
// order and encode them, which is exact and silent. Neither is the right
// default for everyone, so the choice is on the panel with the consequence
// spelled out next to it rather than buried.
const eq = (a, b) => a === b;
const not = (v) => !v;

const pct = (v) => `width:${Math.round(v * 100)}%`;

export default class ExportModal extends Component {
  formats = FORMATS;
  resolutions = RESOLUTIONS;
  qualities = QUALITIES;

  get o() {
    return this.args.editor.exportOptions;
  }

  get format() {
    return formatById(this.o.format);
  }

  get size() {
    return sizeFor(this.o);
  }

  get numbers() {
    const e = estimate(this.o);
    return {
      ...e,
      weight: formatBytes(e.bytes),
      length: `${e.seconds.toFixed(2)}s`,
    };
  }

  // A frame-by-frame render holds every PNG until the encoder has them all, so
  // a long comp at full size is a memory problem rather than a slow one. Worth
  // saying before, not after.
  get heavy() {
    return this.o.engine === 'exact' && this.numbers.bytes > 700e6;
  }

  get engines() {
    return [
      {
        id: 'live',
        label: 'Real time',
        note: 'Records as it plays. Carries the sound. Drops frames if the comp is heavy.',
      },
      {
        id: 'exact',
        label: 'Frame by frame',
        note: 'Every frame drawn and encoded in order. Exact, slower, silent.',
      },
    ].map((e) => ({ ...e, can: this.format.engines.includes(e.id) }));
  }

  get spanLabel() {
    return `${timecode(this.o.fromMs, this.o.fps)} → ${timecode(this.o.toMs, this.o.fps)}`;
  }

  // Escape closes it, as every other dialog on the site does — but not while
  // a render is running, because there would be nothing to go back to.
  trap = modifier((element) => {
    element.querySelector('select, button')?.focus();
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (!this.args.editor.busy) this.args.editor.closeExport();
    };
    element.addEventListener('keydown', onKey);
    return () => element.removeEventListener('keydown', onKey);
  });

  <template>
    <div class="fr-modal-wrap" role="presentation">
      <button
        type="button"
        class="fr-backdrop"
        aria-label="Close"
        disabled={{@editor.busy}}
        {{on "click" @editor.closeExport}}
      ></button>
      <div
        class="fr-modal is-render"
        role="dialog"
        aria-modal="true"
        aria-label="Render queue"
        {{this.trap}}
      >
        <header class="fr-modal-head">
          <h2><Icon @name="download" @size={{14}} /> Render</h2>
          <span class="fr-spacer"></span>
          <button
            type="button"
            class="fr-icon-btn"
            aria-label="Close"
            disabled={{@editor.busy}}
            {{on "click" @editor.closeExport}}
          ><Icon @name="x" @size={{14}} /></button>
        </header>

        <div class="fr-modal-body">
          <section class="fr-modal-col">
            <h3>Render settings</h3>

            <label class="fr-field">
              <span>Time span</span>
              <select
                class="fr-input"
                data-field="span"
                {{on "change" (fn @editor.setExport "span")}}
              >
                <option value="comp" selected={{eq this.o.span "comp"}}>Whole
                  composition</option>
                <option value="work" selected={{eq this.o.span "work"}}>Work
                  area</option>
                <option
                  value="custom"
                  selected={{eq this.o.span "custom"}}
                >Custom</option>
              </select>
            </label>
            {{#if (eq this.o.span "custom")}}
              <div class="fr-field-row">
                <label class="fr-field"><span>From (s)</span><input
                    type="number"
                    class="fr-input is-short"
                    step="0.1"
                    min="0"
                    value={{@editor.exportFromSec}}
                    {{on "input" (fn @editor.setExport "fromSec")}}
                  /></label>
                <label class="fr-field"><span>To (s)</span><input
                    type="number"
                    class="fr-input is-short"
                    step="0.1"
                    min="0"
                    value={{@editor.exportToSec}}
                    {{on "input" (fn @editor.setExport "toSec")}}
                  /></label>
              </div>
            {{/if}}
            <p class="fr-hint">{{this.spanLabel}}</p>

            <label class="fr-field">
              <span>Resolution</span>
              <select
                class="fr-input"
                data-field="resolution"
                {{on "change" (fn @editor.setExport "resolution")}}
              >
                {{#each this.resolutions key="id" as |r|}}
                  <option
                    value={{r.id}}
                    selected={{eq this.o.resolution r.id}}
                  >{{r.label}}</option>
                {{/each}}
              </select>
            </label>
            {{#if (eq this.o.resolution "custom")}}
              <div class="fr-field-row">
                <label class="fr-field"><span>Width</span><input
                    type="number"
                    class="fr-input is-short"
                    min="2"
                    value={{this.o.customW}}
                    {{on "input" (fn @editor.setExport "customW")}}
                  /></label>
                <label class="fr-field"><span>Height</span><input
                    type="number"
                    class="fr-input is-short"
                    min="2"
                    value={{this.o.customH}}
                    {{on "input" (fn @editor.setExport "customH")}}
                  /></label>
              </div>
            {{/if}}

            <label class="fr-field">
              <span>Frame rate</span>
              <span class="fr-field-row">
                <input
                  type="number"
                  class="fr-input is-short"
                  min="1"
                  max="120"
                  value={{this.o.fps}}
                  {{on "input" (fn @editor.setExport "fps")}}
                />
                <button
                  type="button"
                  class="fr-btn is-small"
                  {{on "click" @editor.useCompFps}}
                >Use comp ({{@editor.fps}})</button>
              </span>
            </label>

            <label class="fr-field">
              <span>Quality</span>
              <select
                class="fr-input"
                data-field="quality"
                {{on "change" (fn @editor.setExport "quality")}}
              >
                {{#each this.qualities key="id" as |q|}}
                  <option
                    value={{q.id}}
                    selected={{eq this.o.quality q.id}}
                  >{{q.label}}</option>
                {{/each}}
              </select>
            </label>

            <label class="fr-check"><input
                type="checkbox"
                checked={{this.o.motionBlur}}
                {{on "change" (fn @editor.setExport "motionBlur")}}
              />
              Motion blur</label>
            <label class="fr-check"><input
                type="checkbox"
                checked={{this.o.effects}}
                {{on "change" (fn @editor.setExport "effects")}}
              />
              Effects</label>
            <label class="fr-check"><input
                type="checkbox"
                checked={{this.o.soloOff}}
                {{on "change" (fn @editor.setExport "soloOff")}}
              />
              Ignore solo switches</label>
          </section>

          <section class="fr-modal-col">
            <h3>Output module</h3>

            <label class="fr-field">
              <span>Format</span>
              <select
                class="fr-input"
                data-field="format"
                {{on "change" (fn @editor.setExport "format")}}
              >
                {{#each this.formats key="id" as |f|}}
                  <option
                    value={{f.id}}
                    selected={{eq this.o.format f.id}}
                  >{{f.label}}</option>
                {{/each}}
              </select>
            </label>
            <p class="fr-hint">{{this.format.note}}</p>

            <span class="fr-field-label">Engine</span>
            <div class="fr-engine-list">
              {{#each this.engines key="id" as |e|}}
                <button
                  type="button"
                  class="fr-engine {{if (eq this.o.engine e.id) 'is-on'}}"
                  data-engine={{e.id}}
                  disabled={{not e.can}}
                  {{on "click" (fn @editor.setEngine e.id)}}
                >
                  <b>{{e.label}}</b>
                  <i class="fr-faint">{{e.note}}</i>
                </button>
              {{/each}}
            </div>

            <label class="fr-field">
              <span>Channels</span>
              <select
                class="fr-input"
                data-field="alpha"
                disabled={{not this.format.alpha}}
                {{on "change" (fn @editor.setExport "alpha")}}
              >
                <option value="rgb" selected={{not this.o.alpha}}>RGB</option>
                <option value="rgba" selected={{this.o.alpha}}>RGB + Alpha</option>
              </select>
            </label>
            {{#unless this.format.alpha}}
              <p class="fr-hint">{{this.format.label}}
                has no alpha channel; the background shows through instead.</p>
            {{/unless}}

            <label class="fr-check"><input
                type="checkbox"
                checked={{this.o.audio}}
                disabled={{not this.format.audio}}
                {{on "change" (fn @editor.setExport "audio")}}
              />
              Include sound</label>
            {{#if (eq this.o.engine "exact")}}
              <p class="fr-hint">Frame-by-frame renders are silent — sound is a
                live graph and there is no clock to play it against. Use real
                time if you need the audio.</p>
            {{/if}}

            <label class="fr-field">
              <span>File name</span>
              <input
                type="text"
                class="fr-input"
                value={{this.o.name}}
                {{on "input" (fn @editor.setExport "name")}}
              />
            </label>

            <dl class="fr-summary">
              <div><dt>Size</dt><dd
                  data-out="size"
                >{{this.size.width}}×{{this.size.height}}</dd></div>
              <div><dt>Frames</dt><dd>{{this.numbers.frames}}
                  at
                  {{this.o.fps}}fps</dd></div>
              <div><dt>Length</dt><dd>{{this.numbers.length}}</dd></div>
              <div><dt>About</dt><dd>{{this.numbers.weight}}</dd></div>
            </dl>
            {{#if this.heavy}}
              <p class="fr-warn">That is a lot of frames to hold at once. Drop
                the resolution, shorten the span, or render it in pieces.</p>
            {{/if}}
          </section>
        </div>

        <footer class="fr-modal-foot">
          {{#if @editor.busy}}
            <div class="fr-progress is-inline"><div
                class="fr-progress-bar"
                style={{pct @editor.progress}}
              ></div></div>
            <span class="fr-faint">{{@editor.status}}</span>
            <span class="fr-spacer"></span>
            <button
              type="button"
              class="fr-btn"
              {{on "click" @editor.cancelRender}}
            >Stop</button>
          {{else}}
            {{#if @editor.resultUrl}}
              <a
                class="fr-btn is-accent"
                href={{@editor.resultUrl}}
                download={{@editor.resultName}}
                data-download
              ><Icon @name="download" @size={{12}} />
                Save
                {{@editor.resultName}}</a>
              <span class="fr-faint">{{@editor.resultWeight}}</span>
            {{/if}}
            <span class="fr-spacer"></span>
            <button
              type="button"
              class="fr-btn"
              {{on "click" @editor.closeExport}}
            >Close</button>
            <button
              type="button"
              class="fr-btn is-accent"
              data-render
              disabled={{not @editor.layers.length}}
              {{on "click" @editor.render}}
            >Render</button>
          {{/if}}
        </footer>
      </div>
    </div>
  </template>
}
