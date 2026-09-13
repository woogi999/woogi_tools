import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import ToolPage from './tool-page';
import CopyButton from './copy-button';

// Example token signed with the secret "woogi".
const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ildvb2dpIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.XpVA21w55jbzB8c9Kp6nNDGsHYug3JZVZJRxN6uYEfE';

const HMAC = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };
const TIME_CLAIMS = { iat: 'Issued', exp: 'Expires', nbf: 'Not before', auth_time: 'Authenticated' };
const CLAIM_NAMES = { iss: 'Issuer', sub: 'Subject', aud: 'Audience', jti: 'Token ID', ...TIME_CLAIMS };

const base64UrlBytes = (part) => {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const decodePart = (part) => JSON.parse(new TextDecoder().decode(base64UrlBytes(part)));

function relative(ms) {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const [unit, size] = [['day', 86400000], ['hour', 3600000], ['minute', 60000], ['second', 1000]].find(([, s]) => abs >= s) ?? ['second', 1000];
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(diff / size), unit);
}

function parseToken(token) {
  const parts = token.trim().replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3) return { error: 'A JWT has three parts separated by dots: header.payload.signature' };
  try {
    return { header: decodePart(parts[0]), payload: decodePart(parts[1]), parts };
  } catch {
    return { error: "The header or payload isn't valid Base64URL-encoded JSON" };
  }
}

export default class JwtDecoderPage extends Component {
  @tracked token = SAMPLE;
  @tracked secret = '';
  @tracked verification = null;

  runId = 0;

  get parsed() {
    return this.token.trim() ? parseToken(this.token) : null;
  }

  get headerJson() {
    return this.parsed?.header ? JSON.stringify(this.parsed.header, null, 2) : '';
  }

  get payloadJson() {
    return this.parsed?.payload ? JSON.stringify(this.parsed.payload, null, 2) : '';
  }

  get claims() {
    const payload = this.parsed?.payload;
    if (!payload || typeof payload !== 'object') return [];
    return Object.entries(payload)
      .filter(([key]) => CLAIM_NAMES[key])
      .map(([key, value]) => ({
        label: `${CLAIM_NAMES[key]} (${key})`,
        value: TIME_CLAIMS[key] && typeof value === 'number' ? `${new Date(value * 1000).toLocaleString()} · ${relative(value * 1000)}` : Array.isArray(value) ? value.join(', ') : String(value),
      }));
  }

  get status() {
    const payload = this.parsed?.payload;
    if (!payload) return null;
    const now = Date.now() / 1000;
    if (typeof payload.exp === 'number' && payload.exp < now) return { ok: false, text: `Expired ${relative(payload.exp * 1000)}.` };
    if (typeof payload.nbf === 'number' && payload.nbf > now) return { ok: false, text: `Not valid until ${relative(payload.nbf * 1000)}.` };
    return { ok: true, text: typeof payload.exp === 'number' ? `Not expired; expires ${relative(payload.exp * 1000)}.` : 'No expiry set.' };
  }

  get algorithm() {
    return this.parsed?.header?.alg;
  }

  get canVerify() {
    return Boolean(HMAC[this.algorithm]);
  }

  async verify() {
    const id = ++this.runId;
    const { parts } = this.parsed ?? {};
    if (!parts || !this.canVerify || !this.secret) {
      this.verification = null;
      return;
    }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.secret), { name: 'HMAC', hash: HMAC[this.algorithm] }, false, ['verify']);
    let valid = false;
    try {
      valid = await crypto.subtle.verify('HMAC', key, base64UrlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    } catch {
      valid = false;
    }
    if (id === this.runId) this.verification = valid;
  }

  setToken = (e) => {
    this.token = e.target.value;
    this.verify();
  };

  setSecret = (e) => {
    this.secret = e.target.value;
    this.verify();
  };

  <template>
    <ToolPage @route="jwt-decoder" @subtitle="Decode a JSON Web Token's header and claims, check its expiry, and verify HMAC signatures.">
      <div class="math-grid text-tool pop-in">
        <section class="math-card">
          <label class="field-label" for="jwt-token">Token</label>
          <textarea id="jwt-token" class="textarea text-area-tall is-mono" spellcheck="false" value={{this.token}} {{on "input" this.setToken}}></textarea>
          {{#if this.parsed.error}}
            <p class="tool-error">{{this.parsed.error}}</p>
          {{else if this.status}}
            <p class="math-callout {{unless this.status.ok 'is-soft'}}">{{this.status.text}}</p>
          {{/if}}
          <p class="tool-hint">Decoding happens in your browser. Even so, avoid pasting live production tokens into any website.</p>

          {{#if this.algorithm}}
            <h3 class="qr-heading">Signature · {{this.algorithm}}</h3>
            {{#if this.canVerify}}
              <label class="math-field">
                <span class="qr-label is-muted">Secret</span>
                <input type="text" class="math-input" spellcheck="false" autocomplete="off" placeholder="Enter the HMAC secret to verify" value={{this.secret}} {{on "input" this.setSecret}} />
              </label>
              {{#if this.secret}}
                <p class="math-callout {{unless this.verification 'is-soft'}}">{{if this.verification "Signature verified." "Signature does not match this secret."}}</p>
              {{/if}}
            {{else}}
              <p class="tool-hint">Only HMAC tokens (HS256/384/512) can be verified here; {{this.algorithm}} needs the issuer's public key.</p>
            {{/if}}
          {{/if}}
        </section>

        {{#if this.parsed.payload}}
          <section class="math-card">
            {{#if this.claims.length}}
              <div class="math-stats">
                {{#each this.claims as |c|}}
                  <div class="math-stat"><span>{{c.label}}</span><strong>{{c.value}}</strong></div>
                {{/each}}
              </div>
            {{/if}}
            <div class="field-head"><span class="qr-label is-muted">Header</span><CopyButton @value={{this.headerJson}} /></div>
            <pre class="code-block">{{this.headerJson}}</pre>
            <div class="field-head"><span class="qr-label is-muted">Payload</span><CopyButton @value={{this.payloadJson}} /></div>
            <pre class="code-block">{{this.payloadJson}}</pre>
          </section>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
