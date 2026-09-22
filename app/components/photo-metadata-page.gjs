import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { acceptPastedFiles } from '../utils/paste-files';

// exifr is only needed on this page, so it's fetched when a photo arrives.
const loadExifr = () => import('exifr').then((m) => m.default ?? m);

const show = (value) => {
  if (value instanceof Date) return value.toLocaleString();
  if (value instanceof Uint8Array || ArrayBuffer.isView(value))
    return `${value.length} bytes`;
  if (Array.isArray(value)) return value.map(show).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export default class PhotoMetadataPage extends Component {
  @tracked fileName = null;
  @tracked imageUrl = null;
  @tracked tags = null;
  @tracked gps = null;
  @tracked error = null;
  @tracked busy = false;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => this.revoke());
  }

  revoke() {
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
  }

  get highlights() {
    const t = this.tags;
    if (!t) return [];
    const camera = [t.Make, t.Model].filter(Boolean).join(' ');
    const rows = [
      ['Taken', t.DateTimeOriginal ?? t.CreateDate],
      ['Camera', camera],
      ['Lens', t.LensModel],
      ['Software', t.Software],
      ['Author', t.Artist ?? t.Creator ?? t.XPAuthor],
      ['Copyright', t.Copyright],
      ['Owner', t.OwnerName ?? t.CameraOwnerName],
      ['Serial number', t.SerialNumber ?? t.BodySerialNumber],
      [
        'Size',
        t.ExifImageWidth && `${t.ExifImageWidth} × ${t.ExifImageHeight}`,
      ],
      [
        'Exposure',
        t.ExposureTime &&
          `1/${Math.round(1 / t.ExposureTime)} s, f/${t.FNumber}, ISO ${t.ISO}`,
      ],
    ];
    return rows
      .filter(([, v]) => v)
      .map(([label, v]) => ({ label, value: show(v) }));
  }

  get allTags() {
    return Object.entries(this.tags ?? {})
      .filter(([k]) => !['latitude', 'longitude'].includes(k))
      .map(([key, value]) => ({ key, value: show(value) }));
  }

  get mapUrl() {
    const g = this.gps;
    return g
      ? `https://www.openstreetmap.org/?mlat=${g.latitude}&mlon=${g.longitude}#map=16/${g.latitude}/${g.longitude}`
      : null;
  }

  get coords() {
    const g = this.gps;
    return g ? `${g.latitude.toFixed(6)}, ${g.longitude.toFixed(6)}` : '';
  }

  open = async (file) => {
    if (!file) return;
    this.revoke();
    this.fileName = file.name;
    this.imageUrl = file.type.startsWith('image/')
      ? URL.createObjectURL(file)
      : null;
    this.error = null;
    this.tags = null;
    this.gps = null;
    this.busy = true;
    try {
      const exifr = await loadExifr();
      const tags = await exifr.parse(file, {
        tiff: true,
        exif: true,
        gps: true,
        iptc: true,
        xmp: true,
        icc: false,
        interop: true,
        mergeOutput: true,
      });
      this.tags = tags ?? {};
      if (Number.isFinite(tags?.latitude) && Number.isFinite(tags?.longitude))
        this.gps = { latitude: tags.latitude, longitude: tags.longitude };
    } catch {
      this.error =
        "Couldn't read that file's metadata. JPEG, HEIC, TIFF, PNG and WebP work best.";
    }
    this.busy = false;
  };

  selectFile = (e) => {
    this.open(e.target.files?.[0]);
    e.target.value = '';
  };
  dragOverFile = (e) => e.preventDefault();
  dropFile = (e) => {
    e.preventDefault();
    this.open(e.dataTransfer.files?.[0]);
  };
  pasteFiles = (files) => this.open(files[0]);

  <template>
    <ToolPage
      @route="photo-metadata"
      @busy={{this.busy}}
      @closeWarning="Close Photo Metadata? The photo being read will be dropped."
      @subtitle="What a photo gives away: where it was taken, on what, when and by whom, read from its EXIF, IPTC and XMP tags."
    >
      <div class="math-grid pop-in" {{acceptPastedFiles this.pasteFiles}}>
        <section class="math-card">
          <label
            class="qr-drop {{if this.imageUrl 'is-filled'}}"
            {{on "dragover" this.dragOverFile}}
            {{on "drop" this.dropFile}}
          >
            {{#if this.imageUrl}}
              <img src={{this.imageUrl}} alt="" class="pex-picture" />
            {{else}}
              <Icon @name="scan-eye" @size={{22}} />
              <span>Drop a photo, or click to browse</span>
            {{/if}}
            <input
              type="file"
              accept="image/*,.heic,.heif,.tif,.tiff"
              class="sr-only"
              {{on "change" this.selectFile}}
            />
          </label>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
          {{#if this.gps}}
            <p class="osint-verdict is-bad">
              <Icon @name="map-pin" @size={{13}} />
              This photo has its location in it:
              <a
                href={{this.mapUrl}}
                target="_blank"
                rel="noopener noreferrer"
              >{{this.coords}}</a>
              <CopyButton @value={{this.coords}} />
            </p>
          {{/if}}
          <p class="tool-hint">Read in your browser; the photo is never
            uploaded.</p>
        </section>

        {{#if this.tags}}
          <section class="math-card">
            <h3 class="qr-heading">{{this.fileName}}</h3>
            {{#if this.highlights.length}}
              <dl class="rbx-facts">
                {{#each this.highlights as |h|}}
                  <dt>{{h.label}}</dt><dd>{{h.value}}</dd>
                {{/each}}
              </dl>
            {{/if}}
            {{#if this.allTags.length}}
              <details class="osint-details">
                <summary>All {{this.allTags.length}} tags</summary>
                <dl class="rbx-facts">
                  {{#each this.allTags as |t|}}
                    <dt>{{t.key}}</dt><dd>{{t.value}}</dd>
                  {{/each}}
                </dl>
              </details>
            {{else}}
              <p class="tool-hint">No metadata at all: it has been stripped, or
                this file never had any (screenshots and most social-media
                downloads don't).</p>
            {{/if}}
          </section>
        {{else if this.busy}}
          <section class="math-card"><p class="tool-hint">Reading…</p></section>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
