<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import Link from '../core/link.svelte';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import { keepState } from '../utils/tool-state.js';
  import {
    parseHeaders,
    receivedHops,
    authResults,
    headerValue,
    headerWarnings,
  } from '../utils/osint.js';

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

  class EmailHeaderAnalyzerPage extends Component {
    raw = $state.raw('');

    constructor(args) {
      super(args);
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
  }
</script>

<script>
  let args = $props();
  const self = new EmailHeaderAnalyzerPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="email-header-analyzer"
  subtitle="Paste an email's raw headers to see the route it took, whether the sender checks out, and what looks off."
>
  <div class="pop-in math-grid">
    <section class="math-card">
      <textarea
        class="math-input osint-textarea"
        placeholder="Received: from mail.example.com …"
        spellcheck="false"
        aria-label="Email headers"
        {@attach prop('value', () => self.raw)}
        oninput={self.setRaw}></textarea>
      <p class="tool-hint"
        >Gmail: ⋮ → Show original. Outlook: File → Properties → Internet
        headers. Apple Mail: View → Message → All Headers. It's read in your
        browser; nothing is sent anywhere.</p
      >
    </section>

    {#if truthy(self.headers?.length)}
      <section class="math-card">
        {#if truthy(self.auth?.length)}
          <div class="osint-chips">
            {#each self.auth ?? [] as a}
              <span class="osint-chip {truthy(a?.pass) ? 'is-good' : 'is-bad'}"
                >{a?.name}
                {a?.value}</span
              >
            {/each}
          </div>
        {/if}
        {#each self.warnings ?? [] as w}
          <p class="osint-verdict is-bad">{w}</p>
        {/each}
        <dl class="rbx-facts">
          {#each self.summary ?? [] as r}
            <dt>{r?.name}</dt><dd>{r?.value}</dd>
          {/each}
        </dl>

        {#if truthy(self.hops?.length)}
          <h3 class="qr-heading">Route, sender first</h3>
          <ol class="osint-hops">
            {#each self.hops ?? [] as h}
              <li>
                <div
                  ><strong>{truthy(h?.from) ? h?.from : '?'}</strong>
                  →
                  {truthy(h?.by) ? h?.by : '?'}
                  {#if truthy(h?.with)}<span class="is-muted">({h?.with})</span
                    >{/if}</div
                >
                <div class="is-muted">
                  {#if truthy(h?.ip)}<code>{h?.ip}</code>{/if}
                  {h?.when}
                  {#if truthy(h?.delay)}<span
                      class={truthy(h?.slow) ? 'dl-soon' : ''}>{h?.delay}</span
                    >{/if}
                </div>
              </li>
            {/each}
          </ol>
          <p class="tool-hint"
            >The first public address is usually the sender's mail server
            (sometimes their own connection). Look it up in the
            <Link route="ip-lookup">IP Address Lookup</Link>.</p
          >
        {/if}
      </section>
    {/if}
  </div>
</ToolPage>
