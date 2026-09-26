import Component from '@glimmer/component';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import Icon from './icon';
import { originOf } from '../utils/theme-origin';

export default class ThemeToggle extends Component {
  @service settings;

  toggle = (event) => this.settings.toggleTheme(originOf(event));

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
