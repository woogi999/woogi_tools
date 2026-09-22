import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { LinkTo } from '@ember/routing';
import Icon from './icon';
import AvatarPortrait from './avatar-portrait';
import { loadSaves } from '../utils/avatar-saves';
import { avatarKey } from '../utils/avatar';
import { poseKey } from '../utils/pose';

// Choose which of your saved looks (and its pose) to use in games. Looks are
// made in the Avatar Editor tool; this only picks between them.
//
// Args: @profile ({ avatar, pose, look }), @onPick({ avatar, pose, look })
export default class AvatarPicker extends Component {
  @tracked saves = loadSaves();

  get size() {
    return this.args.size ?? 52;
  }

  isCurrent = (save) => {
    const profile = this.args.profile;
    if (profile?.look) return profile.look === save.id;
    return (
      avatarKey(save.avatar) === avatarKey(profile?.avatar) &&
      poseKey(save.pose) === poseKey(profile?.pose)
    );
  };

  pick = (save) =>
    this.args.onPick?.({ avatar: save.avatar, pose: save.pose, look: save.id });

  // Saves made in another tab or page since this opened.
  refresh = () => (this.saves = loadSaves());

  <template>
    <div
      class="avatar-picker"
      {{on "focusin" this.refresh}}
      {{on "pointerenter" this.refresh}}
    >
      {{#if this.saves.length}}
        <ul
          class="avatar-picker-list"
          role="radiogroup"
          aria-label="Your saved avatars"
        >
          {{#each this.saves key="id" as |save|}}
            <li>
              <button
                type="button"
                role="radio"
                class="avatar-picker-item {{if (this.isCurrent save) 'active'}}"
                aria-checked={{if (this.isCurrent save) "true" "false"}}
                title="Use {{save.label}}"
                {{on "click" (fn this.pick save)}}
              >
                <AvatarPortrait
                  @avatar={{save.avatar}}
                  @pose={{save.pose}}
                  @size={{this.size}}
                />
                <span class="avatar-picker-name">{{save.label}}</span>
              </button>
            </li>
          {{/each}}
        </ul>
      {{else}}
        <p class="tool-hint">No saved avatars yet. Go make someone in the Avatar
          Editor (you, your OC, anyone) and save them to pick them here.</p>
      {{/if}}
      <LinkTo
        @route="avatar-editor"
        class="btn math-use avatar-picker-edit"
      ><Icon @name="shirt" @size={{13}} /> Open Avatar Editor</LinkTo>
    </div>
  </template>
}
