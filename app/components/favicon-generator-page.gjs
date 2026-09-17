import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { buildIco } from '../utils/ico';
import { acceptPastedFiles } from '../utils/paste-files';

const PNG_SIZES = [16, 32, 48, 180, 192, 512];
const ICO_SIZES = [16, 32, 48];

const SNIPPET = `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/android-chrome-512x512.png">`;

async function toPng(bitmap, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // Fit the source image into a centred square without stretching it.
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  return { size, bytes: new Uint8Array(await blob.arrayBuffer()), blob };
}

export default class FaviconGeneratorPage extends Component {
  // While this is true, leaving the page floats the tool in a PiP window
  // instead of tearing it down, so the work carries on (see services/pip.js).
  get pipBusy() {
    return this.busy;
  }

  get pipWarning() {
    return 'Close the Favicon Generator? The icons being built will be lost.';
  }
  snippet = SNIPPET;

  @tracked imageUrl = null;
  @tracked pngs = [];
  @tracked icoUrl = null;
  @tracked zipUrl = null;
  @tracked busy = false;
  @tracked error = null;

  get firstPngUrl() {
    return this.pngs[0]?.url ?? '';
  }

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.revokeAll());
  }

  revokeAll() {
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    if (this.icoUrl) URL.revokeObjectURL(this.icoUrl);
    if (this.zipUrl) URL.revokeObjectURL(this.zipUrl);
    for (const p of this.pngs) URL.revokeObjectURL(p.url);
  }

  openFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    this.busy = true;
    this.error = null;
    try {
      const bitmap = await createImageBitmap(file);
      this.revokeAll();
      this.imageUrl = URL.createObjectURL(file);

      const pngs = await Promise.all(
        PNG_SIZES.map((size) => toPng(bitmap, size)),
      );
      this.pngs = pngs.map((p) => ({
        ...p,
        url: URL.createObjectURL(p.blob),
        name: nameFor(p.size),
      }));

      const icoSources = pngs.filter((p) => ICO_SIZES.includes(p.size));
      const icoBlob = buildIco(
        icoSources.map((p) => ({
          width: p.size,
          height: p.size,
          bytes: p.bytes,
        })),
      );
      const icoBytes = new Uint8Array(await icoBlob.arrayBuffer());
      this.icoUrl = URL.createObjectURL(icoBlob);

      const { zipSync } = await import('fflate');
      const entries = { 'favicon.ico': icoBytes };
      for (const p of this.pngs) entries[p.name] = p.bytes;
      this.zipUrl = URL.createObjectURL(
        new Blob([zipSync(entries, { level: 6 })], { type: 'application/zip' }),
      );
    } catch {
      this.error = "This browser can't open that image.";
    } finally {
      this.busy = false;
    }
  };

  selectFile = (e) => {
    this.openFile(e.target.files?.[0]);
    e.target.value = '';
  };

  dragOver = (e) => e.preventDefault();
  drop = (e) => {
    e.preventDefault();
    this.openFile(e.dataTransfer.files?.[0]);
  };

  pasteFiles = (files) => this.openFile(files[0]);

  <template>
    <ToolPage
      @route="favicon-generator"
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
      @subtitle="Drop in an image and get every favicon size a website needs, the .ico file and the HTML to link them."
    >
      <div class="math-grid pop-in" {{acceptPastedFiles this.pasteFiles}}>
        <section class="math-card">
          <label
            class="qr-drop"
            {{on "dragover" this.dragOver}}
            {{on "drop" this.drop}}
          >
            <Icon @name="app-window" @size={{22}} />
            <span>{{if
                this.busy
                "Working…"
                "Drop an image, or click to browse"
              }}</span>
            <input
              type="file"
              accept="image/*"
              class="sr-only"
              {{on "change" this.selectFile}}
              disabled={{this.busy}}
            />
          </label>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
          <p class="tool-hint">A square image works best. Smaller sizes are
            cropped to fit without stretching.</p>
        </section>

        {{#if this.pngs.length}}
          <section class="math-card">
            <div class="field-head">
              <h3 class="qr-heading">Generated files</h3>
              {{#if this.zipUrl}}<a
                  class="btn active"
                  href={{this.zipUrl}}
                  download="favicons.zip"
                ><Icon @name="download" @size={{13}} />
                  Download all (ZIP)</a>{{/if}}
            </div>
            <ul class="fs-list">
              {{#each this.pngs key="name" as |p|}}
                <li class="fs-row">
                  <img src={{p.url}} alt="" class="favicon-thumb" />
                  <div class="fs-row-info"><span
                      class="fs-row-name"
                    >{{p.name}}</span></div>
                  <a
                    class="btn fs-save"
                    href={{p.url}}
                    download={{p.name}}
                  ><Icon @name="download" @size={{13}} /></a>
                </li>
              {{/each}}
              {{#if this.icoUrl}}
                <li class="fs-row">
                  <img src={{this.firstPngUrl}} alt="" class="favicon-thumb" />
                  <div class="fs-row-info"><span
                      class="fs-row-name"
                    >favicon.ico</span></div>
                  <a
                    class="btn fs-save"
                    href={{this.icoUrl}}
                    download="favicon.ico"
                  ><Icon @name="download" @size={{13}} /></a>
                </li>
              {{/if}}
            </ul>
          </section>

          <section class="math-card">
            <div class="field-head">
              <h3 class="qr-heading">HTML to add</h3>
              <CopyButton @value={{this.snippet}} />
            </div>
            <pre class="code-block">{{this.snippet}}</pre>
          </section>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}

function nameFor(size) {
  if (size === 16) return 'favicon-16x16.png';
  if (size === 32) return 'favicon-32x32.png';
  if (size === 180) return 'apple-touch-icon.png';
  if (size === 192) return 'android-chrome-192x192.png';
  if (size === 512) return 'android-chrome-512x512.png';
  return `favicon-${size}x${size}.png`;
}
