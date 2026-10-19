<script module>
  import { prop } from '../core/helpers.js';
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import AvatarEditor from './avatar-editor.svelte';
  import { loadProfile, saveProfile, NAME_LENGTH } from '../utils/profile.js';

  // The Avatar Editor tool: edits your games profile's avatar and pose directly,
  // and keeps saved looks that Settings and game lobbies let you pick between.
  class AvatarEditorPage extends Component {
    profile = $state.raw(loadProfile());
    nameLength = NAME_LENGTH;

    // Any edit means you're no longer wearing a saved look exactly as saved, but it stays linked so it can be updated.
    store(patch) {
      this.profile = saveProfile({ ...this.profile, ...patch });
    }

    setAvatar = (avatar) => this.store({ avatar });
    setPose = (pose) => this.store({ pose });
    wear = (look) => this.store(look);
    saved = (save) => this.store({ look: save.id });
    setName = (event) => this.store({ name: event.target.value });
  }
</script>

<script>
  let args = $props();
  const self = new AvatarEditorPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="avatar-editor"
  subtitle="Build your little 3D self, your OC, or a total gremlin. Pick the hair and fit, strike a pose, and save pictures. They show up in games too."
>
  <div class="avatar-editor-page pop-in">
    <label class="lobby-name avatar-editor-name">
      <span class="qr-label is-muted">Name in games</span>
      <input
        type="text"
        maxlength={self.nameLength}
        {@attach prop('value', () => self.profile?.name)}
        oninput={self.setName}
      />
    </label>
    <AvatarEditor
      avatar={self.profile?.avatar}
      pose={self.profile?.pose}
      name={self.profile?.name}
      lookId={self.profile?.look}
      onChange={self.setAvatar}
      onPoseChange={self.setPose}
      onWear={self.wear}
      onSaved={self.saved}
    />
    <p class="tool-hint"
      >Changes apply to your games profile straight away. Save looks to switch
      between them later from Settings or any game lobby.</p
    >
  </div>
</ToolPage>
