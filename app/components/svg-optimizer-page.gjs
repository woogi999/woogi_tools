import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { formatBytes } from '../utils/file-share';
import { acceptPastedFiles } from '../utils/paste-files';
import { keepState } from '../utils/tool-state';
import { optimizeSvg, DEFAULT_OPTIONS } from '../utils/svg-optimize';

const dataUrl = (svg) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// The switches, in the order they're worth thinking about. The two that can
// change how a file behaves out in a page are last and start off.
const SWITCHES = [
  {
    key: 'removeComments',
    label: 'Comments',
    hint: 'The editor’s header block and any notes left in the file.',
  },
  {
    key: 'removeMetadata',
    label: 'Metadata',
    hint: 'The <metadata> block, and the layer names buried on shapes.',
  },
  {
    key: 'removeEditorData',
    label: 'Editor leftovers',
    hint: 'Inkscape, Figma and Illustrator’s own private attributes.',
  },
  {
    key: 'roundNumbers',
    label: 'Round the numbers',
    hint: 'Ten decimal places on a coordinate nobody can see.',
  },
  {
    key: 'removeDefaults',
    label: 'Default attributes',
    hint: 'stroke-width="1" and friends, which do nothing at all.',
  },
  {
    key: 'shortenColours',
    label: 'Shorten colours',
    hint: '#ffffff becomes #fff, rgb(255,0,0) becomes #f00.',
  },
  {
    key: 'collapseGroups',
    label: 'Collapse groups',
    hint: 'A <g> wrapping a <g> wrapping a single shape.',
  },
  {
    key: 'removeEmpty',
    label: 'Empty elements',
    hint: 'Containers with nothing left inside them.',
  },
  {
    key: 'removeIds',
    label: 'Unused IDs',
    hint: 'Only ones nothing points at. Off by default: your own CSS might.',
  },
  {
    key: 'removeDimensions',
    label: 'width and height',
    hint: 'Leaves the viewBox, so it scales to its container. Changes how it lays out.',
  },
];

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: a drawing program, version 9000 -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd" version="1.1" width="120.00000" height="120.00000" viewBox="0 0 120 120">
  <metadata>a great deal of RDF nobody reads</metadata>
  <g id="layer1" sodipodi:insensitive="true">
    <g>
      <circle cx="60.0000000" cy="60.0000000" r="50.0000000" fill="rgb(255, 221, 51)" stroke="#000000" stroke-width="1" stroke-opacity="1" fill-opacity="1"/>
    </g>
  </g>
</svg>`;

export default class SvgOptimizerPage extends Component {
  @tracked source = '';
  @tracked options = { ...DEFAULT_OPTIONS };
  @tracked fileName = 'optimised.svg';
  @tracked dragging = false;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'svg-optimizer', ['source', 'options', 'fileName']);
  }

  get switchRows() {
    return SWITCHES.map((s) => ({ ...s, on: this.options[s.key] }));
  }

  get result() {
    if (!this.source.trim())
      return { svg: '', before: 0, after: 0, error: null, empty: true };
    return optimizeSvg(this.source, this.options);
  }

  get saved() {
    const { before, after } = this.result;
    if (!before || !after) return null;
    const pct = Math.round((1 - after / before) * 100);
    return `${formatBytes(before)} → ${formatBytes(after)} (${
      pct >= 0 ? `${pct}% smaller` : `${-pct}% bigger`
    })`;
  }

  // Both previews go through <img src>, which sandboxes the drawing: a file
  // carrying its own <style> or a script can't reach the page around it. Data
  // URLs rather than blobs, so there is nothing to revoke and no bookkeeping
  // to get wrong when you type another character.
  get previews() {
    const { svg, error, empty } = this.result;
    if (empty || error) return null;
    return { before: dataUrl(this.source), after: dataUrl(svg) };
  }

  get downloadUrl() {
    const { svg, empty, error } = this.result;
    return empty || error ? null : dataUrl(svg);
  }

  setSource = (e) => (this.source = e.target.value);

  toggle = (key) => {
    this.options = { ...this.options, [key]: !this.options[key] };
  };

  setPrecision = (e) => {
    this.options = { ...this.options, precision: Number(e.target.value) };
  };

  loadSample = () => {
    this.source = SAMPLE;
    this.fileName = 'sample.svg';
  };

  clear = () => {
    this.source = '';
  };

  async readFile(file) {
    if (!file) return;
    this.fileName = file.name.replace(/\.svg$/i, '') + '.min.svg';
    this.source = await file.text();
  }

  selectFile = (e) => {
    this.readFile(e.target.files[0]);
    e.target.value = '';
  };

  dragOver = (e) => {
    e.preventDefault();
    this.dragging = e.type === 'dragover';
  };

  drop = (e) => {
    e.preventDefault();
    this.dragging = false;
    this.readFile(e.dataTransfer.files[0]);
  };

  pasteFiles = (files) => this.readFile(files[0]);

  <template>
    <ToolPage
      @route="svg-optimizer"
      @subtitle="Icons and logos come out of a drawing program carrying a load of things no browser looks at. This takes them out, shows you both versions side by side, and hands the small one back."
    >
      <div class="svgo" {{acceptPastedFiles this.pasteFiles}}>
        <div class="fs-frame fc-panel pop-in">
          <label
            class="qr-drop fs-drop {{if this.dragging 'is-dragging'}}"
            {{on "dragover" this.dragOver}}
            {{on "dragleave" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="vector-square" @size={{22}} />
            <span>Drop an SVG, click to browse, or just paste the markup below</span>
            <input
              type="file"
              accept=".svg,image/svg+xml"
              class="sr-only"
              {{on "change" this.selectFile}}
            />
          </label>

          <div class="settings-actions">
            <button type="button" class="btn" {{on "click" this.loadSample}}>Try
              an example</button>
            <button
              type="button"
              class="btn"
              {{on "click" this.clear}}
            >Clear</button>
            {{#if this.saved}}<span
                class="tool-hint"
              >{{this.saved}}</span>{{/if}}
          </div>
        </div>

        <div class="math-grid">
          <section class="math-card">
            <h3 class="qr-heading">What to take out</h3>
            <ul class="svgo-switches">
              {{#each this.switchRows key="key" as |s|}}
                <li>
                  <label class="math-check">
                    <input
                      type="checkbox"
                      checked={{s.on}}
                      {{on "change" (fn this.toggle s.key)}}
                    />
                    <span><strong>{{s.label}}</strong><span
                        class="tool-hint"
                      >{{s.hint}}</span></span>
                  </label>
                </li>
              {{/each}}
            </ul>
            <div class="slider-row slider-row-wide">
              <label for="svgo-precision">Decimal places</label>
              <input
                id="svgo-precision"
                type="range"
                min="0"
                max="5"
                value={{this.options.precision}}
                {{on "input" this.setPrecision}}
              />
              <span class="slider-num">{{this.options.precision}}</span>
            </div>
            <p class="tool-hint">Two decimal places is invisible at any size a
              logo is used at. Zero is fine for a square icon drawn on a grid,
              and will wobble a curve that wasn't.</p>
          </section>

          <section class="math-card">
            <h3 class="qr-heading">Before and after</h3>
            {{#if this.previews}}
              <div class="svgo-previews">
                <figure><img
                    src={{this.previews.before}}
                    alt="The original drawing"
                  /><figcaption>Original</figcaption></figure>
                <figure><img
                    src={{this.previews.after}}
                    alt="The optimised drawing"
                  /><figcaption>Optimised</figcaption></figure>
              </div>
              <p class="tool-hint">If these two don't look identical, something
                in the list on the left went too far. Turn the last switches off
                first: they're the ones that can change how a file behaves.</p>
            {{else}}
              <p class="tool-hint">Drop an SVG in and both versions appear here.</p>
            {{/if}}
          </section>
        </div>

        <section class="math-card pop-in">
          <div class="field-head">
            <span class="qr-label is-muted">Markup</span>
            <div class="settings-actions">
              <CopyButton @value={{this.result.svg}} />
              {{#if this.downloadUrl}}
                <a
                  class="btn fs-save"
                  href={{this.downloadUrl}}
                  download={{this.fileName}}
                ><Icon @name="download" @size={{13}} /> Save</a>
              {{/if}}
            </div>
          </div>
          {{#if this.result.error}}
            <p class="tool-error">{{this.result.error}}</p>
          {{/if}}
          <textarea
            class="textarea text-area-tall is-mono"
            spellcheck="false"
            aria-label="SVG markup"
            placeholder="Paste your SVG here"
            value={{this.source}}
            {{on "input" this.setSource}}
          ></textarea>
          {{#if this.result.svg}}
            <span class="qr-label is-muted">Result</span>
            <textarea
              class="textarea text-area-tall is-mono"
              readonly
              spellcheck="false"
              aria-label="Optimised SVG"
              value={{this.result.svg}}
            ></textarea>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
