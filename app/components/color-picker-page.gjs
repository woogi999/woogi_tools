import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import ToolPage from './tool-page';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import ColorWheel from './color-wheel';
import CopyButton from './copy-button';
import { clampByte, toHex, parseHex, rgbToHsl, rgbToHsv, hsvToRgb } from 'woogi-tools/utils/color';

const HISTORY_LIMIT = 12;

export default class ColorPickerPage extends Component {
  @tracked r = 138;
  @tracked g = 138;
  @tracked b = 138;
  @tracked hexDraft = null;
  @tracked history = [];
  @tracked mode = 'rgb';
  @tracked hsvDraft = null;

  get hex() {
    return this.hexDraft ?? toHex(this.r, this.g, this.b);
  }

  get swatchHex() {
    return toHex(this.r, this.g, this.b);
  }

  get swatchStyle() {
    return htmlSafe(`background:${this.swatchHex};`);
  }

  get rgbText() {
    return `${this.r},${this.g},${this.b}`;
  }

  get hsl() {
    return rgbToHsl(this.r, this.g, this.b);
  }

  get hslText() {
    const { h, s, l } = this.hsl;
    return `${h},${s}%,${l}%`;
  }

  setRgb(r, g, b) {
    this.r = clampByte(r);
    this.g = clampByte(g);
    this.b = clampByte(b);
    this.hexDraft = null;
    this.hsvDraft = null;
  }

  onWheelChange = (rgb) => {
    this.setRgb(rgb.r, rgb.g, rgb.b);
  };

  onHexInput = (evt) => {
    const value = evt.target.value;
    this.hexDraft = value;
    const rgb = parseHex(value);
    if (rgb) this.setRgb(rgb.r, rgb.g, rgb.b);
  };

  get isHsv() {
    return this.mode === 'hsv';
  }

  // Held while dragging HSV sliders so hue/saturation survive passing through grey/black.
  get hsv() {
    return this.hsvDraft ?? rgbToHsv(this.r, this.g, this.b);
  }

  setMode = (mode) => {
    this.mode = mode;
  };

  get sliders() {
    const grad = (...stops) => htmlSafe(`background:linear-gradient(to right,${stops.join(',')});`);
    const hex = ({ r, g, b }) => toHex(r, g, b);
    if (!this.isHsv) {
      const { r, g, b } = this;
      return [
        { key: 'r', label: 'R', max: 255, value: r, style: grad(toHex(0, g, b), toHex(255, g, b)) },
        { key: 'g', label: 'G', max: 255, value: g, style: grad(toHex(r, 0, b), toHex(r, 255, b)) },
        { key: 'b', label: 'B', max: 255, value: b, style: grad(toHex(r, g, 0), toHex(r, g, 255)) },
      ];
    }
    const { h, s, v } = this.hsv;
    const hues = [0, 60, 120, 180, 240, 300, 360].map((deg) => hex(hsvToRgb(deg, s, v)));
    return [
      { key: 'h', label: 'H', max: 360, value: Math.round(h), style: grad(...hues) },
      { key: 's', label: 'S', max: 100, value: Math.round(s * 100), style: grad(hex(hsvToRgb(h, 0, v)), hex(hsvToRgb(h, 1, v))) },
      { key: 'v', label: 'V', max: 100, value: Math.round(v * 100), style: grad('#000000', hex(hsvToRgb(h, s, 1))) },
    ];
  }

  onSlider = (channel, evt) => {
    const value = +evt.target.value;
    if ('rgb'.includes(channel)) {
      const next = { r: this.r, g: this.g, b: this.b, [channel]: value };
      this.setRgb(next.r, next.g, next.b);
      return;
    }
    const hsv = { ...this.hsv, [channel]: channel === 'h' ? value : value / 100 };
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    this.setRgb(rgb.r, rgb.g, rgb.b);
    this.hsvDraft = hsv;
  };

  commitHistory = () => {
    const hex = this.swatchHex;
    if (this.history[0] === hex) return;
    this.history = [hex, ...this.history.filter((h) => h !== hex)].slice(0, HISTORY_LIMIT);
  };

  pickHistory = (hex) => {
    const rgb = parseHex(hex);
    if (rgb) this.setRgb(rgb.r, rgb.g, rgb.b);
  };

  get historyEntries() {
    return this.history.map((hex) => ({ hex, style: htmlSafe(`background:${hex};`) }));
  }

  <template>
    <ToolPage @route="color-picker" @subtitle="Spin the wheel till it feels right, then copy it as HEX, RGB or HSL. Easy.">

      <section class="picker-layout pop-in">
        <div class="preview-panel">
          <ColorWheel
            @r={{this.r}}
            @g={{this.g}}
            @b={{this.b}}
            @onChange={{this.onWheelChange}}
            @onCommit={{this.commitHistory}}
          />
          <div class="swatch" style={{this.swatchStyle}}></div>
        </div>

        <div class="values-panel">
          <div class="value-row">
            <label for="hex-value">HEX</label>
            <input
              id="hex-value"
              type="text"
              value={{this.hex}}
              spellcheck="false"
              {{on "input" this.onHexInput}}
              {{on "change" this.commitHistory}}
            />
            <CopyButton @value={{this.hex}} />
          </div>

          <div class="value-row">
            <label for="rgb-value">RGB</label>
            <input id="rgb-value" type="text" value={{this.rgbText}} readonly spellcheck="false" />
            <CopyButton @value={{this.rgbText}} />
          </div>

          <div class="value-row">
            <label for="hsl-value">HSL</label>
            <input id="hsl-value" type="text" value={{this.hslText}} readonly spellcheck="false" />
            <CopyButton @value={{this.hslText}} />
          </div>

          <div class="slider-group">
            <div class="mode-toggle" role="group" aria-label="Slider mode">
              <button type="button" class="btn {{if this.isHsv '' 'active'}}" {{on "click" (fn this.setMode "rgb")}}>RGB</button>
              <button type="button" class="btn {{if this.isHsv 'active'}}" {{on "click" (fn this.setMode "hsv")}}>HSV</button>
            </div>
            {{#each this.sliders as |slider|}}
              <div class="slider-row">
                <label for="{{slider.key}}-slider">{{slider.label}}</label>
                <input
                  id="{{slider.key}}-slider"
                  type="range"
                  class="colour-slider"
                  min="0"
                  max={{slider.max}}
                  value={{slider.value}}
                  style={{slider.style}}
                  {{on "input" (fn this.onSlider slider.key)}}
                  {{on "change" this.commitHistory}}
                />
                <span class="slider-num">{{slider.value}}</span>
              </div>
            {{/each}}
          </div>
        </div>
      </section>

      <section class="history-section pop-in">
        <h2>Colour History</h2>
        {{#if this.history.length}}
          <div class="history-row">
            {{#each this.historyEntries as |entry|}}
              <button
                type="button"
                class="history-swatch"
                style={{entry.style}}
                title={{entry.hex}}
                {{on "click" (fn this.pickHistory entry.hex)}}
              ></button>
            {{/each}}
          </div>
        {{else}}
          <p class="history-empty">Colours you pick will show up here.</p>
        {{/if}}
      </section>
    </ToolPage>
  </template>
}
