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
import { priorityOf } from '../utils/priority-sites';
import {
  buildReport,
  buildGraph,
  exportJson,
  exportPdf,
  NODE_KINDS,
  FIELDS,
} from '../utils/user-profile';
import { sortTargets, emailIntel, ipIntel } from '../utils/target-osint';
import {
  listProfiles,
  loadProfile,
  saveProfile,
  deleteProfile,
} from '../utils/profile-store';
import {
  cachedResult,
  cacheResult,
  cacheProfile,
  forgetResult,
} from '../utils/site-cache';

// User Profiling, the way Maigret does it, for usernames, email addresses
// and IP addresses at once. Usernames are checked against every site in the
// list and each found profile is read for what it says about its owner;
// emails get breaches, Gravatar and mail provider; IPs get location, network
// and hostnames. It all merges into one profile that can be saved in this
// browser, annotated, and exported.
//
// Sites go to the Worker 25 to a request, a few requests at a time; found
// accounts are read for profile data 10 to a request while the search runs.
const BATCH = 25;
const PARALLEL = 12;
const PROFILE_BATCH = 10;
const PROFILE_PARALLEL = 4;
const PAGE = 100;
const POPULAR = USERNAME_SITES.filter((s) => s.top);
// The graph and the notes & edits now live under Overview, so there are only
// two tabs: the merged profile, and the full site-by-site list.
const TABS = [
  ['overview', 'Overview'],
  ['accounts', 'Accounts'],
];
// How far the graph can be zoomed, and per notch.
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.2;
const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const STATES = [
  ['found', 'Found'],
  ['unknown', "Couldn't tell"],
  ['absent', 'Not there'],
  ['all', 'Every site checked'],
];

const day = (iso) => new Date(iso).toLocaleDateString();
const lower = (s) => String(s).toLowerCase();

export default class UsernameSearchPage extends Component {
  @tracked input = '';
  @tracked names = [];
  @tracked emails = [];
  @tracked ips = [];
  @tracked rows = [];
  @tracked checking = 0;
  @tracked profiling = 0;
  @tracked looking = 0;
  @tracked error = null;
  @tracked tab = 'overview';
  @tracked exporting = null;

  // Which sites: 'popular' (~500 best known) or 'all', adult ones or not,
  // and any the person has excluded. Kept in this browser.
  @tracked scope = 'popular';
  @tracked adult = false;
  @tracked excluded = [];

  // The accounts list: which answers, a search, and how many are shown.
  @tracked stateFilter = 'found';
  @tracked query = '';
  @tracked shownCount = PAGE;

  // The saved profile being worked on, and what was added to it by hand.
  @tracked profileId = null;
  @tracked title = '';
  @tracked notes = '';
  @tracked manual = [];
  @tracked hidden = [];
  @tracked saved = listProfiles();
  @tracked saveNote = null;
  @tracked newField = 'name';
  @tracked newValue = '';

  // Sites the person added themselves, kept in this browser.
  @tracked customSites = [];
  @tracked newUrl = '';
  @tracked newName = '';
  @tracked newAbsent = '';
  @tracked newKnown = '';
  @tracked adding = false;
  @tracked addError = null;

  tabs = TABS;
  fields = FIELDS;
  kinds = Object.values(NODE_KINDS).map((k) => ({
    ...k,
    swatch: htmlSafe(`background: ${k.colour}`),
  }));
  controller = new AbortController();
  profileQueue = [];

  // The graph's pan and zoom: a transform applied to everything drawn.
  @tracked zoom = 1;
  @tracked panX = 0;
  @tracked panY = 0;
  panFrom = null;
  panMoved = false;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'username-search', [
      'input',
      'customSites',
      'adult',
      'scope',
      'excluded',
    ]);
    registerDestructor(this, () => this.controller.abort());
  }

  // ─── Which sites a search covers ──────────────────────────────────

  get siteList() {
    const excluded = new Set(this.excluded);
    return (this.scope === 'all' ? USERNAME_SITES : POPULAR).filter(
      (s) => (this.adult || !s.nsfw) && !excluded.has(s.name),
    );
  }

  get siteCount() {
    return this.siteList.length.toLocaleString();
  }

  get popularCount() {
    return POPULAR.filter((s) => this.adult || !s.nsfw).length;
  }

  get allCount() {
    return USERNAME_SITES.filter(
      (s) => this.adult || !s.nsfw,
    ).length.toLocaleString();
  }

  get isPopular() {
    return this.scope === 'popular';
  }

  // ─── What the page shows ──────────────────────────────────────────

  get busy() {
    return this.checking > 0 || this.profiling > 0 || this.looking > 0;
  }

  get hasTargets() {
    return this.names.length + this.emails.length + this.ips.length > 0;
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

  // Big sites that couldn't be checked from our server: worth a manual look.
  get checkYourself() {
    return this.rows.filter(
      (r) => r.state === 'unknown' && USERNAME_SITES[r.index]?.top,
    );
  }

  get filteredRows() {
    const q = lower(this.query.trim());
    return this.rows.filter(
      (r) =>
        (this.stateFilter === 'all' || r.state === this.stateFilter) &&
        (!q || lower(r.site).includes(q) || lower(r.username).includes(q)),
    );
  }

  get shownRows() {
    return this.filteredRows.slice(0, this.shownCount);
  }

  get moreRows() {
    return Math.max(0, this.filteredRows.length - this.shownCount);
  }

  get stateCounts() {
    const count = (s) => this.rows.filter((r) => r.state === s).length;
    return STATES.map(([id, label]) => ({
      id,
      label,
      count: id === 'all' ? this.rows.length : count(id),
      active: this.stateFilter === id,
    }));
  }

  // Read by half the page, so built once per change rather than per read.
  reportMemo = { deps: [], report: null };
  get report() {
    const deps = [
      this.rows,
      this.names,
      this.emails,
      this.ips,
      this.manual,
      this.hidden,
    ];
    const memo = this.reportMemo;
    if (deps.every((d, i) => d === memo.deps[i])) return memo.report;
    memo.deps = deps;
    memo.report = this.buildReport();
    return memo.report;
  }

  buildReport() {
    return buildReport(
      this.names,
      this.found.map((r) => ({
        username: r.username,
        site: r.site,
        url: r.url,
        profile: r.profile,
      })),
      {
        emails: this.emails.filter((e) => e.ready),
        ips: this.ips.filter((i) => i.ready),
        manual: this.manual,
        hidden: this.hidden,
      },
    );
  }

  // The picture from an account that gave the headline name, so it's the
  // person's own avatar rather than some site's default logo.
  get photo() {
    const r = this.report;
    const top = r.personal.find((f) => f.key === 'name')?.values[0];
    // The picture from the account that gave the headline name; failing that,
    // the highest-ranked network's avatar (images are already priority-sorted).
    return (
      (top && r.images.find((i) => top.ids.includes(i.id))) ??
      r.images[0] ??
      null
    );
  }

  get headline() {
    return (
      this.title ||
      this.report.personal.find((f) => f.key === 'name')?.values[0]?.value ||
      this.targetLine
    );
  }

  get targetLine() {
    return [
      ...this.names.map((n) => `@${n}`),
      ...this.emails.map((e) => e.email),
      ...this.ips.map((i) => i.ip),
    ].join(', ');
  }

  get facts() {
    const r = this.report;
    const out = [['Accounts', String(r.accounts.length)]];
    if (this.names.length) out.push(['Usernames', this.names.join(', ')]);
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
      searched: this.names.some((n) => lower(n) === lower(l.username)),
    }));
  }

  get emailCards() {
    return this.emails.map((e) => ({
      ...e,
      breachCount: e.breaches?.length ?? 0,
      breachList: (e.breaches ?? []).slice(0, 30),
      guessSearched:
        e.usernameGuess &&
        this.names.some((n) => lower(n) === lower(e.usernameGuess)),
    }));
  }

  // The layout is the expensive part, so it's redone only when what it
  // draws has changed.
  memo = { key: null, graph: null };
  get graph() {
    const key = [
      this.names.join(','),
      this.found.length,
      this.profiled,
      this.emails.filter((e) => e.ready).length,
      this.ips.filter((i) => i.ready).length,
      this.manual.length,
      this.hidden.length,
    ].join('|');
    const memo = this.memo;
    if (key !== memo.key) {
      memo.key = key;
      memo.graph = buildGraph(this.report);
    }
    return memo.graph;
  }

  get is() {
    return Object.fromEntries(TABS.map(([id]) => [id, this.tab === id]));
  }

  // ─── Actions: searching ───────────────────────────────────────────

  setInput = (event) => (this.input = event.target.value);
  setTab = (tab) => (this.tab = tab);
  setScope = (event) => (this.scope = event.target.value);
  toggleAdult = (event) => (this.adult = event.target.checked);
  setStateFilter = (id) => {
    this.stateFilter = id;
    this.shownCount = PAGE;
  };
  setQuery = (event) => {
    this.query = event.target.value;
    this.shownCount = PAGE;
  };
  showMore = () => (this.shownCount += PAGE);
  setNew = (field, event) => (this[field] = event.target.value);

  submit = (event) => {
    event.preventDefault();
    const targets = sortTargets(this.input);
    if (targets.invalid.length) {
      this.error = `Not a username, email or IP address: ${targets.invalid.join(', ')}`;
      return;
    }
    if (
      !targets.usernames.length &&
      !targets.emails.length &&
      !targets.ips.length
    ) {
      this.error =
        'Type one or more usernames, email addresses or IP addresses, separated by commas or spaces.';
      return;
    }
    this.error = null;
    // An open saved profile grows; otherwise each search starts afresh.
    if (!this.profileId) this.reset();
    this.addTargets(targets);
  };

  newProfile = () => {
    this.reset();
    this.profileId = null;
    this.title = '';
    this.notes = '';
    this.manual = [];
    this.hidden = [];
    this.input = '';
    this.saveNote = null;
  };

  reset() {
    this.controller.abort();
    this.controller = new AbortController();
    this.profileQueue = [];
    this.names = [];
    this.emails = [];
    this.ips = [];
    this.rows = [];
    this.checking = 0;
    this.profiling = 0;
    this.looking = 0;
    this.tab = 'overview';
    this.stateFilter = 'found';
    this.query = '';
    this.shownCount = PAGE;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  addTargets({ usernames, emails, ips }) {
    for (const name of usernames)
      if (!this.names.some((n) => lower(n) === lower(name))) this.search(name);
    for (const email of emails)
      if (!this.emails.some((e) => e.email === email)) this.lookEmail(email);
    for (const ip of ips)
      if (!this.ips.some((i) => i.ip === ip)) this.lookIp(ip);
  }

  // Adds another username (one the profiles linked to) to this profile.
  follow = (name) => {
    if (!USERNAME_PATTERN.test(name)) return;
    this.addTargets({ usernames: [name], emails: [], ips: [] });
  };

  openNode = (node) => {
    // A pan that moved the graph isn't a click on the node under the pointer.
    if (this.panMoved) return;
    if (node.kind === 'linked') this.follow(node.label);
    else if (node.url) window.open(node.url, '_blank', 'noopener,noreferrer');
  };

  // ─── The graph's pan and zoom ─────────────────────────────────────

  get graphTransform() {
    return `translate(${this.panX} ${this.panY}) scale(${this.zoom})`;
  }

  // The point under the pointer in the graph's own coordinates (before the
  // pan/zoom transform), so zooming keeps that point still.
  svgPoint(event) {
    const svg = event.currentTarget.closest('svg');
    const ctm = svg?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0, scale: 1 };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      ctm.inverse(),
    );
    return { x: p.x, y: p.y, scale: ctm.a };
  }

  zoomAbout(factor, cx, cy) {
    const next = clampZoom(this.zoom * factor);
    const k = next / this.zoom;
    this.panX = cx - (cx - this.panX) * k;
    this.panY = cy - (cy - this.panY) * k;
    this.zoom = next;
  }

  // Buttons zoom about the middle of what's on screen.
  zoomButton = (factor) => {
    const [x, y, w, h] = this.graph.viewBox.split(' ').map(Number);
    this.zoomAbout(factor, x + w / 2, y + h / 2);
  };

  zoomIn = () => this.zoomButton(ZOOM_STEP);
  zoomOut = () => this.zoomButton(1 / ZOOM_STEP);
  resetZoom = () => {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  };

  onGraphWheel = (event) => {
    event.preventDefault();
    const p = this.svgPoint(event);
    this.zoomAbout(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, p.x, p.y);
  };

  onGraphDown = (event) => {
    this.panFrom = {
      x: event.clientX,
      y: event.clientY,
      scale: this.svgPoint(event).scale,
    };
    this.panMoved = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  onGraphMove = (event) => {
    if (!this.panFrom) return;
    const dx = event.clientX - this.panFrom.x;
    const dy = event.clientY - this.panFrom.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) this.panMoved = true;
    const s = this.panFrom.scale || 1;
    this.panX += dx / s;
    this.panY += dy / s;
    this.panFrom = { ...this.panFrom, x: event.clientX, y: event.clientY };
  };

  onGraphUp = (event) => {
    this.panFrom = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  async lookEmail(email) {
    const signal = this.controller.signal;
    this.emails = [...this.emails, { email, ready: false }];
    this.looking++;
    let result;
    try {
      result = await emailIntel(email, signal);
    } catch (error) {
      result = { email, breaches: [], mail: {}, errors: [error.message] };
    }
    if (signal.aborted) return;
    this.emails = this.emails.map((e) =>
      e.email === email ? { ...result, ready: true } : e,
    );
    this.looking--;
  }

  async lookIp(ip) {
    const signal = this.controller.signal;
    this.ips = [...this.ips, { ip, ready: false }];
    this.looking++;
    let result;
    try {
      result = await ipIntel(ip, signal);
    } catch (error) {
      result = { ip, hostnames: [], links: [], error: error.message };
    }
    if (signal.aborted) return;
    this.ips = this.ips.map((i) =>
      i.ip === ip ? { ...result, ready: true } : i,
    );
    this.looking--;
  }

  async search(name) {
    const signal = this.controller.signal;
    this.names = [...this.names, name];
    const fresh = [
      ...this.customSites.map((custom) => ({
        custom,
        username: name,
        site: `${custom.name} (yours)`,
        url: fill(custom.url, name),
      })),
      ...this.siteList.map((site) => ({
        index: USERNAME_SITES.indexOf(site),
        username: name,
        site: site.name,
        adult: Boolean(site.nsfw),
        url: fill(site.url, name),
      })),
    ].map((r) => ({ ...r, state: 'pending', note: '', profile: null }));
    this.rows = [...this.rows, ...fresh];
    // Answers we already remember for this name skip the network entirely.
    const cached = fresh
      .map((row) => ({ row, hit: cachedResult(row.site, name) }))
      .filter((c) => c.hit);
    const cachedRows = new Set(cached.map((c) => c.row));
    if (cached.length) {
      const byRow = new Map(cached.map((c) => [c.row, c.hit]));
      const applied = this.update(
        cached.map((c) => c.row),
        (row) => {
          const h = byRow.get(row);
          return {
            state: h.state,
            note: h.note,
            profile: h.profile ?? null,
            cached: true,
            profiled: row.custom || h.profile != null,
          };
        },
      );
      // A remembered "found" with no picture yet still gets profiled.
      this.queueProfiles(
        applied.filter((r) => r.state === 'found' && !r.custom && !r.profile),
      );
    }
    const todo = fresh.filter((r) => !cachedRows.has(r));
    // The big networks answer a server only through their own back doors
    // (Discord's API, an oembed, a preview crawler) and are easily lost in a
    // 4,000-site "every site" run, so they go first and one to a request —
    // never sharing a batch where one blocked site could stall the rest.
    const listed = todo.filter((r) => !r.custom);
    const priority = listed.filter(
      (r) => priorityOf(USERNAME_SITES[r.index]?.name) !== Infinity,
    );
    const rest = listed.filter((r) => !priority.includes(r));
    const jobs = [
      ...todo.filter((r) => r.custom).map((r) => [r]),
      ...priority.map((r) => [r]),
      ...Array.from({ length: Math.ceil(rest.length / BATCH) }, (_, i) =>
        rest.slice(i * BATCH, (i + 1) * BATCH),
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
          cached: false,
          profiled: row.custom ? true : undefined,
        }));
        // Remember every answer so this name isn't asked again next time.
        for (const r of updated)
          cacheResult(r.site, name, {
            state: r.state,
            note: r.note,
            profile: null,
          });
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
      // Rows may have been replaced since they were queued; match by site
      // and username instead of identity.
      const want = new Map(
        batch.map((r, i) => [`${r.index}:${r.username}`, profiles[i] ?? null]),
      );
      const current = this.rows.filter((r) =>
        want.has(`${r.index}:${r.username}`),
      );
      const done = this.update(current, (r) => ({
        profile: want.get(`${r.index}:${r.username}`),
        profiled: true,
      }));
      for (const r of done) cacheProfile(r.site, first.username, r.profile);
    }
    if (!signal.aborted) this.profiling--;
  }

  // ─── Actions: excluding sites ─────────────────────────────────────

  exclude = (row) => {
    if (row.custom) {
      this.customSites = this.customSites.filter((s) => s !== row.custom);
    } else if (!this.excluded.includes(row.site)) {
      this.excluded = [...this.excluded, row.site];
    }
    this.rows = this.rows.filter((r) => r.site !== row.site);
  };

  restoreSite = (name) =>
    (this.excluded = this.excluded.filter((n) => n !== name));

  restoreAllSites = () => (this.excluded = []);

  // Ask one site again, ignoring (and refreshing) what was remembered — for
  // when an account has since appeared, changed or been taken down.
  retest = async (row) => {
    const target = this.rows.find(
      (r) => r.site === row.site && r.username === row.username,
    );
    if (!target) return;
    forgetResult(target.site, target.username);
    const signal = this.controller.signal;
    this.checking++;
    const [pending] = this.update([target], () => ({
      state: 'pending',
      note: '',
      profile: null,
      cached: false,
      profiled: undefined,
    }));
    let result;
    try {
      result = pending.custom
        ? await checkCustomSite(pending.custom, pending.username, signal)
        : (await checkUsernames([pending.index], pending.username, signal))
            .results[0];
    } catch {
      result = { state: 'unknown', note: 'no answer' };
    }
    if (signal.aborted) return;
    const [updated] = this.update([pending], () => ({
      state: result.state,
      note: result.note ?? '',
      cached: false,
      profiled: pending.custom ? true : undefined,
    }));
    cacheResult(updated.site, updated.username, {
      state: updated.state,
      note: updated.note,
      profile: null,
    });
    if (updated.state === 'found' && !updated.custom)
      this.queueProfiles([updated]);
    this.checking--;
  };

  // ─── Actions: editing the profile ─────────────────────────────────

  setTitle = (event) => (this.title = event.target.value);
  setNotes = (event) => (this.notes = event.target.value);

  addInfo = (event) => {
    event.preventDefault();
    const value = this.newValue.trim();
    if (!value) return;
    this.manual = [...this.manual, { field: this.newField, value }];
    this.newValue = '';
  };

  removeInfo = (entry) =>
    (this.manual = this.manual.filter(
      (m) => m.field !== entry.field || m.value !== entry.value,
    ));

  hideValue = (value) => {
    this.hidden = [...this.hidden, value.hideKey];
  };

  unhideAll = () => (this.hidden = []);

  get manualList() {
    const label = Object.fromEntries(FIELDS);
    return this.manual.map((m) => ({ ...m, label: label[m.field] }));
  }

  // ─── Actions: saved profiles ──────────────────────────────────────

  // Everything that makes up the saved record, so save and rename agree.
  profilePayload(extra = {}) {
    return {
      id: this.profileId ?? undefined,
      title: this.title || this.headline,
      notes: this.notes,
      manual: this.manual,
      hidden: this.hidden,
      names: this.names,
      emails: this.emails.filter((e) => e.ready),
      ips: this.ips.filter((i) => i.ready),
      accounts: this.found.map((r) => ({
        index: r.index,
        username: r.username,
        site: r.site,
        url: r.url,
        adult: r.adult,
        profile: r.profile,
      })),
      ...extra,
    };
  }

  saveCurrent = () => {
    const record = saveProfile(this.profilePayload());
    if (!record) {
      this.saveNote =
        "This browser wouldn't store it (storage is full or blocked).";
      return;
    }
    this.profileId = record.id;
    this.title = record.title;
    this.saved = listProfiles();
    this.saveNote = `Saved at ${new Date().toLocaleTimeString()}.`;
  };

  openSaved = (event) => {
    const id = event.target.value;
    event.target.value = '';
    const record = id && loadProfile(id);
    if (!record) return;
    this.reset();
    this.profileId = record.id;
    this.title = record.title ?? '';
    this.notes = record.notes ?? '';
    this.manual = record.manual ?? [];
    this.hidden = record.hidden ?? [];
    this.names = record.names ?? [];
    this.emails = (record.emails ?? []).map((e) => ({ ...e, ready: true }));
    this.ips = (record.ips ?? []).map((i) => ({ ...i, ready: true }));
    // Indexes shift when the site list is rebuilt; find each site by name.
    const byName = new Map(USERNAME_SITES.map((s, i) => [s.name, i]));
    this.rows = (record.accounts ?? []).map((a) => ({
      ...a,
      index: byName.get(a.site) ?? a.index,
      state: 'found',
      note: '',
      profiled: true,
    }));
    this.saveNote = `Opened, last saved ${day(record.updated)}. New searches add to it.`;
  };

  renameCurrent = () => {
    if (!this.profileId) return;
    const name = window.prompt('Rename this profile', this.title)?.trim();
    if (!name || name === this.title) return;
    this.title = name;
    const record = saveProfile(this.profilePayload({ title: name }));
    this.saved = listProfiles();
    this.saveNote = record
      ? `Renamed to "${name}".`
      : "This browser wouldn't store the change.";
  };

  deleteCurrent = () => {
    if (!this.profileId) return;
    if (!window.confirm(`Delete the saved profile "${this.title}"?`)) return;
    deleteProfile(this.profileId);
    this.saved = listProfiles();
    this.newProfile();
    this.saveNote = 'Deleted.';
  };

  // ─── Exports ──────────────────────────────────────────────────────

  get exportNotes() {
    return { title: this.title || this.headline, text: this.notes };
  }

  exportJson = () => exportJson(this.report, this.exportNotes);

  exportPdf = async () => {
    this.exporting = 'pdf';
    try {
      await exportPdf(this.report, this.graph, this.exportNotes);
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
      @subtitle="Usernames, email addresses or IP addresses in; the accounts, leaks, locations and links behind them out, merged into one profile you can save, edit and export."
    >
      <div class="pop-in">
        <div class="osint-saved-bar">
          <select
            class="math-input"
            aria-label="Open a saved profile"
            {{on "change" this.openSaved}}
          >
            <option value="">{{if
                this.saved.length
                "Open a saved profile…"
                "No saved profiles yet"
              }}</option>
            {{#each this.saved as |p|}}
              <option value={{p.id}}>{{p.title}}
                ({{p.accounts}}
                accounts)</option>
            {{/each}}
          </select>
          <button
            type="button"
            class="btn"
            disabled={{this.busy}}
            {{on "click" this.saveCurrent}}
          ><Icon @name="save" @size={{12}} />
            {{if this.profileId "Save changes" "Save profile"}}</button>
          {{#if this.profileId}}
            <button type="button" class="btn" {{on "click" this.renameCurrent}}>
              <Icon @name="square-pen" @size={{12}} />
              Rename</button>
            <button type="button" class="btn" {{on "click" this.deleteCurrent}}>
              <Icon @name="trash-2" @size={{12}} />
              Delete</button>
          {{/if}}
          <button type="button" class="btn" {{on "click" this.newProfile}}>
            <Icon @name="plus" @size={{12}} />
            New</button>
          {{#if this.saveNote}}<span
              class="is-muted osint-save-note"
            >{{this.saveNote}}</span>{{/if}}
        </div>

        <form
          class="dl-form"
          aria-label="Profile usernames, emails or IP addresses"
          {{on "submit" this.submit}}
        >
          <input
            type="text"
            class="math-input"
            placeholder="usernames, emails or IPs: alice, bob@mail.com, 1.2.3.4"
            spellcheck="false"
            autocapitalize="off"
            aria-label="Usernames, emails or IP addresses"
            value={{this.input}}
            {{on "input" this.setInput}}
          />
          <button type="submit" class="btn active" disabled={{this.busy}}>
            <Icon @name="search" @size={{13}} />
            {{if
              this.busy
              "Profiling…"
              (if this.profileId "Add to profile" "Profile")
            }}</button>
        </form>

        <div class="osint-options">
          <label>Sites
            <select
              class="math-input"
              disabled={{this.busy}}
              {{on "change" this.setScope}}
            >
              <option value="popular" selected={{this.isPopular}}>Popular ({{this.popularCount}})</option>
              <option value="all" selected={{unless this.isPopular true}}>Every
                site ({{this.allCount}})</option>
            </select></label>
          <label class="osint-toggle"><input
              type="checkbox"
              checked={{this.adult}}
              disabled={{this.busy}}
              {{on "change" this.toggleAdult}}
            />
            Adult (NSFW) sites</label>
          <span class="is-muted">{{this.siteCount}}
            sites per username{{#if this.excluded.length}},
              {{this.excluded.length}}
              excluded{{/if}}</span>
        </div>
        {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}

        {{#if this.hasTargets}}
          <div class="osint-bar">
            <span><strong>{{this.found.length}}</strong>
              accounts{{#if this.names.length}}
                · checked
                {{this.done}}/{{this.rows.length}}
                · profiles read
                {{this.profiled}}/{{this.found.length}}{{/if}}</span>
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

          {{#if this.is.overview}}
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
                  <h3>{{this.headline}}</h3>
                  <dl class="rbx-facts">
                    {{#each this.facts as |f|}}
                      <dt>{{f.label}}</dt><dd>{{f.value}}</dd>
                    {{/each}}
                  </dl>
                </div>
              </div>

              {{#if this.found.length}}
                <h4 class="osint-field">Accounts found</h4>
                <ul class="osint-chips-list">
                  {{#each this.found as |row|}}
                    <li><a
                        href={{row.url}}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={{row.profile.name}}
                      >{{row.site}}</a>{{#if row.adult}}<span
                          class="osint-adult"
                        >18+</span>{{/if}}</li>
                  {{/each}}
                </ul>
              {{else if this.names.length}}
                <p class="tool-hint">{{if
                    this.checking
                    "Checking sites…"
                    "No account found under that name on the sites checked."
                  }}</p>
              {{/if}}

              {{#if this.checkYourself.length}}
                <h4 class="osint-field">Check these yourself</h4>
                <p class="tool-hint">These sites show our server a login page or
                  rate-limit it, so it can't tell. Open them to see.</p>
                <ul class="osint-chips-list is-unknown">
                  {{#each this.checkYourself as |row|}}
                    <li><a
                        href={{row.url}}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={{row.note}}
                      >{{row.site}}</a></li>
                  {{/each}}
                </ul>
              {{/if}}

              {{#each this.emailCards as |e|}}
                <div class="osint-target-card">
                  <h4><Icon @name="at-sign" @size={{14}} /> {{e.email}}</h4>
                  {{#if e.ready}}
                    <dl class="rbx-facts">
                      <dt>Mail</dt><dd>{{if
                          e.mail.provider
                          e.mail.provider
                          "No mail servers: this domain can't receive email"
                        }}</dd>
                      <dt>Breaches</dt><dd>{{e.breachCount}}</dd>
                      {{#if e.gravatar}}
                        <dt>Gravatar</dt><dd><a
                            href={{e.gravatar.url}}
                            target="_blank"
                            rel="noopener noreferrer"
                          >{{if
                              e.gravatar.name
                              e.gravatar.name
                              "Profile"
                            }}</a></dd>
                      {{/if}}
                      {{#if e.leakFields}}
                        <dt>Leaked data</dt><dd>{{e.leakFields}}</dd>
                      {{/if}}
                      {{#if e.accounts.length}}
                        <dt>Registered at</dt>
                        <dd>
                          {{#each e.accounts as |acct|}}
                            <a
                              href={{acct.url}}
                              target="_blank"
                              rel="noopener noreferrer"
                            >{{acct.site}}</a>
                          {{/each}}
                        </dd>
                      {{/if}}
                    </dl>
                    {{#if e.breachCount}}
                      <ul class="osint-values">
                        {{#each e.breachList as |b|}}
                          <li><strong>{{b.name}}</strong>
                            <small class="is-muted">{{b.year}}{{#if b.data}}
                                ·
                                {{b.data}}{{/if}}</small></li>
                        {{/each}}
                      </ul>
                    {{/if}}
                    {{#if e.usernameGuess}}
                      {{#unless e.guessSearched}}
                        <button
                          type="button"
                          class="btn"
                          {{on "click" (fn this.follow e.usernameGuess)}}
                        ><Icon @name="plus" @size={{12}} />
                          Profile the username "{{e.usernameGuess}}"</button>
                      {{/unless}}
                    {{/if}}
                    {{#each e.errors as |err|}}
                      <p class="tool-error">{{err}}</p>
                    {{/each}}
                  {{else}}
                    <p class="tool-hint">Looking it up…</p>
                  {{/if}}
                </div>
              {{/each}}

              {{#each this.ips as |ip|}}
                <div class="osint-target-card">
                  <h4><Icon @name="globe" @size={{14}} /> {{ip.ip}}</h4>
                  {{#if ip.ready}}
                    <dl class="rbx-facts">
                      {{#if ip.place}}<dt>Location</dt><dd
                        >{{ip.place}}</dd>{{/if}}
                      {{#if ip.isp}}<dt>Network</dt><dd>{{ip.isp}}
                          {{ip.asn}}</dd>{{/if}}
                      {{#if ip.org}}<dt>Organisation</dt><dd
                        >{{ip.org}}</dd>{{/if}}
                      {{#if ip.timezone}}<dt>Time zone</dt><dd
                        >{{ip.timezone}}</dd>{{/if}}
                      {{#if ip.hostnames.length}}<dt>Hostnames</dt><dd>{{join
                            ip.hostnames
                          }}</dd>{{/if}}
                    </dl>
                    <p class="osint-links">
                      {{#each ip.links as |l|}}
                        <a
                          href={{l.url}}
                          target="_blank"
                          rel="noopener noreferrer"
                        >{{l.label}}</a>
                      {{/each}}
                    </p>
                    {{#if ip.error}}<p
                        class="tool-error"
                      >{{ip.error}}</p>{{/if}}
                  {{else}}
                    <p class="tool-hint">Looking it up…</p>
                  {{/if}}
                </div>
              {{/each}}

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
                      <button
                        type="button"
                        class="osint-hide"
                        aria-label="Hide {{v.value}}"
                        title="Hide this"
                        {{on "click" (fn this.hideValue v)}}
                      ><Icon @name="x" @size={{11}} /></button>
                    </li>
                  {{/each}}
                </ul>
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

          {{#if this.is.accounts}}
            <div class="osint-list-tools">
              <div class="osint-tabs">
                {{#each this.stateCounts as |s|}}
                  <button
                    type="button"
                    class="btn {{if s.active 'active'}}"
                    {{on "click" (fn this.setStateFilter s.id)}}
                  >{{s.label}} ({{s.count}})</button>
                {{/each}}
              </div>
              <input
                type="search"
                class="math-input"
                placeholder="Search sites"
                aria-label="Search sites"
                value={{this.query}}
                {{on "input" this.setQuery}}
              />
            </div>
            <ul class="osint-results">
              {{#each this.shownRows as |row|}}
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
                    }}, {{row.note}}{{/if}}{{#if row.cached}}
                      · remembered{{/if}}</span>
                  <button
                    type="button"
                    class="osint-hide"
                    aria-label="Check {{row.site}} again"
                    title="Check this site again, ignoring the remembered answer"
                    {{on "click" (fn this.retest row)}}
                  ><Icon @name="refresh-cw" @size={{11}} /></button>
                  <button
                    type="button"
                    class="osint-hide"
                    aria-label="Exclude {{row.site}} from searches"
                    title="Exclude this site from searches"
                    {{on "click" (fn this.exclude row)}}
                  ><Icon @name="x" @size={{11}} /></button>
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
                    "Nothing matches."
                  }}</li>
              {{/each}}
            </ul>
            {{#if this.moreRows}}
              <button type="button" class="btn" {{on "click" this.showMore}}>
                Show 100 more ({{this.moreRows}}
                left)</button>
            {{/if}}
          {{/if}}

          {{#if this.is.overview}}
            {{! template-lint-disable no-pointer-down-event-binding }}
            {{! panning the graph needs the pointerdown that starts the drag }}
            <section class="math-card osint-graph-card">
              <div class="osint-graph-tools">
                <h4 class="osint-field">Graph</h4>
                <div class="osint-zoom">
                  <button
                    type="button"
                    class="btn"
                    aria-label="Zoom out"
                    {{on "click" this.zoomOut}}
                  ><Icon @name="zoom-out" @size={{13}} /></button>
                  <button
                    type="button"
                    class="btn"
                    aria-label="Zoom in"
                    {{on "click" this.zoomIn}}
                  ><Icon @name="zoom-in" @size={{13}} /></button>
                  <button
                    type="button"
                    class="btn"
                    {{on "click" this.resetZoom}}
                  >Reset</button>
                </div>
              </div>
              <svg
                class="osint-graph"
                viewBox={{this.graph.viewBox}}
                role="img"
                aria-label="How {{this.targetLine}}'s accounts and details connect"
                {{on "wheel" this.onGraphWheel}}
                {{on "pointerdown" this.onGraphDown}}
                {{on "pointermove" this.onGraphMove}}
                {{on "pointerup" this.onGraphUp}}
                {{on "pointerleave" this.onGraphUp}}
              >
                <g transform={{this.graphTransform}}>
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
                      <circle
                        cx={{n.x}}
                        cy={{n.y}}
                        r={{n.r}}
                        fill={{n.colour}}
                      />
                      <text
                        x={{labelX n}}
                        y={{n.y}}
                        dominant-baseline="middle"
                        class={{if (isCentre n) "osint-centre-label"}}
                      >{{n.short}}</text>
                    </g>
                  {{/each}}
                </g>
              </svg>
              <div class="osint-legend">
                {{#each this.kinds as |k|}}
                  <span><i style={{k.swatch}}></i>{{k.label}}</span>
                {{/each}}
              </div>
              <p class="tool-hint">Scroll to zoom, drag to pan. Click an account
                to open it, or a linked username to add it to this profile. Up
                to 120 accounts are drawn, the ones with the most to say first.</p>
            </section>
          {{/if}}

          {{#if this.is.overview}}
            <section class="math-card osint-notes">
              <h4 class="osint-field">Notes &amp; edits</h4>
              <label class="osint-label">Title
                <input
                  type="text"
                  class="math-input"
                  placeholder={{this.headline}}
                  value={{this.title}}
                  {{on "input" this.setTitle}}
                /></label>
              <label class="osint-label">Notes
                <textarea
                  class="math-input"
                  rows="6"
                  placeholder="Anything you know or want to remember about this person"
                  value={{this.notes}}
                  {{on "input" this.setNotes}}
                ></textarea></label>

              <h4 class="osint-field">Add information</h4>
              <form
                class="osint-add-info"
                aria-label="Add information"
                {{on "submit" this.addInfo}}
              >
                <select
                  class="math-input"
                  aria-label="Kind of information"
                  {{on "change" (fn this.setNew "newField")}}
                >
                  {{#each this.fields as |f|}}
                    <option value={{fieldId f}}>{{fieldLabel f}}</option>
                  {{/each}}
                </select>
                <input
                  type="text"
                  class="math-input"
                  placeholder="Value"
                  aria-label="Value"
                  value={{this.newValue}}
                  {{on "input" (fn this.setNew "newValue")}}
                />
                <button type="submit" class="btn active"><Icon
                    @name="plus"
                    @size={{12}}
                  />
                  Add</button>
              </form>
              {{#if this.manualList.length}}
                <ul class="osint-values">
                  {{#each this.manualList as |m|}}
                    <li><small class="is-muted">{{m.label}}</small>
                      <span>{{m.value}}</span>
                      <button
                        type="button"
                        class="osint-hide"
                        aria-label="Remove {{m.value}}"
                        {{on "click" (fn this.removeInfo m)}}
                      ><Icon @name="x" @size={{11}} /></button></li>
                  {{/each}}
                </ul>
              {{/if}}
              {{#if this.hidden.length}}
                <p class="tool-hint">{{this.hidden.length}}
                  found values hidden.
                  <button
                    type="button"
                    class="btn"
                    {{on "click" this.unhideAll}}
                  >
                    Show them again</button></p>
              {{/if}}
              <p class="tool-hint">What you add here shows in the profile, the
                graph and the exports, credited to "You". Save the profile to
                keep it; saved profiles stay in this browser only.</p>
            </section>
          {{/if}}

          <p class="tool-hint">A match means an account with that exact name
            exists, not that it belongs to the person you have in mind, and what
            a profile says about its owner is only what they chose to write.</p>
        {{/if}}

        {{#if this.excluded.length}}
          <details class="math-card osint-details">
            <summary>Excluded sites ({{this.excluded.length}})</summary>
            <ul class="osint-custom-sites">
              {{#each this.excluded as |name|}}
                <li><strong>{{name}}</strong>
                  <button
                    type="button"
                    class="btn"
                    {{on "click" (fn this.restoreSite name)}}
                  >Check it again</button></li>
              {{/each}}
            </ul>
            <button
              type="button"
              class="btn"
              {{on "click" this.restoreAllSites}}
            >
              Restore all</button>
          </details>
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

        {{#unless this.hasTargets}}
          <p class="tool-hint">Works like Maigret: each site is asked for the
            profile (or its public API), found profiles are read for the name,
            bio, location, links and picture their owner put there, and any
            other usernames those links reveal can be profiled in turn. Emails
            are checked against breach databases, Gravatar and their mail
            servers; IPs are placed on the map and traced to their network.
            Separate several targets with commas.</p>
        {{/unless}}
      </div>
    </ToolPage>
  </template>
}

const tabId = (t) => t[0];
const tabLabel = (t) => t[1];
const fieldId = (f) => f[0];
const fieldLabel = (f) => f[1];
const eqTab = (current, t) => current === t[0];
const moreThanOne = (list) => list.length > 1;
const clickable = (n) => n.kind === 'linked' || Boolean(n.url);
const isLinked = (n) => n.kind === 'linked';
const isCentre = (n) => n.kind === 'username' || n.kind === 'target';
const labelX = (n) => n.x + n.r + 4;
const join = (list) => list.join(', ');
