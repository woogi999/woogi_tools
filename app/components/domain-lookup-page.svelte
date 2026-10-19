<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import Link from '../core/link.svelte';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { keepState } from '../utils/tool-state.js';
  import { cleanDomain, lookupRdap, lookupDns } from '../utils/domain.js';
  import { lookup as lookupIp, placeLine } from '../utils/ip-lookup.js';
  import {
    findSubdomains,
    waybackSnapshots,
    waybackDate,
    allBreaches,
  } from '../utils/osint.js';

  // Domain Lookup: one domain in, every passive source this site has run at
  // once, the way SpiderFoot scans. The registry (RDAP) and DNS give who owns
  // it and where it points; certificate-transparency logs give every subdomain
  // that ever had a certificate; the Internet Archive says how long it has been
  // around; Have I Been Pwned says whether it has been breached. The Map tab
  // draws it all as a link graph around the domain, the way Maltego does, and
  // a subdomain in it can be clicked to look that up next. Nothing here ever
  // contacts the domain itself.

  const SIZE = 640;
  const MID = SIZE / 2;
  const RADIUS = 250;
  const MAX_DRAWN = 30;
  // Room either side for the labels, which run outwards from their dots.
  const PAD = 180;
  const PAGE = 200;

  const KINDS = {
    ip: { label: 'Address', colour: '#4f9dff' },
    ns: { label: 'Name server', colour: '#a07bff' },
    mx: { label: 'Mail server', colour: '#ff9f43' },
    registrar: { label: 'Registrar', colour: '#2ecc71' },
    sub: { label: 'Subdomain', colour: '#8a8f98' },
    breach: { label: 'Breach', colour: '#ff5a5f' },
  };

  const SOURCES = [
    ['rdap', 'Registry'],
    ['dns', 'DNS'],
    ['subs', 'Certificate logs'],
    ['wayback', 'Internet Archive'],
    ['breaches', 'Have I Been Pwned'],
    ['ip', 'IP location'],
  ];

  const TABS = [
    ['overview', 'Overview'],
    ['subdomains', 'Subdomains'],
    ['map', 'Map'],
  ];

  const when = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
  };

  const daysUntil = (iso) =>
    iso ? Math.round((new Date(iso) - Date.now()) / 86400000) : null;

  class DomainLookupPage extends Component {
    kinds = Object.entries(KINDS).map(([id, k]) => ({
      id,
      ...k,
      swatch: `background: ${k.colour}`,
    }));
    tabs = TABS;

    input = $state.raw('');
    domain = $state.raw(null);
    data = $state.raw({});
    status = $state.raw({});
    error = $state.raw(null);
    tab = $state.raw('overview');
    filter = $state.raw('');
    shownCount = $state.raw(PAGE);

    controller = null;

    constructor(args) {
      super(args);
      keepState(this, 'domain-lookup', ['input']);
      registerDestructor(this, () => this.controller?.abort());
    }

    get busy() {
      return Object.values(this.status).includes('running');
    }

    get sources() {
      return SOURCES.map(([id, label]) => ({
        label,
        state: this.status[id] ?? 'waiting',
      }));
    }

    get is() {
      return Object.fromEntries(TABS.map(([id]) => [id, this.tab === id]));
    }

    // ─── Registration ─────────────────────────────────────────────────

    get rdap() {
      return this.data.rdap ?? null;
    }

    get rdapError() {
      return this.status.rdap === 'failed'
        ? 'The registry could not be reached, or has no RDAP service for this domain.'
        : null;
    }

    get age() {
      if (!this.rdap?.registered) return null;
      const years = (Date.now() - new Date(this.rdap.registered)) / 31557600000;
      return years < 1
        ? `${Math.max(1, Math.round(years * 12))} months old`
        : `${Math.floor(years)} years old`;
    }

    get expiry() {
      if (!this.rdap?.expires) return null;
      const days = daysUntil(this.rdap.expires);
      return {
        date: when(this.rdap.expires),
        note:
          days < 0
            ? 'expired'
            : days < 30
              ? `in ${days} days`
              : days < 365
                ? `in ${Math.round(days / 30)} months`
                : `in ${(days / 365).toFixed(1)} years`,
        soon: days < 30,
      };
    }

    get registered() {
      return when(this.rdap?.registered);
    }

    get updated() {
      return when(this.rdap?.updated);
    }

    // ─── DNS ──────────────────────────────────────────────────────────

    get dns() {
      return Array.isArray(this.data.dns) ? this.data.dns : null;
    }

    get records() {
      const dns = this.dns ?? [];
      const of = (type) =>
        dns.find((g) => g.type === type)?.answers.map((a) => a.value) ?? [];
      return {
        a: [...of('A'), ...of('AAAA')],
        mx: of('MX').map((v) => v.split(/\s+/).at(-1).replace(/\.$/, '')),
        ns: of('NS').map((v) => v.replace(/\.$/, '')),
        txt: of('TXT'),
      };
    }

    // ─── Everything else ──────────────────────────────────────────────

    get breaches() {
      const d = this.domain;
      return (
        Array.isArray(this.data.breaches) ? this.data.breaches : []
      ).filter(
        (b) => b.domain && (b.domain === d || b.domain.endsWith(`.${d}`)),
      );
    }

    get subdomains() {
      const names = this.data.subs?.names;
      return Array.isArray(names) ? names.filter((n) => n !== this.domain) : [];
    }

    get filteredSubdomains() {
      const f = this.filter.trim().toLowerCase();
      return f ? this.subdomains.filter((n) => n.includes(f)) : this.subdomains;
    }

    get shownSubdomains() {
      return this.filteredSubdomains.slice(0, this.shownCount);
    }

    get moreSubdomains() {
      return Math.max(0, this.filteredSubdomains.length - this.shownCount);
    }

    get subdomainText() {
      return this.filteredSubdomains.join('\n');
    }

    get facts() {
      const d = this.data;
      const rows = [];
      if (d.ip)
        rows.push([
          'Hosted',
          [d.ip.org || d.ip.isp, placeLine(d.ip)].filter(Boolean).join(', '),
        ]);
      if (d.wayback?.first)
        rows.push([
          'Archived',
          `since ${waybackDate(d.wayback.first).toLocaleDateString()}, last ${waybackDate(d.wayback.last).toLocaleDateString()}`,
        ]);
      if (d.subs) rows.push(['Subdomains', String(this.subdomains.length)]);
      if (Array.isArray(d.breaches))
        rows.push(['Breaches', String(this.breaches.length)]);
      if (this.dns) {
        const spf = this.records.txt.find((t) => /v=spf1/i.test(t));
        rows.push(['SPF', spf ? 'Published' : 'None']);
      }
      return rows.map(([label, value]) => ({ label, value }));
    }

    get graph() {
      if (!this.domain) return null;
      const r = this.records;
      const nodes = [
        ...r.a.map((v) => ({ kind: 'ip', label: String(v) })),
        ...(r.ns.length ? r.ns : (this.rdap?.nameservers ?? [])).map((v) => ({
          kind: 'ns',
          label: String(v),
        })),
        ...r.mx.map((v) => ({ kind: 'mx', label: String(v) })),
        ...(this.rdap?.registrar
          ? [
              {
                kind: 'registrar',
                label: String(this.rdap.registrar.name || 'Registrar'),
              },
            ]
          : []),
        ...this.breaches.map((b) => ({ kind: 'breach', label: b.title })),
        ...this.subdomains
          .slice(0, MAX_DRAWN)
          .map((v) => ({ kind: 'sub', label: v, pivot: true })),
      ];
      const n = Math.max(nodes.length, 1);
      return {
        size: `${-PAD} -20 ${SIZE + PAD * 2} ${SIZE + 40}`,
        mid: MID,
        nodes: nodes.map((node, i) => {
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          const x = MID + Math.cos(angle) * RADIUS;
          const y = MID + Math.sin(angle) * RADIUS;
          const right = Math.cos(angle) >= 0;
          return {
            ...node,
            colour: KINDS[node.kind].colour,
            x,
            y,
            tx: x + (right ? 9 : -9),
            anchor: right ? 'start' : 'end',
            short:
              node.label.length > 26
                ? `${node.label.slice(0, 25)}…`
                : node.label,
          };
        }),
      };
    }

    // ─── Actions ──────────────────────────────────────────────────────

    setInput = (event) => (this.input = event.target.value);
    setTab = (tab) => (this.tab = tab);
    setFilter = (event) => {
      this.filter = event.target.value;
      this.shownCount = PAGE;
    };
    showMore = () => (this.shownCount += PAGE);

    submit = (event) => {
      event.preventDefault();
      this.look(this.input);
    };

    pivot = (label) => {
      this.input = label;
      this.look(label);
    };

    look = async (value) => {
      const domain = cleanDomain(value);
      if (!domain) {
        this.error = 'Type a domain, like example.com.';
        return;
      }
      this.controller?.abort();
      const controller = (this.controller = new AbortController());
      const signal = controller.signal;
      this.error = null;
      this.domain = domain;
      this.data = {};
      this.filter = '';
      this.shownCount = PAGE;
      this.status = Object.fromEntries(SOURCES.map(([id]) => [id, 'running']));
      const run = async (id, task) => {
        try {
          const value = await task();
          if (signal.aborted) return;
          this.data = { ...this.data, [id]: value };
          this.status = { ...this.status, [id]: 'done' };
        } catch {
          if (!signal.aborted) this.status = { ...this.status, [id]: 'failed' };
        }
      };
      const dns = run('dns', () => lookupDns(domain, signal));
      await Promise.all([
        run('rdap', () => lookupRdap(domain, signal)),
        run('subs', () => findSubdomains(domain, signal)),
        run('wayback', () => waybackSnapshots(domain, signal)),
        run('breaches', () => allBreaches(signal)),
        dns.then(() => {
          const ip = this.records.a[0];
          if (ip) return run('ip', () => lookupIp(ip));
          if (!signal.aborted) this.status = { ...this.status, ip: 'skipped' };
        }),
      ]);
    };
  }

  const tabId = (t) => t[0];
  const tabLabel = (t) => t[1];
  const eqTab = (current, t) => current === t[0];
  const isSubs = (t) => t[0] === 'subdomains';
  const isFailed = (state) => state === 'failed';
</script>

<script>
  let args = $props();
  const self = new DomainLookupPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="domain-lookup"
  busy={self.busy}
  closeWarning="Close Domain Lookup? The lookup still running will stop."
  subtitle="Everything public about a domain: who registered it, where it points, every subdomain it has had, how long it's been around and whether it's been breached, drawn as a map."
>
  <div class="pop-in">
    <form class="dl-form" aria-label="Look up a domain" onsubmit={self.submit}>
      <input
        type="text"
        class="math-input"
        placeholder="example.com"
        spellcheck="false"
        autocapitalize="off"
        aria-label="Domain"
        {@attach prop('value', () => self.input)}
        oninput={self.setInput}
      />
      <button type="submit" class="btn active" disabled={self.busy}>
        <Icon name="search" size={13} />
        {truthy(self.busy) ? 'Looking…' : 'Look up'}</button
      >
    </form>
    {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}

    {#if truthy(self.domain)}
      <div class="osint-chips">
        {#each self.sources ?? [] as s}
          <span class="osint-chip is-{s?.state}"
            >{s?.label}:
            {s?.state}</span
          >
        {/each}
      </div>

      <div class="osint-tabs" role="tablist">
        {#each self.tabs ?? [] as t}
          <button
            type="button"
            role="tab"
            class="btn {truthy(eqTab(self.tab, t)) ? 'active' : ''}"
            aria-selected={truthy(eqTab(self.tab, t)) ? 'true' : 'false'}
            onclick={(..._r) => self.setTab(tabId(t), ..._r)}
            >{tabLabel(t)}{#if truthy(isSubs(t))}
              ({self.subdomains?.length}){/if}</button
          >
        {/each}
      </div>

      {#if truthy(self.is?.overview)}
        <div class="math-grid">
          <section class="math-card">
            <h3 class="qr-heading">Registration</h3>
            {#if truthy(self.rdap)}
              <dl class="rbx-facts">
                <dt>Domain</dt><dd>{self.rdap?.name}</dd>
                {#if truthy(self.rdap?.registrar)}
                  <dt>Registrar</dt>
                  <dd
                    >{self.rdap?.registrar
                      ?.name}{#if truthy(self.rdap?.registrar?.registrarId)}
                      <span class="is-muted"
                        >(IANA
                        {self.rdap?.registrar?.registrarId})</span
                      >{/if}</dd
                  >
                {/if}
                <dt>Registrant</dt>
                <dd
                  >{#if truthy(self.rdap?.registrant)}{truthy(
                      self.rdap?.registrant?.org,
                    )
                      ? self.rdap?.registrant?.org
                      : self.rdap?.registrant
                          ?.name}{#if truthy(self.rdap?.registrant?.country)},
                      {self.rdap?.registrant?.country}{/if}{:else}<span
                      class="is-muted">Withheld (privacy service or GDPR)</span
                    >{/if}</dd
                >
                {#if truthy(self.registered)}
                  <dt>Registered</dt><dd
                    >{self.registered}
                    <span class="is-muted">({self.age})</span></dd
                  >
                {/if}
                {#if truthy(self.expiry)}
                  <dt>Expires</dt>
                  <dd class={truthy(self.expiry?.soon) ? 'dl-soon' : ''}
                    >{self.expiry?.date}
                    <span class="is-muted">({self.expiry?.note})</span></dd
                  >
                {/if}
                {#if truthy(self.updated)}
                  <dt>Updated</dt><dd>{self.updated}</dd>
                {/if}
                <dt>DNSSEC</dt><dd
                  >{truthy(self.rdap?.dnssec) ? 'Signed' : 'Not signed'}</dd
                >
              </dl>
              {#if truthy(self.rdap?.status?.length)}
                <ul class="dl-status">
                  {#each self.rdap?.status ?? [] as s}<li>{s}</li>{/each}
                </ul>
              {/if}
            {:else if truthy(self.rdapError)}
              <p class="tool-error">{self.rdapError}</p>
            {:else}
              <p class="tool-hint">Asking the registry…</p>
            {/if}
          </section>

          <section class="math-card">
            <h3 class="qr-heading">Findings</h3>
            <dl class="rbx-facts">
              {#each self.facts ?? [] as f}
                <dt>{f?.label}</dt><dd>{f?.value}</dd>
              {/each}
            </dl>
            {#each self.breaches ?? [] as b}
              <p class="osint-verdict is-bad"
                >{b?.title}
                ({b?.date}):
                {b?.classes?.length}
                kinds of data leaked.</p
              >
            {/each}
            {#if truthy(self.data?.wayback?.first)}
              <p class="tool-hint"
                >See every capture year by year in
                <Link route="wayback-snapshots">Wayback Snapshots</Link>.</p
              >
            {/if}
          </section>

          <section class="math-card osint-graph-card">
            <h3 class="qr-heading">DNS</h3>
            {#if truthy(self.dns)}
              {#if truthy(self.dns?.length)}
                {#each self.dns ?? [] as group}
                  <p class="qr-label is-muted">{group?.type}</p>
                  <ul class="dl-list">
                    {#each group?.answers ?? [] as a}
                      <li
                        ><code>{a?.value}</code>
                        <span class="is-muted">TTL {a?.ttl}</span></li
                      >
                    {/each}
                  </ul>
                {/each}
                <p class="tool-hint"
                  >Curious where an address is? Paste it into the
                  <Link route="ip-lookup">IP Lookup</Link>.</p
                >
              {:else}
                <p class="tool-hint"
                  >No records: the domain is registered but doesn't point
                  anywhere yet, or doesn't exist.</p
                >
              {/if}
            {:else}
              <p class="tool-hint">Resolving…</p>
            {/if}
          </section>
        </div>
      {/if}

      {#if truthy(self.is?.subdomains)}
        <section class="math-card">
          {#if truthy(self.data?.subs)}
            <div class="osint-bar">
              <span
                ><strong>{self.subdomains?.length}</strong>
                names for
                {self.domain}
                <span class="is-muted"
                  >via
                  {self.data?.subs?.source}</span
                ></span
              >
              <CopyButton value={self.subdomainText} label="Copy list" />
            </div>
            <input
              type="search"
              class="math-input"
              placeholder="Filter (dev, mail, api…)"
              aria-label="Filter subdomains"
              {@attach prop('value', () => self.filter)}
              oninput={self.setFilter}
            />
            <ul class="dl-list osint-columns">
              {#each self.shownSubdomains ?? [] as n}
                <li
                  ><button
                    type="button"
                    class="osint-link-button"
                    title="Look this up"
                    onclick={(..._r) => self.pivot(n, ..._r)}
                    ><code>{n}</code></button
                  ></li
                >
              {/each}
            </ul>
            {#if truthy(self.moreSubdomains)}
              <button type="button" class="btn" onclick={self.showMore}
                >Show 200 more ({self.moreSubdomains} left)</button
              >
            {/if}
            <p class="tool-hint"
              >From the public certificate-transparency logs: a name here had an
              HTTPS certificate at some point and may not resolve any more.
              Click one to look it up.</p
            >
          {:else if truthy(self.status?.subs)}
            <p class="tool-hint"
              >{truthy(isFailed(self.status?.subs))
                ? 'Neither certificate log search answered. Try again in a minute.'
                : 'Searching the certificate logs; big domains can take up to half a minute.'}</p
            >
          {/if}
        </section>
      {/if}

      {#if truthy(self.is?.map)}
        <section class="math-card osint-graph-card">
          <svg
            class="osint-graph"
            viewBox={self.graph?.size}
            role="img"
            aria-label="What {self.domain} is connected to"
          >
            {#each self.graph?.nodes ?? [] as n}
              <line
                x1={self.graph?.mid}
                y1={self.graph?.mid}
                x2={n?.x}
                y2={n?.y}
                stroke={n?.colour}
                class="osint-edge"
              ></line>
            {/each}
            {#each self.graph?.nodes ?? [] as n}
              {#if truthy(n?.pivot)}
                <g
                  class="osint-node is-pivot"
                  role="button"
                  tabindex="0"
                  onclick={(..._r) => self.pivot(n?.label, ..._r)}
                >
                  <title>{n?.label}: click to look it up</title>
                  <circle cx={n?.x} cy={n?.y} r="6" fill={n?.colour}></circle>
                  <text
                    x={n?.tx}
                    y={n?.y}
                    text-anchor={n?.anchor}
                    dominant-baseline="middle">{n?.short}</text
                  >
                </g>
              {:else}
                <g class="osint-node">
                  <title>{n?.label}</title>
                  <circle cx={n?.x} cy={n?.y} r="6" fill={n?.colour}></circle>
                  <text
                    x={n?.tx}
                    y={n?.y}
                    text-anchor={n?.anchor}
                    dominant-baseline="middle">{n?.short}</text
                  >
                </g>
              {/if}
            {/each}
            <circle
              cx={self.graph?.mid}
              cy={self.graph?.mid}
              r="10"
              class="osint-centre"
            ></circle>
            <text
              x={self.graph?.mid}
              y={self.graph?.mid}
              dy="26"
              text-anchor="middle"
              class="osint-centre-label">{self.domain}</text
            >
          </svg>
          <div class="osint-legend">
            {#each self.kinds ?? [] as k}
              <span><i style={k?.swatch}></i>{k?.label}</span>
            {/each}
          </div>
          <p class="tool-hint"
            >Only the first
            {MAX_DRAWN}
            subdomains are drawn; the Subdomains tab lists them all.</p
          >
        </section>
      {/if}
    {:else}
      <p class="tool-hint"
        >Everything here is passive: public registries (RDAP, the successor to
        WHOIS), DNS, certificate-transparency logs, the Internet Archive and
        Have I Been Pwned's breach list. The domain itself is never contacted.</p
      >
    {/if}
  </div>
</ToolPage>
