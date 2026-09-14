import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { TABS, parseNotes, filterGroups } from '../utils/jjs';

const eq = (a, b) => a === b;
const COPIED_MS = 1200;

// Jujutsu Shenanigans Skill Builder notes: sound IDs, animation directions,
// move startups and presets, sorted into tabs you can search and copy from.
export default class JjsStuffPage extends Component {
  tabs = TABS;

  @tracked tab = 'sounds';
  @tracked query = '';
  @tracked data = null;
  @tracked failed = false;
  @tracked copied = null;

  copyTimer = null;

  constructor(owner, args) {
    super(owner, args);
    // The notes are ~100 KB of text, so they're only fetched when this page opens.
    import('../lazy/jjs-data')
      .then((module) => {
        if (!this.isDestroying) this.data = module;
      })
      .catch(() => (this.failed = true));
    registerDestructor(this, () => clearTimeout(this.copyTimer));
  }

  @cached
  get parsed() {
    if (!this.data) return null;
    return Object.fromEntries(TABS.filter((t) => t.source).map((t) => [t.id, parseNotes(this.data.RAW[t.source])]));
  }

  get current() {
    return TABS.find((t) => t.id === this.tab);
  }

  get isPresets() {
    return this.tab === 'presets';
  }

  get presets() {
    const q = this.query.trim().toLowerCase();
    const all = this.data?.PRESETS ?? [];
    return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  }

  @cached
  get results() {
    const parsed = this.parsed;
    if (!parsed) return {};
    return Object.fromEntries(Object.entries(parsed).map(([id, notes]) => [id, filterGroups(notes.groups, this.query)]));
  }

  get groups() {
    return this.results[this.tab] ?? [];
  }

  get intro() {
    return this.query.trim() ? [] : (this.parsed?.[this.tab]?.intro ?? []);
  }

  // While searching, each tab shows how many rows matched, so a hit on another tab isn't missed.
  get tabItems() {
    const searching = Boolean(this.query.trim());
    return TABS.map((t) => {
      let count = null;
      if (searching && this.parsed) count = t.source ? this.results[t.id].reduce((n, g) => n + g.rows.length, 0) : this.presets.length;
      return { ...t, count };
    });
  }

  // The characters and categories in this tab, to jump straight to one.
  get sections() {
    const seen = new Map();
    for (const group of this.groups) {
      const name = group.parent || group.title;
      if (!seen.has(name)) seen.set(name, group.key);
    }
    return seen.size > 1 ? [...seen].map(([name, key]) => ({ name, key })) : [];
  }

  get rowCount() {
    return this.groups.reduce((n, g) => n + g.rows.length, 0);
  }

  setTab = (id) => (this.tab = id);
  setQuery = (event) => (this.query = event.target.value);
  clearQuery = () => (this.query = '');

  jump = (event) => {
    const key = event.target.value;
    event.target.value = '';
    document.getElementById(`jjs-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // clipboard permission denied; the ID is still selectable on screen
    }
    this.copied = value;
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => (this.copied = null), COPIED_MS);
  };

  <template>
    <ToolPage @route="jjs-stuff" @subtitle="Jujutsu Shenanigans Skill Builder notes: every sound ID, emote music, punch, kick and flip directions, run animations, move startups and presets. Tap an ID to copy it.">
      <div class="jjs pop-in">
        <div class="jjs-bar">
          <div class="home-chips jjs-tabs" role="tablist" aria-label="Sections">
            {{#each this.tabItems key="id" as |t|}}
              <button type="button" role="tab" class="home-chip {{if (eq this.tab t.id) 'active'}} {{if (eq t.count 0) 'is-empty'}}" aria-selected={{if (eq this.tab t.id) "true" "false"}} {{on "click" (fn this.setTab t.id)}}>
                {{t.label}}{{#if t.count}} <span class="jjs-tab-count">{{t.count}}</span>{{/if}}
              </button>
            {{/each}}
          </div>
          <div class="jjs-search-row">
            <label class="jjs-search">
              <Icon @name="search" @size={{15}} />
              <input type="search" class="math-input" placeholder="Search: gojo red, black flash, 1.2x, conga…" aria-label="Search the notes" value={{this.query}} {{on "input" this.setQuery}} />
              {{#if this.query}}
                <button type="button" class="qr-icon-btn" aria-label="Clear search" {{on "click" this.clearQuery}}><Icon @name="x" @size={{14}} /></button>
              {{/if}}
            </label>
            {{#if this.sections.length}}
              <select class="jjs-jump" aria-label="Jump to" {{on "change" this.jump}}>
                <option value="">Jump to…</option>
                {{#each this.sections key="key" as |s|}}
                  <option value={{s.key}}>{{s.name}}</option>
                {{/each}}
              </select>
            {{/if}}
          </div>
          <p class="tool-hint">{{this.current.hint}}</p>
        </div>

        {{#if this.failed}}
          <p class="tool-error">Couldn’t load the notes. Check your connection and reload the page.</p>
        {{else if this.data}}
          {{#if this.isPresets}}
            <div class="jjs-presets">
              {{#each this.presets key="name" as |p|}}
                <div class="math-card jjs-preset">
                  <span class="jjs-preset-name"><Icon @name="sparkles" @size={{14}} /> {{p.name}}</span>
                  <button type="button" class="btn {{if (eq this.copied p.text) 'copied active'}}" {{on "click" (fn this.copy p.text)}}>
                    <Icon @name={{if (eq this.copied p.text) "check" "copy"}} @size={{13}} />
                    {{if (eq this.copied p.text) "Copied" "Copy preset"}}
                  </button>
                </div>
              {{else}}
                <p class="tool-hint">No presets match “{{this.query}}”.</p>
              {{/each}}
            </div>
            <p class="tool-hint">VFX presets made by TheNoob (@dhdvru2i on Discord).</p>
          {{else}}
            {{#if this.intro.length}}
              <div class="jjs-intro">
                {{#each this.intro as |line|}}<p>{{line}}</p>{{/each}}
              </div>
            {{/if}}
            {{#if this.query}}
              <p class="tool-hint">{{this.rowCount}} {{if (eq this.rowCount 1) "match" "matches"}} in {{this.current.label}}.</p>
            {{/if}}
            <div class="jjs-groups">
              {{#each this.groups key="key" as |group|}}
                <section class="jjs-group" id="jjs-{{group.key}}">
                  <header class="jjs-group-head">
                    {{#if group.parent}}<span class="jjs-group-parent">{{group.parent}}</span>{{/if}}
                    <h3 class="qr-heading">{{group.title}}</h3>
                    {{#if group.note}}<span class="tool-hint">{{group.note}}</span>{{/if}}
                  </header>
                  <ul class="jjs-rows">
                    {{#each group.rows as |row|}}
                      {{#if (eq row.kind "sound")}}
                        <li class="jjs-row">
                          <button type="button" class="jjs-id {{if (eq this.copied row.id) 'is-copied'}}" title="Copy {{row.id}}" {{on "click" (fn this.copy row.id)}}>
                            <Icon @name={{if (eq this.copied row.id) "check" "copy"}} @size={{11}} />{{row.id}}
                          </button>
                          <span class="jjs-label">{{row.label}}</span>
                          {{#if row.speed}}<span class="lobby-tag jjs-speed">{{row.speed}}</span>{{/if}}
                        </li>
                      {{else if (eq row.kind "startup")}}
                        <li class="jjs-row">
                          <span class="jjs-label">{{row.name}}</span>
                          <span class="lobby-tag jjs-time">{{row.time}}s</span>
                          {{#if row.note}}<span class="jjs-note">{{row.note}}</span>{{/if}}
                        </li>
                      {{else if (eq row.kind "sub")}}
                        <li class="jjs-sub">{{row.text}}{{#if row.note}} <span class="jjs-note">{{row.note}}</span>{{/if}}</li>
                      {{else}}
                        <li class="jjs-row is-text">{{row.text}}</li>
                      {{/if}}
                    {{/each}}
                  </ul>
                </section>
              {{else}}
                <p class="tool-hint">Nothing in {{this.current.label}} matches “{{this.query}}”.</p>
              {{/each}}
            </div>
          {{/if}}
        {{else}}
          <p class="tool-hint">Loading the notes…</p>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
