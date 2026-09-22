import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import Icon from '../icon';
import { CATALOG, CATEGORIES } from '../../utils/ferrite/effects';

// The Effects browser, ported from `ferrite-app/src/ui/effects.rs`.
//
// Every effect the compositor knows how to render lives here, grouped the way
// After Effects groups them: a search box and a plain list of names. Click one
// to apply it to the selected layer. One line, one name — the description
// belongs in a tooltip at most, and an icon would say nothing the category
// heading above it does not already say.
export default class EffectsPanel extends Component {
  @tracked query = '';

  search = (event) => (this.query = event.target.value);

  // Dragging an effect onto a layer, the way Ferrite does it: a press starts
  // the drag, a chip follows the cursor so it is obvious something is in
  // flight, and where it is let go decides which layer it lands on. Clicking
  // still applies it to the selection, so the quick path is unchanged.
  dragEffect = modifier((element, [name]) => {
    const down = (event) => {
      if (event.button !== 0) return;
      const editor = this.args.editor;
      let moved = false;
      const move = (move_) => {
        if (
          !moved &&
          Math.abs(move_.clientX - event.clientX) < 4 &&
          Math.abs(move_.clientY - event.clientY) < 4
        )
          return;
        moved = true;
        editor.dragEffectTo(name, move_.clientX, move_.clientY);
      };
      const up = (up_) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (!moved) return;
        // A drag has decided where it goes; the click that follows must not
        // also apply it to the selection.
        this.swallowClick = true;
        editor.dropEffect(name, up_.clientX, up_.clientY);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    element.addEventListener('pointerdown', down);
    return () => element.removeEventListener('pointerdown', down);
  });

  swallowClick = false;

  apply = (name) => {
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    this.args.editor.addEffect(name);
  };

  get groups() {
    const q = this.query.trim().toLowerCase();
    const matches = (def) =>
      !q ||
      def.name.toLowerCase().includes(q) ||
      def.category.toLowerCase().includes(q) ||
      def.description.toLowerCase().includes(q);
    return CATEGORIES.map((category) => ({
      category,
      hits: CATALOG.filter((d) => d.category === category && matches(d)),
    })).filter((g) => g.hits.length);
  }

  get nothing() {
    return this.groups.length === 0;
  }

  get selectedName() {
    return this.args.editor.layer?.name ?? 'no layer';
  }

  <template>
    <div class="fr-panel-body">
      <div class="fr-search">
        <Icon @name="search" @size={{11}} />
        <input
          type="text"
          placeholder="Search {{CATALOG.length}} effects"
          value={{this.query}}
          aria-label="Search effects"
          {{on "input" this.search}}
        />
      </div>
      <div class="fr-panel-note">
        <span>{{this.selectedName}}</span>
        <span class="fr-faint">click to apply</span>
      </div>
      <div class="fr-scroll">
        {{#if this.nothing}}
          <p class="fr-faint fr-pad">Nothing matches</p>
        {{else}}
          {{#each this.groups key="category" as |group|}}
            <div class="fr-cat">{{group.category}}</div>
            {{#each group.hits key="name" as |def|}}
              <button
                type="button"
                class="fr-fx-row"
                title="{{def.description}} — click to apply, or drag onto a layer"
                {{this.dragEffect def.name}}
                {{on "click" (fn this.apply def.name)}}
              >{{def.name}}</button>
            {{/each}}
          {{/each}}
        {{/if}}
      </div>
    </div>
  </template>
}
