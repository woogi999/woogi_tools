import Component from '@glimmer/component';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import Icon from './icon';

export default class FavouriteStar extends Component {
  @service favourites;

  get starred() {
    return this.favourites.has(this.args.route);
  }

  toggle = () => this.favourites.toggle(this.args.route);

  <template>
    <button
      type="button"
      class="star-btn {{if this.starred 'starred'}}"
      aria-pressed={{if this.starred "true" "false"}}
      aria-label="{{if this.starred 'Remove from' 'Add to'}} favourites"
      title="{{if this.starred 'Remove from' 'Add to'}} favourites"
      {{on "click" this.toggle}}
      ...attributes
    >
      <Icon @name="star" @size={{@size}} @fill={{if this.starred "currentColor" "none"}} />
    </button>
  </template>
}
