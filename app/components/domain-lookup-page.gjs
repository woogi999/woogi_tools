import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import { LinkTo } from '@ember/routing';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';
import { cleanDomain, lookupRdap, lookupDns } from '../utils/domain';

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

const daysUntil = (iso) => {
  if (!iso) return null;
  return Math.round((new Date(iso) - Date.now()) / 86400000);
};

export default class DomainLookupPage extends Component {
  @tracked input = '';
  @tracked domain = null;
  @tracked busy = false;
  @tracked error = null;
  @tracked rdap = null;
  @tracked rdapError = null;
  @tracked dns = null;

  controller = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'domain-lookup', ['input']);
    registerDestructor(this, () => this.controller?.abort());
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

  setInput = (event) => (this.input = event.target.value);

  submit = (event) => {
    event.preventDefault();
    this.look();
  };

  look = async () => {
    const domain = cleanDomain(this.input);
    if (!domain) {
      this.error = 'Type a domain, like example.com.';
      return;
    }
    this.controller?.abort();
    const controller = (this.controller = new AbortController());
    this.domain = domain;
    this.busy = true;
    this.error = null;
    this.rdap = null;
    this.rdapError = null;
    this.dns = null;
    const [rdap, dns] = await Promise.allSettled([
      lookupRdap(domain, controller.signal),
      lookupDns(domain, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    if (rdap.status === 'fulfilled') this.rdap = rdap.value;
    else
      this.rdapError =
        rdap.reason?.message ?? 'The registry could not be reached.';
    this.dns = dns.status === 'fulfilled' ? dns.value : [];
    this.busy = false;
  };

  <template>
    <ToolPage
      @route="domain-lookup"
      @subtitle="Who a domain is registered to, when it runs out, and where it points: the registry record and the DNS, side by side."
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
          <button type="submit" class="btn active" disabled={{this.busy}}>
            <Icon @name="search" @size={{13}} />
            {{if this.busy "Looking…" "Look up"}}</button>
        </form>
        {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}

        {{#if this.domain}}
          <div class="math-grid">
            <section class="math-card">
              <h3 class="qr-heading">Registration</h3>
              {{#if this.rdap}}
                <dl class="rbx-facts">
                  <dt>Domain</dt><dd>{{this.rdap.name}}</dd>
                  {{#if this.rdap.registrar}}
                    <dt>Registrar</dt>
                    <dd>{{this.rdap.registrar.name}}{{#if
                        this.rdap.registrar.registrarId
                      }}
                        <span class="is-muted">(IANA
                          {{this.rdap.registrar.registrarId}})</span>{{/if}}</dd>
                  {{/if}}
                  <dt>Registrant</dt>
                  <dd>{{#if this.rdap.registrant}}{{if
                        this.rdap.registrant.org
                        this.rdap.registrant.org
                        this.rdap.registrant.name
                      }}{{#if this.rdap.registrant.country}},
                        {{this.rdap.registrant.country}}{{/if}}{{else}}<span
                        class="is-muted"
                      >Withheld (privacy service or GDPR)</span>{{/if}}</dd>
                  {{#if this.registered}}
                    <dt>Registered</dt><dd>{{this.registered}}
                      <span class="is-muted">({{this.age}})</span></dd>
                  {{/if}}
                  {{#if this.expiry}}
                    <dt>Expires</dt>
                    <dd
                      class="{{if this.expiry.soon 'dl-soon'}}"
                    >{{this.expiry.date}}
                      <span class="is-muted">({{this.expiry.note}})</span></dd>
                  {{/if}}
                  {{#if this.updated}}
                    <dt>Updated</dt><dd>{{this.updated}}</dd>
                  {{/if}}
                  <dt>DNSSEC</dt><dd>{{if
                      this.rdap.dnssec
                      "Signed"
                      "Not signed"
                    }}</dd>
                </dl>
                {{#if this.rdap.status.length}}
                  <ul class="dl-status">
                    {{#each this.rdap.status as |s|}}<li>{{s}}</li>{{/each}}
                  </ul>
                {{/if}}
                {{#if this.rdap.nameservers.length}}
                  <p class="qr-label is-muted">Name servers at the registry</p>
                  <ul class="dl-list">
                    {{#each this.rdap.nameservers as |ns|}}<li><code
                        >{{ns}}</code></li>{{/each}}
                  </ul>
                {{/if}}
              {{else if this.rdapError}}
                <p class="tool-error">{{this.rdapError}}</p>
              {{else}}
                <p class="tool-hint">Asking the registry…</p>
              {{/if}}
            </section>

            <section class="math-card">
              <h3 class="qr-heading">DNS</h3>
              {{#if this.dns}}
                {{#if this.dns.length}}
                  {{#each this.dns as |group|}}
                    <p class="qr-label is-muted">{{group.type}}</p>
                    <ul class="dl-list">
                      {{#each group.answers as |a|}}
                        <li><code>{{a.value}}</code>
                          <span class="is-muted">TTL {{a.ttl}}</span></li>
                      {{/each}}
                    </ul>
                  {{/each}}
                  <p class="tool-hint">Curious where an address is? Paste it
                    into the
                    <LinkTo @route="ip-lookup">IP Lookup</LinkTo>.</p>
                {{else}}
                  <p class="tool-hint">No records: the domain is registered but
                    doesn't point anywhere yet, or doesn't exist.</p>
                {{/if}}
              {{else}}
                <p class="tool-hint">Resolving…</p>
              {{/if}}
            </section>
          </div>
        {{else}}
          <p class="tool-hint">Registry data comes over RDAP, the successor to
            WHOIS, and DNS answers from Cloudflare's resolver. Both are asked
            straight from your browser.</p>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
