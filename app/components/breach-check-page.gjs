import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';
import {
  pwnedCount,
  allBreaches,
  xposedOrNot,
  leakCheck,
} from '../utils/osint';

// Breach Check: an email and/or a password in, one report out. The email is
// asked of two open databases at once (XposedOrNot, and LeakCheck's public
// API through the Worker), their answers are merged by breach name, and each
// breach is filled in from Have I Been Pwned's catalogue where it knows it.
// The password goes to Pwned Passwords as a 5-character hash prefix only.

const SHOWN = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const number = (n) => Number(n).toLocaleString();

// "Gemini.com", "gemini" and "Gemini" are the same breach to every source.
const keyOf = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/\.(com|net|org|io|co|ru|de|fr|uk|info|me)$/, '')
    .replace(/[^a-z0-9]/g, '');

const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error: error.message }),
  );

export default class BreachCheckPage extends Component {
  @tracked email = '';
  @tracked password = '';
  @tracked busy = false;
  @tracked error = null;
  @tracked report = null;

  @tracked query = '';
  @tracked catalogue = null;
  @tracked catalogueError = null;

  controller = null;
  life = new AbortController();

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'breach-check', ['email', 'query']);
    registerDestructor(this, () => {
      this.life.abort();
      this.controller?.abort();
    });
    allBreaches(this.life.signal)
      .then((list) => (this.catalogue = Array.isArray(list) ? list : []))
      .catch((error) => {
        if (!this.life.signal.aborted) this.catalogueError = error.message;
      });
  }

  setEmail = (event) => (this.email = event.target.value);
  setPassword = (event) => (this.password = event.target.value);
  setQuery = (event) => (this.query = event.target.value);

  check = async (event) => {
    event.preventDefault();
    const email = this.email.trim();
    const password = this.password;
    if (!email && !password) {
      this.error = 'Type an email address, a password, or both.';
      return;
    }
    if (email && !EMAIL.test(email)) {
      this.error = "That doesn't look like an email address.";
      return;
    }
    this.controller?.abort();
    const controller = (this.controller = new AbortController());
    const signal = controller.signal;
    this.busy = true;
    this.error = null;
    this.report = null;
    const [xon, leak, pw, hibp] = await Promise.all([
      email ? settle(xposedOrNot(email, signal)) : null,
      email ? settle(leakCheck(email, signal)) : null,
      password ? settle(pwnedCount(password, signal)) : null,
      settle(allBreaches(signal)),
    ]);
    if (signal.aborted) return;
    this.report = this.build(email, { xon, leak, pw, hibp });
    this.busy = false;
  };

  build(email, { xon, leak, pw, hibp }) {
    const catalogue = Array.isArray(hibp.value) ? hibp.value : [];
    const byKey = new Map();
    for (const b of catalogue) {
      byKey.set(keyOf(b.name), b);
      byKey.set(keyOf(b.title), b);
      if (b.domain) byKey.set(keyOf(b.domain), b);
    }
    const merged = new Map();
    const add = (name, source, extra = {}) => {
      const key = keyOf(name);
      if (!key) return;
      const row = merged.get(key) ?? { name, sources: [], data: [] };
      row.sources.push(source);
      for (const [k, v] of Object.entries(extra))
        if (v && (!row[k] || (Array.isArray(v) && v.length > row[k].length)))
          row[k] = v;
      merged.set(key, row);
    };
    for (const b of xon?.value ?? [])
      add(b.name, 'XposedOrNot', {
        domain: b.domain,
        date: b.year,
        records: b.records,
        data: b.data,
        description: b.description,
      });
    for (const s of leak?.value?.sources ?? [])
      add(s.name, 'LeakCheck', { date: s.date });
    const breaches = [...merged.values()]
      .map((row) => {
        const known =
          byKey.get(keyOf(row.name)) ?? byKey.get(keyOf(row.domain));
        if (known) {
          row.title = known.title;
          row.domain ||= known.domain;
          row.date = known.date || row.date;
          row.records ||= known.count;
          if (known.classes.length > row.data.length) row.data = known.classes;
          row.description ||= known.description.replace(/<[^>]+>/g, '');
          row.sources.push('HIBP');
        }
        return {
          ...row,
          title: row.title ?? row.name,
          records: row.records ? number(row.records) : null,
          data: row.data.join(', '),
          sources: row.sources.join(' · '),
          passwords: row.data.some((d) => /password/i.test(d)),
        };
      })
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    const errors = [
      xon?.error && `XposedOrNot: ${xon.error}`,
      leak?.error && `LeakCheck: ${leak.error}`,
      pw?.error && `Pwned Passwords: ${pw.error}`,
    ].filter(Boolean);
    return {
      email,
      emailChecked: Boolean(email) && !(xon?.error && leak?.error),
      breaches,
      withPasswords: breaches.filter((b) => b.passwords).length,
      leakFields: (leak?.value?.fields ?? []).join(', '),
      password:
        pw && !pw.error
          ? { count: pw.value, seen: number(pw.value), bad: pw.value > 0 }
          : null,
      errors,
    };
  }

  get matches() {
    if (!this.catalogue) return [];
    let q = this.query.trim().toLowerCase();
    if (q.includes('@')) q = q.split('@')[1];
    const list = q
      ? this.catalogue.filter(
          (b) =>
            b.domain?.toLowerCase().includes(q) ||
            b.title.toLowerCase().includes(q) ||
            b.classes.some((c) => c.toLowerCase().includes(q)),
        )
      : [...this.catalogue].sort((a, b) => b.date.localeCompare(a.date));
    return list.slice(0, SHOWN).map((b) => ({
      ...b,
      count: number(b.count),
      classes: b.classes.join(', '),
      description: b.description.replace(/<[^>]+>/g, ''),
    }));
  }

  get total() {
    return this.catalogue ? number(this.catalogue.length) : '…';
  }

  <template>
    <ToolPage
      @route="breach-check"
      @busy={{this.busy}}
      @closeWarning="Close Breach Check? The check still running will stop."
      @subtitle="Has your email or password leaked? One check against XposedOrNot, LeakCheck and Have I Been Pwned together."
    >
      <div class="pop-in">
        <form class="math-card osint-breach-form" {{on "submit" this.check}}>
          <input
            type="email"
            class="math-input"
            placeholder="you@example.com"
            autocomplete="email"
            aria-label="Email address"
            value={{this.email}}
            {{on "input" this.setEmail}}
          />
          <input
            type="password"
            class="math-input"
            placeholder="A password (optional)"
            autocomplete="off"
            aria-label="Password"
            value={{this.password}}
            {{on "input" this.setPassword}}
          />
          <button type="submit" class="btn active" disabled={{this.busy}}>
            <Icon @name="shield-alert" @size={{13}} />
            {{if this.busy "Checking…" "Check"}}</button>
        </form>
        {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}

        {{#if this.report}}
          <section class="math-card">
            {{#if this.report.password}}
              {{#if this.report.password.bad}}
                <p class="osint-verdict is-bad">The password has been seen
                  {{this.report.password.seen}}
                  times in leaked data. Don't use it anywhere.</p>
              {{else}}
                <p class="osint-verdict is-good">The password isn't in any known
                  leak.</p>
              {{/if}}
            {{/if}}
            {{#if this.report.emailChecked}}
              {{#if this.report.breaches.length}}
                <p class="osint-verdict is-bad">{{this.report.email}}
                  is in
                  {{this.report.breaches.length}}
                  breaches{{#if this.report.withPasswords}}, and
                    {{this.report.withPasswords}}
                    of them leaked passwords{{/if}}.</p>
                {{#if this.report.leakFields}}
                  <p class="tool-hint">Kinds of data LeakCheck has for it:
                    {{this.report.leakFields}}.</p>
                {{/if}}
                <ul class="osint-breaches">
                  {{#each this.report.breaches as |b|}}
                    <li>
                      <div class="osint-breach-head">
                        <strong>{{b.title}}</strong>
                        {{#if b.domain}}<code>{{b.domain}}</code>{{/if}}
                        <span class="is-muted">{{b.date}}{{#if b.records}}
                            ·
                            {{b.records}}
                            accounts{{/if}}</span>
                      </div>
                      {{#if b.data}}<p
                          class="osint-classes"
                        >{{b.data}}</p>{{/if}}
                      {{#if b.description}}
                        <p class="is-muted osint-desc">{{b.description}}</p>
                      {{/if}}
                      <p class="is-muted osint-sources">Found by
                        {{b.sources}}</p>
                    </li>
                  {{/each}}
                </ul>
              {{else}}
                <p class="osint-verdict is-good">{{this.report.email}}
                  isn't in any breach these databases know of.</p>
              {{/if}}
            {{/if}}
            {{#each this.report.errors as |e|}}
              <p class="tool-error">{{e}}</p>
            {{/each}}
          </section>
        {{/if}}

        <p class="tool-hint">The password never leaves your device: it's hashed
          with SHA-1 here and only the first 5 of the hash's 40 characters are
          sent. The email is sent to XposedOrNot and LeakCheck to look up.</p>

        <details class="math-card osint-details">
          <summary>Browse all
            {{this.total}}
            breaches Have I Been Pwned knows</summary>
          <input
            type="search"
            class="math-input"
            placeholder="Site, email provider or data type (adobe.com, yahoo.com, passwords)"
            aria-label="Search breaches"
            value={{this.query}}
            {{on "input" this.setQuery}}
          />
          {{#if this.catalogueError}}
            <p class="tool-error">{{this.catalogueError}}</p>
          {{else}}
            <ul class="osint-breaches">
              {{#each this.matches as |b|}}
                <li>
                  <div class="osint-breach-head">
                    <strong>{{b.title}}</strong>
                    {{#if b.domain}}<code>{{b.domain}}</code>{{/if}}
                    <span class="is-muted">{{b.date}}
                      ·
                      {{b.count}}
                      accounts</span>
                  </div>
                  <p class="osint-classes">{{b.classes}}</p>
                  <p class="is-muted osint-desc">{{b.description}}</p>
                </li>
              {{else}}
                <li class="tool-hint">{{if
                    this.catalogue
                    "No known breach matches that."
                    "Loading…"
                  }}</li>
              {{/each}}
            </ul>
          {{/if}}
        </details>
      </div>
    </ToolPage>
  </template>
}
