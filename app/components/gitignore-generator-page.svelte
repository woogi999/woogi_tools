<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import CopyButton from './copy-button.svelte';
  import Icon from './icon.svelte';
  import {
    GITIGNORE_TEMPLATES,
    buildGitignore,
  } from '../utils/gitignore-templates.js';
  import { keepState } from '../utils/tool-state.js';

  class GitignoreGeneratorPage extends Component {
    templates = GITIGNORE_TEMPLATES;

    selected = $state.raw(['node', 'vscode']);

    constructor(args) {
      super(args);
      keepState(this, 'gitignore-generator', ['selected']);
    }

    get output() {
      return this.selected.length ? buildGitignore(this.selected) : '';
    }

    isSelected = (id) => this.selected.includes(id);

    toggle = (id) => {
      this.selected = this.selected.includes(id)
        ? this.selected.filter((i) => i !== id)
        : [...this.selected, id];
    };

    download = () => {
      const url = URL.createObjectURL(
        new Blob([this.output], { type: 'text/plain' }),
      );
      const link = Object.assign(document.createElement('a'), {
        href: url,
        download: '.gitignore',
      });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
</script>

<script>
  let args = $props();
  const self = new GitignoreGeneratorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="gitignore-generator"
  subtitle="Tick the languages, frameworks and editors you use and get one tidy .gitignore file."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <h3 class="qr-heading">Stack</h3>
      <div class="settings-tool-grid">
        {#each self.templates ?? [] as t (t?.id)}
          <label
            class="settings-tool-item
                  {!truthy(self.isSelected(t?.id)) ? 'is-off' : ''}"
          >
            <input
              type="checkbox"
              {@attach prop('checked', () => self.isSelected(t?.id))}
              onchange={(..._r) => self.toggle(t?.id, ..._r)}
            />
            <span class="settings-tool-check" aria-hidden="true"
              ><Icon name="check" size={11} /></span
            >
            <span>{t?.label}</span>
          </label>
        {/each}
      </div>
    </section>

    <section class="math-card">
      <div class="field-head">
        <h3 class="qr-heading">.gitignore</h3>
        <div class="settings-actions">
          <button type="button" class="btn" onclick={self.download}
            >Download</button
          >
          <CopyButton value={self.output} />
        </div>
      </div>
      <pre class="code-block gitignore-output">{self.output}</pre>
    </section>
  </div>
</ToolPage>
