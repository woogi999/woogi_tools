import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import Icon from './icon';
import { fieldsOf, nodeInfo, rgbOf } from '../utils/skillbuilder/schema';

// The settings of one Skill Builder node. Every field of its kind is listed;
// one the node doesn't carry shows JJS's usual value greyed out, and is only
// written once it's changed. Fields this doesn't know are edited by type.
// Args: @node, @branches (names, for suggestions), @uid (for ids),
// @onSet(key, value), @onClear(key).

const eq = (a, b) => a === b;

const toHex = (rgb) =>
  `#${rgbOf(rgb)
    .map((c) => Math.round(c).toString(16).padStart(2, '0'))
    .join('')}`;

export default class WsNodeInspector extends Component {
  get info() {
    return nodeInfo(this.args.node?.K_NAME);
  }

  get rows() {
    const node = this.args.node ?? {};
    return fieldsOf(node).map((field) => {
      const has = field.key in node;
      const value = has ? node[field.key] : field.def;
      return {
        ...field,
        has,
        value,
        id: `${this.args.uid}-${field.key.replace(/\W+/g, '-')}`,
        text: this.show(field, value),
        pairA: Array.isArray(value) ? value[0] : '',
        pairB: Array.isArray(value) ? value[1] : '',
        hex: field.type === 'color' ? toHex(value) : null,
        swatch: field.type === 'color' ? htmlSafe(`background:${toHex(value)}`) : null,
        list: field.type === 'choice' ? `${this.args.uid}-${field.key}-options`.replace(/\W+/g, '-') : null,
      };
    });
  }

  show(field, value) {
    if (value === undefined || value === null) return '';
    if (field.type === 'anim') return Array.isArray(value) ? value.join(', ') : String(value);
    if (field.type === 'json') return JSON.stringify(value);
    return String(value);
  }

  read(field, raw) {
    switch (field.type) {
      case 'num': {
        const n = Number(raw);
        return raw.trim() === '' ? field.def : Number.isFinite(n) ? n : field.def;
      }
      case 'anim': {
        const parts = raw.split(',').map((s) => s.trim());
        return parts.length === 2 && parts.every((s) => s !== '' && Number.isFinite(Number(s)))
          ? parts.map(Number)
          : raw.trim();
      }
      case 'json':
        try {
          return JSON.parse(raw);
        } catch {
          return undefined;
        }
      default:
        return raw;
    }
  }

  setText = (field, event) => {
    const value = this.read(field, event.target.value);
    if (value !== undefined) this.args.onSet(field.key, value);
  };

  setBool = (field, event) => this.args.onSet(field.key, event.target.checked);

  setPair = (field, which, event) => {
    const current = Array.isArray(field.value) ? [...field.value] : [0, 0];
    const n = Number(event.target.value);
    current[which] = Number.isFinite(n) ? n : 0;
    this.args.onSet(field.key, current);
  };

  setColour = (field, event) => {
    const hex = event.target.value;
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    this.args.onSet(field.key, rgb.join(', '));
  };

  clear = (key) => this.args.onClear(key);

  <template>
    <div class="ws-inspector">
      <p class="ws-about">{{this.info.about}}</p>
      <datalist id="{{@uid}}-branches">
        {{#each @branches as |b|}}<option value={{b}}></option>{{/each}}
      </datalist>
      {{#each this.rows key="key" as |f|}}
        <div class="ws-field {{if f.has 'is-set' 'is-default'}} {{if f.unknown 'is-unknown'}}">
          <label class="ws-field-label" for={{f.id}} title={{f.hint}}>
            {{if f.label f.label f.key}}
            {{#if f.hint}}<Icon @name="info" @size={{11}} />{{/if}}
          </label>
          <div class="ws-field-input">
            {{#if (eq f.type "bool")}}
              <input
                id={{f.id}}
                type="checkbox"
                checked={{f.value}}
                {{on "change" (fn this.setBool f)}}
              />
            {{else if (eq f.type "pair")}}
              <input
                id={{f.id}}
                type="number"
                step="any"
                class="math-input"
                value={{f.pairA}}
                {{on "change" (fn this.setPair f 0)}}
              />
              <input
                type="number"
                step="any"
                class="math-input"
                aria-label="{{f.key}} end"
                value={{f.pairB}}
                {{on "change" (fn this.setPair f 1)}}
              />
            {{else if (eq f.type "color")}}
              <span class="ws-swatch" style={{f.swatch}}>
                <input
                  type="color"
                  value={{f.hex}}
                  aria-label="{{f.key}} picker"
                  {{on "input" (fn this.setColour f)}}
                />
              </span>
              <input
                id={{f.id}}
                type="text"
                class="math-input"
                spellcheck="false"
                value={{f.text}}
                {{on "change" (fn this.setText f)}}
              />
            {{else if (eq f.type "json")}}
              <textarea
                id={{f.id}}
                class="math-input"
                rows="2"
                spellcheck="false"
                value={{f.text}}
                {{on "change" (fn this.setText f)}}
              ></textarea>
            {{else}}
              <input
                id={{f.id}}
                type={{if (eq f.type "num") "number" "text"}}
                step="any"
                class="math-input"
                spellcheck="false"
                list={{if
                  (eq f.type "branch")
                  (concatId @uid "branches")
                  f.list
                }}
                value={{f.text}}
                {{on "change" (fn this.setText f)}}
              />
              {{#if f.list}}
                <datalist id={{f.list}}>
                  {{#each f.options as |o|}}<option value={{o}}></option>{{/each}}
                </datalist>
              {{/if}}
            {{/if}}
            {{#if f.has}}
              <button
                type="button"
                class="ws-field-reset"
                title="Remove: JJS uses its usual value"
                aria-label="Remove {{f.key}}"
                {{on "click" (fn this.clear f.key)}}
              ><Icon @name="x" @size={{11}} /></button>
            {{/if}}
          </div>
        </div>
      {{/each}}
    </div>
  </template>
}

function concatId(uid, name) {
  return `${uid}-${name}`;
}
