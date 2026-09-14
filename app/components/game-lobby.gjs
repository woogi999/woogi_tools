import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from './icon';
import CopyButton from './copy-button';
import AvatarPortrait from './avatar-portrait';
import AvatarEditor from './avatar-editor';
import GameChat from './game-chat';

// The lobby every game shares. Everyone gathers here before a game starts:
// the host adds computer players, sets the rules and presses Start; friends
// join through a room code or invite link and see the same seats and rules.
//
// Args:
//   @room         the page's GameRoom
//   @seats        [{ id, name, avatar, kind: 'human' | 'bot', isHost, isYou }]
//   @maxSeats     seat limit, for the counter and the Add button
//   @onAddBot     when given, the host can add computer players
//   @onRemoveBot  (seatId) removes one
//   @onStart      host only
//   @startLabel   defaults to "Start game"
//   @blocker      why the game can't start yet, or null
// Blocks:
//   <:rules as |canEdit|>  the game's own rules; guests get a read-only copy
//   <:profile>             extra per-player settings (Chess's board options)
export default class GameLobby extends Component {
  @tracked joinInput = '';
  @tracked editingAvatar = false;

  get room() {
    return this.args.room;
  }

  get canEdit() {
    return this.room.isHost;
  }

  get seatCount() {
    return this.args.seats.length;
  }

  get canAddBot() {
    return this.args.onAddBot && this.canEdit && this.seatCount < this.args.maxSeats;
  }

  get statusLabel() {
    switch (this.room.status) {
      case 'opening':
        return 'Opening room…';
      case 'open':
        return `Room ${this.room.code}`;
      case 'joining':
        return `Joining ${this.room.code}…`;
      case 'joined':
        return `In room ${this.room.code}`;
      default:
        return 'Local lobby';
    }
  }

  setAvatar = (avatar) => this.room.setProfile({ avatar });
  toggleAvatarEditor = () => (this.editingAvatar = !this.editingAvatar);
  setName = (event) => this.room.setProfile({ name: event.target.value });
  setJoinInput = (event) => (this.joinInput = event.target.value);

  join = (event) => {
    event.preventDefault();
    this.room.join(this.joinInput);
  };

  host = () => this.room.host();
  leaveRoom = () => this.room.close();
  kick = (id) => this.room.kick(id);

  <template>
    <div class="game-lobby pop-in">
      <header class="lobby-head">
        <h2 class="lobby-heading">Lobby</h2>
        <span class="lobby-count"><Icon @name="users" @size={{13}} /> {{this.seatCount}}/{{@maxSeats}}</span>
      </header>

      <div class="lobby-grid">
        <section class="lobby-panel lobby-players" aria-label="Players">
          <h3 class="lobby-panel-title"><Icon @name="users" @size={{14}} /> Players</h3>
          <ul class="lobby-seats">
            {{#each @seats key="id" as |seat|}}
              <li class="lobby-seat {{if seat.isYou 'is-you'}} pop-in">
                {{#if (isBot seat)}}
                  <span class="lobby-seat-bot"><Icon @name="bot" @size={{20}} /></span>
                {{else}}
                  <AvatarPortrait @avatar={{seat.avatar}} @size={{40}} />
                {{/if}}
                <span class="lobby-seat-text">
                  <span class="lobby-seat-name">{{seat.name}}</span>
                  <span class="lobby-seat-tags">
                    {{#if seat.isYou}}<span class="lobby-tag">You</span>{{/if}}
                    {{#if seat.isHost}}<span class="lobby-tag is-host"><Icon @name="crown" @size={{10}} /> Host</span>{{/if}}
                    {{#if (isBot seat)}}<span class="lobby-tag">Computer</span>{{/if}}
                  </span>
                </span>
                {{#if this.canEdit}}
                  {{#if (isBot seat)}}
                    {{#if @onRemoveBot}}
                      <button type="button" class="qr-icon-btn" aria-label="Remove {{seat.name}}" {{on "click" (fn @onRemoveBot seat.id)}}><Icon @name="x" @size={{14}} /></button>
                    {{/if}}
                  {{else}}
                    {{#unless seat.isYou}}
                      <button type="button" class="qr-icon-btn" aria-label="Remove {{seat.name}} from the room" title="Remove from room" {{on "click" (fn this.kick seat.id)}}><Icon @name="log-out" @size={{14}} /></button>
                    {{/unless}}
                  {{/if}}
                {{/if}}
              </li>
            {{/each}}
          </ul>
          {{#if this.canAddBot}}
            <button type="button" class="lobby-add" {{on "click" @onAddBot}}><Icon @name="plus" @size={{14}} /> Add computer player</button>
          {{/if}}

          <div class="lobby-invite">
            {{#if (eq this.room.status "open")}}
              <div class="fs-code-block">
                <span class="qr-label is-muted">Room code</span>
                <div class="fs-code-row">
                  <span class="fs-code">{{this.room.code}}</span>
                  <CopyButton @value={{this.room.code}} />
                </div>
              </div>
              <div class="fs-code-block">
                <span class="qr-label is-muted">Invite link</span>
                <div class="fs-code-row">
                  <span class="fs-link">{{this.room.shareUrl}}</span>
                  <CopyButton @value={{this.room.shareUrl}} />
                </div>
              </div>
              <p class="fs-status is-connected"><Icon @name="radio-tower" @size={{14}} /> Room open. Friends can join until you start.</p>
              <button type="button" class="fs-reset" {{on "click" this.leaveRoom}}><Icon @name="x" @size={{13}} /> Close room</button>
            {{else if this.room.isBusy}}
              <p class="fs-status"><Icon @name="radio-tower" @size={{14}} /> {{this.statusLabel}}</p>
              {{#if this.room.slow}}
                <p class="tool-hint">Still looking. Keep this tab open. If it never connects, one of the networks (often mobile data, work or school Wi-Fi) is blocking direct browser-to-browser connections; try both devices on the same Wi-Fi.</p>
              {{/if}}
              <button type="button" class="fs-reset" {{on "click" this.leaveRoom}}><Icon @name="x" @size={{13}} /> Cancel</button>
            {{else if (eq this.room.status "joined")}}
              <p class="fs-status is-connected"><Icon @name="radio-tower" @size={{14}} /> Connected to the host.</p>
              <button type="button" class="fs-reset" {{on "click" this.leaveRoom}}><Icon @name="log-out" @size={{13}} /> Leave room</button>
            {{else}}
              <span class="qr-label is-muted">Play with friends</span>
              <button type="button" class="btn lobby-open-btn" {{on "click" this.host}}><Icon @name="radio-tower" @size={{13}} /> Open room to friends</button>
              <form class="fs-join" {{on "submit" this.join}}>
                <input type="text" class="fs-code-input" placeholder="Room code" aria-label="Room code" maxlength="8" value={{this.joinInput}} {{on "input" this.setJoinInput}} />
                <button type="submit" class="btn">Join</button>
              </form>
            {{/if}}
          </div>
        </section>

        <section class="lobby-panel lobby-rules" aria-label="Rules">
          <h3 class="lobby-panel-title">
            <Icon @name="sliders-horizontal" @size={{14}} /> Rules
            {{#unless this.canEdit}}<span class="lobby-tag">Set by the host</span>{{/unless}}
          </h3>
          <fieldset class="lobby-rules-body" disabled={{if this.canEdit false true}}>
            {{yield this.canEdit to="rules"}}
          </fieldset>
        </section>
      </div>

      <div class="lobby-grid">
        <section class="lobby-panel lobby-profile" aria-label="Your profile">
          <h3 class="lobby-panel-title"><Icon @name="user-round" @size={{14}} /> You</h3>
          <div class="lobby-profile-row">
            <AvatarPortrait @avatar={{this.room.profile.avatar}} @size={{52}} />
            <label class="lobby-name">
              <span class="qr-label is-muted">Name</span>
              <input type="text" maxlength="20" value={{this.room.profile.name}} {{on "input" this.setName}} />
            </label>
            <button type="button" class="btn lobby-avatar-toggle {{if this.editingAvatar 'active'}}" aria-expanded={{if this.editingAvatar "true" "false"}} {{on "click" this.toggleAvatarEditor}}>
              <Icon @name="shirt" @size={{13}} /> {{if this.editingAvatar "Done" "Customise avatar"}}
            </button>
          </div>
          {{#if this.editingAvatar}}
            <AvatarEditor @avatar={{this.room.profile.avatar}} @onChange={{this.setAvatar}} />
          {{/if}}
          {{yield to="profile"}}
        </section>

        {{#if this.room.isOnline}}
          <GameChat @room={{this.room}} @class="lobby-panel lobby-chat" />
        {{/if}}
      </div>

      <footer class="lobby-foot">
        {{#if this.room.error}}
          <p class="tool-error">{{this.room.error}}</p>
        {{else if @blocker}}
          <p class="tool-hint">{{@blocker}}</p>
        {{else if this.canEdit}}
          <p class="tool-hint">Everyone’s in? Start when you’re ready.</p>
        {{else}}
          <p class="tool-hint">Waiting for the host to start the game…</p>
        {{/if}}
        {{#if this.canEdit}}
          <button type="button" class="btn active lobby-start" disabled={{if @blocker true this.room.isBusy}} {{on "click" @onStart}}>
            <Icon @name="play" @size={{14}} /> {{if @startLabel @startLabel "Start game"}}
          </button>
        {{/if}}
      </footer>
    </div>
  </template>
}

function isBot(seat) {
  return seat.kind === 'bot';
}

function eq(a, b) {
  return a === b;
}
