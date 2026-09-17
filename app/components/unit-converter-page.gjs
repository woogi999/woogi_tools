import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';

// Every category converts through a common base unit (metres, kilograms, …)
// except Temperature, which needs its own non-linear formulas.
const CATEGORIES = {
  Length: {
    base: 'm',
    units: {
      mm: 0.001,
      cm: 0.01,
      m: 1,
      km: 1000,
      in: 0.0254,
      ft: 0.3048,
      yd: 0.9144,
      mi: 1609.344,
      'nmi (nautical)': 1852,
    },
  },
  Mass: {
    base: 'kg',
    units: {
      mg: 0.000001,
      g: 0.001,
      kg: 1,
      t: 1000,
      oz: 0.028349523125,
      lb: 0.45359237,
      'st (stone)': 6.35029318,
    },
  },
  Volume: {
    base: 'L',
    units: {
      mL: 0.001,
      L: 1,
      'm³': 1000,
      'tsp (US)': 0.0049289216,
      'tbsp (US)': 0.0147867648,
      'fl oz (US)': 0.0295735296,
      cup: 0.2365882365,
      'pt (US)': 0.473176473,
      'qt (US)': 0.946352946,
      'gal (US)': 3.785411784,
    },
  },
  Area: {
    base: 'm²',
    units: {
      'mm²': 0.000001,
      'cm²': 0.0001,
      'm²': 1,
      hectare: 10000,
      'km²': 1000000,
      'ft²': 0.09290304,
      'yd²': 0.83612736,
      acre: 4046.8564224,
      'mi²': 2589988.110336,
    },
  },
  Speed: {
    base: 'm/s',
    units: {
      'm/s': 1,
      'km/h': 0.2777777778,
      mph: 0.44704,
      knot: 0.5144444444,
      'ft/s': 0.3048,
    },
  },
  Time: {
    base: 's',
    units: {
      ms: 0.001,
      s: 1,
      min: 60,
      hour: 3600,
      day: 86400,
      week: 604800,
      year: 31557600,
    },
  },
  Data: {
    base: 'B',
    units: {
      bit: 0.125,
      B: 1,
      KB: 1000,
      MB: 1000 ** 2,
      GB: 1000 ** 3,
      TB: 1000 ** 4,
      KiB: 1024,
      MiB: 1024 ** 2,
      GiB: 1024 ** 3,
      TiB: 1024 ** 4,
    },
  },
  Pressure: {
    base: 'Pa',
    units: {
      Pa: 1,
      kPa: 1000,
      bar: 100000,
      atm: 101325,
      psi: 6894.757293168,
      mmHg: 133.322387415,
    },
  },
};

const TEMPERATURE_UNITS = ['°C', '°F', 'K'];

function toCelsius(value, unit) {
  if (unit === '°C') return value;
  if (unit === '°F') return ((value - 32) * 5) / 9;
  return value - 273.15; // K
}

function fromCelsius(value, unit) {
  if (unit === '°C') return value;
  if (unit === '°F') return (value * 9) / 5 + 32;
  return value + 273.15; // K
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return '—';
  const rounded = parseFloat(n.toPrecision(6));
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 10 });
}

export default class UnitConverterPage extends Component {
  categories = [...Object.keys(CATEGORIES), 'Temperature'];

  @tracked category = 'Length';
  @tracked fromUnit = 'm';
  @tracked toUnit = 'ft';
  @tracked fromValue = '1';

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'unit-converter', [
      'category',
      'fromUnit',
      'toUnit',
      'fromValue',
    ]);
  }

  get isTemperature() {
    return this.category === 'Temperature';
  }

  get unitOptions() {
    return this.isTemperature
      ? TEMPERATURE_UNITS
      : Object.keys(CATEGORIES[this.category].units);
  }

  get numericValue() {
    const n = parseFloat(this.fromValue);
    return Number.isFinite(n) ? n : null;
  }

  get result() {
    const n = this.numericValue;
    if (n === null) return null;
    if (this.isTemperature)
      return fromCelsius(toCelsius(n, this.fromUnit), this.toUnit);
    const { units } = CATEGORIES[this.category];
    return (n * units[this.fromUnit]) / units[this.toUnit];
  }

  get resultText() {
    return this.result === null ? '—' : formatNumber(this.result);
  }

  // A quick reference table: 1 "from" unit converted into every other unit in the category.
  get referenceRows() {
    return this.unitOptions
      .filter((u) => u !== this.fromUnit)
      .map((unit) => {
        const value = this.isTemperature
          ? fromCelsius(toCelsius(1, this.fromUnit), unit)
          : CATEGORIES[this.category].units[this.fromUnit] /
            CATEGORIES[this.category].units[unit];
        return { unit, text: formatNumber(value) };
      });
  }

  setCategory = (name) => {
    this.category = name;
    const units = this.isTemperature
      ? TEMPERATURE_UNITS
      : Object.keys(CATEGORIES[name].units);
    this.fromUnit = units[0];
    this.toUnit = units[1] ?? units[0];
  };

  setFromUnit = (event) => (this.fromUnit = event.target.value);
  setToUnit = (event) => (this.toUnit = event.target.value);
  setFromValue = (event) => (this.fromValue = event.target.value);

  swap = () => {
    [this.fromUnit, this.toUnit] = [this.toUnit, this.fromUnit];
  };

  <template>
    <ToolPage
      @route="unit-converter"
      @subtitle="Convert length, mass, volume, area, speed, time, data, pressure and temperature without the head-scratching."
    >
      <div class="math-grid pop-in">
        <section class="math-card">
          <h3 class="qr-heading">Category</h3>
          <div class="math-tabs" role="group" aria-label="Category">
            {{#each this.categories as |c|}}
              <button
                type="button"
                class="qr-tab {{if (eq this.category c) 'active'}}"
                {{on "click" (fn this.setCategory c)}}
              >{{c}}</button>
            {{/each}}
          </div>

          <div class="math-row is-aligned">
            <label class="math-field">
              <span class="qr-label is-muted">From</span>
              <input
                type="number"
                class="math-input"
                value={{this.fromValue}}
                {{on "input" this.setFromValue}}
              />
            </label>
            <label class="math-field">
              <span class="qr-label is-muted">Unit</span>
              <select class="select" {{on "change" this.setFromUnit}}>
                {{#each this.unitOptions as |u|}}
                  <option
                    value={{u}}
                    selected={{eq this.fromUnit u}}
                  >{{u}}</option>
                {{/each}}
              </select>
            </label>
            <button
              type="button"
              class="btn math-swap"
              aria-label="Swap units"
              {{on "click" this.swap}}
            ><Icon @name="refresh-cw" @size={{14}} /></button>
            <label class="math-field">
              <span class="qr-label is-muted">To unit</span>
              <select class="select" {{on "change" this.setToUnit}}>
                {{#each this.unitOptions as |u|}}
                  <option
                    value={{u}}
                    selected={{eq this.toUnit u}}
                  >{{u}}</option>
                {{/each}}
              </select>
            </label>
          </div>

          <div class="math-result">
            <span class="qr-label is-muted">{{this.fromValue}}
              {{this.fromUnit}}
              =</span>
            <span class="math-big">{{this.resultText}}
              <small>{{this.toUnit}}</small></span>
          </div>
        </section>

        <section class="math-card">
          <h3 class="qr-heading">1 {{this.fromUnit}} equals…</h3>
          <div class="math-stats">
            {{#each this.referenceRows as |row|}}
              <div class="math-stat"><span>{{row.unit}}</span><strong
                >{{row.text}}</strong></div>
            {{/each}}
          </div>
        </section>
      </div>
    </ToolPage>
  </template>
}

function eq(a, b) {
  return a === b;
}
