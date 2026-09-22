import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import { keepState } from '../utils/tool-state';
import { checkUsername } from '../utils/osint';
import {
  USERNAME_SITES,
  USERNAME_PATTERN,
  fill,
} from '../utils/username-sites';

// How many sites are asked at once. Each check is its own Worker request, so
// results fill in as they arrive instead of all at the end.
const PARALLEL = 16;

export default class UsernameSearchPage extends Component {
  @tracked input = '';
  @tracked name = null;
  @tracked rows = [];
  @tracked busy = false;
  @tracked error = null;
  @tracked showAll = false;

  controller = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'username-search', ['input']);
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
    this.rows = USERNAME_SITES.map((site, index) => ({
      index,
      site: site.name,
      url: fill(site.url, name),
      state: 'pending',
      note: '',
    }));
    let next = 0;
    const worker = async () => {
      while (next < this.rows.length && !controller.signal.aborted) {
        const row = this.rows[next++];
        let result;
        try {
          result = await checkUsername(row.index, name, controller.signal);
        } catch {
          result = { state: 'unknown', note: 'no answer' };
        }
        if (controller.signal.aborted) return;
        this.rows = this.rows.map((r) =>
          r === row
            ? { ...r, state: result.state, note: result.note ?? '' }
            : r,
        );
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (!controller.signal.aborted) this.busy = false;
  };

  <template>
    <ToolPage
      @route="username-search"
      @subtitle="Type a username and see which of {{USERNAME_SITES.length}} sites have an account by that name."
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
        {{else}}
          <p class="tool-hint">Works like Sherlock: each site is asked for the
            profile page (or its public API), and a real profile is told apart
            from a "no such user" page by its status code or wording.</p>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
