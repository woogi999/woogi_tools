import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { acceptPastedFiles } from '../utils/paste-files';

const eq = (a, b) => a === b;

// ZXing is a fair size, so it's fetched the first time something is scanned.
let zxing = null;
const loadZxing = () =>
  (zxing ??= Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]).then(([browser, library]) => {
    const hints = new Map();
    hints.set(library.DecodeHintType.TRY_HARDER, true);
    return {
      reader: new browser.BrowserMultiFormatReader(hints),
      formatName: (format) => library.BarcodeFormat[format] ?? 'Code',
    };
  }));

const looksLikeUrl = (text) => /^(https?:\/\/|www\.)\S+$/i.test(text);
const prettyFormat = (name) =>
  name
    .replace(/_/g, ' ')
    .replace(/\bQR CODE\b/, 'QR code')
    .replace(/\bEAN\b/, 'EAN')
    .replace(/\bUPC\b/, 'UPC');

export default class CodeScannerPage extends Component {
  @tracked mode = 'camera'; // 'camera' | 'image'
  @tracked scanning = false;
  @tracked cameras = [];
  @tracked cameraId = '';
  @tracked error = null;
  @tracked results = []; // newest first: { id, text, format, at }
  @tracked imageUrl = null;
  @tracked busy = false;

  controls = null;
  video = null;
  lastText = null;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => {
      this.stop();
      if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    });
  }

  get latest() {
    return this.results[0] ?? null;
  }

  bindVideo = modifier((video) => {
    this.video = video;
    return () => {
      this.stop();
      this.video = null;
    };
  });

  setMode = (mode) => {
    if (mode === this.mode) return;
    this.stop();
    this.mode = mode;
    this.error = null;
  };

  start = async () => {
    this.error = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error = 'This browser cannot open a camera.';
      return;
    }
    try {
      const { reader } = await loadZxing();
      this.controls = await reader.decodeFromVideoDevice(
        this.cameraId || undefined,
        this.video,
        (result) => {
          if (result) this.found(result.getText(), result.getBarcodeFormat());
        },
      );
      this.scanning = true;
      // Names only come once a camera has been allowed.
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.cameras = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({
          id: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }));
    } catch (err) {
      this.error =
        err?.name === 'NotAllowedError'
          ? 'The camera was not allowed. Check the site permission.'
          : 'The camera could not be started.';
      this.scanning = false;
    }
  };

  stop = () => {
    this.controls?.stop();
    this.controls = null;
    this.scanning = false;
  };

  setCamera = (event) => {
    this.cameraId = event.target.value;
    if (this.scanning) {
      this.stop();
      this.start();
    }
  };

  async found(text, format) {
    // A camera sees the same code many times a second; keep it once.
    if (text === this.lastText) return;
    this.lastText = text;
    const { formatName } = await loadZxing();
    this.results = [
      {
        id: Date.now(),
        text,
        format: prettyFormat(formatName(format)),
        url: looksLikeUrl(text)
          ? text.startsWith('www.')
            ? `https://${text}`
            : text
          : null,
        at: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      },
      ...this.results,
    ].slice(0, 30);
    if (navigator.vibrate) navigator.vibrate(60);
  }

  openFile = async (file) => {
    if (!file?.type.startsWith('image/')) return;
    this.error = null;
    this.busy = true;
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = URL.createObjectURL(file);
    try {
      const { reader } = await loadZxing();
      const result = await reader.decodeFromImageUrl(this.imageUrl);
      this.lastText = null;
      await this.found(result.getText(), result.getBarcodeFormat());
    } catch {
      this.error =
        'No code found in that picture. A sharper, straighter shot helps.';
    } finally {
      this.busy = false;
    }
  };

  selectFile = (e) => {
    this.openFile(e.target.files?.[0]);
    e.target.value = '';
  };

  dragOverFile = (e) => e.preventDefault();
  dropFile = (e) => {
    e.preventDefault();
    this.setMode('image');
    this.openFile(e.dataTransfer.files?.[0]);
  };
  pasteFiles = (files) => {
    this.setMode('image');
    this.openFile(files[0]);
  };

  clear = () => {
    this.results = [];
    this.lastText = null;
  };

  <template>
    <ToolPage
      @route="code-scanner"
      @subtitle="Read a QR code or barcode with your camera, or from a picture, and get what's inside."
      @busy={{this.scanning}}
      @closeWarning="the camera"
    >
      <div class="math-grid pop-in" {{acceptPastedFiles this.pasteFiles}}>
        <section class="math-card">
          <div class="math-tabs" role="group" aria-label="Source">
            <button
              type="button"
              class="qr-tab {{if (eq this.mode 'camera') 'active'}}"
              {{on "click" (fn this.setMode "camera")}}
            >Camera</button>
            <button
              type="button"
              class="qr-tab {{if (eq this.mode 'image') 'active'}}"
              {{on "click" (fn this.setMode "image")}}
            >Picture</button>
          </div>

          {{#if (eq this.mode "camera")}}
            <div class="scan-stage">
              {{! template-lint-disable require-media-caption }}
              <video
                class="scan-video"
                playsinline
                muted
                {{this.bindVideo}}
              ></video>
              {{#if this.scanning}}<div
                  class="scan-frame"
                  aria-hidden="true"
                ></div>{{/if}}
            </div>
            <div class="settings-actions">
              {{#if this.scanning}}
                <button type="button" class="btn" {{on "click" this.stop}}>
                  <Icon @name="circle-stop" @size={{13}} />
                  Stop</button>
              {{else}}
                <button
                  type="button"
                  class="btn active"
                  {{on "click" this.start}}
                >
                  <Icon @name="camera" @size={{13}} />
                  Start camera</button>
              {{/if}}
              {{#if this.cameras.length}}
                <select
                  class="select"
                  aria-label="Camera"
                  {{on "change" this.setCamera}}
                >
                  {{#each this.cameras as |c|}}
                    <option
                      value={{c.id}}
                      selected={{eq c.id this.cameraId}}
                    >{{c.label}}</option>
                  {{/each}}
                </select>
              {{/if}}
            </div>
            <p class="tool-hint">Hold the code steady in the frame. The picture
              stays on your device; nothing is uploaded.</p>
          {{else}}
            <label
              class="qr-drop {{if this.imageUrl 'is-filled'}}"
              {{on "dragover" this.dragOverFile}}
              {{on "drop" this.dropFile}}
            >
              {{#if this.imageUrl}}
                <img src={{this.imageUrl}} alt="" class="scan-picture" />
              {{else}}
                <Icon @name="qr-code" @size={{22}} />
                <span>Drop a picture of a code, or click to browse</span>
              {{/if}}
              <input
                type="file"
                accept="image/*"
                class="sr-only"
                {{on "change" this.selectFile}}
              />
            </label>
            {{#if this.busy}}<p class="tool-hint">Reading…</p>{{/if}}
          {{/if}}
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
        </section>

        <section class="math-card">
          <div class="fc-toolbar">
            <h3 class="qr-heading">Found</h3>
            {{#if this.results.length}}
              <button
                type="button"
                class="btn"
                {{on "click" this.clear}}
              >Clear</button>
            {{/if}}
          </div>
          {{#if this.latest}}
            <ul class="scan-list">
              {{#each this.results key="id" as |r|}}
                <li class="scan-result">
                  <span class="scan-format">{{r.format}} · {{r.at}}</span>
                  <p class="scan-text">{{r.text}}</p>
                  <div class="settings-actions">
                    <CopyButton @value={{r.text}} />
                    {{#if r.url}}
                      <a
                        class="btn"
                        href={{r.url}}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Icon @name="link" @size={{13}} />
                        Open link</a>
                    {{/if}}
                  </div>
                </li>
              {{/each}}
            </ul>
          {{else}}
            <p class="tool-hint">QR codes, Data Matrix, Aztec, PDF417 and the
              usual barcodes (EAN, UPC, Code 128, Code 39, ITF) all read here.</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
