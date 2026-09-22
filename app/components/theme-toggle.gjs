import Component from '@glimmer/component';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import Icon from './icon';

export default class ThemeToggle extends Component {
  @service settings;

  toggle = () => this.settings.toggleTheme();

  <template>
    <button
      type="button"
      class="theme-toggle"
      aria-label="Switch to {{if this.settings.isDark 'light' 'dark'}} mode"
      {{on "click" this.toggle}}
      ...attributes
    >
      {{#if this.settings.isDark}}
        <Icon @name="moon" @size={{15}} />
      {{else}}
        <Icon @name="sun" @size={{19}} />
      {{/if}}
    </button>
  </template>
}
