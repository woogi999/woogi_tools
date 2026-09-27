import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import StNum from './num';

// Draws a list of parameter specs ({ key, label, type, min, max, step,
// options }) against a values object. @onChange(key, value, final).
// @objects lists [id, name] pairs for 'object' parameters (boolean cutters).

const val = (o, k) => o?.[k];
const eq = (a, b) => String(a) === String(b);
const isType = (p, t) => p.type === t;

function pickBool(onChange, key, e) {
  onChange(key, e.target.checked, true);
}

function pickSelect(onChange, key, options, e) {
  const raw = e.target.value;
  const opt = options.find((o) => String(o.value) === raw);
  onChange(key, opt ? opt.value : raw, true);
}

function pickObject(onChange, key, e) {
  onChange(key, e.target.value || null, true);
}

function numChange(onChange, key, value, final) {
  onChange(key, value, final);
}

<template>
  <div class="st-params">
    {{#each @params as |p|}}
      {{#if (isType p "bool")}}
        <label class="st-check">
          <input
            type="checkbox"
            checked={{val @values p.key}}
            {{on "change" (fn pickBool @onChange p.key)}}
          />
          <span>{{p.label}}</span>
        </label>
      {{else if (isType p "select")}}
        <label class="st-field">
          <span>{{p.label}}</span>
          <select {{on "change" (fn pickSelect @onChange p.key p.options)}}>
            {{#each p.options as |o|}}
              <option
                value={{o.value}}
                selected={{eq o.value (val @values p.key)}}
              >{{o.label}}</option>
            {{/each}}
          </select>
        </label>
      {{else if (isType p "object")}}
        <label class="st-field">
          <span>{{p.label}}</span>
          <select {{on "change" (fn pickObject @onChange p.key)}}>
            <option value="">None</option>
            {{#each @objects as |o|}}
              <option
                value={{val o 0}}
                selected={{eq (val o 0) (val @values p.key)}}
              >{{val o 1}}</option>
            {{/each}}
          </select>
        </label>
      {{else}}
        <StNum
          @label={{p.label}}
          @value={{val @values p.key}}
          @min={{p.min}}
          @max={{p.max}}
          @step={{p.step}}
          @int={{isType p "int"}}
          @onChange={{fn numChange @onChange p.key}}
        />
      {{/if}}
    {{/each}}
  </div>
</template>
