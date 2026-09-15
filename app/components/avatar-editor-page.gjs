import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import ToolPage from './tool-page';
import AvatarEditor from './avatar-editor';
import { loadProfile, saveProfile, NAME_LENGTH } from '../utils/profile';

// The Avatar Editor tool: edits your games profile's avatar and pose directly,
// and keeps saved looks that Settings and game lobbies let you pick between.
export default class AvatarEditorPage extends Component {
  @tracked profile = loadProfile();
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

  <template>
    <ToolPage @route="avatar-editor" @subtitle="Build your little 3D self, your OC, or a total gremlin. Pick the hair and fit, strike a pose, and save pictures. They show up in games too.">
      <div class="avatar-editor-page pop-in">
        <label class="lobby-name avatar-editor-name">
          <span class="qr-label is-muted">Name in games</span>
          <input type="text" maxlength={{this.nameLength}} value={{this.profile.name}} {{on "input" this.setName}} />
        </label>
        <AvatarEditor @avatar={{this.profile.avatar}} @pose={{this.profile.pose}} @name={{this.profile.name}} @lookId={{this.profile.look}} @onChange={{this.setAvatar}} @onPoseChange={{this.setPose}} @onWear={{this.wear}} @onSaved={{this.saved}} />
        <p class="tool-hint">Changes apply to your games profile straight away. Save looks to switch between them later from Settings or any game lobby.</p>
      </div>
    </ToolPage>
  </template>
}
