import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';
import { cleanDomain } from '../utils/domain';
import { findSubdomains } from '../utils/osint';

export default class SubdomainFinderPage extends Component {
  @tracked input = '';
  @tracked filter = '';
  @tracked result = null;
  @tracked busy = false;
  @tracked error = null;

  controller = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'subdomain-finder', ['input']);
    registerDestructor(this, () => this.controller?.abort());
  }

  get names() {
    const f = this.filter.trim().toLowerCase();
    const all = this.result?.names ?? [];
    return f ? all.filter((n) => n.includes(f)) : all;
  }

  get asText() {
    return this.names.join('\n');
  }

  setInput = (event) => (this.input = event.target.value);
  setFilter = (event) => (this.filter = event.target.value);

  submit = async (event) => {
    event.preventDefault();
    const domain = cleanDomain(this.input);
    if (!domain) {
      this.error = 'Type a domain, like example.com.';
      return;
    }
    this.controller?.abort();
    const controller = (this.controller = new AbortController());
    this.busy = true;
    this.error = null;
    this.result = null;
    try {
      const result = await findSubdomains(domain, controller.signal);
      if (!controller.signal.aborted) this.result = { domain, ...result };
    } catch (error) {
      if (!controller.signal.aborted) this.error = error.message;
    }
    if (!controller.signal.aborted) this.busy = false;
  };

  <template>
    <ToolPage
      @route="subdomain-finder"
      @subtitle="Every subdomain that has ever had an HTTPS certificate, from the public certificate-transparency logs."
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
            <Icon @name="network" @size={{13}} />
            {{if this.busy "Searching the logs…" "Find"}}</button>
        </form>
        {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}

        {{#if this.result}}
          <section class="math-card">
            <div class="osint-bar">
              <span><strong>{{this.result.names.length}}</strong>
                names for
                {{this.result.domain}}
                <span class="is-muted">via {{this.result.source}}</span></span>
              <CopyButton @value={{this.asText}} @label="Copy list" />
            </div>
            <input
              type="search"
              class="math-input"
              placeholder="Filter (dev, mail, api…)"
              aria-label="Filter"
              value={{this.filter}}
              {{on "input" this.setFilter}}
            />
            <ul class="dl-list osint-columns">
              {{#each this.names as |n|}}
                <li><a
                    href="https://{{n}}"
                    target="_blank"
                    rel="noopener noreferrer"
                  ><code>{{n}}</code></a></li>
              {{/each}}
            </ul>
          </section>
        {{else if this.busy}}
          <p class="tool-hint">Big domains have tens of thousands of
            certificates; this can take up to half a minute.</p>
        {{else}}
          <p class="tool-hint">Passive, like Amass or Sublist3r in their
            certificate mode: nothing is sent to the domain itself. A name in
            the list had a certificate at some point; it may not resolve any
            more.</p>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
