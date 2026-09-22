import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import ToolPage from './tool-page';
import { keepState } from '../utils/tool-state';
import {
  parseHeaders,
  receivedHops,
  authResults,
  headerValue,
  headerWarnings,
} from '../utils/osint';

const SUMMARY = [
  'From',
  'Reply-To',
  'Return-Path',
  'To',
  'Subject',
  'Date',
  'Message-ID',
  'X-Mailer',
  'User-Agent',
  'X-Originating-IP',
];

const seconds = (s) =>
  s === null ? '' : s < 60 ? `+${s}s` : `+${Math.round(s / 60)}m`;

export default class EmailHeaderAnalyzerPage extends Component {
  @tracked raw = '';

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'email-header-analyzer', ['raw']);
  }

  get headers() {
    return parseHeaders(this.raw);
  }

  get summary() {
    return SUMMARY.map((name) => ({
      name,
      value: headerValue(this.headers, name),
    })).filter((r) => r.value);
  }

  get hops() {
    return receivedHops(this.headers).map((h) => ({
      ...h,
      when: h.date?.toLocaleString() ?? '',
      delay: seconds(h.delay),
      slow: h.delay > 300,
    }));
  }

  get auth() {
    const a = authResults(this.headers);
    return ['spf', 'dkim', 'dmarc']
      .filter((k) => a[k])
      .map((k) => ({
        name: k.toUpperCase(),
        value: a[k],
        pass: a[k] === 'pass',
      }));
  }

  get warnings() {
    return headerWarnings(this.headers, authResults(this.headers));
  }

  setRaw = (event) => (this.raw = event.target.value);

  <template>
    <ToolPage
      @route="email-header-analyzer"
      @subtitle="Paste an email's raw headers to see the route it took, whether the sender checks out, and what looks off."
    >
      <div class="pop-in math-grid">
        <section class="math-card">
          <textarea
            class="math-input osint-textarea"
            placeholder="Received: from mail.example.com …"
            spellcheck="false"
            aria-label="Email headers"
            value={{this.raw}}
            {{on "input" this.setRaw}}
          ></textarea>
          <p class="tool-hint">Gmail: ⋮ → Show original. Outlook: File →
            Properties → Internet headers. Apple Mail: View → Message → All
            Headers. It's read in your browser; nothing is sent anywhere.</p>
        </section>

        {{#if this.headers.length}}
          <section class="math-card">
            {{#if this.auth.length}}
              <div class="osint-chips">
                {{#each this.auth as |a|}}
                  <span
                    class="osint-chip {{if a.pass 'is-good' 'is-bad'}}"
                  >{{a.name}}
                    {{a.value}}</span>
                {{/each}}
              </div>
            {{/if}}
            {{#each this.warnings as |w|}}
              <p class="osint-verdict is-bad">{{w}}</p>
            {{/each}}
            <dl class="rbx-facts">
              {{#each this.summary as |r|}}
                <dt>{{r.name}}</dt><dd>{{r.value}}</dd>
              {{/each}}
            </dl>

            {{#if this.hops.length}}
              <h3 class="qr-heading">Route, sender first</h3>
              <ol class="osint-hops">
                {{#each this.hops as |h|}}
                  <li>
                    <div><strong>{{if h.from h.from "?"}}</strong>
                      →
                      {{if h.by h.by "?"}}
                      {{#if h.with}}<span
                          class="is-muted"
                        >({{h.with}})</span>{{/if}}</div>
                    <div class="is-muted">
                      {{#if h.ip}}<code>{{h.ip}}</code>{{/if}}
                      {{h.when}}
                      {{#if h.delay}}<span
                          class="{{if h.slow 'dl-soon'}}"
                        >{{h.delay}}</span>{{/if}}
                    </div>
                  </li>
                {{/each}}
              </ol>
              <p class="tool-hint">The first public address is usually the
                sender's mail server (sometimes their own connection). Look it
                up in the
                <LinkTo @route="ip-lookup">IP Address Lookup</LinkTo>.</p>
            {{/if}}
          </section>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
