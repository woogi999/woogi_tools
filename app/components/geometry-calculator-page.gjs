import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import ToolPage from './tool-page';
import { keepState } from '../utils/tool-state';

// Area, perimeter, volume and surface for the everyday shapes. Each shape lists
// the measurements it needs and works the rest out; the sketch shows which
// side is which.

const num = (v) => (v === '' || v === null ? NaN : Number(v));
const fmt = (n) =>
  Number.isFinite(n)
    ? parseFloat(n.toPrecision(8)).toLocaleString(undefined, {
        maximumFractionDigits: 6,
      })
    : '-';
const eq = (a, b) => a === b;
const { PI, sqrt, sin, tan } = Math;

// A shape's sketch is a bit of SVG in a 100×100 box; labels sit on the parts
// they measure.
const SHAPES = [
  {
    id: 'square',
    label: 'Square',
    kind: 'flat',
    fields: [{ id: 'a', label: 'Side', value: 5 }],
    sketch:
      '<rect x="20" y="20" width="60" height="60"/><text x="50" y="14">a</text>',
    solve: ({ a }) => [
      ['Area', a * a, 2],
      ['Perimeter', 4 * a, 1],
      ['Diagonal', a * sqrt(2), 1],
    ],
  },
  {
    id: 'rectangle',
    label: 'Rectangle',
    kind: 'flat',
    fields: [
      { id: 'w', label: 'Width', value: 8 },
      { id: 'h', label: 'Height', value: 5 },
    ],
    sketch:
      '<rect x="10" y="28" width="80" height="44"/><text x="50" y="22">w</text><text x="97" y="54">h</text>',
    solve: ({ w, h }) => [
      ['Area', w * h, 2],
      ['Perimeter', 2 * (w + h), 1],
      ['Diagonal', sqrt(w * w + h * h), 1],
    ],
  },
  {
    id: 'triangle',
    label: 'Triangle (3 sides)',
    kind: 'flat',
    fields: [
      { id: 'a', label: 'Side a', value: 3 },
      { id: 'b', label: 'Side b', value: 4 },
      { id: 'c', label: 'Side c', value: 5 },
    ],
    sketch:
      '<polygon points="10,80 90,80 30,20"/><text x="50" y="92">b</text><text x="14" y="50">c</text><text x="68" y="48">a</text>',
    solve: ({ a, b, c }) => {
      const s = (a + b + c) / 2;
      const valid = a + b > c && a + c > b && b + c > a;
      const area = valid ? sqrt(s * (s - a) * (s - b) * (s - c)) : NaN;
      const angle = (x, y, z) =>
        valid
          ? (Math.acos((y * y + z * z - x * x) / (2 * y * z)) * 180) / PI
          : NaN;
      return [
        ['Area', area, 2],
        ['Perimeter', valid ? a + b + c : NaN, 1],
        ['Height onto b', valid ? (2 * area) / b : NaN, 1],
        ['Angle A', angle(a, b, c), 'deg'],
        ['Angle B', angle(b, a, c), 'deg'],
        ['Angle C', angle(c, a, b), 'deg'],
      ];
    },
  },
  {
    id: 'right-triangle',
    label: 'Right triangle',
    kind: 'flat',
    fields: [
      { id: 'a', label: 'Leg a', value: 3 },
      { id: 'b', label: 'Leg b', value: 4 },
    ],
    sketch:
      '<polygon points="15,85 85,85 15,20"/><rect x="15" y="75" width="10" height="10" fill="none"/><text x="50" y="96">b</text><text x="8" y="55">a</text><text x="58" y="50">c</text>',
    solve: ({ a, b }) => [
      ['Hypotenuse', sqrt(a * a + b * b), 1],
      ['Area', (a * b) / 2, 2],
      ['Perimeter', a + b + sqrt(a * a + b * b), 1],
      ['Angle opposite a', (Math.atan2(a, b) * 180) / PI, 'deg'],
    ],
  },
  {
    id: 'circle',
    label: 'Circle',
    kind: 'flat',
    fields: [{ id: 'r', label: 'Radius', value: 4 }],
    sketch:
      '<circle cx="50" cy="50" r="38"/><line x1="50" y1="50" x2="88" y2="50"/><text x="68" y="44">r</text>',
    solve: ({ r }) => [
      ['Area', PI * r * r, 2],
      ['Circumference', 2 * PI * r, 1],
      ['Diameter', 2 * r, 1],
    ],
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    kind: 'flat',
    fields: [
      { id: 'a', label: 'Semi-axis a', value: 6 },
      { id: 'b', label: 'Semi-axis b', value: 3 },
    ],
    sketch:
      '<ellipse cx="50" cy="50" rx="42" ry="24"/><line x1="50" y1="50" x2="92" y2="50"/><line x1="50" y1="50" x2="50" y2="26"/><text x="72" y="44">a</text><text x="44" y="38">b</text>',
    solve: ({ a, b }) => {
      const h = ((a - b) / (a + b)) ** 2;
      return [
        ['Area', PI * a * b, 2],
        [
          'Perimeter (Ramanujan)',
          PI * (a + b) * (1 + (3 * h) / (10 + sqrt(4 - 3 * h))),
          1,
        ],
      ];
    },
  },
  {
    id: 'parallelogram',
    label: 'Parallelogram',
    kind: 'flat',
    fields: [
      { id: 'b', label: 'Base', value: 8 },
      { id: 's', label: 'Slanted side', value: 5 },
      { id: 'h', label: 'Height', value: 4 },
    ],
    sketch:
      '<polygon points="5,80 70,80 95,25 30,25"/><line x1="70" y1="80" x2="70" y2="25" stroke-dasharray="3 3"/><text x="38" y="92">b</text><text x="76" y="56">h</text><text x="88" y="60">s</text>',
    solve: ({ b, s, h }) => [
      ['Area', b * h, 2],
      ['Perimeter', 2 * (b + s), 1],
    ],
  },
  {
    id: 'trapezoid',
    label: 'Trapezoid',
    kind: 'flat',
    fields: [
      { id: 'a', label: 'Top', value: 4 },
      { id: 'b', label: 'Bottom', value: 8 },
      { id: 'h', label: 'Height', value: 3 },
      { id: 'c', label: 'Left side', value: 3.6 },
      { id: 'd', label: 'Right side', value: 3.6 },
    ],
    sketch:
      '<polygon points="10,80 90,80 70,25 30,25"/><text x="50" y="20">a</text><text x="50" y="92">b</text><text x="10" y="55">c</text><text x="90" y="55">d</text>',
    solve: ({ a, b, h, c, d }) => [
      ['Area', ((a + b) / 2) * h, 2],
      ['Perimeter', a + b + c + d, 1],
      ['Median', (a + b) / 2, 1],
    ],
  },
  {
    id: 'polygon',
    label: 'Regular polygon',
    kind: 'flat',
    fields: [
      { id: 'n', label: 'Sides', value: 6 },
      { id: 'a', label: 'Side length', value: 4 },
    ],
    sketch:
      '<polygon points="50,10 85,30 85,70 50,90 15,70 15,30"/><text x="72" y="16">a</text>',
    solve: ({ n, a }) => {
      const sides = Math.max(3, Math.floor(n));
      return [
        ['Area', (sides * a * a) / (4 * tan(PI / sides)), 2],
        ['Perimeter', sides * a, 1],
        ['Apothem', a / (2 * tan(PI / sides)), 1],
        ['Circumradius', a / (2 * sin(PI / sides)), 1],
        ['Interior angle', 180 - 360 / sides, 'deg'],
      ];
    },
  },
  {
    id: 'sector',
    label: 'Circle sector',
    kind: 'flat',
    fields: [
      { id: 'r', label: 'Radius', value: 5 },
      { id: 'deg', label: 'Angle (degrees)', value: 60 },
    ],
    sketch:
      '<path d="M50,85 L50,15 A70,70 0 0,1 100,50 L50,85 Z" transform="translate(-10 0)"/><text x="30" y="52">r</text><text x="52" y="72">θ</text>',
    solve: ({ r, deg }) => {
      const rad = (deg * PI) / 180;
      return [
        ['Area', (rad / 2) * r * r, 2],
        ['Arc length', r * rad, 1],
        ['Chord', 2 * r * sin(rad / 2), 1],
        ['Perimeter', 2 * r + r * rad, 1],
      ];
    },
  },
  {
    id: 'cube',
    label: 'Cube',
    kind: 'solid',
    fields: [{ id: 'a', label: 'Edge', value: 3 }],
    sketch:
      '<rect x="15" y="35" width="50" height="50"/><polygon points="15,35 35,15 85,15 65,35"/><polygon points="65,35 85,15 85,65 65,85"/><text x="40" y="95">a</text>',
    solve: ({ a }) => [
      ['Volume', a ** 3, 3],
      ['Surface area', 6 * a * a, 2],
      ['Space diagonal', a * sqrt(3), 1],
    ],
  },
  {
    id: 'box',
    label: 'Box (cuboid)',
    kind: 'solid',
    fields: [
      { id: 'l', label: 'Length', value: 6 },
      { id: 'w', label: 'Width', value: 4 },
      { id: 'h', label: 'Height', value: 3 },
    ],
    sketch:
      '<rect x="10" y="40" width="60" height="40"/><polygon points="10,40 30,20 90,20 70,40"/><polygon points="70,40 90,20 90,60 70,80"/><text x="40" y="92">l</text><text x="84" y="14">w</text><text x="96" y="62">h</text>',
    solve: ({ l, w, h }) => [
      ['Volume', l * w * h, 3],
      ['Surface area', 2 * (l * w + w * h + h * l), 2],
      ['Space diagonal', sqrt(l * l + w * w + h * h), 1],
    ],
  },
  {
    id: 'sphere',
    label: 'Sphere',
    kind: 'solid',
    fields: [{ id: 'r', label: 'Radius', value: 4 }],
    sketch:
      '<circle cx="50" cy="50" r="38"/><ellipse cx="50" cy="50" rx="38" ry="12" stroke-dasharray="3 3"/><line x1="50" y1="50" x2="88" y2="50"/><text x="68" y="44">r</text>',
    solve: ({ r }) => [
      ['Volume', (4 / 3) * PI * r ** 3, 3],
      ['Surface area', 4 * PI * r * r, 2],
      ['Great circle', 2 * PI * r, 1],
    ],
  },
  {
    id: 'cylinder',
    label: 'Cylinder',
    kind: 'solid',
    fields: [
      { id: 'r', label: 'Radius', value: 3 },
      { id: 'h', label: 'Height', value: 7 },
    ],
    sketch:
      '<ellipse cx="50" cy="22" rx="32" ry="10"/><line x1="18" y1="22" x2="18" y2="80"/><line x1="82" y1="22" x2="82" y2="80"/><path d="M18,80 A32,10 0 0,0 82,80"/><line x1="50" y1="22" x2="82" y2="22"/><text x="66" y="17">r</text><text x="90" y="55">h</text>',
    solve: ({ r, h }) => [
      ['Volume', PI * r * r * h, 3],
      ['Surface area', 2 * PI * r * (r + h), 2],
      ['Side (lateral) area', 2 * PI * r * h, 2],
    ],
  },
  {
    id: 'cone',
    label: 'Cone',
    kind: 'solid',
    fields: [
      { id: 'r', label: 'Radius', value: 3 },
      { id: 'h', label: 'Height', value: 6 },
    ],
    sketch:
      '<ellipse cx="50" cy="78" rx="34" ry="10"/><line x1="16" y1="78" x2="50" y2="10"/><line x1="84" y1="78" x2="50" y2="10"/><line x1="50" y1="78" x2="84" y2="78" stroke-dasharray="3 3"/><line x1="50" y1="78" x2="50" y2="10" stroke-dasharray="3 3"/><text x="68" y="74">r</text><text x="42" y="48">h</text>',
    solve: ({ r, h }) => {
      const slant = sqrt(r * r + h * h);
      return [
        ['Volume', (PI * r * r * h) / 3, 3],
        ['Surface area', PI * r * (r + slant), 2],
        ['Slant height', slant, 1],
      ];
    },
  },
  {
    id: 'pyramid',
    label: 'Square pyramid',
    kind: 'solid',
    fields: [
      { id: 'a', label: 'Base edge', value: 4 },
      { id: 'h', label: 'Height', value: 5 },
    ],
    sketch:
      '<polygon points="15,80 65,90 90,65 40,55"/><line x1="15" y1="80" x2="50" y2="10"/><line x1="65" y1="90" x2="50" y2="10"/><line x1="90" y1="65" x2="50" y2="10"/><line x1="40" y1="55" x2="50" y2="10" stroke-dasharray="3 3"/><text x="40" y="98">a</text><text x="60" y="45">h</text>',
    solve: ({ a, h }) => {
      const slant = sqrt((a / 2) ** 2 + h * h);
      return [
        ['Volume', (a * a * h) / 3, 3],
        ['Surface area', a * a + 2 * a * slant, 2],
        ['Slant height', slant, 1],
      ];
    },
  },
  {
    id: 'torus',
    label: 'Torus (ring)',
    kind: 'solid',
    fields: [
      { id: 'R', label: 'Ring radius (centre to tube)', value: 5 },
      { id: 'r', label: 'Tube radius', value: 1.5 },
    ],
    sketch:
      '<ellipse cx="50" cy="50" rx="42" ry="22"/><ellipse cx="50" cy="48" rx="18" ry="8"/><line x1="50" y1="50" x2="92" y2="50" stroke-dasharray="3 3"/><text x="70" y="44">R</text>',
    solve: ({ R, r }) => [
      ['Volume', 2 * PI * PI * R * r * r, 3],
      ['Surface area', 4 * PI * PI * R * r, 2],
    ],
  },
];

const UNIT_SUFFIX = { 1: '', 2: '²', 3: '³', deg: '°' };

export default class GeometryCalculatorPage extends Component {
  @tracked shapeId = 'rectangle';
  @tracked values = {};
  @tracked unit = 'cm';

  shapes = SHAPES;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'geometry-calculator', ['shapeId', 'values', 'unit']);
  }

  get shape() {
    return SHAPES.find((s) => s.id === this.shapeId) ?? SHAPES[0];
  }

  get flat() {
    return SHAPES.filter((s) => s.kind === 'flat');
  }

  get solid() {
    return SHAPES.filter((s) => s.kind === 'solid');
  }

  get fields() {
    return this.shape.fields.map((field) => ({
      ...field,
      current: this.values[`${this.shape.id}.${field.id}`] ?? field.value,
    }));
  }

  get sketch() {
    return htmlSafe(this.shape.sketch);
  }

  get results() {
    const input = {};
    for (const field of this.fields) input[field.id] = num(field.current);
    if (Object.values(input).some((v) => !Number.isFinite(v) || v < 0))
      return [];
    return this.shape.solve(input).map(([label, value, power]) => ({
      label,
      value: fmt(value),
      unit: power === 'deg' ? '°' : `${this.unit}${UNIT_SUFFIX[power] ?? ''}`,
    }));
  }

  pickShape = (id) => (this.shapeId = id);
  setValue = (id, event) =>
    (this.values = {
      ...this.values,
      [`${this.shape.id}.${id}`]: event.target.value,
    });
  setUnit = (event) => (this.unit = event.target.value);

  <template>
    <ToolPage
      @route="geometry-calculator"
      @subtitle="Area, perimeter, volume and surface area for the shapes you actually meet, with a sketch that shows which measurement is which."
    >
      <div class="math-grid pop-in">
        <section class="math-card">
          <h3 class="qr-heading">Flat shapes</h3>
          <div class="cipher-picks" role="group" aria-label="Flat shapes">
            {{#each this.flat as |s|}}
              <button
                type="button"
                class="qr-tab {{if (eq this.shapeId s.id) 'active'}}"
                {{on "click" (fn this.pickShape s.id)}}
              >{{s.label}}</button>
            {{/each}}
          </div>
          <h3 class="qr-heading">Solids</h3>
          <div class="cipher-picks" role="group" aria-label="Solid shapes">
            {{#each this.solid as |s|}}
              <button
                type="button"
                class="qr-tab {{if (eq this.shapeId s.id) 'active'}}"
                {{on "click" (fn this.pickShape s.id)}}
              >{{s.label}}</button>
            {{/each}}
          </div>
          <label class="math-field geo-unit"><span
              class="qr-label is-muted"
            >Unit (just a label)</span><input
              type="text"
              class="math-input"
              maxlength="6"
              value={{this.unit}}
              {{on "input" this.setUnit}}
            /></label>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">{{this.shape.label}}</h3>
          <div class="geo-layout">
            <svg class="geo-sketch" viewBox="0 0 100 100" aria-hidden="true">
              {{this.sketch}}
            </svg>
            <div class="geo-fields">
              {{#each this.fields key="id" as |field|}}
                <label class="math-field"><span
                    class="qr-label is-muted"
                  >{{field.label}}</span><input
                    type="number"
                    class="math-input"
                    min="0"
                    step="any"
                    value={{field.current}}
                    {{on "input" (fn this.setValue field.id)}}
                  /></label>
              {{/each}}
            </div>
          </div>
          {{#if this.results.length}}
            <dl class="geo-results">
              {{#each this.results as |r|}}
                <div class="geo-result">
                  <dt>{{r.label}}</dt>
                  <dd>{{r.value}} <small>{{r.unit}}</small></dd>
                </div>
              {{/each}}
            </dl>
          {{else}}
            <p class="tool-hint">Fill in every measurement with a positive
              number.</p>
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
