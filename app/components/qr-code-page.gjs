import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import QRCodeStyling from 'qr-code-styling';
import { zipSync } from 'fflate';
import ToolPage from './tool-page';
import Icon from './icon';
import ColourField from './colour-field';
import {
  wifiPayload,
  vcardPayload,
  utf8Binary,
  looksLikeUrl,
  isValidUrl,
} from '../utils/qr';
import { printFile } from '../utils/print';

const eq = (a, b) => a === b;
const not = (a) => !a;

const MODES = [
  { id: 'single', label: 'Single' },
  { id: 'wifi', label: 'WiFi QR' },
  { id: 'vcard', label: 'vCard Builder' },
  { id: 'batch', label: 'Batch Mode' },
];

const PRESETS = [
  { label: 'URL', value: 'https://example.com' },
  { label: 'Email', value: 'mailto:hello@example.com' },
  { label: 'Phone', value: 'tel:+1234567890' },
  { label: 'WiFi', value: 'WIFI:T:WPA;S:NetworkName;P:password;;' },
  { label: 'SMS', value: 'sms:+1234567890?body=Hello' },
  { label: 'Geo', value: 'geo:40.7128,-74.0060' },
];

const SECURITY_TYPES = [
  { value: 'nopass', label: 'No password' },
  { value: 'WPA', label: 'WPA/WPA2' },
  { value: 'WEP', label: 'WEP' },
];

const LEVELS = ['L', 'M', 'Q', 'H'];

const DOT_STYLES = [
  { value: 'square', label: 'Boxy' },
  { value: 'rounded', label: 'Bouba' },
  { value: 'dots', label: 'Braille' },
  { value: 'classy', label: 'Calligraph' },
  { value: 'classy-rounded', label: 'Kiki' },
  { value: 'extra-rounded', label: 'Blobby' },
];

const EYE_STYLES = [
  { value: 'square', label: 'Boxy' },
  { value: 'dot', label: 'Circular' },
  { value: 'extra-rounded', label: 'Rounded' },
];

const PUPIL_STYLES = [
  { value: 'square', label: 'Square' },
  { value: 'dot', label: 'Circle' },
];

const QUICK_STYLES = [
  {
    label: 'Classic',
    dot: 'square',
    eye: 'square',
    pupil: 'square',
    fg: '#000000',
  },
  {
    label: 'Rounded',
    dot: 'rounded',
    eye: 'extra-rounded',
    pupil: 'dot',
    fg: '#000000',
  },
  { label: 'Dots', dot: 'dots', eye: 'dot', pupil: 'dot', fg: '#000000' },
  {
    label: 'Classy',
    dot: 'classy-rounded',
    eye: 'extra-rounded',
    pupil: 'dot',
    fg: '#000000',
  },
  {
    label: 'Indigo',
    dot: 'rounded',
    eye: 'extra-rounded',
    pupil: 'dot',
    fg: '#6366F1',
  },
  {
    label: 'Rose',
    dot: 'extra-rounded',
    eye: 'extra-rounded',
    pupil: 'dot',
    fg: '#E11D48',
  },
  {
    label: 'Teal',
    dot: 'classy',
    eye: 'square',
    pupil: 'square',
    fg: '#0D9488',
  },
  {
    label: 'Amber',
    dot: 'rounded',
    eye: 'extra-rounded',
    pupil: 'dot',
    fg: '#D97706',
  },
  {
    label: 'Violet',
    dot: 'classy-rounded',
    eye: 'extra-rounded',
    pupil: 'dot',
    fg: '#7C3AED',
  },
];

const INFO_FONT = "'Moderustic', 'Segoe UI', sans-serif";

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Word-wraps the caption lines to the QR width so exports and preview agree.
function layoutInfo(texts, size) {
  const fontSize = Math.max(11, Math.round(size / 22));
  const lineHeight = Math.round(fontSize * 1.35);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `500 ${fontSize}px ${INFO_FONT}`;
  const maxWidth = size - fontSize * 2;
  const lines = [];
  for (const text of texts) {
    let line = '';
    for (const ch of text) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
    lines.push(line);
  }
  return {
    lines,
    fontSize,
    lineHeight,
    blockHeight: lines.length * lineHeight + fontSize,
  };
}

const escapeXml = (s) => s.replace(/[&<>'"]/g, (c) => `&#${c.charCodeAt(0)};`);

let nextRowId = 1;
const newRow = (text = '') => ({
  id: nextRowId++,
  text,
  status: 'pending',
  thumb: null,
});

export default class QrCodePage extends Component {
  modes = MODES;
  presets = PRESETS;
  securityTypes = SECURITY_TYPES;
  levels = LEVELS;
  dotStyles = DOT_STYLES;
  eyeStyles = EYE_STYLES;
  pupilStyles = PUPIL_STYLES;
  quickStyles = QUICK_STYLES;

  @tracked mode = 'single';
  @tracked content = 'https://example.com';
  @tracked wifi = {
    ssid: '',
    password: '',
    securityType: 'WPA',
    isHidden: false,
  };
  @tracked showPassword = false;
  @tracked vcard = {
    firstName: '',
    lastName: '',
    organization: '',
    title: '',
    email: '',
    phone: '',
    website: '',
    address: '',
  };
  @tracked rows = [newRow(), newRow()];
  @tracked batchGenerating = false;

  @tracked size = 300;
  @tracked padding = 2;
  @tracked errorCorrection = 'M';
  @tracked foreground = '#000000';
  @tracked background = '#FFFFFF';
  @tracked transparent = false;
  @tracked dotType = 'square';
  @tracked cornerSquareType = 'square';
  @tracked cornerDotType = 'square';
  @tracked logo = null;
  @tracked logoSize = 0.3;
  @tracked logoMargin = 4;
  @tracked logoDragging = false;
  @tracked showInfo = false;
  @tracked tooLong = false;
  @tracked copied = false;

  preview = new QRCodeStyling({ type: 'svg' });

  constructor(owner, args) {
    super(owner, args);
    window.addEventListener('paste', this.onPaste);
    registerDestructor(this, () =>
      window.removeEventListener('paste', this.onPaste),
    );
  }

  // ─── Payload ─────────────────────────────────────────────────────────

  get isBatch() {
    return this.mode === 'batch';
  }

  get payload() {
    if (this.mode === 'wifi') return wifiPayload(this.wifi);
    if (this.mode === 'vcard') return vcardPayload(this.vcard);
    if (this.isBatch)
      return this.rows.find((r) => r.text.trim())?.text.trim() ?? '';
    return this.content.trim();
  }

  get emptyMessage() {
    if (this.mode === 'wifi')
      return 'Enter network details to generate QR code';
    if (this.mode === 'vcard')
      return 'Fill in contact details to generate QR code';
    return 'Enter content to generate QR code';
  }

  get urlStatus() {
    if (!looksLikeUrl(this.content)) return null;
    return isValidUrl(this.content) ? 'valid' : 'invalid';
  }

  get isOpenNetwork() {
    return this.wifi.securityType === 'nopass';
  }

  get wifiNeedsPassword() {
    return !this.isOpenNetwork && this.wifi.ssid.trim() && !this.wifi.password;
  }

  get infoTexts() {
    const items =
      this.mode === 'wifi'
        ? [
            ['Network', this.wifi.ssid.trim()],
            ['Password', this.isOpenNetwork ? '' : this.wifi.password],
            ['', this.wifi.isHidden ? 'Hidden network' : ''],
          ]
        : this.mode === 'vcard'
          ? [
              ['Name', `${this.vcard.firstName} ${this.vcard.lastName}`.trim()],
              ['Organization', this.vcard.organization],
              ['Job Title', this.vcard.title],
              ['Email', this.vcard.email],
              ['Phone', this.vcard.phone],
              ['Website', this.vcard.website],
              ['Address', this.vcard.address],
            ]
          : [['Content', this.payload]];
    return items
      .filter(([, v]) => v)
      .map(([label, v]) => (label ? `${label}: ${v}` : v));
  }

  // ─── Styling ─────────────────────────────────────────────────────────

  styleOptions(data) {
    return {
      width: this.size,
      height: this.size,
      data: utf8Binary(data),
      margin: this.padding * 4,
      image: this.logo ?? '',
      qrOptions: { errorCorrectionLevel: this.errorCorrection, mode: 'Byte' },
      imageOptions: {
        crossOrigin: 'anonymous',
        imageSize: this.logoSize,
        margin: this.logoMargin,
        hideBackgroundDots: true,
      },
      dotsOptions: { type: this.dotType, color: this.foreground },
      cornersSquareOptions: {
        type: this.cornerSquareType,
        color: this.foreground,
      },
      cornersDotOptions: { type: this.cornerDotType, color: this.foreground },
      backgroundOptions: {
        color: this.transparent ? 'transparent' : this.background,
      },
    };
  }

  get options() {
    return this.payload ? this.styleOptions(this.payload) : null;
  }

  get previewStyle() {
    return htmlSafe(this.transparent ? '' : `background:${this.background};`);
  }

  get infoStyle() {
    const { fontSize, lineHeight } = layoutInfo([], this.size);
    return htmlSafe(
      `color:${this.foreground};font-size:${fontSize}px;line-height:${lineHeight}px;width:${this.size}px;`,
    );
  }

  renderPreview = modifier((element, [options]) => {
    element.replaceChildren();
    let failed = false;
    try {
      this.preview.update(options);
      this.preview.append(element);
    } catch {
      failed = true; // data exceeds QR capacity at this error-correction level
    }
    // Deferred so the flag isn't written during the render that read it.
    queueMicrotask(() => {
      if (this.tooLong !== failed) this.tooLong = failed;
    });
  });

  // ─── Export ──────────────────────────────────────────────────────────

  async pngBlob() {
    const qrBlob = await this.preview.getRawData('png');
    if (!this.showInfo || !this.infoTexts.length) return qrBlob;
    const { lines, fontSize, lineHeight, blockHeight } = layoutInfo(
      this.infoTexts,
      this.size,
    );
    const canvas = document.createElement('canvas');
    canvas.width = this.size;
    canvas.height = this.size + blockHeight;
    const ctx = canvas.getContext('2d');
    if (!this.transparent) {
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(await createImageBitmap(qrBlob), 0, 0, this.size, this.size);
    ctx.fillStyle = this.foreground;
    ctx.font = `500 ${fontSize}px ${INFO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) =>
      ctx.fillText(line, this.size / 2, this.size + i * lineHeight),
    );
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  async svgBlob() {
    const raw = await (await this.preview.getRawData('svg')).text();
    const qrSvg = raw.replace(/<\?xml[^>]*\?>/, '');
    if (!this.showInfo || !this.infoTexts.length)
      return new Blob([qrSvg], { type: 'image/svg+xml' });
    const { lines, fontSize, lineHeight, blockHeight } = layoutInfo(
      this.infoTexts,
      this.size,
    );
    const height = this.size + blockHeight;
    const bg = this.transparent
      ? ''
      : `<rect width="${this.size}" height="${height}" fill="${this.background}"/>`;
    const text = lines
      .map(
        (line, i) =>
          `<text x="${this.size / 2}" y="${this.size + i * lineHeight + fontSize}" text-anchor="middle" font-family="${escapeXml(INFO_FONT)}" font-size="${fontSize}" font-weight="500" fill="${this.foreground}">${escapeXml(line)}</text>`,
      )
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.size}" height="${height}" viewBox="0 0 ${this.size} ${height}">${bg}${qrSvg}${text}</svg>`;
    return new Blob([svg], { type: 'image/svg+xml' });
  }

  get noQr() {
    return !this.payload || this.tooLong;
  }

  downloadPng = async () => saveBlob(await this.pngBlob(), 'qr-code.png');

  downloadSvg = async () => saveBlob(await this.svgBlob(), 'qr-code.svg');

  // Straight to a printer, handy for a QR you're sticking on something.
  printQr = async () =>
    printFile(await this.pngBlob(), { name: 'qr-code.png' });

  copyPng = async () => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': this.pngBlob() }),
      ]);
      this.copied = true;
      setTimeout(() => (this.copied = false), 1500);
    } catch {
      // clipboard image writes need a secure context + permission
    }
  };

  // ─── Inputs ──────────────────────────────────────────────────────────

  setMode = (mode) => (this.mode = mode);
  setContent = (event) => (this.content = event.target.value);
  usePreset = (preset) => (this.content = preset.value);
  setWifi = (key, event) =>
    (this.wifi = {
      ...this.wifi,
      [key]:
        event.target.type === 'checkbox'
          ? event.target.checked
          : event.target.value,
    });
  togglePassword = () => (this.showPassword = !this.showPassword);
  setVcard = (key, event) =>
    (this.vcard = { ...this.vcard, [key]: event.target.value });

  setNumber = (key, event) => (this[key] = +event.target.value);
  setValue = (key, value) => (this[key] = value);
  toggle = (key) => (this[key] = !this[key]);

  applyQuickStyle = (style) => {
    this.dotType = style.dot;
    this.cornerSquareType = style.eye;
    this.cornerDotType = style.pupil;
    this.foreground = style.fg;
    this.background = '#FFFFFF';
    this.transparent = false;
  };

  // ─── Logo ────────────────────────────────────────────────────────────

  async readLogo(file) {
    if (!file?.type.startsWith('image/')) return;
    this.logo = await readAsDataUrl(file);
    if (this.errorCorrection !== 'H') this.errorCorrection = 'H'; // logo covers modules; max redundancy keeps it scannable
  }

  selectLogo = (event) => {
    this.readLogo(event.target.files?.[0]);
    event.target.value = '';
  };

  dragLogo = (event) => {
    event.preventDefault();
    this.logoDragging = event.type === 'dragover';
  };

  dropLogo = (event) => {
    event.preventDefault();
    this.logoDragging = false;
    this.readLogo(event.dataTransfer.files?.[0]);
  };

  onPaste = (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((f) =>
      f.type.startsWith('image/'),
    );
    if (!file) return;
    event.preventDefault();
    this.readLogo(file);
  };

  removeLogo = () => (this.logo = null);

  // ─── Batch ───────────────────────────────────────────────────────────

  get batchRows() {
    return this.rows.map((row, i) => ({
      ...row,
      number: i + 1,
      isDone: row.status === 'done',
      isError: row.status === 'error',
      isGenerating: row.status === 'generating',
    }));
  }

  get hasBatchContent() {
    return this.rows.some((r) => r.text.trim());
  }

  updateRow = (id, event) => {
    this.rows = this.rows.map((r) =>
      r.id === id
        ? { ...r, text: event.target.value, status: 'pending', thumb: null }
        : r,
    );
  };

  addRow = () => (this.rows = [...this.rows, newRow()]);

  removeRow = (id) => {
    this.rows = this.rows.filter((r) => r.id !== id);
    if (!this.rows.length) this.rows = [newRow()];
  };

  uploadList = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const lines = (await file.text())
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length) this.rows = lines.map((l) => newRow(l));
  };

  setRow(id, patch) {
    this.rows = this.rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
  }

  generateZip = async () => {
    this.batchGenerating = true;
    const files = {};
    let n = 0;
    for (const row of this.rows) {
      if (!row.text.trim()) continue;
      n++;
      this.setRow(row.id, { status: 'generating' });
      try {
        const blob = await new QRCodeStyling({
          ...this.styleOptions(row.text.trim()),
          type: 'canvas',
        }).getRawData('png');
        files[`qr-${n}.png`] = new Uint8Array(await blob.arrayBuffer());
        this.setRow(row.id, {
          status: 'done',
          thumb: await readAsDataUrl(blob),
        });
      } catch {
        this.setRow(row.id, { status: 'error' });
      }
    }
    if (Object.keys(files).length) {
      // PNGs are already compressed; store them as-is.
      saveBlob(
        new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }),
        `qr-codes-batch-${Date.now()}.zip`,
      );
    }
    this.batchGenerating = false;
  };

  <template>
    <ToolPage
      @route="qr-code"
      @subtitle="Make a styled QR code for a link, text, WiFi or a contact. Download it as PNG or SVG, or make a batch at once."
    >
      <div class="qr">
        <div class="qr-tabs pop-in" role="tablist" aria-label="QR type">
          {{#each this.modes as |m|}}
            <button
              type="button"
              role="tab"
              class="qr-tab {{if (eq m.id this.mode) 'active'}}"
              aria-selected={{if (eq m.id this.mode) "true" "false"}}
              {{on "click" (fn this.setMode m.id)}}
            >{{m.label}}</button>
          {{/each}}
        </div>

        <div class="qr-frame pop-in">
          <div class="qr-panel">
            {{#if (eq this.mode "single")}}
              <div class="qr-mode-panel pop-in">
                <div class="qr-field">
                  <div class="qr-field-head">
                    <label class="qr-label" for="qr-content">Content</label>
                    {{#if this.urlStatus}}
                      <span class="qr-url is-{{this.urlStatus}}">
                        <Icon
                          @name={{if
                            (eq this.urlStatus "valid")
                            "circle-check-big"
                            "circle-alert"
                          }}
                          @size={{12}}
                        />
                        {{if
                          (eq this.urlStatus "valid")
                          "Valid URL format"
                          "Invalid URL format"
                        }}
                      </span>
                    {{/if}}
                  </div>
                  <textarea
                    id="qr-content"
                    class="textarea qr-textarea"
                    placeholder="Enter URL, text, or data..."
                    value={{this.content}}
                    {{on "input" this.setContent}}
                  ></textarea>
                </div>
                <div class="qr-chips">
                  {{#each this.presets as |preset|}}
                    <button
                      type="button"
                      class="qr-chip"
                      {{on "click" (fn this.usePreset preset)}}
                    >{{preset.label}}</button>
                  {{/each}}
                </div>
              </div>
            {{else if (eq this.mode "wifi")}}
              <div class="qr-mode-panel pop-in">
                <div class="qr-field">
                  <label class="qr-label" for="qr-ssid">Network Name (SSID)</label>
                  <input
                    id="qr-ssid"
                    type="text"
                    placeholder="My WiFi Network"
                    value={{this.wifi.ssid}}
                    {{on "input" (fn this.setWifi "ssid")}}
                  />
                </div>
                <div class="qr-pair">
                  <div class="qr-field">
                    <label class="qr-label" for="qr-security">Security Type</label>
                    <select
                      id="qr-security"
                      class="select"
                      {{on "change" (fn this.setWifi "securityType")}}
                    >
                      {{#each this.securityTypes as |t|}}
                        <option
                          value={{t.value}}
                          selected={{eq t.value this.wifi.securityType}}
                        >{{t.label}}</option>
                      {{/each}}
                    </select>
                  </div>
                  <div class="qr-field">
                    <label class="qr-label" for="qr-password">Password</label>
                    <div class="qr-password">
                      <input
                        id="qr-password"
                        type={{if this.showPassword "text" "password"}}
                        class="qr-input"
                        autocomplete="off"
                        placeholder={{if
                          this.isOpenNetwork
                          "Open network"
                          "Enter WiFi password"
                        }}
                        disabled={{this.isOpenNetwork}}
                        value={{this.wifi.password}}
                        {{on "input" (fn this.setWifi "password")}}
                      />
                      <button
                        type="button"
                        class="qr-icon-btn"
                        aria-label="Show password"
                        disabled={{this.isOpenNetwork}}
                        {{on "click" this.togglePassword}}
                      >
                        <Icon
                          @name={{if this.showPassword "eye-off" "eye"}}
                          @size={{15}}
                        />
                      </button>
                    </div>
                    {{#if this.wifiNeedsPassword}}<p class="tool-hint">A
                        password is required for secured networks.</p>{{/if}}
                  </div>
                </div>
                <label class="qr-check">
                  <input
                    type="checkbox"
                    checked={{this.wifi.isHidden}}
                    {{on "change" (fn this.setWifi "isHidden")}}
                  />
                  Hidden network
                </label>
              </div>
            {{else if (eq this.mode "vcard")}}
              <div class="qr-mode-panel pop-in">
                <div class="qr-pair">
                  <VcardInput
                    @id="qr-first"
                    @label="First Name"
                    @placeholder="John"
                    @value={{this.vcard.firstName}}
                    @onInput={{fn this.setVcard "firstName"}}
                  />
                  <VcardInput
                    @id="qr-last"
                    @label="Last Name"
                    @placeholder="Doe"
                    @value={{this.vcard.lastName}}
                    @onInput={{fn this.setVcard "lastName"}}
                  />
                  <VcardInput
                    @id="qr-org"
                    @label="Organization"
                    @placeholder="Acme Inc."
                    @value={{this.vcard.organization}}
                    @onInput={{fn this.setVcard "organization"}}
                  />
                  <VcardInput
                    @id="qr-title"
                    @label="Job Title"
                    @placeholder="Software Engineer"
                    @value={{this.vcard.title}}
                    @onInput={{fn this.setVcard "title"}}
                  />
                  <VcardInput
                    @id="qr-email"
                    @label="Email"
                    @placeholder="john@example.com"
                    @value={{this.vcard.email}}
                    @onInput={{fn this.setVcard "email"}}
                  />
                  <VcardInput
                    @id="qr-phone"
                    @label="Phone"
                    @placeholder="+1 234 567 8900"
                    @value={{this.vcard.phone}}
                    @onInput={{fn this.setVcard "phone"}}
                  />
                  <VcardInput
                    @id="qr-website"
                    @label="Website"
                    @placeholder="https://example.com"
                    @value={{this.vcard.website}}
                    @onInput={{fn this.setVcard "website"}}
                  />
                  <VcardInput
                    @id="qr-address"
                    @label="Address"
                    @placeholder="123 Main St, City"
                    @value={{this.vcard.address}}
                    @onInput={{fn this.setVcard "address"}}
                  />
                </div>
                {{#if this.payload}}
                  <pre class="qr-vcard">{{this.payload}}</pre>
                {{/if}}
              </div>
            {{else}}
              <div class="qr-mode-panel pop-in">
                <ul class="qr-batch">
                  {{#each this.batchRows as |row|}}
                    <li class="qr-batch-row">
                      <span class="qr-batch-index">{{row.number}}</span>
                      <input
                        type="text"
                        placeholder="Enter content..."
                        aria-label="Batch content {{row.number}}"
                        value={{row.text}}
                        {{on "input" (fn this.updateRow row.id)}}
                      />
                      {{#if row.isDone}}
                        <img
                          class="qr-batch-thumb"
                          src={{row.thumb}}
                          alt="QR {{row.number}}"
                        />
                      {{else if row.isGenerating}}
                        <span class="qr-batch-thumb is-loading"></span>
                      {{else if row.isError}}
                        <span
                          class="qr-batch-error"
                          title="Too long for a QR code"
                        ><Icon @name="circle-alert" @size={{16}} /></span>
                      {{/if}}
                      <button
                        type="button"
                        class="qr-icon-btn"
                        aria-label="Remove item"
                        {{on "click" (fn this.removeRow row.id)}}
                      ><Icon @name="trash-2" @size={{15}} /></button>
                    </li>
                  {{/each}}
                </ul>
                <div class="qr-batch-actions">
                  <button
                    type="button"
                    class="btn"
                    {{on "click" this.addRow}}
                  ><Icon @name="plus" @size={{14}} /> Add Item</button>
                  <label class="btn">
                    <Icon @name="upload" @size={{14}} />
                    Upload List
                    <input
                      type="file"
                      accept=".txt,text/plain"
                      class="sr-only"
                      {{on "change" this.uploadList}}
                    />
                  </label>
                  <button
                    type="button"
                    class="btn active"
                    disabled={{not this.hasBatchContent}}
                    {{on "click" this.generateZip}}
                  >
                    <Icon @name="download" @size={{14}} />
                    {{if
                      this.batchGenerating
                      "Generating…"
                      "Generate & Download ZIP"
                    }}
                  </button>
                </div>
              </div>
            {{/if}}
          </div>

          <div class="qr-main">
            <div class="qr-side">
              <div class="qr-side-head">
                <h3 class="qr-heading">Preview</h3>
                {{#unless this.isBatch}}
                  <label class="qr-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={{this.showInfo}}
                      {{on "change" (fn this.toggle "showInfo")}}
                    />
                    <span class="qr-switch-track" aria-hidden="true"></span>
                    Add information
                  </label>
                {{/unless}}
              </div>

              <div
                class="qr-preview {{if this.transparent 'is-checkered'}}"
                style={{this.previewStyle}}
              >
                {{#if this.options}}
                  <div class="qr-stack">
                    <div
                      class="qr-image"
                      {{this.renderPreview this.options}}
                    ></div>
                    {{#if this.tooLong}}
                      <p class="tool-error">Too much data for a QR code. Shorten
                        it or lower error correction.</p>
                    {{else if this.showInfo}}
                      {{#unless this.isBatch}}
                        <div class="qr-info" style={{this.infoStyle}}>
                          {{#each this.infoTexts as |line|}}<p
                            >{{line}}</p>{{/each}}
                        </div>
                      {{/unless}}
                    {{/if}}
                  </div>
                {{else}}
                  <p class="qr-empty">{{this.emptyMessage}}</p>
                {{/if}}
              </div>

              <div class="qr-section">
                <span class="qr-label is-muted">Quick Styles</span>
                <div class="qr-grid-3">
                  {{#each this.quickStyles as |style|}}
                    <button
                      type="button"
                      class="qr-chip"
                      {{on "click" (fn this.applyQuickStyle style)}}
                    >{{style.label}}</button>
                  {{/each}}
                </div>
              </div>

              {{#unless this.isBatch}}
                <div class="qr-grid-3 qr-exports">
                  <button
                    type="button"
                    class="qr-export is-primary"
                    disabled={{this.noQr}}
                    {{on "click" this.downloadPng}}
                  ><Icon @name="download" @size={{16}} /> PNG</button>
                  <button
                    type="button"
                    class="qr-export"
                    disabled={{this.noQr}}
                    {{on "click" this.downloadSvg}}
                  ><Icon @name="download" @size={{16}} /> SVG</button>
                  <button
                    type="button"
                    class="qr-export"
                    disabled={{this.noQr}}
                    {{on "click" this.printQr}}
                  ><Icon @name="printer" @size={{16}} /> Print</button>
                  <button
                    type="button"
                    class="qr-export"
                    disabled={{this.noQr}}
                    {{on "click" this.copyPng}}
                  >
                    <Icon
                      @name={{if this.copied "check" "copy"}}
                      @size={{16}}
                    />
                    {{if this.copied "Copied!" "Copy"}}
                  </button>
                </div>
              {{/unless}}
            </div>

            <div class="qr-side">
              <h3 class="qr-heading">Options</h3>

              <details class="qr-group" open>
                <summary>Basics</summary>
                <div class="qr-group-body">
                  <div class="qr-field">
                    <div class="qr-field-head"><label
                        class="qr-label"
                        for="qr-size"
                      >Size</label><span
                        class="slider-num"
                      >{{this.size}}px</span></div>
                    <input
                      id="qr-size"
                      type="range"
                      min="100"
                      max="600"
                      step="10"
                      value={{this.size}}
                      {{on "input" (fn this.setNumber "size")}}
                    />
                  </div>
                  <div class="qr-field">
                    <div class="qr-field-head"><label
                        class="qr-label"
                        for="qr-padding"
                      >Padding</label><span
                        class="slider-num"
                      >{{this.padding}}</span></div>
                    <input
                      id="qr-padding"
                      type="range"
                      min="0"
                      max="10"
                      value={{this.padding}}
                      {{on "input" (fn this.setNumber "padding")}}
                    />
                  </div>
                  <div class="qr-field">
                    <span class="qr-label">Error Correction</span>
                    <div class="qr-segmented qr-grid-4">
                      {{#each this.levels as |level|}}
                        <button
                          type="button"
                          class="qr-chip
                            {{if (eq level this.errorCorrection) 'active'}}"
                          {{on
                            "click"
                            (fn this.setValue "errorCorrection" level)
                          }}
                        >{{level}}</button>
                      {{/each}}
                    </div>
                  </div>
                </div>
              </details>

              <details class="qr-group" open>
                <summary>Colours</summary>
                <div class="qr-group-body">
                  <div class="qr-field">
                    <span class="qr-label">Foreground</span>
                    <ColourField
                      @label="Foreground colour"
                      @value={{this.foreground}}
                      @onChange={{fn this.setValue "foreground"}}
                    />
                  </div>
                  <div class="qr-field">
                    <div class="qr-field-head">
                      <span class="qr-label">Background</span>
                      <button
                        type="button"
                        class="qr-chip qr-chip-sm
                          {{if this.transparent 'active'}}"
                        aria-pressed={{if this.transparent "true" "false"}}
                        {{on "click" (fn this.toggle "transparent")}}
                      >Transparent</button>
                    </div>
                    <ColourField
                      @label="Background colour"
                      @value={{this.background}}
                      @disabled={{this.transparent}}
                      @onChange={{fn this.setValue "background"}}
                    />
                  </div>
                </div>
              </details>

              <details class="qr-group">
                <summary>Shapes</summary>
                <div class="qr-group-body">
                  <ShapePicker
                    @label="Bit Style"
                    @options={{this.dotStyles}}
                    @value={{this.dotType}}
                    @onPick={{fn this.setValue "dotType"}}
                  />
                  <ShapePicker
                    @label="Eyes"
                    @options={{this.eyeStyles}}
                    @value={{this.cornerSquareType}}
                    @onPick={{fn this.setValue "cornerSquareType"}}
                  />
                  <ShapePicker
                    @label="Pupils"
                    @options={{this.pupilStyles}}
                    @value={{this.cornerDotType}}
                    @onPick={{fn this.setValue "cornerDotType"}}
                  />
                </div>
              </details>

              <details class="qr-group">
                <summary>Logo / Image</summary>
                <div class="qr-group-body">
                  {{#if this.logo}}
                    <div class="qr-logo-current">
                      <img src={{this.logo}} alt="Logo" />
                      <button
                        type="button"
                        class="btn"
                        {{on "click" this.removeLogo}}
                      ><Icon @name="x" @size={{14}} /> Remove</button>
                    </div>
                    <div class="qr-field">
                      <div class="qr-field-head"><label
                          class="qr-label"
                          for="qr-logo-size"
                        >Logo Size</label><span
                          class="slider-num"
                        >{{this.logoSize}}</span></div>
                      <input
                        id="qr-logo-size"
                        type="range"
                        min="0.1"
                        max="0.5"
                        step="0.05"
                        value={{this.logoSize}}
                        {{on "input" (fn this.setNumber "logoSize")}}
                      />
                    </div>
                    <div class="qr-field">
                      <div class="qr-field-head"><label
                          class="qr-label"
                          for="qr-logo-margin"
                        >Logo Margin</label><span
                          class="slider-num"
                        >{{this.logoMargin}}px</span></div>
                      <input
                        id="qr-logo-margin"
                        type="range"
                        min="0"
                        max="20"
                        value={{this.logoMargin}}
                        {{on "input" (fn this.setNumber "logoMargin")}}
                      />
                    </div>
                  {{else}}
                    <label
                      class="qr-drop {{if this.logoDragging 'is-dragging'}}"
                      {{on "dragover" this.dragLogo}}
                      {{on "dragleave" this.dragLogo}}
                      {{on "drop" this.dropLogo}}
                    >
                      <Icon @name="image-plus" @size={{22}} />
                      <span>{{if
                          this.logoDragging
                          "Drop image here"
                          "Drop, click, or paste"
                        }}</span>
                      <input
                        type="file"
                        accept="image/*"
                        class="sr-only"
                        {{on "change" this.selectLogo}}
                      />
                    </label>
                  {{/if}}
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>
    </ToolPage>
  </template>
}

const VcardInput = <template>
  <div class="qr-field">
    <label class="qr-label" for={{@id}}>{{@label}}</label>
    <input
      id={{@id}}
      type="text"
      placeholder={{@placeholder}}
      value={{@value}}
      {{on "input" @onInput}}
    />
  </div>
</template>;

const ShapePicker = <template>
  <div class="qr-field">
    <span class="qr-label">{{@label}}</span>
    <div class="qr-segmented qr-grid-3">
      {{#each @options as |option|}}
        <button
          type="button"
          class="qr-chip {{if (eq option.value @value) 'active'}}"
          {{on "click" (fn @onPick option.value)}}
        >{{option.label}}</button>
      {{/each}}
    </div>
  </div>
</template>;
