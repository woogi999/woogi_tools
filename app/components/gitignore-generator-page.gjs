import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import ToolPage from './tool-page';
import CopyButton from './copy-button';
import Icon from './icon';
import { GITIGNORE_TEMPLATES, buildGitignore } from '../utils/gitignore-templates';

export default class GitignoreGeneratorPage extends Component {
  templates = GITIGNORE_TEMPLATES;

  @tracked selected = ['node', 'vscode'];

  get output() {
    return this.selected.length ? buildGitignore(this.selected) : '';
  }

  isSelected = (id) => this.selected.includes(id);

  toggle = (id) => {
    this.selected = this.selected.includes(id) ? this.selected.filter((i) => i !== id) : [...this.selected, id];
  };

  download = () => {
    const url = URL.createObjectURL(new Blob([this.output], { type: 'text/plain' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: '.gitignore' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  <template>
    <ToolPage @route="gitignore-generator" @subtitle="Tick the languages, frameworks and editors you use and get one tidy .gitignore file.">
      <div class="math-grid pop-in">
        <section class="math-card">
          <h3 class="qr-heading">Stack</h3>
          <div class="settings-tool-grid">
            {{#each this.templates key="id" as |t|}}
              <label class="settings-tool-item {{unless (this.isSelected t.id) 'is-off'}}">
                <input type="checkbox" checked={{this.isSelected t.id}} {{on "change" (fn this.toggle t.id)}} />
                <span class="settings-tool-check" aria-hidden="true"><Icon @name="check" @size={{11}} /></span>
                <span>{{t.label}}</span>
              </label>
            {{/each}}
          </div>
        </section>

        <section class="math-card">
          <div class="field-head">
            <h3 class="qr-heading">.gitignore</h3>
            <div class="settings-actions">
              <button type="button" class="btn" {{on "click" this.download}}>Download</button>
              <CopyButton @value={{this.output}} />
            </div>
          </div>
          <pre class="code-block gitignore-output">{{this.output}}</pre>
        </section>
      </div>
    </ToolPage>
  </template>
}
