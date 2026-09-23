import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import { htmlSafe } from '@ember/template';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';
import {
  checkUsernames,
  checkCustomSite,
  profileAccounts,
} from '../utils/osint';
import {
  USERNAME_SITES,
  USERNAME_PATTERN,
  fill,
} from '../utils/username-sites';
import {
  buildReport,
  buildGraph,
  exportJson,
  exportPdf,
  NODE_KINDS,
} from '../utils/user-profile';

// User Profiling, the way Maigret does it: find every account under a
// username, read what each one says about its owner, merge that into one
// picture of the person, and follow any other usernames it turns up.
//
// Sites go to the Worker 25 to a request (its limit), a few requests at a
// time, so results fill in batch by batch. Found accounts are then read for
// their profile data 10 to a request, while the search carries on.
const BATCH = 25;
const PARALLEL = 16;
const PROFILE_BATCH = 10;
const PROFILE_PARALLEL = 4;
const ADULT_COUNT = USERNAME_SITES.filter((s) => s.nsfw).length;
const SAFE_COUNT = USERNAME_SITES.length - ADULT_COUNT;
const TABS = [
  ['profile', 'Profile'],
  ['accounts', 'Accounts'],
  ['graph', 'Graph'],
];

const day = (iso) => new Date(iso).toLocaleDateString();

export default class UsernameSearchPage extends Component {
  @tracked input = '';
  @tracked names = [];
  @tracked rows = [];
  @tracked checking = 0;
  @tracked profiling = 0;
  @tracked error = null;
  @tracked showAll = false;
  @tracked adult = false;
  @tracked tab = 'profile';
  @tracked exporting = null;
  adultCount = ADULT_COUNT;
  tabs = TABS;
  kinds = Object.values(NODE_KINDS).map((k) => ({
    ...k,
    swatch: htmlSafe(`background: ${k.colour}`),
  }));

  // Sites the person added themselves, kept in this browser.
  @tracked customSites = [];
  @tracked newUrl = '';
  @tracked newName = '';
  @tracked newAbsent = '';
  @tracked newKnown = '';
  @tracked adding = false;
  @tracked addError = null;

  controller = new AbortController();
  profileQueue = [];

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'username-search', ['input', 'customSites', 'adult']);
    registerDestructor(this, () => this.controller.abort());
  }

  // ─── What the page shows ──────────────────────────────────────────

  get busy() {
    return this.checking > 0 || this.profiling > 0;
  }

  get siteCount() {
    return (this.adult ? USERNAME_SITES.length : SAFE_COUNT).toLocaleString();
  }

  get done() {
    return this.rows.filter((r) => r.state !== 'pending').length;
  }

  get found() {
    return this.rows.filter((r) => r.state === 'found');
  }

  get profiled() {
    return this.found.filter((r) => r.profiled).length;
  }

  get shown() {
    return this.showAll ? this.rows : this.found;
  }

  get report() {
    return buildReport(
      this.names,
      this.found.map((r) => ({
        username: r.username,
        site: r.site,
        url: r.url,
        profile: r.profile,
      })),
    );
  }

  // The picture from an account that gave the headline name, so it's the
  // person's own avatar rather than some site's default logo.
  get photo() {
    const r = this.report;
    const top = r.personal.find((f) => f.key === 'name')?.values[0];
    return top ? (r.images.find((i) => top.ids.includes(i.id)) ?? null) : null;
  }

  get headline() {
    const r = this.report;
    return r.personal.find((f) => f.key === 'name')?.values[0]?.value ?? null;
  }

  get facts() {
    const r = this.report;
    const out = [
      ['Accounts', String(r.accounts.length)],
      ['Usernames', r.usernames.join(', ')],
    ];
    if (r.earliest)
      out.push([
        'Oldest account',
        `${r.earliest.site}, ${day(r.earliest.date)}`,
      ]);
    if (r.followers) out.push(['Followers', r.followers.toLocaleString()]);
    return out.map(([label, value]) => ({ label, value }));
  }

  get personal() {
    return this.report.personal.map((f) => ({
      ...f,
      values: f.values.slice(0, f.key === 'bio' ? 6 : 12).map((v) => ({
        ...v,
        sources: v.sources.join(', '),
        isLink: /^https?:\/\//.test(v.value),
      })),
    }));
  }

  get linked() {
    return this.report.linked.map((l) => ({
      ...l,
      via: l.via.join(', '),
      searched: this.names.some(
        (n) => n.toLowerCase() === l.username.toLowerCase(),
      ),
    }));
  }

  // The layout is the expensive part, so it's redone only when what it
  // draws has changed.
  memo = { key: null, graph: null };
  get graph() {
    const key = `${this.names.join(',')}|${this.found.length}|${this.profiled}`;
    const memo = this.memo;
    if (key !== memo.key) {
      memo.key = key;
      memo.graph = buildGraph(this.report);
    }
    return memo.graph;
  }

  get isProfile() {
    return this.tab === 'profile';
  }

  get isAccounts() {
    return this.tab === 'accounts';
  }

  get isGraph() {
    return this.tab === 'graph';
  }

  // ─── Actions ──────────────────────────────────────────────────────

  setInput = (event) => (this.input = event.target.value);
  toggleAll = (event) => (this.showAll = event.target.checked);
  toggleAdult = (event) => (this.adult = event.target.checked);
  setTab = (tab) => (this.tab = tab);
  setNew = (field, event) => (this[field] = event.target.value);

  submit = (event) => {
    event.preventDefault();
    const name = this.input.trim().replace(/^@/, '');
    if (!USERNAME_PATTERN.test(name)) {
      this.error =
        'Type a username: letters, numbers, dots, dashes and underscores.';
      return;
    }
    // A new search starts a new investigation.
    this.controller.abort();
    this.controller = new AbortController();
    this.profileQueue = [];
    this.names = [];
    this.rows = [];
    this.checking = 0;
    this.profiling = 0;
    this.tab = 'profile';
    this.search(name);
  };

  // Adds another username (one the profiles linked to) to this investigation.
  follow = (name) => {
    if (this.names.some((n) => n.toLowerCase() === name.toLowerCase())) return;
    if (!USERNAME_PATTERN.test(name)) return;
    this.search(name);
  };

  openNode = (node) => {
    if (node.kind === 'linked') this.follow(node.label);
    else if (node.url) window.open(node.url, '_blank', 'noopener,noreferrer');
  };

  async search(name) {
    const signal = this.controller.signal;
    this.error = null;
    this.names = [...this.names, name];
    const fresh = [
      ...this.customSites.map((custom) => ({
        custom,
        username: name,
        site: `${custom.name} (yours)`,
        url: fill(custom.url, name),
      })),
      ...USERNAME_SITES.flatMap((site, index) =>
        site.nsfw && !this.adult
          ? []
          : [
              {
                index,
                username: name,
                site: site.name,
                adult: Boolean(site.nsfw),
                url: fill(site.url, name),
              },
            ],
      ),
    ].map((r) => ({ ...r, state: 'pending', note: '', profile: null }));
    this.rows = [...this.rows, ...fresh];
    // Each job is one custom site, or a batch of up to BATCH listed ones.
    const listed = fresh.filter((r) => !r.custom);
    const jobs = [
      ...fresh.filter((r) => r.custom).map((r) => [r]),
      ...Array.from({ length: Math.ceil(listed.length / BATCH) }, (_, i) =>
        listed.slice(i * BATCH, (i + 1) * BATCH),
      ),
    ];
    let next = 0;
    const worker = async () => {
      while (next < jobs.length && !signal.aborted) {
        const batch = jobs[next++];
        let results;
        try {
          results = batch[0].custom
            ? [await checkCustomSite(batch[0].custom, name, signal)]
            : (
                await checkUsernames(
                  batch.map((r) => r.index),
                  name,
                  signal,
                )
              ).results;
        } catch {
          results = batch.map(() => ({ state: 'unknown', note: 'no answer' }));
        }
        if (signal.aborted) return;
        const updated = this.update(batch, (row, i) => ({
          state: results[i].state,
          note: results[i].note ?? '',
          profiled: row.custom ? true : undefined,
        }));
        this.queueProfiles(
          updated.filter((r) => r.state === 'found' && !r.custom),
        );
      }
    };
    this.checking++;
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (!signal.aborted) this.checking--;
  }

  // Replaces rows with changed copies; returns the new copies.
  update(rows, change) {
    const byRow = new Map(rows.map((row, i) => [row, change(row, i)]));
    const updated = [];
    this.rows = this.rows.map((r) => {
      const patch = byRow.get(r);
      if (!patch) return r;
      const copy = { ...r, ...patch };
      updated.push(copy);
      return copy;
    });
    return updated;
  }

  queueProfiles(rows) {
    this.profileQueue.push(...rows);
    while (
      this.profiling < PROFILE_PARALLEL &&
      this.profileQueue.length &&
      !this.controller.signal.aborted
    )
      this.profileWorker();
  }

  async profileWorker() {
    const signal = this.controller.signal;
    this.profiling++;
    while (this.profileQueue.length && !signal.aborted) {
      // One request per username, so take a batch that shares one.
      const first = this.profileQueue[0];
      const batch = this.profileQueue
        .filter((r) => r.username === first.username)
        .slice(0, PROFILE_BATCH);
      this.profileQueue = this.profileQueue.filter((r) => !batch.includes(r));
      let profiles;
      try {
        ({ profiles } = await profileAccounts(
          batch.map((r) => r.index),
          first.username,
          signal,
        ));
      } catch {
        profiles = [];
      }
      if (signal.aborted) return;
      // Rows may have been replaced since they were queued; match by identity
      // of site and username instead.
      const want = new Map(
        batch.map((r, i) => [`${r.index}:${r.username}`, profiles[i] ?? null]),
      );
      const current = this.rows.filter((r) =>
        want.has(`${r.index}:${r.username}`),
      );
      this.update(current, (r) => ({
        profile: want.get(`${r.index}:${r.username}`),
        profiled: true,
      }));
    }
    if (!signal.aborted) this.profiling--;
  }

  exportJson = () => exportJson(this.report);

  exportPdf = async () => {
    this.exporting = 'pdf';
    try {
      await exportPdf(this.report, this.graph);
    } catch (error) {
      this.error = `Couldn't make the PDF: ${error.message}`;
    }
    this.exporting = null;
  };

  // ─── Sites the person adds ────────────────────────────────────────

  removeSite = (site) =>
    (this.customSites = this.customSites.filter((s) => s !== site));

  addSite = async (event) => {
    event.preventDefault();
    let url = this.newUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let host = null;
    try {
      host = new URL(url.replaceAll('{}', 'x')).hostname.replace(/^www\./, '');
    } catch {
      // not a link; said below
    }
    if (!host || !url.includes('{}')) {
      this.addError =
        'Paste a profile link with {} where the username goes, like https://example.com/user/{}';
      return;
    }
    const site = {
      name: this.newName.trim() || host,
      url,
      absent: this.newAbsent.trim(),
    };
    // With a name known to exist there, make sure the site can actually tell
    // a real account from a made-up one before trusting it.
    const known = this.newKnown.trim().replace(/^@/, '');
    if (known) {
      this.adding = true;
      this.addError = null;
      const problem = await this.testSite(site, known);
      this.adding = false;
      if (problem) {
        this.addError = problem;
        return;
      }
    }
    this.customSites = [...this.customSites.filter((s) => s.url !== url), site];
    this.newUrl = this.newName = this.newAbsent = this.newKnown = '';
    this.addError = null;
  };

  async testSite(site, known) {
    let real, fake;
    try {
      [real, fake] = await Promise.all([
        checkCustomSite(site, known),
        checkCustomSite(site, `woogi${Date.now().toString(36)}zq`),
      ]);
    } catch (error) {
      return error.message;
    }
    if (real.state === 'unknown' || fake.state === 'unknown')
      return `${site.name} blocks automated checks, so it can't be searched from here.`;
    if (real.state !== 'found')
      return `${known} came back as not found. If a missing user's page still loads normally, put some text only that page shows in the second box.`;
    if (fake.state !== 'absent')
      return `A made-up name came back as found too, so ${site.name} answers every name the same way. Put some text only a missing user's page shows in the second box.`;
    return null;
  }

  <template>
    <ToolPage
      @route="username-search"
      @busy={{this.busy}}
      @closeWarning="Close User Profiling? The sites not yet checked will be skipped."
      @subtitle="One username in; every account under it across {{this.siteCount}} sites, what those profiles say about their owner, and how it all connects."
    >
      <div class="pop-in">
        <form
          class="dl-form"
          aria-label="Profile a username"
          {{on "submit" this.submit}}
        >
          <input
            type="text"
            class="math-input"
            placeholder="username"
            spellcheck="false"
            autocapitalize="off"
            aria-label="Username"
            value={{this.input}}
            {{on "input" this.setInput}}
          />
          <button type="submit" class="btn active" disabled={{this.busy}}>
            <Icon @name="search" @size={{13}} />
            {{if this.busy "Profiling…" "Profile"}}</button>
        </form>
        <label class="osint-toggle osint-adult-toggle"><input
            type="checkbox"
            checked={{this.adult}}
            disabled={{this.busy}}
            {{on "change" this.toggleAdult}}
          />
          Include adult (NSFW) sites ({{this.adultCount}}
          more)</label>
        {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}

        {{#if this.names.length}}
          <div class="osint-bar">
            <span><strong>{{this.found.length}}</strong>
              accounts · checked
              {{this.done}}/{{this.rows.length}}
              · profiles read
              {{this.profiled}}/{{this.found.length}}</span>
            <span class="osint-exports">
              <button type="button" class="btn" {{on "click" this.exportJson}}>
                <Icon @name="download" @size={{12}} />
                JSON</button>
              <button
                type="button"
                class="btn"
                disabled={{this.exporting}}
                {{on "click" this.exportPdf}}
              >
                <Icon @name="file-text" @size={{12}} />
                {{if this.exporting "Making PDF…" "PDF"}}</button>
            </span>
          </div>

          <div class="osint-tabs" role="tablist">
            {{#each this.tabs as |t|}}
              <button
                type="button"
                role="tab"
                class="btn {{if (eqTab this.tab t) 'active'}}"
                aria-selected={{if (eqTab this.tab t) "true" "false"}}
                {{on "click" (fn this.setTab (tabId t))}}
              >{{tabLabel t}}</button>
            {{/each}}
          </div>

          {{#if this.isProfile}}
            <section class="math-card osint-profile">
              <div class="osint-profile-head">
                {{#if this.photo}}
                  <img
                    src={{this.photo.url}}
                    alt="Avatar on {{this.photo.site}}"
                    referrerpolicy="no-referrer"
                    loading="lazy"
                  />
                {{/if}}
                <div>
                  <h3>{{if
                      this.headline
                      this.headline
                      (atName this.names)
                    }}</h3>
                  <dl class="rbx-facts">
                    {{#each this.facts as |f|}}
                      <dt>{{f.label}}</dt><dd>{{f.value}}</dd>
                    {{/each}}
                  </dl>
                </div>
              </div>

              {{#each this.personal as |field|}}
                <h4 class="osint-field">{{field.label}}</h4>
                <ul class="osint-values">
                  {{#each field.values as |v|}}
                    <li>
                      {{#if v.isLink}}
                        <a
                          href={{v.value}}
                          target="_blank"
                          rel="noopener noreferrer"
                        >{{v.value}}</a>
                      {{else}}
                        <span>{{v.value}}</span>
                      {{/if}}
                      <small class="is-muted">{{v.sources}}</small>
                    </li>
                  {{/each}}
                </ul>
              {{else}}
                <p class="tool-hint">{{if
                    this.busy
                    "Reading the profiles as they're found…"
                    "None of the profiles said anything about their owner beyond the account itself."
                  }}</p>
              {{/each}}

              {{#if this.linked.length}}
                <h4 class="osint-field">Other usernames found</h4>
                <ul class="osint-values">
                  {{#each this.linked as |l|}}
                    <li>
                      <strong>{{l.username}}</strong>
                      <small class="is-muted">linked from {{l.via}}</small>
                      {{#unless l.searched}}
                        <button
                          type="button"
                          class="btn"
                          {{on "click" (fn this.follow l.username)}}
                        ><Icon @name="plus" @size={{12}} />
                          Profile this too</button>
                      {{/unless}}
                    </li>
                  {{/each}}
                </ul>
              {{/if}}

              {{#if this.report.links.length}}
                <details class="osint-details">
                  <summary>Other links on the profiles ({{this.report.links.length}})</summary>
                  <ul class="osint-values">
                    {{#each this.report.links as |l|}}
                      <li><a
                          href={{l.url}}
                          target="_blank"
                          rel="noopener noreferrer"
                        >{{l.url}}</a>
                        <small class="is-muted">{{l.source}}</small></li>
                    {{/each}}
                  </ul>
                </details>
              {{/if}}
            </section>
          {{/if}}

          {{#if this.isAccounts}}
            <label class="osint-toggle"><input
                type="checkbox"
                checked={{this.showAll}}
                {{on "change" this.toggleAll}}
              />
              Show every site checked</label>
            <ul class="osint-results">
              {{#each this.shown as |row|}}
                <li class="osint-row is-{{row.state}}">
                  <span class="osint-dot"></span>
                  <a
                    href={{row.url}}
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{row.site}}</a>
                  {{#if row.adult}}<span class="osint-adult">18+</span>{{/if}}
                  {{#if (moreThanOne this.names)}}<small
                      class="is-muted"
                    >@{{row.username}}</small>{{/if}}
                  <span class="is-muted osint-state">{{row.state}}{{#if
                      row.note
                    }}, {{row.note}}{{/if}}</span>
                  {{#if row.profile.name}}
                    <span class="osint-snippet">{{row.profile.name}}{{#if
                        row.profile.location
                      }} · {{row.profile.location}}{{/if}}</span>
                  {{/if}}
                </li>
              {{else}}
                <li class="tool-hint">{{if
                    this.busy
                    "Nothing yet…"
                    "No accounts found by that name."
                  }}</li>
              {{/each}}
            </ul>
          {{/if}}

          {{#if this.isGraph}}
            <section class="math-card osint-graph-card">
              <svg
                class="osint-graph"
                viewBox={{this.graph.viewBox}}
                role="img"
                aria-label="How {{atName
                  this.names
                }}'s accounts and details connect"
              >
                {{#each this.graph.edges as |e|}}
                  <line
                    x1={{e.x1}}
                    y1={{e.y1}}
                    x2={{e.x2}}
                    y2={{e.y2}}
                    stroke={{e.colour}}
                    class="osint-edge"
                  />
                {{/each}}
                {{#each this.graph.nodes as |n|}}
                  <g
                    class="osint-node {{if (clickable n) 'is-pivot'}}"
                    role={{if (clickable n) "button"}}
                    tabindex={{if (clickable n) "0"}}
                    {{on "click" (fn this.openNode n)}}
                  >
                    <title>{{n.label}}{{if
                        (isLinked n)
                        ": click to profile this username too"
                      }}</title>
                    <circle cx={{n.x}} cy={{n.y}} r={{n.r}} fill={{n.colour}} />
                    <text
                      x={{labelX n}}
                      y={{n.y}}
                      dominant-baseline="middle"
                      class={{if (isUser n) "osint-centre-label"}}
                    >{{n.short}}</text>
                  </g>
                {{/each}}
              </svg>
              <div class="osint-legend">
                {{#each this.kinds as |k|}}
                  <span><i style={{k.swatch}}></i>{{k.label}}</span>
                {{/each}}
              </div>
              <p class="tool-hint">Click an account to open it, or a linked
                username to add it to this profile. Up to 120 accounts are
                drawn, the ones with the most to say first.</p>
            </section>
          {{/if}}

          <p class="tool-hint">A match means an account with that exact name
            exists, not that it belongs to the person you have in mind, and what
            a profile says about its owner is only what they chose to write.
            Sites that block automated checks show as unknown.</p>
        {{/if}}

        <details class="math-card osint-details">
          <summary>Add a site we don't check{{#if this.customSites.length}}
              ({{this.customSites.length}}
              added){{/if}}</summary>
          <form
            class="osint-add-site"
            aria-label="Add a site"
            {{on "submit" this.addSite}}
          >
            <input
              type="text"
              class="math-input"
              placeholder="Profile link, with {} for the name: https://example.com/user/{}"
              spellcheck="false"
              autocapitalize="off"
              aria-label="Profile link"
              value={{this.newUrl}}
              {{on "input" (fn this.setNew "newUrl")}}
            />
            <input
              type="text"
              class="math-input"
              placeholder="Text only a missing user's page shows (optional)"
              aria-label="Text on a missing user's page"
              value={{this.newAbsent}}
              {{on "input" (fn this.setNew "newAbsent")}}
            />
            <input
              type="text"
              class="math-input"
              placeholder="Site name (optional)"
              aria-label="Site name"
              value={{this.newName}}
              {{on "input" (fn this.setNew "newName")}}
            />
            <input
              type="text"
              class="math-input"
              placeholder="A username that exists there, to test it (optional)"
              spellcheck="false"
              autocapitalize="off"
              aria-label="A username that exists there"
              value={{this.newKnown}}
              {{on "input" (fn this.setNew "newKnown")}}
            />
            <button type="submit" class="btn active" disabled={{this.adding}}>
              <Icon @name="plus" @size={{13}} />
              {{if this.adding "Testing…" "Add site"}}</button>
          </form>
          {{#if this.addError}}<p
              class="tool-error"
            >{{this.addError}}</p>{{/if}}
          {{#if this.customSites.length}}
            <ul class="osint-custom-sites">
              {{#each this.customSites as |site|}}
                <li>
                  <strong>{{site.name}}</strong>
                  <code>{{site.url}}</code>
                  <button
                    type="button"
                    class="btn"
                    aria-label="Remove {{site.name}}"
                    {{on "click" (fn this.removeSite site)}}
                  ><Icon @name="x" @size={{12}} /></button>
                </li>
              {{/each}}
            </ul>
          {{/if}}
          <p class="tool-hint">Without the text, an account counts as found when
            its page loads and missing when the site answers with an error
            (404). Many sites show a normal page even for missing users: open
            one with a made-up name and copy a phrase from it, like "user not
            found". Your sites are kept in this browser and checked first.</p>
        </details>

        {{#unless this.names.length}}
          <p class="tool-hint">Works like Maigret: each site is asked for the
            profile (or its public API), found profiles are read for the name,
            bio, location, links and picture their owner put there, and any
            other usernames those links reveal can be profiled in turn. The site
            lists come from Sherlock, WhatsMyName and Maigret.</p>
        {{/unless}}
      </div>
    </ToolPage>
  </template>
}

const tabId = (t) => t[0];
const tabLabel = (t) => t[1];
const eqTab = (current, t) => current === t[0];
const atName = (names) => names.map((n) => `@${n}`).join(', ');
const moreThanOne = (list) => list.length > 1;
const clickable = (n) => n.kind === 'linked' || Boolean(n.url);
const isLinked = (n) => n.kind === 'linked';
const isUser = (n) => n.kind === 'username';
const labelX = (n) => n.x + n.r + 4;
