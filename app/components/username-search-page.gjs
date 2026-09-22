import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';
import { checkUsernames, checkCustomSite } from '../utils/osint';
import {
  USERNAME_SITES,
  USERNAME_PATTERN,
  fill,
} from '../utils/username-sites';

// Sites go to the Worker 25 to a request (its limit), a few requests at a
// time, so results fill in batch by batch instead of all at the end.
const BATCH = 25;
const PARALLEL = 8;
const ADULT_COUNT = USERNAME_SITES.filter((s) => s.nsfw).length;
const SAFE_COUNT = USERNAME_SITES.length - ADULT_COUNT;

export default class UsernameSearchPage extends Component {
  @tracked input = '';
  @tracked name = null;
  @tracked rows = [];
  @tracked busy = false;
  @tracked error = null;
  @tracked showAll = false;
  @tracked adult = false;
  adultCount = ADULT_COUNT;

  // Sites the person added themselves, kept in this browser.
  @tracked customSites = [];
  @tracked newUrl = '';
  @tracked newName = '';
  @tracked newAbsent = '';
  @tracked newKnown = '';
  @tracked adding = false;
  @tracked addError = null;

  controller = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'username-search', ['input', 'customSites', 'adult']);
    registerDestructor(this, () => this.controller?.abort());
  }

  get done() {
    return this.rows.filter((r) => r.state !== 'pending').length;
  }

  get found() {
    return this.rows.filter((r) => r.state === 'found');
  }

  get shown() {
    return this.showAll ? this.rows : this.found;
  }

  setInput = (event) => (this.input = event.target.value);
  toggleAll = (event) => (this.showAll = event.target.checked);
  toggleAdult = (event) => (this.adult = event.target.checked);

  get siteCount() {
    return (this.adult ? USERNAME_SITES.length : SAFE_COUNT).toLocaleString();
  }
  setNew = (field, event) => (this[field] = event.target.value);

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

  submit = async (event) => {
    event.preventDefault();
    const name = this.input.trim().replace(/^@/, '');
    if (!USERNAME_PATTERN.test(name)) {
      this.error =
        'Type a username: letters, numbers, dots, dashes and underscores.';
      return;
    }
    this.controller?.abort();
    const controller = (this.controller = new AbortController());
    this.error = null;
    this.name = name;
    this.busy = true;
    this.rows = [
      ...this.customSites.map((custom) => ({
        custom,
        site: `${custom.name} (yours)`,
        url: fill(custom.url, name),
        state: 'pending',
        note: '',
      })),
      ...USERNAME_SITES.flatMap((site, index) =>
        site.nsfw && !this.adult
          ? []
          : [
              {
                index,
                site: site.name,
                adult: Boolean(site.nsfw),
                url: fill(site.url, name),
                state: 'pending',
                note: '',
              },
            ],
      ),
    ];
    // Each job is one custom site, or a batch of up to BATCH listed ones.
    const listed = this.rows.filter((r) => !r.custom);
    const jobs = [
      ...this.rows.filter((r) => r.custom).map((r) => [r]),
      ...Array.from({ length: Math.ceil(listed.length / BATCH) }, (_, i) =>
        listed.slice(i * BATCH, (i + 1) * BATCH),
      ),
    ];
    const settle = (batch, results) => {
      const byRow = new Map(batch.map((row, i) => [row, results[i]]));
      this.rows = this.rows.map((r) => {
        const result = byRow.get(r);
        return result
          ? { ...r, state: result.state, note: result.note ?? '' }
          : r;
      });
    };
    let next = 0;
    const worker = async () => {
      while (next < jobs.length && !controller.signal.aborted) {
        const batch = jobs[next++];
        let results;
        try {
          results = batch[0].custom
            ? [await checkCustomSite(batch[0].custom, name, controller.signal)]
            : (
                await checkUsernames(
                  batch.map((r) => r.index),
                  name,
                  controller.signal,
                )
              ).results;
        } catch {
          results = batch.map(() => ({ state: 'unknown', note: 'no answer' }));
        }
        if (controller.signal.aborted) return;
        settle(batch, results);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (!controller.signal.aborted) this.busy = false;
  };

  <template>
    <ToolPage
      @route="username-search"
      @busy={{this.busy}}
      @closeWarning="Close Username Search? The sites not yet checked will be skipped."
      @subtitle="Type a username and see which of {{this.siteCount}} sites have an account by that name."
    >
      <div class="pop-in">
        <form class="dl-form" {{on "submit" this.submit}}>
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
            {{if this.busy "Searching…" "Search"}}</button>
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

        {{#if this.name}}
          <div class="osint-bar">
            <span><strong>{{this.found.length}}</strong>
              found · checked
              {{this.done}}/{{this.rows.length}}</span>
            <label class="osint-toggle"><input
                type="checkbox"
                checked={{this.showAll}}
                {{on "change" this.toggleAll}}
              />
              Show every site</label>
          </div>
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
                <span class="is-muted osint-state">{{row.state}}{{#if
                    row.note
                  }}, {{row.note}}{{/if}}</span>
              </li>
            {{else}}
              <li class="tool-hint">{{if
                  this.busy
                  "Nothing yet…"
                  "No accounts found by that name."
                }}</li>
            {{/each}}
          </ul>
          <p class="tool-hint">A match means an account with that exact name
            exists, not that it belongs to the person you have in mind. Sites
            that block automated checks show as unknown; open them to see for
            yourself.</p>
        {{/if}}

        <details class="math-card osint-details">
          <summary>Add a site we don't check{{#if this.customSites.length}}
              ({{this.customSites.length}}
              added){{/if}}</summary>
          <form class="osint-add-site" {{on "submit" this.addSite}}>
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

        {{#unless this.name}}
          <p class="tool-hint">Works like Sherlock: each site is asked for the
            profile page (or its public API), and a real profile is told apart
            from a "no such user" page by its status code or wording.</p>
        {{/unless}}
      </div>
    </ToolPage>
  </template>
}
