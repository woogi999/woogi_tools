import Component from '@glimmer/component';
import HoldConfirm from './hold-confirm';
import { confirmState } from '../utils/confirm';

// Shows whichever prompt askConfirm() (utils/confirm.js) has open. Rendered once, in the application template.
export default class ConfirmHost extends Component {
  state = confirmState;

  confirm = () => this.state.request?.answer(true);
  cancel = () => this.state.request?.answer(false);

  <template>
    {{#if this.state.request}}
      {{#let this.state.request as |r|}}
        <HoldConfirm @title={{r.title}} @message={{r.message}} @confirmLabel={{r.confirmLabel}} @cancelLabel={{r.cancelLabel}} @holdMs={{r.holdMs}} @onConfirm={{this.confirm}} @onCancel={{this.cancel}} />
      {{/let}}
    {{/if}}
  </template>
}
