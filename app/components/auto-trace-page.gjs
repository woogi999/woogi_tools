import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { formatBytes } from '../utils/file-share';
import { acceptPastedFiles } from '../utils/paste-files';
import { keepState } from '../utils/tool-state';
import { optimizeSvg } from '../utils/svg-optimize';

// Tracing time grows with the pixel count, and it runs on the main thread, so
// anything bigger than this is scaled down first. A logo or a sketch has
// nothing at 2000px that it doesn't have at 1000.
const MAX_SIDE = 1000;

const STYLES = [
  {
    id: 'flat',
    label: 'Flat colour',
    hint: 'Logos, stickers, cartoons: a handful of solid shapes with clean edges.',
    options: { ltres: 1, qtres: 1, pathomit: 8, rightangleenhance: true },
  },
  {
    id: 'smooth',
    label: 'Smooth',
    hint: 'Photos and paintings, turned into soft overlapping blobs of colour.',
    options: { ltres: 1, qtres: 1, pathomit: 20, blurradius: 3, blurdelta: 20 },
  },
  {
    id: 'detailed',
    label: 'Detailed',
    hint: 'Keeps the small stuff. Bigger file, slower, closer to the original.',
    options: { ltres: 0.5, qtres: 0.5, pathomit: 2, rightangleenhance: true },
  },
  {
    id: 'poster',
    label: 'Poster',
    hint: 'Big blocks of flat colour, like a screen print.',
    options: { ltres: 1, qtres: 1, pathomit: 40, blurradius: 2 },
  },
];

const eq = (a, b) => a === b;

export default class AutoTracePage extends Component {
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close Auto-trace? The trace in progress will be lost.';
  }

  styles = STYLES;

  @tracked file = null;
  @tracked sourceUrl = null;
  @tracked svg = '';
  @tracked style = 'flat';
  @tracked colours = 8;
  @tracked mono = false;
  @tracked tidy = true;
  @tracked busy = false;
  @tracked error = null;
  @tracked dragging = false;
  @tracked traced = null; // { width, height } of what was actually traced

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'auto-trace', ['style', 'colours', 'mono', 'tidy']);
    registerDestructor(this, () => {
      if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl);
    });
  }

  get currentStyle() {
    return STYLES.find((s) => s.id === this.style) ?? STYLES[0];
  }

  get svgUrl() {
    return this.svg
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.svg)}`
      : null;
  }

  get outName() {
    const base = (this.file?.name ?? 'traced').replace(/\.[^.]+$/, '');
    return `${base}.svg`;
  }

  get sizes() {
    if (!this.svg || !this.file) return null;
    const after = new TextEncoder().encode(this.svg).length;
    return `${formatBytes(this.file.size)} of pixels → ${formatBytes(after)} of vector`;
  }

  setStyle = (id) => (this.style = id);
  setColours = (e) => (this.colours = Number(e.target.value));
  toggleMono = () => (this.mono = !this.mono);
  toggleTidy = () => (this.tidy = !this.tidy);

  load(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl);
    this.file = file;
    this.sourceUrl = URL.createObjectURL(file);
    this.svg = '';
    this.error = null;
    this.traced = null;
  }

  selectFile = (e) => {
    this.load(e.target.files[0]);
    e.target.value = '';
  };

  dragOver = (e) => {
    e.preventDefault();
    this.dragging = e.type === 'dragover';
  };

  drop = (e) => {
    e.preventDefault();
    this.dragging = false;
    this.load(e.dataTransfer.files[0]);
  };

  pasteFiles = (files) => this.load(files[0]);

  clear = () => {
    if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl);
    this.file = null;
    this.sourceUrl = null;
    this.svg = '';
    this.error = null;
    this.traced = null;
  };

  run = async () => {
    if (!this.file) return;
    this.busy = true;
    this.error = null;
    try {
      const imageData = await this.pixels();
      const { default: ImageTracer } = await import('imagetracerjs');
      const options = {
        ...this.currentStyle.options,
        // Fewer colours means fewer layers, which is most of what makes a
        // traced file big. Black and white is the two-colour case, and gets
        // the library's own greyscale palette so the threshold lands sensibly.
        numberofcolors: this.mono ? 2 : this.colours,
        colorsampling: this.mono ? 0 : 2,
        ...(this.mono ? { colorquantcycles: 1 } : {}),
        // We size the canvas ourselves, so the tracer shouldn't scale again.
        scale: 1,
        viewbox: true,
        desc: false,
      };
      // The tracer is synchronous and not quick; yielding first lets the
      // "Tracing…" label actually paint before the thread locks up.
      await new Promise((resolve) => setTimeout(resolve, 0));
      let svg = ImageTracer.imagedataToSVG(imageData, options);
      if (this.tidy) {
        const optimised = optimizeSvg(svg, { precision: 1, removeIds: true });
        if (!optimised.error) svg = optimised.svg;
      }
      this.svg = svg;
      this.traced = { width: imageData.width, height: imageData.height };
    } catch (error) {
      this.error = error.message || 'Could not trace this image.';
    } finally {
      this.busy = false;
    }
  };

  // The image as pixels, scaled down if it's big enough to make tracing crawl.
  async pixels() {
    const bitmap = await createImageBitmap(this.file);
    try {
      const scale = Math.min(
        1,
        MAX_SIDE / Math.max(bitmap.width, bitmap.height),
      );
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // A transparent PNG traced straight would give every edge a dark fringe
      // from the invisible black behind it; white underneath is what you see
      // when you look at the picture, so that's what gets traced.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      return ctx.getImageData(0, 0, width, height);
    } finally {
      bitmap.close?.();
    }
  }

  <template>
    <ToolPage
      @route="auto-trace"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Turn a photo, a logo or a scribble into an SVG you can scale to any size without it going blurry. It traces the shapes it finds and hands you the vector."
    >
      <div class="fs" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="pen-tool" @size={{22}} />
            <span>{{if
                this.file
                this.file.name
                "Drop a picture, or click to browse"
              }}</span>
            <input
              type="file"
              accept="image/*"
              class="sr-only"
              {{on "change" this.selectFile}}
            />
          </label>

          <div class="math-tabs" role="group" aria-label="Tracing style">
            {{#each this.styles as |s|}}
              <button
                type="button"
                class="qr-tab {{if (eq this.style s.id) 'active'}}"
                {{on "click" (fn this.setStyle s.id)}}
              >{{s.label}}</button>
            {{/each}}
          </div>
          <p class="tool-hint">{{this.currentStyle.hint}}</p>

          {{#unless this.mono}}
            <div class="slider-row slider-row-wide">
              <label for="trace-colours">Colours</label>
              <input
                id="trace-colours"
                type="range"
                min="2"
                max="32"
                value={{this.colours}}
                {{on "input" this.setColours}}
              />
              <span class="slider-num">{{this.colours}}</span>
            </div>
          {{/unless}}

          <div class="settings-actions">
            <label class="math-check"><input
                type="checkbox"
                checked={{this.mono}}
                {{on "change" this.toggleMono}}
              />
              Black and white</label>
            <label class="math-check"><input
                type="checkbox"
                checked={{this.tidy}}
                {{on "change" this.toggleTidy}}
              />
              Tidy the result</label>
          </div>

          <div class="settings-actions">
            <button
              type="button"
              class="btn active"
              disabled={{this.busy}}
              {{on "click" this.run}}
            >{{if this.busy "Tracing…" "Trace it"}}</button>
            <button
              type="button"
              class="btn"
              disabled={{this.busy}}
              {{on "click" this.clear}}
            >Clear</button>
            {{#if this.sizes}}<span
                class="tool-hint"
              >{{this.sizes}}</span>{{/if}}
          </div>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
          <p class="tool-hint">Every colour becomes its own layer of shapes, so
            more colours means a bigger, slower file: eight is plenty for a logo
            and about as far as a photo is worth taking. Big pictures are scaled
            to
            {{MAX_SIDE}}px first, because tracing happens right here in the page
            and would otherwise lock it up.</p>
        </div>

        {{#if this.sourceUrl}}
          <div class="fs-frame fc-panel pop-in">
            <div class="trace-previews">
              <figure>
                <img src={{this.sourceUrl}} alt="Before tracing" />
                <figcaption>Pixels</figcaption>
              </figure>
              {{#if this.svgUrl}}
                <figure>
                  <img src={{this.svgUrl}} alt="After tracing" />
                  <figcaption>Vector{{#if this.traced}}
                      ·
                      {{this.traced.width}}×{{this.traced.height}}{{/if}}</figcaption>
                </figure>
              {{/if}}
            </div>
            {{#if this.svg}}
              <div class="field-head">
                <span class="qr-label is-muted">SVG</span>
                <div class="settings-actions">
                  <CopyButton @value={{this.svg}} />
                  <a
                    class="btn fs-save"
                    href={{this.svgUrl}}
                    download={{this.outName}}
                  ><Icon @name="download" @size={{13}} /> Save SVG</a>
                </div>
              </div>
              <textarea
                class="textarea text-area-tall is-mono"
                readonly
                spellcheck="false"
                aria-label="Traced SVG"
                value={{this.svg}}
              ></textarea>
            {{/if}}
          </div>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
