import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';

const random = (n) => crypto.getRandomValues(new Uint8Array(n));
const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const dashed = (h) =>
  `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NANO_ALPHABET =
  'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

function uuidV7() {
  const bytes = random(16);
  const ms = Date.now();
  // 48-bit big-endian millisecond timestamp, so v7 IDs sort by creation time.
  for (let i = 0; i < 6; i++)
    bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return dashed(hex(bytes));
}

function ulid() {
  let ms = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[ms % 32] + time;
    ms = Math.floor(ms / 32);
  }
  return time + Array.from(random(16), (b) => CROCKFORD[b % 32]).join('');
}

function nanoId(size = 21) {
  // 64 symbols, so masking a byte with 63 keeps every symbol equally likely.
  return Array.from(random(size), (b) => NANO_ALPHABET[b & 63]).join('');
}

const KINDS = [
  {
    id: 'v4',
    label: 'UUID v4',
    hint: 'Fully random. The everyday choice.',
    make: () => crypto.randomUUID(),
  },
  {
    id: 'v7',
    label: 'UUID v7',
    hint: 'Starts with a timestamp, so IDs sort in creation order. Great for database keys.',
    make: uuidV7,
  },
  {
    id: 'ulid',
    label: 'ULID',
    hint: '26 characters, time-sortable, no ambiguous letters.',
    make: ulid,
  },
  {
    id: 'nano',
    label: 'Nano ID',
    hint: '21 URL-safe characters with about the same collision resistance as UUID v4.',
    make: () => nanoId(),
  },
];

const eq = (a, b) => a === b;

function inspect(value) {
  const text = value.trim();
  if (!text) return null;
  return describe(text)?.map(([label, v]) => ({ label, value: v }));
}

function describe(text) {
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(text)) {
    const ms = [...text.slice(0, 10).toUpperCase()].reduce(
      (n, c) => n * 32 + CROCKFORD.indexOf(c),
      0,
    );
    return [
      ['Type', 'ULID'],
      ['Created', new Date(ms).toLocaleString()],
    ];
  }
  const h = text.replace(/[{}-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return [['Type', 'Not a UUID or ULID']];
  if (/^0+$/.test(h)) return [['Type', 'Nil UUID']];
  if (/^f+$/.test(h)) return [['Type', 'Max UUID']];
  const version = parseInt(h[12], 16);
  const variantBits = parseInt(h[16], 16);
  const variant =
    variantBits < 8
      ? 'NCS (legacy)'
      : variantBits < 12
        ? 'RFC 9562'
        : variantBits < 14
          ? 'Microsoft (legacy)'
          : 'Reserved';
  const rows = [
    ['Type', `UUID version ${version}`],
    ['Variant', variant],
    ['Canonical', dashed(h)],
  ];
  if (version === 7)
    rows.push([
      'Created',
      new Date(parseInt(h.slice(0, 12), 16)).toLocaleString(),
    ]);
  if (version === 1) {
    // 60-bit count of 100ns intervals since 1582-10-15, split across three fields.
    const ticks = BigInt(
      `0x${h.slice(13, 16)}${h.slice(8, 12)}${h.slice(0, 8)}`,
    );
    rows.push([
      'Created',
      new Date(Number(ticks / 10000n - 12219292800000n)).toLocaleString(),
    ]);
  }
  return rows;
}

export default class UuidGeneratorPage extends Component {
  kinds = KINDS;

  @tracked kind = 'v4';
  @tracked count = 5;
  @tracked uppercase = false;
  @tracked hyphens = true;
  @tracked ids = [];
  @tracked inspectInput = '';

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'uuid-generator', [
      'kind',
      'count',
      'uppercase',
      'hyphens',
    ]);
    this.generate();
  }

  get current() {
    return KINDS.find((k) => k.id === this.kind);
  }

  get isUuid() {
    return this.kind === 'v4' || this.kind === 'v7';
  }

  get formatted() {
    return this.ids.map((id) => {
      let out = this.isUuid && !this.hyphens ? id.replaceAll('-', '') : id;
      if (this.isUuid && this.uppercase) out = out.toUpperCase();
      return out;
    });
  }

  get allText() {
    return this.formatted.join('\n');
  }

  get inspection() {
    return inspect(this.inspectInput);
  }

  generate = () => {
    this.ids = Array.from({ length: this.count }, this.current.make);
  };

  setKind = (id) => {
    this.kind = id;
    this.generate();
  };

  setCount = (e) => {
    this.count = Math.min(500, Math.max(1, Math.floor(+e.target.value) || 1));
    this.generate();
  };

  toggleUppercase = () => (this.uppercase = !this.uppercase);
  toggleHyphens = () => (this.hyphens = !this.hyphens);
  setInspect = (e) => (this.inspectInput = e.target.value);

  <template>
    <ToolPage
      @route="uuid-generator"
      @subtitle="Make UUIDs (v4 and v7), ULIDs and Nano IDs by the bucketload, or decode one you already have."
    >
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <div class="math-tabs" role="group" aria-label="ID type">
            {{#each this.kinds as |k|}}
              <button
                type="button"
                class="qr-tab {{if (eq this.kind k.id) 'active'}}"
                {{on "click" (fn this.setKind k.id)}}
              >{{k.label}}</button>
            {{/each}}
          </div>
          <p class="tool-hint">{{this.current.hint}}</p>
          <div class="math-row is-aligned">
            <label class="math-field"><span class="qr-label is-muted">How many</span><input
                type="number"
                min="1"
                max="500"
                class="math-input"
                value={{this.count}}
                {{on "input" this.setCount}}
              /></label>
            <button
              type="button"
              class="btn active math-swap"
              {{on "click" this.generate}}
            ><Icon @name="refresh-cw" @size={{13}} /> Generate</button>
          </div>
          {{#if this.isUuid}}
            <div class="settings-actions">
              <label class="math-check"><input
                  type="checkbox"
                  checked={{this.uppercase}}
                  {{on "change" this.toggleUppercase}}
                />
                Uppercase</label>
              <label class="math-check"><input
                  type="checkbox"
                  checked={{this.hyphens}}
                  {{on "change" this.toggleHyphens}}
                />
                Hyphens</label>
            </div>
          {{/if}}
          <div class="field-head">
            <span class="qr-label is-muted">{{this.ids.length}} generated</span>
            <CopyButton @value={{this.allText}} />
          </div>
          <textarea
            class="textarea text-area-tall is-mono"
            readonly
            spellcheck="false"
            aria-label="Generated IDs"
            value={{this.allText}}
          ></textarea>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">Decode an ID</h3>
          <input
            type="text"
            class="math-input"
            spellcheck="false"
            placeholder="Paste a UUID or ULID"
            aria-label="ID to decode"
            value={{this.inspectInput}}
            {{on "input" this.setInspect}}
          />
          {{#if this.inspection}}
            <div class="math-stats">
              {{#each this.inspection as |row|}}
                <div class="math-stat"><span>{{row.label}}</span><strong
                  >{{row.value}}</strong></div>
              {{/each}}
            </div>
          {{else}}
            <p class="tool-hint">Shows the version, variant and, for time-based
              IDs, when it was created.</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
