import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn, concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import ColourField from './colour-field';
import Icon from './icon';
import PbImagePick from './pb-image-pick';
import { paintCss, sampleStops } from '../utils/progress-bar';

// A fill for the Progress Bar Maker: one colour, a linear, radial or conic
// gradient with as many stops as you like (each with its own opacity), or a
// picture. Args: @label, @paint, @path (where it lives on the layer, e.g.
// "fill"), @onSet(path, value), and @segments when a picture can be laid
// into each segment rather than across the whole bar.

const TYPES = [
  { id: 'solid', label: 'Solid' },
  { id: 'linear', label: 'Linear' },
  { id: 'radial', label: 'Radial' },
  { id: 'conic', label: 'Conic' },
  { id: 'image', label: 'Picture' },
];

const FITS = [
  { id: 'cover', label: 'Cover', title: 'Fills the area, cropping what spills over' },
  { id: 'contain', label: 'Fit', title: 'The whole picture, inside the area' },
  { id: 'stretch', label: 'Stretch', title: 'Squashed or stretched to the area' },
  { id: 'tile', label: 'Tile', title: 'Repeated at a set size' },
];

const MAPS = [
  { id: 'bar', label: 'Across the bar' },
  { id: 'segment', label: 'In each segment' },
];

const eq = (a, b) => a === b;

// "rgba(r,g,b,a)" back to a hex code, for a new stop picked off the gradient.
function toHex(css) {
  const [r, g, b] = css.match(/[\d.]+/g).map(Number);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export default class PbPaintField extends Component {
  types = TYPES;
  fits = FITS;
  maps = MAPS;

  get isImage() {
    return this.args.paint.type === 'image';
  }

  get fit() {
    return this.args.paint.fit ?? 'cover';
  }

  get map() {
    return this.args.paint.map ?? 'bar';
  }

  get scale() {
    return this.args.paint.scale ?? 100;
  }

  pickImage = (src) => this.put('src', src);
  pickFit = (id) => this.put('fit', id);
  pickMap = (id) => this.put('map', id);
  setScale = (event) => this.put('scale', Math.max(1, Number(event.target.value) || 100));

  get stops() {
    return this.args.paint.stops;
  }

  get first() {
    return this.stops[0];
  }

  get isSolid() {
    return this.args.paint.type === 'solid';
  }

  get usesAngle() {
    return ['linear', 'conic'].includes(this.args.paint.type);
  }

  get canRemove() {
    return this.stops.length > 2;
  }

  get previewStyle() {
    return htmlSafe(`background:${paintCss(this.args.paint)}`);
  }

  put(key, value) {
    this.args.onSet(`${this.args.path}.${key}`, value);
  }

  pickType = (id) => this.put('type', id);
  setAngle = (event) => this.put('angle', Number(event.target.value) || 0);
  setColour = (i, hex) => this.put(`stops.${i}.color`, hex);
  setNumber = (i, key, event) =>
    this.put(`stops.${i}.${key}`, Math.max(0, Math.min(100, Number(event.target.value) || 0)));

  // A solid colour is the first stop; keeping the rest in step means turning
  // it back into a gradient doesn't surprise you with an old colour.
  setSolid = (hex) =>
    this.put(
      'stops',
      this.stops.map((s) => ({ ...s, color: hex })),
    );
  setSolidAlpha = (event) =>
    this.put(
      'stops',
      this.stops.map((s) => ({ ...s, alpha: Number(event.target.value) || 0 })),
    );

  // A new stop goes in the widest gap, in the colour the gradient already has there.
  addStop = () => {
    const sorted = [...this.stops].sort((a, b) => a.pos - b.pos);
    let at = 50;
    let widest = -1;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].pos - sorted[i - 1].pos;
      if (gap > widest) {
        widest = gap;
        at = Math.round(sorted[i - 1].pos + gap / 2);
      }
    }
    const colour = sampleStops(this.stops, at);
    const alpha = Math.round(Number(colour.match(/[\d.]+/g)[3]) * 100);
    this.put('stops', [...this.stops, { pos: at, color: toHex(colour), alpha }]);
  };

  removeStop = (i) =>
    this.put(
      'stops',
      this.stops.filter((_, j) => j !== i),
    );

  <template>
    <div class="pb-paint">
      <div class="field-head">
        <span class="qr-label">{{@label}}</span>
        <span class="pb-paint-preview checkerboard"><span
            style={{this.previewStyle}}
          ></span></span>
      </div>
      <div class="pb-seg" role="group" aria-label="{{@label}} type">
        {{#each this.types as |t|}}
          <button
            type="button"
            class={{if (eq @paint.type t.id) "active"}}
            {{on "click" (fn this.pickType t.id)}}
          >{{t.label}}</button>
        {{/each}}
      </div>

      {{#if this.isImage}}
        <PbImagePick
          @src={{@paint.src}}
          @label="{{@label}} picture"
          @onPick={{this.pickImage}}
        />
        <div class="pb-seg" role="group" aria-label="{{@label}} fit">
          {{#each this.fits as |f|}}
            <button
              type="button"
              class={{if (eq this.fit f.id) "active"}}
              title={{f.title}}
              {{on "click" (fn this.pickFit f.id)}}
            >{{f.label}}</button>
          {{/each}}
        </div>
        {{#if (eq this.fit "tile")}}
          <label class="pb-slider">
            <span class="pb-slider-label">Size</span>
            <input
              type="range"
              min="5"
              max="400"
              value={{this.scale}}
              {{on "input" this.setScale}}
            />
            <span class="pb-slider-value">{{this.scale}}%</span>
          </label>
        {{/if}}
        {{#if @segments}}
          <div class="pb-seg" role="group" aria-label="{{@label}} placement">
            {{#each this.maps as |m|}}
              <button
                type="button"
                class={{if (eq this.map m.id) "active"}}
                {{on "click" (fn this.pickMap m.id)}}
              >{{m.label}}</button>
            {{/each}}
          </div>
        {{/if}}
      {{else if this.isSolid}}
        {{#let this.first as |s|}}
          <div class="pb-stop">
            <ColourField
              @label="{{@label}} colour"
              @value={{s.color}}
              @onChange={{this.setSolid}}
            />
            <span class="pb-mini" title="Opacity">
              <span>α</span>
              <input
                type="range"
                min="0"
                max="100"
                value={{s.alpha}}
                aria-label="{{@label}} opacity"
                {{on "input" this.setSolidAlpha}}
              />
            </span>
          </div>
        {{/let}}
      {{else}}
        {{#if this.usesAngle}}
          <label class="pb-slider">
            <span class="pb-slider-label">Angle</span>
            <input
              type="range"
              min="0"
              max="360"
              value={{@paint.angle}}
              {{on "input" this.setAngle}}
            />
            <span class="pb-slider-value">{{@paint.angle}}°</span>
          </label>
        {{/if}}
        {{#each this.stops as |s i|}}
          <div class="pb-stop">
            <ColourField
              @label={{concat @label " stop " i}}
              @value={{s.color}}
              @onChange={{fn this.setColour i}}
            />
            <span class="pb-mini pb-mini-pos" title="Position along the gradient (%)">
              <input
                type="number"
                min="0"
                max="100"
                class="math-input"
                value={{s.pos}}
                aria-label={{concat @label " stop " i " position"}}
                {{on "change" (fn this.setNumber i "pos")}}
              />
            </span>
            <span class="pb-mini" title="Opacity">
              <span>α</span>
              <input
                type="range"
                min="0"
                max="100"
                value={{s.alpha}}
                aria-label={{concat @label " stop " i " opacity"}}
                {{on "input" (fn this.setNumber i "alpha")}}
              />
            </span>
            <button
              type="button"
              class="btn pb-icon-btn"
              title="Remove this stop"
              aria-label="Remove stop"
              disabled={{if this.canRemove false true}}
              {{on "click" (fn this.removeStop i)}}
            ><Icon @name="x" @size={{12}} /></button>
          </div>
        {{/each}}
        <button type="button" class="btn pb-add-stop" {{on "click" this.addStop}}>
          <Icon @name="plus" @size={{12}} />
          Add colour stop
        </button>
      {{/if}}
    </div>
  </template>
}
