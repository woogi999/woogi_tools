import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';

const API = '/api/mail';
const DOMAIN = 'temp.woogi.xyz';
const POLL_MS = 6000;
// Long enough that nobody guesses it; short enough to read out.
const randomBox = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
};

const when = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default class DisposableEmailPage extends Component {
  @tracked box = '';
  @tracked messages = [];
  @tracked open = null;
  @tracked error = null;
  @tracked checking = false;
  @tracked lastChecked = null;
  @tracked available = null;

  timer = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'disposable-email', ['box'], () => {
      if (!this.box) this.box = randomBox();
      this.check();
      this.timer = setInterval(this.check, POLL_MS);
    });
    registerDestructor(this, () => clearInterval(this.timer));
  }

  get address() {
    return `${this.box}@${DOMAIN}`;
  }

  get busy() {
    return Boolean(this.box) && this.available !== false;
  }

  get openHtml() {
    // The message's own HTML runs sealed inside an iframe with no scripts,
    // no forms and no way back into this page.
    return this.open?.html || null;
  }

  check = async () => {
    if (!this.box || this.checking || document.hidden) return;
    this.checking = true;
    try {
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- our own Worker route
      const response = await fetch(`${API}?box=${this.box}`);
      const body = await response.json().catch(() => ({}));
      if (response.status === 503) {
        this.available = false;
        this.error = body.error;
        clearInterval(this.timer);
        return;
      }
      if (!response.ok)
        throw new Error(body.error || 'The inbox could not be read.');
      this.available = true;
      this.messages = body.messages;
      this.error = null;
      this.lastChecked = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch (err) {
      this.error = err.message;
    } finally {
      this.checking = false;
    }
  };

  read = async (message) => {
    try {
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- our own Worker route
      const response = await fetch(`${API}?box=${this.box}&id=${message.id}`);
      if (!response.ok) throw new Error('That message has gone.');
      this.open = await response.json();
    } catch (err) {
      this.error = err.message;
    }
  };

  back = () => (this.open = null);

  fresh = async () => {
    try {
      // eslint-disable-next-line warp-drive/no-external-request-patterns -- our own Worker route
      await fetch(`${API}?box=${this.box}`, { method: 'DELETE' });
    } catch {
      // the old box expires by itself within the hour anyway
    }
    this.box = randomBox();
    this.messages = [];
    this.open = null;
    this.error = null;
    this.check();
  };

  <template>
    <ToolPage
      @route="disposable-email"
      @subtitle="An email address that lasts an hour, for sign-ups you don't want in your real inbox. Mail shows up here as it arrives."
      @busy={{this.busy}}
      @closeWarning="the inbox"
    >
      <div class="math-grid pop-in">
        <section class="math-card">
          <h3 class="qr-heading">Your address</h3>
          <p class="de-address">{{this.address}}</p>
          <div class="settings-actions">
            <CopyButton @value={{this.address}} @label="Copy address" />
            <button
              type="button"
              class="btn"
              {{on "click" this.check}}
              disabled={{this.checking}}
            >
              <Icon @name="refresh-cw" @size={{13}} />
              {{if this.checking "Checking…" "Check now"}}</button>
            <button type="button" class="btn" {{on "click" this.fresh}}>
              <Icon @name="shuffle" @size={{13}} />
              New address</button>
          </div>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
          <p class="tool-hint">Anything sent here is kept for an hour on the
            site's server and then wiped; nobody else can see it unless they
            know the address. The address is remembered in this browser until
            you ask for a new one. Don't use it for anything you'll need to get
            back into later.</p>
          {{#if this.lastChecked}}
            <p class="tool-hint">Checked at
              {{this.lastChecked}}; checks again every few seconds while this
              page is open.</p>
          {{/if}}
        </section>

        <section class="math-card">
          {{#if this.open}}
            <div class="fc-toolbar">
              <button type="button" class="btn" {{on "click" this.back}}>
                <Icon @name="arrow-left" @size={{13}} />
                Inbox</button>
            </div>
            <h3 class="de-subject">{{if
                this.open.subject
                this.open.subject
                "(no subject)"
              }}</h3>
            <p class="tool-hint">From
              {{#if this.open.fromName}}{{this.open.fromName}}
                &lt;{{this.open.from}}&gt;{{else}}{{this.open.from}}{{/if}}
              at
              {{when this.open.date}}</p>
            {{#if this.open.attachments.length}}
              <p class="tool-hint">Attachments (not kept):
                {{#each this.open.attachments as |a|}}{{a.name}} {{/each}}</p>
            {{/if}}
            {{#if this.openHtml}}
              <iframe
                class="de-frame"
                title="Message"
                sandbox=""
                referrerpolicy="no-referrer"
                srcdoc={{this.openHtml}}
              ></iframe>
            {{else}}
              <pre class="de-text">{{this.open.text}}</pre>
            {{/if}}
          {{else}}
            <h3 class="qr-heading">Inbox</h3>
            {{#if this.messages.length}}
              <ul class="de-list">
                {{#each this.messages key="id" as |m|}}
                  <li>
                    <button
                      type="button"
                      class="de-row"
                      {{on "click" (fn this.read m)}}
                    >
                      <span class="de-row-top">
                        <strong>{{if m.fromName m.fromName m.from}}</strong>
                        <span class="is-muted">{{when m.date}}</span>
                      </span>
                      <span class="de-row-subject">{{if
                          m.subject
                          m.subject
                          "(no subject)"
                        }}{{#if m.attachments}}
                          <Icon @name="paperclip" @size={{12}} />{{/if}}</span>
                      <span class="de-row-preview">{{m.preview}}</span>
                    </button>
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class="tool-hint">Nothing yet. Use the address somewhere and
                the mail turns up here within a few seconds.</p>
            {{/if}}
          {{/if}}
        </section>
      </div>
    </ToolPage>
  </template>
}
