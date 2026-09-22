import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import { htmlSafe } from '@ember/template';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';
import { cleanDomain, lookupRdap, lookupDns } from '../utils/domain';
import { lookup as lookupIp } from '../utils/ip-lookup';
import {
  findSubdomains,
  waybackSnapshots,
  waybackDate,
  allBreaches,
} from '../utils/osint';

// Recon Sweep: one domain in, every passive source this site has run at once,
// and what came back drawn as a link graph around it (the way SpiderFoot
// scans and Maltego draws). Click a subdomain in the graph to sweep it next.

const SIZE = 640;
const MID = SIZE / 2;
const RADIUS = 250;
const MAX_SUBDOMAINS = 30;
// Room either side for the labels, which run outwards from their dots.
const PAD = 180;

const KINDS = {
  ip: { label: 'Address', colour: '#4f9dff' },
  ns: { label: 'Name server', colour: '#a07bff' },
  mx: { label: 'Mail server', colour: '#ff9f43' },
  registrar: { label: 'Registrar', colour: '#2ecc71' },
  sub: { label: 'Subdomain', colour: '#8a8f98' },
  breach: { label: 'Breach', colour: '#ff5a5f' },
};

const SOURCES = [
  ['rdap', 'Registry (RDAP)'],
  ['dns', 'DNS'],
  ['subs', 'Certificate logs'],
  ['wayback', 'Internet Archive'],
  ['breaches', 'Have I Been Pwned'],
  ['ip', 'IP location'],
];

export default class ReconSweepPage extends Component {
  kinds = Object.entries(KINDS).map(([id, k]) => ({
    id,
    ...k,
    swatch: htmlSafe(`background: ${k.colour}`),
  }));

  @tracked input = '';
  @tracked domain = null;
  @tracked data = {};
  @tracked status = {};
  @tracked error = null;

  controller = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'recon-sweep', ['input']);
    registerDestructor(this, () => this.controller?.abort());
  }

  get sources() {
    return SOURCES.map(([id, label]) => ({
      label,
      state: this.status[id] ?? 'waiting',
    }));
  }

  get busy() {
    return Object.values(this.status).includes('running');
  }

  get records() {
    const dns = Array.isArray(this.data.dns) ? this.data.dns : [];
    const of = (type) =>
      dns.find((g) => g.type === type)?.answers.map((a) => a.value) ?? [];
    return {
      a: [...of('A'), ...of('AAAA')],
      mx: of('MX').map((v) => v.split(/\s+/).at(-1).replace(/\.$/, '')),
      ns: of('NS').map((v) => v.replace(/\.$/, '')),
      txt: of('TXT'),
    };
  }

  get breaches() {
    const d = this.domain;
    return (Array.isArray(this.data.breaches) ? this.data.breaches : []).filter(
      (b) => b.domain && (b.domain === d || b.domain.endsWith(`.${d}`)),
    );
  }

  get subdomains() {
    const names = this.data.subs?.names;
    return Array.isArray(names) ? names.filter((n) => n !== this.domain) : [];
  }

  get graph() {
    if (!this.domain) return null;
    const r = this.records;
    const nodes = [
      ...r.a.map((v) => ({ kind: 'ip', label: String(v) })),
      ...(r.ns.length ? r.ns : (this.data.rdap?.nameservers ?? [])).map(
        (v) => ({ kind: 'ns', label: String(v) }),
      ),
      ...r.mx.map((v) => ({ kind: 'mx', label: String(v) })),
      ...(this.data.rdap?.registrar
        ? [
            {
              kind: 'registrar',
              label: String(this.data.rdap.registrar.name || 'Registrar'),
            },
          ]
        : []),
      ...this.breaches.map((b) => ({ kind: 'breach', label: b.title })),
      ...this.subdomains
        .slice(0, MAX_SUBDOMAINS)
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
            node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label,
        };
      }),
    };
  }

  get facts() {
    const d = this.data;
    const rows = [];
    if (d.rdap?.registered)
      rows.push([
        'Registered',
        new Date(d.rdap.registered).toLocaleDateString(),
      ]);
    if (d.rdap?.registrant)
      rows.push([
        'Registrant',
        d.rdap.registrant.org ?? d.rdap.registrant.name,
      ]);
    if (d.ip)
      rows.push([
        'Hosted',
        [d.ip.org || d.ip.isp, d.ip.city, d.ip.country]
          .filter(Boolean)
          .join(', '),
      ]);
    if (d.wayback?.first)
      rows.push([
        'Archived',
        `since ${waybackDate(d.wayback.first).toLocaleDateString()}, last ${waybackDate(d.wayback.last).toLocaleDateString()}`,
      ]);
    if (d.subs) rows.push(['Subdomains', String(this.subdomains.length)]);
    rows.push(['Breaches', String(this.breaches.length)]);
    const spf = this.records.txt.find((t) => /v=spf1/i.test(t));
    rows.push(['SPF', spf ? 'Published' : 'None']);
    return rows.map(([label, value]) => ({ label, value }));
  }

  setInput = (event) => (this.input = event.target.value);

  submit = (event) => {
    event.preventDefault();
    this.sweep(this.input);
  };

  pivot = (label) => {
    this.input = label;
    this.sweep(label);
  };

  sweep = async (value) => {
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

  <template>
    <ToolPage
      @route="recon-sweep"
      @busy={{this.busy}}
      @closeWarning="Close Recon Sweep? The sweep still running will stop."
      @subtitle="One domain in; its registration, servers, subdomains, history and breaches out, drawn as a map of how they connect."
    >
      <div class="pop-in">
        <form class="dl-form" {{on "submit" this.submit}}>
          <input
            type="text"
            class="math-input"
            placeholder="example.com"
            spellcheck="false"
            autocapitalize="off"
            aria-label="Domain"
            value={{this.input}}
            {{on "input" this.setInput}}
          />
          <button type="submit" class="btn active">
            <Icon @name="radar" @size={{13}} />
            Sweep</button>
        </form>
        {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}

        {{#if this.graph}}
          <div class="osint-chips">
            {{#each this.sources as |s|}}
              <span class="osint-chip is-{{s.state}}">{{s.label}}:
                {{s.state}}</span>
            {{/each}}
          </div>
          <div class="math-grid">
            <section class="math-card osint-graph-card">
              <svg
                class="osint-graph"
                viewBox={{this.graph.size}}
                role="img"
                aria-label="What {{this.domain}} is connected to"
              >
                {{#each this.graph.nodes as |n|}}
                  <line
                    x1={{this.graph.mid}}
                    y1={{this.graph.mid}}
                    x2={{n.x}}
                    y2={{n.y}}
                    stroke={{n.colour}}
                    class="osint-edge"
                  />
                {{/each}}
                {{#each this.graph.nodes as |n|}}
                  {{#if n.pivot}}
                    <g
                      class="osint-node is-pivot"
                      role="button"
                      tabindex="0"
                      {{on "click" (fn this.pivot n.label)}}
                    >
                      <title>{{n.label}}: click to sweep it</title>
                      <circle cx={{n.x}} cy={{n.y}} r="6" fill={{n.colour}} />
                      <text
                        x={{n.tx}}
                        y={{n.y}}
                        text-anchor={{n.anchor}}
                        dominant-baseline="middle"
                      >{{n.short}}</text>
                    </g>
                  {{else}}
                    <g class="osint-node">
                      <title>{{n.label}}</title>
                      <circle cx={{n.x}} cy={{n.y}} r="6" fill={{n.colour}} />
                      <text
                        x={{n.tx}}
                        y={{n.y}}
                        text-anchor={{n.anchor}}
                        dominant-baseline="middle"
                      >{{n.short}}</text>
                    </g>
                  {{/if}}
                {{/each}}
                <circle
                  cx={{this.graph.mid}}
                  cy={{this.graph.mid}}
                  r="10"
                  class="osint-centre"
                />
                <text
                  x={{this.graph.mid}}
                  y={{this.graph.mid}}
                  dy="26"
                  text-anchor="middle"
                  class="osint-centre-label"
                >{{this.domain}}</text>
              </svg>
              <div class="osint-legend">
                {{#each this.kinds as |k|}}
                  <span><i style={{k.swatch}}></i>{{k.label}}</span>
                {{/each}}
              </div>
            </section>

            <section class="math-card">
              <h3 class="qr-heading">Findings</h3>
              <dl class="rbx-facts">
                {{#each this.facts as |f|}}
                  <dt>{{f.label}}</dt><dd>{{f.value}}</dd>
                {{/each}}
              </dl>
              {{#each this.breaches as |b|}}
                <p class="osint-verdict is-bad">{{b.title}}
                  ({{b.date}}):
                  {{b.classes.length}}
                  kinds of data leaked.</p>
              {{/each}}
              <p class="tool-hint">Everything here is passive: public
                registries, DNS, certificate logs and archives. The domain
                itself is never contacted. Only the first
                {{MAX_SUBDOMAINS}}
                subdomains are drawn; the Subdomain Finder lists them all.</p>
            </section>
          </div>
        {{else}}
          <p class="tool-hint">Like SpiderFoot's passive scan, with a
            Maltego-style graph of the results.</p>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
