<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import Link from '../core/link.svelte';
  import { truthy } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import AvatarPortrait from './avatar-portrait.svelte';
  import { loadSaves } from '../utils/avatar-saves.js';
  import { avatarKey } from '../utils/avatar.js';
  import { poseKey } from '../utils/pose.js';

  // Choose which of your saved looks (and its pose) to use in games. Looks are
  // made in the Avatar Editor tool; this only picks between them.
  //
  // Args: @profile ({ avatar, pose, look }), @onPick({ avatar, pose, look })
  class AvatarPicker extends Component {
    saves = $state.raw(loadSaves());

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
      this.args.onPick?.({
        avatar: save.avatar,
        pose: save.pose,
        look: save.id,
      });

    // Saves made in another tab or page since this opened.
    refresh = () => (this.saves = loadSaves());
  }
</script>

<script>
  let args = $props();
  const self = new AvatarPicker(args);
  onDestroy(() => destroy(self));
</script>

<div
  class="avatar-picker"
  onpointerenter={self.refresh}
  onfocusin={self.refresh}
>
  {#if truthy(self.saves?.length)}
    <ul
      class="avatar-picker-list"
      role="radiogroup"
      aria-label="Your saved avatars"
    >
      {#each self.saves ?? [] as save (save?.id)}
        <li>
          <button
            type="button"
            role="radio"
            class="avatar-picker-item {truthy(self.isCurrent(save))
              ? 'active'
              : ''}"
            aria-checked={truthy(self.isCurrent(save)) ? 'true' : 'false'}
            title="Use {save?.label}"
            onclick={(..._r) => self.pick(save, ..._r)}
          >
            <AvatarPortrait
              avatar={save?.avatar}
              pose={save?.pose}
              size={self.size}
            />
            <span class="avatar-picker-name">{save?.label}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="tool-hint"
      >No saved avatars yet. Go make someone in the Avatar Editor (you, your OC,
      anyone) and save them to pick them here.</p
    >
  {/if}
  <Link route="avatar-editor" class="btn math-use avatar-picker-edit"
    ><Icon name="shirt" size={13} /> Open Avatar Editor</Link
  >
</div>
