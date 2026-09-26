import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ColourField from './colour-field';
import Icon from './icon';
import PbPaintField from './pb-paint-field';
import PbImagePick from './pb-image-pick';
import { BLENDS, FONTS } from '../utils/progress-bar';

// The settings for whichever layer is picked in the Progress Bar Maker, one
// tab at a time. Args: @layer, @tab, @onSet(path, value), @onField(path,
// event) (reads the value off the input, whatever kind it is), and
// @onMatchSteps() for segmented bars.

const eq = (a, b) => a === b;
const or = (...v) => v.some(Boolean);
const half = (a, b) => Math.max(1, Math.floor(Math.min(a, b) / 2));
const not = (v) => !v;
const isVertical = (layer) =>
  ['ttb', 'btt', 'center-v'].includes(layer.direction);

const BAR_DIRECTIONS = [
  { id: 'ltr', icon: 'arrow-right', title: 'Left to right' },
  { id: 'rtl', icon: 'arrow-left', title: 'Right to left' },
  { id: 'btt', icon: 'arrow-up', title: 'Bottom to top' },
  { id: 'ttb', icon: 'arrow-down', title: 'Top to bottom' },
  {
    id: 'center-h',
    icon: 'move-horizontal',
    title: 'Out from the middle, sideways',
  },
  {
    id: 'center-v',
    icon: 'move-vertical',
    title: 'Out from the middle, up and down',
  },
];

const SHAPES_BAR = [
  { id: 'bar', label: 'Bar' },
  { id: 'ring', label: 'Ring' },
  { id: 'text', label: 'Text' },
];

const TEXT_LAYOUTS = [
  { id: 'across', label: 'Across' },
  { id: 'down', label: 'Down' },
];

const TEXT_MODES = [
  { id: 'wipe', label: 'Sweep', title: 'The fill sweeps across the whole text' },
  { id: 'chars', label: 'Letter by letter', title: 'Each letter fills in turn' },
  {
    id: 'strokes',
    label: 'Stroke order',
    title: 'Kanji and kana are drawn stroke by stroke, the way they’re written',
  },
];

const TEXT_STYLES = [
  { id: 'fill', label: 'Solid letters' },
  { id: 'outline', label: 'Outlines' },
];

const IMAGE_FITS = [
  { id: 'contain', label: 'Fit' },
  { id: 'stretch', label: 'Stretch' },
];

const SEGMENT_SHAPES = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'slant', label: 'Slant' },
  { id: 'chevron', label: 'Chevron' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'ellipse', label: 'Oval' },
  { id: 'image', label: 'Picture' },
];

const ALIGN_ACROSS = [
  { id: 'start', label: 'Top' },
  { id: 'center', label: 'Middle' },
  { id: 'end', label: 'Bottom' },
];

const ALIGN_DOWN = [
  { id: 'start', label: 'Left' },
  { id: 'center', label: 'Middle' },
  { id: 'end', label: 'Right' },
];

const FILL_ENDS = [
  {
    id: 'cut',
    label: 'Cut by the bar',
    title: 'The fill is trimmed by the bar’s outline',
  },
  {
    id: 'shape',
    label: 'Own shape',
    title: 'The fill keeps its own ends as it grows',
  },
];

const CLIP_TO = [
  { id: 'fill', label: 'The fill' },
  { id: 'all', label: 'The whole bar' },
];

const RING_DIRECTIONS = [
  { id: 'cw', icon: 'rotate-cw', title: 'Clockwise' },
  { id: 'ccw', icon: 'rotate-ccw', title: 'Anticlockwise' },
  { id: 'center', icon: 'move-horizontal', title: 'Both ways from the start' },
];

const FILL_MODES = [
  {
    id: 'reveal',
    label: 'Whole',
    title: 'The gradient spans the full bar and is uncovered as it fills',
  },
  {
    id: 'stretch',
    label: 'Squeezed',
    title: 'The whole gradient always fits inside the filled part',
  },
  {
    id: 'progress',
    label: 'By step',
    title: 'One colour at a time, picked off the gradient by how full it is',
  },
];

const STROKE_STYLES = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'double', label: 'Double' },
];

const STROKE_POSITIONS = [
  { id: 'outside', label: 'Outside' },
  { id: 'center', label: 'Centred' },
  { id: 'inside', label: 'Inside' },
];

const STROKE_AROUND = [
  { id: 'segments', label: 'Each segment' },
  { id: 'bar', label: 'The whole bar' },
];

const CAPS = [
  { id: 'butt', label: 'Flat' },
  { id: 'round', label: 'Round' },
  { id: 'square', label: 'Square' },
];

const PATTERNS = [
  { id: 'stripes', label: 'Stripes' },
  { id: 'dots', label: 'Dots' },
  { id: 'checker', label: 'Checker' },
  { id: 'crosshatch', label: 'Grid' },
  { id: 'image', label: 'Picture' },
];

const ANCHORS = [
  {
    id: 'canvas',
    label: 'Pinned',
    title:
      'Stays still on the picture: the fill uncovers it as it grows (the Chowder look)',
  },
  {
    id: 'fill',
    label: 'With fill',
    title: 'Moves along with the fill’s growing end',
  },
  {
    id: 'drift',
    label: 'Drifts',
    title: 'Slides along by a set amount every step',
  },
];

const SHINES = [
  { id: 'top', label: 'Gloss' },
  { id: 'glass', label: 'Glass' },
  { id: 'sheen', label: 'Sheen' },
  { id: 'shade', label: 'Shade' },
];

const SHAPES = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'diamond', label: 'Diamond' },
];

const ALIGNS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Centre' },
  { id: 'right', label: 'Right' },
];

// Label, track and value on one line; the value has a fixed width so a
// number growing a digit doesn't nudge the track.
const Slider = <template>
  <label class="pb-slider">
    <span class="pb-slider-label">{{@label}}</span>
    <input
      type="range"
      min={{@min}}
      max={{@max}}
      step={{if @step @step 1}}
      value={{@value}}
      {{on "input" (fn @onField @path)}}
    />
    <span class="pb-slider-value">{{@value}}{{@unit}}</span>
  </label>
</template>;

const Check = <template>
  <label class="math-check"><input
      type="checkbox"
      checked={{@checked}}
      {{on "change" (fn @onField @path)}}
    />
    {{@label}}</label>
</template>;

// Joined buttons: for a few short choices.
const Picks = <template>
  <div class="pb-row">
    {{#if @title}}<span class="pb-row-label">{{@title}}</span>{{/if}}
    <div class="pb-seg" role="group" aria-label={{if @title @title @label}}>
      {{#each @options as |o|}}
        <button
          type="button"
          class={{if (eq @value o.id) "active"}}
          title={{o.title}}
          aria-label={{if o.icon o.title}}
          {{on "click" (fn @onSet @path o.id)}}
        >{{#if o.icon}}<Icon @name={{o.icon}} @size={{13}} />{{else}}{{o.label}}{{/if}}</button>
      {{/each}}
    </div>
  </div>
</template>;

// Pills that wrap: for longer lists.
const Chips = <template>
  <div class="pb-chips" role="group" aria-label={{@label}}>
    {{#each @options as |o|}}
      <button
        type="button"
        class={{if (eq @value o.id) "active"}}
        title={{o.title}}
        {{on "click" (fn @onSet @path o.id)}}
      >{{o.label}}</button>
    {{/each}}
  </div>
</template>;

const Num = <template>
  <label class="pb-num"><span>{{@label}}</span><input
      type="number"
      class="math-input"
      value={{@value}}
      {{on "change" (fn @onField @path)}}
    /></label>
</template>;

const Group = <template>
  <section class="pb-group">
    <h4 class="pb-group-title">{{@title}}</h4>
    {{yield}}
  </section>
</template>;

// An effect with its own switch. Its settings fold away while it's off,
// leaving one line saying what it does.
const Fx = <template>
  <section class="pb-group pb-fx {{if @on 'is-on'}}">
    <label class="pb-fx-head">
      <span class="pb-group-title">{{@title}}</span>
      <span class="qr-switch">
        <input
          type="checkbox"
          role="switch"
          checked={{@on}}
          aria-checked={{if @on "true" "false"}}
          {{on "change" (fn @onField @path)}}
        />
        <span class="qr-switch-track"></span>
      </span>
    </label>
    {{#if @on}}
      {{yield}}
    {{else if @hint}}
      <p class="pb-hint">{{@hint}}</p>
    {{/if}}
  </section>
</template>;

const ColourAlpha = <template>
  <div class="pb-stop">
    <ColourField
      @label={{@label}}
      @value={{@color}}
      @onChange={{fn @onSet @colorPath}}
    />
    <span class="pb-mini" title="Opacity"><span>α</span><input
        type="range"
        min="0"
        max="100"
        value={{@alpha}}
        aria-label="{{@label}} opacity"
        {{on "input" (fn @onField @alphaPath)}}
      /></span>
  </div>
</template>;

// The effects every kind of layer can have.
const LayerFx = <template>
  <h3 class="pb-divider">Layer effects</h3>
  <Fx
    @title="Drop shadow"
    @on={{@layer.fx.shadow.on}}
    @path="fx.shadow.on"
    @onField={{@onField}}
    @hint="A soft shadow under the layer."
  >
    <ColourAlpha
      @label="Shadow"
      @color={{@layer.fx.shadow.color}}
      @colorPath="fx.shadow.color"
      @alpha={{@layer.fx.shadow.alpha}}
      @alphaPath="fx.shadow.alpha"
      @onSet={{@onSet}}
      @onField={{@onField}}
    />
    <Slider
      @label="Across"
      @min="-100"
      @max="100"
      @value={{@layer.fx.shadow.x}}
      @path="fx.shadow.x"
      @onField={{@onField}}
    />
    <Slider
      @label="Down"
      @min="-100"
      @max="100"
      @value={{@layer.fx.shadow.y}}
      @path="fx.shadow.y"
      @onField={{@onField}}
    />
    <Slider
      @label="Blur"
      @min="0"
      @max="120"
      @value={{@layer.fx.shadow.blur}}
      @path="fx.shadow.blur"
      @onField={{@onField}}
    />
  </Fx>
  <Fx
    @title="Outer glow"
    @on={{@layer.fx.outerGlow.on}}
    @path="fx.outerGlow.on"
    @onField={{@onField}}
    @hint="Light spilling out all round the layer."
  >
    <ColourAlpha
      @label="Glow"
      @color={{@layer.fx.outerGlow.color}}
      @colorPath="fx.outerGlow.color"
      @alpha={{@layer.fx.outerGlow.alpha}}
      @alphaPath="fx.outerGlow.alpha"
      @onSet={{@onSet}}
      @onField={{@onField}}
    />
    <Slider
      @label="Size"
      @min="1"
      @max="150"
      @value={{@layer.fx.outerGlow.size}}
      @path="fx.outerGlow.size"
      @onField={{@onField}}
    />
  </Fx>
  <Fx
    @title="Outline"
    @on={{@layer.fx.outline.on}}
    @path="fx.outline.on"
    @onField={{@onField}}
    @hint="A solid edge traced round whatever the layer draws."
  >
    <ColourAlpha
      @label="Outline"
      @color={{@layer.fx.outline.color}}
      @colorPath="fx.outline.color"
      @alpha={{@layer.fx.outline.alpha}}
      @alphaPath="fx.outline.alpha"
      @onSet={{@onSet}}
      @onField={{@onField}}
    />
    <Slider
      @label="Width"
      @min="1"
      @max="40"
      @value={{@layer.fx.outline.width}}
      @path="fx.outline.width"
      @onField={{@onField}}
    />
  </Fx>
  <Fx
    @title="Colour overlay"
    @on={{@layer.fx.overlay.on}}
    @path="fx.overlay.on"
    @onField={{@onField}}
    @hint="Tints the whole layer one colour."
  >
    <ColourAlpha
      @label="Overlay"
      @color={{@layer.fx.overlay.color}}
      @colorPath="fx.overlay.color"
      @alpha={{@layer.fx.overlay.alpha}}
      @alphaPath="fx.overlay.alpha"
      @onSet={{@onSet}}
      @onField={{@onField}}
    />
    <label class="pb-row">
      <span class="pb-row-label">Blend</span>
      <select class="select" {{on "change" (fn @onField "fx.overlay.blend")}}>
        {{#each BLENDS as |b|}}
          <option
            value={{b.id}}
            selected={{eq @layer.fx.overlay.blend b.id}}
          >{{b.label}}</option>
        {{/each}}
      </select>
    </label>
  </Fx>
  <Fx
    @title="Fade with progress"
    @on={{@layer.fx.fade.on}}
    @path="fx.fade.on"
    @onField={{@onField}}
    @hint="Fades the layer in (or out) as the bar fills."
  >
    <Slider
      @label="When empty"
      @unit="%"
      @min="0"
      @max="100"
      @value={{@layer.fx.fade.from}}
      @path="fx.fade.from"
      @onField={{@onField}}
    />
    <Slider
      @label="When full"
      @unit="%"
      @min="0"
      @max="100"
      @value={{@layer.fx.fade.to}}
      @path="fx.fade.to"
      @onField={{@onField}}
    />
  </Fx>
  <Fx
    @title="Only show between"
    @on={{@layer.fx.range.on}}
    @path="fx.range.on"
    @onField={{@onField}}
    @hint="Shows the layer on some steps only, like a “FULL!” on the last."
  >
    <Slider
      @label="From"
      @unit="%"
      @min="0"
      @max="100"
      @value={{@layer.fx.range.from}}
      @path="fx.range.from"
      @onField={{@onField}}
    />
    <Slider
      @label="To"
      @unit="%"
      @min="0"
      @max="100"
      @value={{@layer.fx.range.to}}
      @path="fx.range.to"
      @onField={{@onField}}
    />
  </Fx>
</template>;

<template>
  <div class="pb-props">
    {{#if (eq @tab "layer")}}
      <Group @title="Layer">
        <label class="pb-row">
          <span class="pb-row-label">Name</span>
          <input
            type="text"
            class="math-input"
            value={{@layer.name}}
            {{on "change" (fn @onField "name")}}
          />
        </label>
        <Slider
          @label="Opacity"
          @unit="%"
          @min="0"
          @max="100"
          @value={{@layer.opacity}}
          @path="opacity"
          @onField={{@onField}}
        />
        <label class="pb-row">
          <span class="pb-row-label">Blend</span>
          <select class="select" {{on "change" (fn @onField "blend")}}>
            {{#each BLENDS as |b|}}
              <option
                value={{b.id}}
                selected={{eq @layer.blend b.id}}
              >{{b.label}}</option>
            {{/each}}
          </select>
        </label>
      </Group>

      {{#unless (eq @layer.type "paint")}}
        <Group @title="Position">
          <div class="pb-nums">
            <Num
              @label="X"
              @value={{@layer.x}}
              @path="x"
              @onField={{@onField}}
            />
            <Num
              @label="Y"
              @value={{@layer.y}}
              @path="y"
              @onField={{@onField}}
            />
            <Num
              @label="W"
              @value={{@layer.w}}
              @path="w"
              @onField={{@onField}}
            />
            <Num
              @label="H"
              @value={{@layer.h}}
              @path="h"
              @onField={{@onField}}
            />
          </div>
          <Slider
            @label="Rotation"
            @unit="°"
            @min="-180"
            @max="180"
            @value={{@layer.rotation}}
            @path="rotation"
            @onField={{@onField}}
          />
        </Group>
      {{/unless}}

      <Group @title="Clipping">
        <Check
          @label="Clip to the layer below"
          @checked={{@layer.clip}}
          @path="clip"
          @onField={{@onField}}
        />
        {{#if (eq @layer.type "bar")}}
          <Picks
            @title="Clipped layers show on"
            @options={{CLIP_TO}}
            @value={{@layer.clipTo}}
            @path="clipTo"
            @onSet={{@onSet}}
          />
        {{/if}}
        <p class="pb-hint">A clipped layer only shows inside the layer under it:
          put a picture over a bar, clip it, and it becomes a texture on the
          fill.</p>
      </Group>
    {{/if}}

    {{#if (eq @tab "effects")}}
      {{#if (eq @layer.type "bar")}}
        <Fx
          @title="Pattern"
          @on={{@layer.stripes.on}}
          @path="stripes.on"
          @onField={{@onField}}
          @hint="Stripes, dots, checks or a grid over the fill, pinned still or moving."
        >
          <Chips
            @label="Pattern"
            @options={{PATTERNS}}
            @value={{@layer.stripes.kind}}
            @path="stripes.kind"
            @onSet={{@onSet}}
          />
          {{#if (eq @layer.stripes.kind "image")}}
            <PbImagePick
              @src={{@layer.stripes.src}}
              @label="Pattern picture"
              @onPick={{fn @onSet "stripes.src"}}
            />
            <Slider
              @label="Opacity"
              @unit="%"
              @min="0"
              @max="100"
              @value={{@layer.stripes.alpha}}
              @path="stripes.alpha"
              @onField={{@onField}}
            />
          {{else}}
            <ColourAlpha
              @label="Pattern"
              @color={{@layer.stripes.color}}
              @colorPath="stripes.color"
              @alpha={{@layer.stripes.alpha}}
              @alphaPath="stripes.alpha"
              @onSet={{@onSet}}
              @onField={{@onField}}
            />
          {{/if}}
          <Slider
            @label="Size"
            @min="2"
            @max="120"
            @value={{@layer.stripes.width}}
            @path="stripes.width"
            @onField={{@onField}}
          />
          {{#unless (eq @layer.stripes.kind "checker")}}
            <Slider
              @label="Spacing"
              @min="0"
              @max="160"
              @value={{@layer.stripes.gap}}
              @path="stripes.gap"
              @onField={{@onField}}
            />
          {{/unless}}
          <Slider
            @label="Angle"
            @unit="°"
            @min="-90"
            @max="90"
            @value={{@layer.stripes.angle}}
            @path="stripes.angle"
            @onField={{@onField}}
          />
          <Picks
            @title="Moves"
            @options={{ANCHORS}}
            @value={{@layer.stripes.anchor}}
            @path="stripes.anchor"
            @onSet={{@onSet}}
          />
          {{#if (eq @layer.stripes.anchor "drift")}}
            <Slider
              @label="Per step"
              @unit="px"
              @min="-60"
              @max="60"
              @value={{@layer.stripes.move}}
              @path="stripes.move"
              @onField={{@onField}}
            />
          {{/if}}
        </Fx>
        <Fx
          @title="Shine"
          @on={{@layer.shine.on}}
          @path="shine.on"
          @onField={{@onField}}
          @hint="A highlight across the fill: gloss, glass, sheen or a shaded bottom."
        >
          <Picks
            @title="Style"
            @options={{SHINES}}
            @value={{@layer.shine.style}}
            @path="shine.style"
            @onSet={{@onSet}}
          />
          <Slider
            @label="Strength"
            @unit="%"
            @min="0"
            @max="100"
            @value={{@layer.shine.alpha}}
            @path="shine.alpha"
            @onField={{@onField}}
          />
        </Fx>
        <Fx
          @title="Leading edge"
          @on={{@layer.tip.on}}
          @path="tip.on"
          @onField={{@onField}}
          @hint="A bright band where the fill is growing."
        >
          <ColourAlpha
            @label="Edge"
            @color={{@layer.tip.color}}
            @colorPath="tip.color"
            @alpha={{@layer.tip.alpha}}
            @alphaPath="tip.alpha"
            @onSet={{@onSet}}
            @onField={{@onField}}
          />
          <Slider
            @label="Length"
            @min="2"
            @max="300"
            @value={{@layer.tip.size}}
            @path="tip.size"
            @onField={{@onField}}
          />
        </Fx>
        <Fx
          @title="Glow"
          @on={{@layer.glow.on}}
          @path="glow.on"
          @onField={{@onField}}
          @hint="Light around the filled part."
        >
          <ColourAlpha
            @label="Glow"
            @color={{@layer.glow.color}}
            @colorPath="glow.color"
            @alpha={{@layer.glow.alpha}}
            @alphaPath="glow.alpha"
            @onSet={{@onSet}}
            @onField={{@onField}}
          />
          <Slider
            @label="Size"
            @min="1"
            @max="150"
            @value={{@layer.glow.size}}
            @path="glow.size"
            @onField={{@onField}}
          />
          <Check
            @label="Brighter as it fills"
            @checked={{@layer.glow.grow}}
            @path="glow.grow"
            @onField={{@onField}}
          />
        </Fx>
        <Fx
          @title="Grain"
          @on={{@layer.grain.on}}
          @path="grain.on"
          @onField={{@onField}}
          @hint="Film grain over the fill, still or flickering."
        >
          <Slider
            @label="Strength"
            @unit="%"
            @min="0"
            @max="100"
            @value={{@layer.grain.alpha}}
            @path="grain.alpha"
            @onField={{@onField}}
          />
          <Slider
            @label="Coarseness"
            @min="1"
            @max="12"
            @value={{@layer.grain.size}}
            @path="grain.size"
            @onField={{@onField}}
          />
          <Check
            @label="Changes every step"
            @checked={{@layer.grain.animate}}
            @path="grain.animate"
            @onField={{@onField}}
          />
        </Fx>
        <Fx
          @title="Flash when full"
          @on={{@layer.flash.on}}
          @path="flash.on"
          @onField={{@onField}}
          @hint="Washes the fill with a colour on the last step only."
        >
          <ColourAlpha
            @label="Flash"
            @color={{@layer.flash.color}}
            @colorPath="flash.color"
            @alpha={{@layer.flash.alpha}}
            @alphaPath="flash.alpha"
            @onSet={{@onSet}}
            @onField={{@onField}}
          />
        </Fx>
      {{/if}}
      <LayerFx @layer={{@layer}} @onSet={{@onSet}} @onField={{@onField}} />
    {{/if}}

    {{#if (eq @layer.type "bar")}}
      {{#if (eq @tab "shape")}}
        <Group @title="Shape">
          <Picks
            @label="Bar shape"
            @options={{SHAPES_BAR}}
            @value={{@layer.shape}}
            @path="shape"
            @onSet={{@onSet}}
          />
          {{#if (eq @layer.shape "text")}}
            <textarea
              class="math-input pb-textarea pb-text-input"
              rows="2"
              aria-label="Bar text"
              value={{@layer.text}}
              {{on "input" (fn @onField "text")}}
            ></textarea>
            <label class="pb-row">
              <span class="pb-row-label">Font</span>
              <select class="select" {{on "change" (fn @onField "textFont")}}>
                {{#each FONTS as |f|}}
                  <option
                    value={{f}}
                    selected={{eq @layer.textFont f}}
                  >{{f}}</option>
                {{/each}}
              </select>
            </label>
            <Check
              @label="Bold"
              @checked={{@layer.textBold}}
              @path="textBold"
              @onField={{@onField}}
            />
            <Picks
              @title="Written"
              @options={{TEXT_LAYOUTS}}
              @value={{@layer.textLayout}}
              @path="textLayout"
              @onSet={{@onSet}}
            />
            <Slider
              @label="Spacing"
              @unit="%"
              @min="0"
              @max="100"
              @value={{@layer.textSpacing}}
              @path="textSpacing"
              @onField={{@onField}}
            />
          {{else if (eq @layer.shape "ring")}}
            <Picks
              @title="Fills"
              @options={{RING_DIRECTIONS}}
              @value={{@layer.direction}}
              @path="direction"
              @onSet={{@onSet}}
            />
            <Slider
              @label="Starts at"
              @unit="°"
              @min="0"
              @max="360"
              @value={{@layer.ringStart}}
              @path="ringStart"
              @onField={{@onField}}
            />
            <Slider
              @label="Goes round"
              @unit="°"
              @min="10"
              @max="360"
              @value={{@layer.ringSweep}}
              @path="ringSweep"
              @onField={{@onField}}
            />
            <Slider
              @label="Thickness"
              @min="1"
              @max={{half @layer.w @layer.h}}
              @value={{@layer.thickness}}
              @path="thickness"
              @onField={{@onField}}
            />
            <Check
              @label="Round ends"
              @checked={{@layer.roundEnds}}
              @path="roundEnds"
              @onField={{@onField}}
            />
          {{else}}
            <Picks
              @title="Fills"
              @options={{BAR_DIRECTIONS}}
              @value={{@layer.direction}}
              @path="direction"
              @onSet={{@onSet}}
            />
            <Slider
              @label="Roundness"
              @min="0"
              @max={{half @layer.w @layer.h}}
              @value={{@layer.radius}}
              @path="radius"
              @onField={{@onField}}
            />
            <Slider
              @label="Slant"
              @unit="°"
              @min="-45"
              @max="45"
              @value={{@layer.skew}}
              @path="skew"
              @onField={{@onField}}
            />
          {{/if}}
        </Group>

        {{#if (eq @layer.shape "text")}}
          <Group @title="How it fills">
            <Chips
              @label="How the text fills"
              @options={{TEXT_MODES}}
              @value={{@layer.textMode}}
              @path="textMode"
              @onSet={{@onSet}}
            />
            {{#if (eq @layer.textMode "strokes")}}
              <Slider
                @label="Pen"
                @unit="%"
                @min="1"
                @max="25"
                @value={{@layer.textPen}}
                @path="textPen"
                @onField={{@onField}}
              />
              <p class="pb-hint">Kanji and kana are drawn in the order they're
                written, using KanjiVG's stroke data (fetched once, then kept
                with the design). Anything else sweeps in on its turn.</p>
            {{else}}
              <Picks
                @title="Fills"
                @options={{BAR_DIRECTIONS}}
                @value={{@layer.direction}}
                @path="direction"
                @onSet={{@onSet}}
              />
              <Picks
                @title="Letters"
                @options={{TEXT_STYLES}}
                @value={{@layer.textStyle}}
                @path="textStyle"
                @onSet={{@onSet}}
              />
              {{#if (eq @layer.textStyle "outline")}}
                <Slider
                  @label="Line"
                  @unit="%"
                  @min="1"
                  @max="30"
                  @value={{@layer.textOutline}}
                  @path="textOutline"
                  @onField={{@onField}}
                />
              {{/if}}
            {{/if}}
            <Check
              @label={{if
                (eq @layer.textMode "strokes")
                "Whole strokes only"
                "Whole letters only"
              }}
              @checked={{@layer.stepped}}
              @path="stepped"
              @onField={{@onField}}
            />
          </Group>
        {{else}}
        <Group @title="Segments">
          <Slider
            @label="Count"
            @min="1"
            @max="50"
            @value={{@layer.segments}}
            @path="segments"
            @onField={{@onField}}
          />
          <Slider
            @label="Gap"
            @min="0"
            @max="80"
            @value={{@layer.gap}}
            @path="gap"
            @onField={{@onField}}
          />
          <Check
            @label="Light up whole segments only"
            @checked={{@layer.stepped}}
            @path="stepped"
            @onField={{@onField}}
          />
          <button
            type="button"
            class="btn pb-wide"
            {{on "click" @onMatchSteps}}
          >Make the steps match the segments ({{@layer.segments}})</button>
        </Group>
        {{/if}}

        {{#if (eq @layer.shape "bar")}}
          <Group @title="Segment shape">
            <Chips
              @label="Segment shape"
              @options={{SEGMENT_SHAPES}}
              @value={{@layer.segShape}}
              @path="segShape"
              @onSet={{@onSet}}
            />
            {{#if (eq @layer.segShape "image")}}
              <PbImagePick
                @src={{@layer.segImage}}
                @label="Segment picture"
                @onPick={{fn @onSet "segImage"}}
              />
              <Picks
                @title="Picture"
                @options={{IMAGE_FITS}}
                @value={{@layer.segImageFit}}
                @path="segImageFit"
                @onSet={{@onSet}}
              />
              <p class="pb-hint">The picture's outline becomes each segment's
                shape: hearts, gems, anything with a see-through background.</p>
            {{/if}}
            {{#if (eq @layer.segShape "slant")}}
              <Slider
                @label="Lean"
                @min="-200"
                @max="200"
                @value={{@layer.segSlant}}
                @path="segSlant"
                @onField={{@onField}}
              />
            {{/if}}
            {{#if (or (eq @layer.segShape "chevron") (eq @layer.segShape "hexagon"))}}
              <Slider
                @label="Point"
                @unit="%"
                @min="0"
                @max="150"
                @value={{@layer.segDepth}}
                @path="segDepth"
                @onField={{@onField}}
              />
            {{/if}}
            <Slider
              @label="Taper start"
              @unit="%"
              @min="5"
              @max="100"
              @value={{@layer.taperStart}}
              @path="taperStart"
              @onField={{@onField}}
            />
            <Slider
              @label="Taper end"
              @unit="%"
              @min="5"
              @max="100"
              @value={{@layer.taperEnd}}
              @path="taperEnd"
              @onField={{@onField}}
            />
            <Picks
              @title="Line up"
              @options={{if (isVertical @layer) ALIGN_DOWN ALIGN_ACROSS}}
              @value={{@layer.taperAlign}}
              @path="taperAlign"
              @onSet={{@onSet}}
            />
            <p class="pb-hint">With one segment this shapes the whole bar; a
              taper under 100% makes it a wedge, or a signal meter with more
              segments.</p>
          </Group>
        {{/if}}
      {{/if}}

      {{#if (eq @tab "fill")}}
        <Group @title="Fill">
          <PbPaintField
            @label="Fill"
            @paint={{@layer.fill}}
            @path="fill"
            @onSet={{@onSet}}
            @segments={{not (eq @layer.shape "ring")}}
          />
        </Group>
        <Group @title="How it fills">
          <Picks
            @title="Gradient"
            @options={{FILL_MODES}}
            @value={{@layer.fillMode}}
            @path="fillMode"
            @onSet={{@onSet}}
          />
          <Picks
            @title="Ends"
            @options={{FILL_ENDS}}
            @value={{@layer.fillEnds}}
            @path="fillEnds"
            @onSet={{@onSet}}
          />
          <Slider
            @label="Inset"
            @min="0"
            @max="60"
            @value={{@layer.padding}}
            @path="padding"
            @onField={{@onField}}
          />
        </Group>
        <Fx
          @title="Catch-up trail"
          @on={{@layer.trail.on}}
          @path="trail.on"
          @onField={{@onField}}
          @hint="A second, paler fill running a little ahead of the real one."
        >
          <ColourAlpha
            @label="Trail"
            @color={{@layer.trail.color}}
            @colorPath="trail.color"
            @alpha={{@layer.trail.alpha}}
            @alphaPath="trail.alpha"
            @onSet={{@onSet}}
            @onField={{@onField}}
          />
          <Slider
            @label="Ahead by"
            @unit="%"
            @min="1"
            @max="50"
            @value={{@layer.trail.amount}}
            @path="trail.amount"
            @onField={{@onField}}
          />
        </Fx>
      {{/if}}

      {{#if (eq @tab "track")}}
        <Fx
          @title="Background"
          @on={{@layer.trackOn}}
          @path="trackOn"
          @onField={{@onField}}
          @hint="Off: there's nothing behind the fill, just the see-through picture."
        >
          <PbPaintField
            @label="Background"
            @paint={{@layer.track}}
            @path="track"
            @onSet={{@onSet}}
            @segments={{not (eq @layer.shape "ring")}}
          />
          <Check
            @label="Hide it under the fill"
            @checked={{@layer.trackCut}}
            @path="trackCut"
            @onField={{@onField}}
          />
        </Fx>
        <Fx
          @title="Inner shadow"
          @on={{@layer.innerShadow.on}}
          @path="innerShadow.on"
          @onField={{@onField}}
          @hint="Makes the bar look sunk into the picture."
        >
          <ColourAlpha
            @label="Inner shadow"
            @color={{@layer.innerShadow.color}}
            @colorPath="innerShadow.color"
            @alpha={{@layer.innerShadow.alpha}}
            @alphaPath="innerShadow.alpha"
            @onSet={{@onSet}}
            @onField={{@onField}}
          />
          <Slider
            @label="Size"
            @min="1"
            @max="80"
            @value={{@layer.innerShadow.size}}
            @path="innerShadow.size"
            @onField={{@onField}}
          />
          <Slider
            @label="Across"
            @min="-40"
            @max="40"
            @value={{@layer.innerShadow.x}}
            @path="innerShadow.x"
            @onField={{@onField}}
          />
          <Slider
            @label="Down"
            @min="-40"
            @max="40"
            @value={{@layer.innerShadow.y}}
            @path="innerShadow.y"
            @onField={{@onField}}
          />
        </Fx>
      {{/if}}

      {{#if (eq @tab "stroke")}}
        <Fx
          @title="Outline"
          @on={{@layer.stroke.on}}
          @path="stroke.on"
          @onField={{@onField}}
          @hint="A line round the bar: solid, dashed, dotted or double."
        >
          <Picks
            @label="Style"
            @options={{STROKE_STYLES}}
            @value={{@layer.stroke.style}}
            @path="stroke.style"
            @onSet={{@onSet}}
          />
          <Slider
            @label="Width"
            @min="1"
            @max="60"
            @value={{@layer.stroke.width}}
            @path="stroke.width"
            @onField={{@onField}}
          />
          {{#if (eq @layer.stroke.style "dashed")}}
            <Slider
              @label="Dash"
              @min="1"
              @max="200"
              @value={{@layer.stroke.dash}}
              @path="stroke.dash"
              @onField={{@onField}}
            />
          {{/if}}
          {{#if (or (eq @layer.stroke.style "dashed") (eq @layer.stroke.style "dotted"))}}
            <Slider
              @label="Gap"
              @min="1"
              @max="200"
              @value={{@layer.stroke.gap}}
              @path="stroke.gap"
              @onField={{@onField}}
            />
            <Slider
              @label="Crawl"
              @unit="px"
              @min="-60"
              @max="60"
              @value={{@layer.stroke.march}}
              @path="stroke.march"
              @onField={{@onField}}
            />
          {{/if}}
          <Picks
            @title="Sits"
            @options={{STROKE_POSITIONS}}
            @value={{@layer.stroke.position}}
            @path="stroke.position"
            @onSet={{@onSet}}
          />
          <Picks
            @title="Around"
            @options={{STROKE_AROUND}}
            @value={{@layer.stroke.around}}
            @path="stroke.around"
            @onSet={{@onSet}}
          />
          <Picks
            @title="Ends"
            @options={{CAPS}}
            @value={{@layer.stroke.cap}}
            @path="stroke.cap"
            @onSet={{@onSet}}
          />
          <PbPaintField
            @label="Colour"
            @paint={{@layer.stroke.paint}}
            @path="stroke.paint"
            @onSet={{@onSet}}
          />
        </Fx>
        <Fx
          @title="Fill outline"
          @on={{@layer.fillStroke.on}}
          @path="fillStroke.on"
          @onField={{@onField}}
          @hint="An edge round the filled part only, growing with it."
        >
          <ColourAlpha
            @label="Fill outline"
            @color={{@layer.fillStroke.color}}
            @colorPath="fillStroke.color"
            @alpha={{@layer.fillStroke.alpha}}
            @alphaPath="fillStroke.alpha"
            @onSet={{@onSet}}
            @onField={{@onField}}
          />
          <Slider
            @label="Width"
            @min="1"
            @max="30"
            @value={{@layer.fillStroke.width}}
            @path="fillStroke.width"
            @onField={{@onField}}
          />
        </Fx>
      {{/if}}
    {{/if}}

    {{#if (eq @layer.type "shape")}}
      {{#if (eq @tab "shape")}}
        <Group @title="Shape">
          <Chips
            @label="Shape"
            @options={{SHAPES}}
            @value={{@layer.shape}}
            @path="shape"
            @onSet={{@onSet}}
          />
          <Slider
            @label="Roundness"
            @min="0"
            @max={{half @layer.w @layer.h}}
            @value={{@layer.radius}}
            @path="radius"
            @onField={{@onField}}
          />
        </Group>
        <Fx
          @title="Fill"
          @on={{@layer.fillOn}}
          @path="fillOn"
          @onField={{@onField}}
          @hint="Off leaves just the outline."
        >
          <PbPaintField
            @label="Fill"
            @paint={{@layer.fill}}
            @path="fill"
            @onSet={{@onSet}}
          />
        </Fx>
        <Group @title="Outline">
          <Slider
            @label="Width"
            @min="0"
            @max="60"
            @value={{@layer.stroke}}
            @path="stroke"
            @onField={{@onField}}
          />
          <ColourAlpha
            @label="Outline"
            @color={{@layer.strokeColor}}
            @colorPath="strokeColor"
            @alpha={{@layer.strokeAlpha}}
            @alphaPath="strokeAlpha"
            @onSet={{@onSet}}
            @onField={{@onField}}
          />
        </Group>
      {{/if}}
    {{/if}}

    {{#if (eq @layer.type "text")}}
      {{#if (eq @tab "text")}}
        <Group @title="Text">
          <textarea
            class="math-input pb-textarea"
            rows="2"
            aria-label="Text"
            value={{@layer.text}}
            {{on "input" (fn @onField "text")}}
          ></textarea>
          <p class="pb-hint">{percent}, {frame}, {frames} and {left} change
            with every step.</p>
        </Group>
        <Group @title="Type">
          <label class="pb-row">
            <span class="pb-row-label">Font</span>
            <select class="select" {{on "change" (fn @onField "font")}}>
              {{#each FONTS as |f|}}
                <option value={{f}} selected={{eq @layer.font f}}>{{f}}</option>
              {{/each}}
            </select>
          </label>
          <Slider
            @label="Size"
            @min="6"
            @max="600"
            @value={{@layer.size}}
            @path="size"
            @onField={{@onField}}
          />
          <div class="pb-inline">
            <Check
              @label="Bold"
              @checked={{@layer.bold}}
              @path="bold"
              @onField={{@onField}}
            />
            <Check
              @label="Italic"
              @checked={{@layer.italic}}
              @path="italic"
              @onField={{@onField}}
            />
          </div>
          <Picks
            @label="Align"
            @options={{ALIGNS}}
            @value={{@layer.align}}
            @path="align"
            @onSet={{@onSet}}
          />
        </Group>
        <Group @title="Colour">
          <PbPaintField
            @label="Colour"
            @paint={{@layer.fill}}
            @path="fill"
            @onSet={{@onSet}}
          />
        </Group>
        <Group @title="Outline">
          <Slider
            @label="Width"
            @min="0"
            @max="40"
            @value={{@layer.stroke}}
            @path="stroke"
            @onField={{@onField}}
          />
          <div class="pb-stop">
            <ColourField
              @label="Outline"
              @value={{@layer.strokeColor}}
              @onChange={{fn @onSet "strokeColor"}}
            />
          </div>
        </Group>
      {{/if}}
    {{/if}}

    {{#if (eq @layer.type "paint")}}
      {{#if (eq @tab "layer")}}
        <p class="pb-hint pb-pad">Pick the brush or eraser from the tools on the
          left to draw on this layer.</p>
      {{/if}}
    {{/if}}
  </div>
</template>
