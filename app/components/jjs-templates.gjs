import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { LinkTo } from '@ember/routing';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import { waitForPromise } from '@ember/test-waiters';
import Icon from './icon';
import { encodeMoveset } from '../utils/skillbuilder/format';
import { TEMPLATES, defaultsOf } from '../utils/jjs-templates';

const eq = (a, b) => a === b;
const COPIED_MS = 1200;

export const matchTemplates = (query) => {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  return q
    ? TEMPLATES.filter((t) =>
        `${t.name} ${t.blurb} ${t.from}`.toLowerCase().includes(q),
      )
    : TEMPLATES;
};

// JJS Stuff's Templates tab: pick a ready-made skill, fill in its form, copy
// the code into the Skill Builder. The templates are utils/jjs-templates.js.
export default class JjsTemplates extends Component {
  @tracked picked = TEMPLATES[0].id;
  // Each template's values, kept while you look at another.
  @tracked values = {};
  @tracked code = '';
  @tracked error = null;
  @tracked copied = false;

  copyTimer = null;
  run = 0;

  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => clearTimeout(this.copyTimer));
  }

  // Builds the code for whichever template is showing, picked or left by a search.
  follow = modifier((_element, [_id]) => {
    this.refresh();
  });

  get list() {
    return matchTemplates(this.args.query);
  }

  // The picked one, or the first a search left.
  get template() {
    const list = this.list;
    return list.find((t) => t.id === this.picked) ?? list[0] ?? null;
  }

  get current() {
    const t = this.template;
    return t ? { ...defaultsOf(t), ...this.values[t.id] } : {};
  }

  @cached
  get sections() {
    const values = this.current;
    return (this.template?.sections ?? []).map((section) => ({
      title: section.title,
      fields: section.fields
        .filter((f) => !f.when || values[f.when])
        .map((f) => ({ ...f, value: values[f.key] })),
    }));
  }

  get usage() {
    return this.template?.usage(this.current);
  }

  pick = (id) => (this.picked = id);

  set = (field, event) => {
    const { target } = event;
    const value =
      field.type === 'bool'
        ? target.checked
        : field.type === 'number'
          ? Number(target.value) || 0
          : target.value;
    const t = this.template;
    this.values = {
      ...this.values,
      [t.id]: { ...this.values[t.id], [field.key]: value },
    };
    this.refresh();
  };

  reset = () => {
    const { [this.template.id]: _gone, ...rest } = this.values;
    this.values = rest;
    this.refresh();
  };

  // Rebuilt on every change; a slower, older build never overwrites a newer one.
  refresh = () => waitForPromise(this.rebuild());

  rebuild = async () => {
    const run = ++this.run;
    // Out of the render that asked for it before touching anything tracked.
    await Promise.resolve();
    if (this.isDestroying || run !== this.run) return;
    this.copied = false;
    const t = this.template;
    if (!t) return;
    let code = '';
    let error = null;
    try {
      code = await encodeMoveset(t.build(this.current));
    } catch (e) {
      error = e.message;
    }
    if (this.isDestroying || run !== this.run) return;
    this.code = code;
    this.error = error;
  };

  copy = async () => {
    try {
      await navigator.clipboard.writeText(this.code);
    } catch {
      // clipboard permission denied; the code is still selectable below
    }
    this.copied = true;
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => (this.copied = false), COPIED_MS);
  };

  <template>
    {{#if this.template}}
      <div class="jjs-tpl">
        <div class="jjs-tpl-list" role="listbox" aria-label="Templates">
          {{#each this.list key="id" as |t|}}
            <button
              type="button"
              role="option"
              class="jjs-tpl-pick {{if (eq t.id this.template.id) 'active'}}"
              aria-selected={{if (eq t.id this.template.id) "true" "false"}}
              {{on "click" (fn this.pick t.id)}}
            >
              <Icon @name={{t.icon}} @size={{22}} />
              <span class="jjs-tpl-pick-text">
                <span class="jjs-tpl-name">{{t.name}}</span>
                <span class="jjs-tpl-from">{{t.from}}</span>
              </span>
            </button>
          {{/each}}
        </div>

        <section
          class="jjs-tpl-form"
          aria-label={{this.template.name}}
          {{this.follow this.template.id}}
        >
          <header class="jjs-tpl-head">
            <h3 class="qr-heading">{{this.template.name}}</h3>
            <p class="tool-hint">{{this.template.blurb}}</p>
            {{#if this.template.link}}
              <LinkTo
                @route={{this.template.link.route}}
                class="jjs-tpl-link"
              ><Icon @name="arrow-right" @size={{13}} />
                {{this.template.link.label}}</LinkTo>
            {{/if}}
          </header>

          {{#each this.sections as |section|}}
            <fieldset class="jjs-tpl-section">
              <legend>{{section.title}}</legend>
              <div class="jjs-tpl-fields">
                {{#each section.fields key="key" as |field|}}
                  {{#if (eq field.type "bool")}}
                    <label class="math-check jjs-tpl-wide"><input
                        type="checkbox"
                        name={{field.key}}
                        checked={{field.value}}
                        {{on "change" (fn this.set field)}}
                      />
                      {{field.label}}</label>
                  {{else}}
                    <label
                      class="jjs-tpl-field
                        {{if (eq field.type 'ids') 'jjs-tpl-wide'}}
                        {{if field.row 'jjs-tpl-row'}}"
                    >
                      <span>{{field.label}}</span>
                      {{#if (eq field.type "ids")}}
                        <textarea
                          class="math-input"
                          name={{field.key}}
                          rows="3"
                          spellcheck="false"
                          value={{field.value}}
                          {{on "input" (fn this.set field)}}
                        ></textarea>
                      {{else if (eq field.type "choice")}}
                        <select
                          class="math-input"
                          name={{field.key}}
                          {{on "change" (fn this.set field)}}
                        >
                          {{#each field.options as |choice|}}
                            <option
                              value={{choice}}
                              selected={{eq choice field.value}}
                            >{{choice}}</option>
                          {{/each}}
                        </select>
                      {{else if (eq field.type "number")}}
                        <input
                          type="number"
                          class="math-input"
                          name={{field.key}}
                          step={{if field.step field.step "any"}}
                          value={{field.value}}
                          {{on "change" (fn this.set field)}}
                        />
                      {{else}}
                        <input
                          type="text"
                          class="math-input"
                          name={{field.key}}
                          spellcheck="false"
                          value={{field.value}}
                          {{on "change" (fn this.set field)}}
                        />
                      {{/if}}
                      {{#if field.hint}}
                        <small class="jjs-note">{{field.hint}}</small>
                      {{/if}}
                    </label>
                  {{/if}}
                {{/each}}
              </div>
            </fieldset>
          {{/each}}

          <div class="jjs-tpl-out">
            {{#if this.error}}
              <p class="tool-hint jjs-tpl-error">{{this.error}}</p>
            {{else if this.code}}
              <p class="tool-hint">{{this.usage}}</p>
              <textarea
                class="math-input jjs-tpl-code"
                rows="3"
                readonly
                spellcheck="false"
                aria-label="Skill code"
                value={{this.code}}
              ></textarea>
              <div class="jjs-tpl-actions">
                <button
                  type="button"
                  class="btn jjs-tpl-copy {{if this.copied 'copied active'}}"
                  {{on "click" this.copy}}
                >
                  <Icon @name={{if this.copied "check" "copy"}} @size={{13}} />
                  {{if
                    this.copied
                    "Copied: import it in the Skill Builder"
                    "Copy skill code"
                  }}
                </button>
                <button
                  type="button"
                  class="btn jjs-tpl-reset"
                  {{on "click" this.reset}}
                >Back to the defaults</button>
              </div>
            {{/if}}
          </div>
        </section>
      </div>
    {{else}}
      <p class="tool-hint">No templates match “{{@query}}”.</p>
    {{/if}}
  </template>
}
