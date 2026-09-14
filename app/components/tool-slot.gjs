import Component from '@glimmer/component';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import { TOOLS } from '../tools';

// Where a route's tool appears on its own page. The tool itself lives in the
// picture-in-picture service (see services/pip.js), so it can outlive this
// page: this slot only asks for it and gives it a place to sit.
export default class ToolSlot extends Component {
  @service pip;

  constructor(owner, args) {
    super(owner, args);
    // Runs during render, before the PipLayer (after the outlet) reads the sessions.
    this.pip.enter(args.route, args.component);
    // Deferred: the decision (float or discard) must not change tracked state mid-teardown.
    registerDestructor(this, () => queueMicrotask(() => this.pip.leave(args.route)));
  }

  get session() {
    return this.pip.sessionFor(this.args.route);
  }

  get isAway() {
    return this.session && this.session.mode !== 'inline';
  }

  get tool() {
    return TOOLS.find((t) => t.route === this.args.route);
  }

  bind = modifier((element) => {
    const route = this.args.route;
    this.pip.bindSlot(route, element);
    return () => this.pip.unbindSlot(route, element);
  });

  <template>
    <div class="tool-slot" {{this.bind}}></div>
    {{#if this.isAway}}
      <div class="container">
        <div class="pip-placeholder pop-in">
          <Icon @name="picture-in-picture" @size={{28}} />
          <p><strong>{{this.tool.label}}</strong> is open in picture-in-picture.</p>
          <button type="button" class="btn active" {{on "click" (fn this.pip.expand this.session)}}><Icon @name="maximize" @size={{13}} /> Bring it back here</button>
        </div>
      </div>
    {{/if}}
  </template>
}
