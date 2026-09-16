import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { CROP_PRESETS } from '../utils/social-presets';
import { acceptPastedFiles } from '../utils/paste-files';
import PrintButton from './print-button';

const GROUPS = groupByPlatform(CROP_PRESETS);
const eq = (a, b) => a === b;
const MAX_BOX = 360;
const MIN_BOX = 160;

function groupByPlatform(list) {
  const map = new Map();
  for (const p of list) {
    if (!map.has(p.platform)) map.set(p.platform, []);
    map.get(p.platform).push(p);
  }
  return [...map].map(([platform, items]) => ({ platform, items }));
}

export default class ImageCropperPage extends Component {
  groups = GROUPS;

  @tracked bitmap = null;
  @tracked imageUrl = null;
  @tracked fileName = 'image';
  @tracked presetId = 'ig-square';
  @tracked customW = 1200;
  @tracked customH = 800;
  @tracked zoom = 1;
  @tracked offsetX = 0;
  @tracked offsetY = 0;
  @tracked resultUrl = null;
  @tracked error = null;
  @tracked dragging = false;

  dragStart = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => {
      if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
      if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    });
  }

  get preset() {
    return CROP_PRESETS.find((p) => p.id === this.presetId);
  }

  get targetW() {
    return this.preset.free ? Math.max(1, this.customW) : this.preset.w;
  }

  get targetH() {
    return this.preset.free ? Math.max(1, this.customH) : this.preset.h;
  }

  // The on-screen viewport size, worked out from the target ratio rather than
  // measured from the DOM, so the crop math never has to wait on layout.
  get viewportSize() {
    const ratio = this.targetW / this.targetH;
    let vw, vh;
    if (ratio >= 1) {
      vw = MAX_BOX;
      vh = Math.max(MIN_BOX, MAX_BOX / ratio);
    } else {
      vh = MAX_BOX;
      vw = Math.max(MIN_BOX, MAX_BOX * ratio);
    }
    return { vw, vh };
  }

  get viewportStyle() {
    const { vw, vh } = this.viewportSize;
    return htmlSafe(`width:${vw}px;height:${vh}px`);
  }

  get imageStyle() {
    if (!this.bitmap) return htmlSafe('');
    const { imgW, imgH, left, top } = this.layout();
    return htmlSafe(`width:${imgW}px;height:${imgH}px;transform:translate(${left}px,${top}px)`);
  }

  // Cover-fit geometry: the image always fills the viewport, panned and
  // zoomed within it. Returns pixel values in viewport space.
  layout() {
    const { vw, vh } = this.viewportSize;
    const baseScale = Math.max(vw / this.bitmap.width, vh / this.bitmap.height);
    const scale = baseScale * this.zoom;
    const imgW = this.bitmap.width * scale;
    const imgH = this.bitmap.height * scale;
    const maxOffsetX = Math.max(0, (imgW - vw) / 2);
    const maxOffsetY = Math.max(0, (imgH - vh) / 2);
    const offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, this.offsetX));
    const offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, this.offsetY));
    const left = (vw - imgW) / 2 + offsetX;
    const top = (vh - imgH) / 2 + offsetY;
    return { vw, vh, scale, imgW, imgH, left, top, maxOffsetX, maxOffsetY, offsetX, offsetY };
  }

  clampOffsets() {
    if (!this.bitmap) return;
    const { offsetX, offsetY } = this.layout();
    this.offsetX = offsetX;
    this.offsetY = offsetY;
  }

  openFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const bitmap = await createImageBitmap(file);
      if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
      if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      this.imageUrl = URL.createObjectURL(file);
      this.fileName = file.name.replace(/\.[^.]+$/, '');
      this.bitmap = bitmap;
      this.resultUrl = null;
      this.error = null;
      this.zoom = 1;
      this.offsetX = 0;
      this.offsetY = 0;
    } catch {
      this.error = "This browser can't open that image. Try the File Converter first.";
    }
  };

  selectFile = (e) => {
    this.openFile(e.target.files?.[0]);
    e.target.value = '';
  };

  dragOverFile = (e) => e.preventDefault();
  dropFile = (e) => {
    e.preventDefault();
    this.openFile(e.dataTransfer.files?.[0]);
  };

  setPreset = (event) => {
    this.presetId = event.target.value;
    this.resultUrl = null;
    this.zoom = 1;
    this.offsetX = 0;
    this.offsetY = 0;
  };

  setCustom = (key, event) => {
    this[key] = Math.max(1, Math.floor(+event.target.value) || 1);
    this.resultUrl = null;
    this.offsetX = 0;
    this.offsetY = 0;
  };

  setZoom = (event) => {
    this.zoom = Math.max(1, Math.min(4, +event.target.value));
    this.clampOffsets();
    this.resultUrl = null;
  };

  startDrag = (e) => {
    if (!this.bitmap) return;
    e.preventDefault();
    this.dragging = true;
    this.dragStart = { x: e.clientX, y: e.clientY, offsetX: this.offsetX, offsetY: this.offsetY };
    const move = (ev) => {
      this.offsetX = this.dragStart.offsetX + (ev.clientX - this.dragStart.x);
      this.offsetY = this.dragStart.offsetY + (ev.clientY - this.dragStart.y);
      this.clampOffsets();
      this.resultUrl = null;
    };
    const stop = () => {
      this.dragging = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  crop = () => {
    if (!this.bitmap) return;
    const { vw, vh, scale, left, top } = this.layout();
    const srcX = -left / scale;
    const srcY = -top / scale;
    const srcW = vw / scale;
    const srcH = vh / scale;

    const canvas = document.createElement('canvas');
    canvas.width = this.targetW;
    canvas.height = this.targetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.bitmap, srcX, srcY, srcW, srcH, 0, 0, this.targetW, this.targetH);
    canvas.toBlob((blob) => {
      if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
      this.resultUrl = URL.createObjectURL(blob);
    }, 'image/png');
  };

  pasteFiles = (files) => this.openFile(files[0]);

  <template>
    <ToolPage @route="image-cropper" @subtitle="Drag, zoom and crop to an exact size, with presets for socials and a live preview so nothing gets cut off.">
      <div class="math-grid pop-in" {{acceptPastedFiles this.pasteFiles}}>
        <section class="math-card">
          <label class="qr-drop {{if this.bitmap 'is-filled'}}" {{on "dragover" this.dragOverFile}} {{on "drop" this.dropFile}}>
            {{#unless this.bitmap}}
              <Icon @name="crop" @size={{22}} />
              <span>Drop an image, or click to browse</span>
            {{/unless}}
            <input type="file" accept="image/*" class="sr-only" {{on "change" this.selectFile}} />
          </label>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}

          <label class="math-field">
            <span class="qr-label is-muted">Preset</span>
            <select class="select" {{on "change" this.setPreset}}>
              {{#each this.groups as |group|}}
                <optgroup label={{group.platform}}>
                  {{#each group.items as |p|}}
                    <option value={{p.id}} selected={{eq p.id this.presetId}}>{{p.label}}{{#unless p.free}} ({{p.w}}×{{p.h}}){{/unless}}</option>
                  {{/each}}
                </optgroup>
              {{/each}}
            </select>
          </label>

          {{#if this.preset.free}}
            <div class="math-row">
              <label class="math-field"><span class="qr-label is-muted">Width (px)</span><input type="number" min="1" class="math-input" value={{this.customW}} {{on "input" (fn this.setCustom "customW")}} /></label>
              <label class="math-field"><span class="qr-label is-muted">Height (px)</span><input type="number" min="1" class="math-input" value={{this.customH}} {{on "input" (fn this.setCustom "customH")}} /></label>
            </div>
          {{/if}}

          {{#if this.bitmap}}
            <label class="math-field">
              <span class="qr-label is-muted">Zoom</span>
              <input type="range" min="1" max="4" step="0.01" value={{this.zoom}} {{on "input" this.setZoom}} />
            </label>
          {{/if}}
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Preview</h3>
          {{#if this.bitmap}}
            <div
              class="crop-viewport {{if this.dragging 'is-dragging'}}"
              style={{this.viewportStyle}}
              {{on "pointerdown" this.startDrag}}
            >
              <img src={{this.imageUrl}} alt="" class="crop-image" style={{this.imageStyle}} draggable="false" />
            </div>
            <p class="tool-hint">Drag to reposition, and use the zoom slider to get in closer.</p>
            <div class="settings-actions">
              <button type="button" class="btn active" {{on "click" this.crop}}>Crop</button>
              {{#if this.resultUrl}}<a class="btn fs-save" href={{this.resultUrl}} download="{{this.fileName}}-{{this.targetW}}x{{this.targetH}}.png"><Icon @name="download" @size={{13}} /> Save</a><PrintButton @url={{this.resultUrl}} @name="{{this.fileName}}.png" />{{/if}}
            </div>
          {{else}}
            <p class="tool-hint">Upload an image to start cropping.</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
