import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from './icon';
import CopyButton from './copy-button';
import AvatarPortrait from './avatar-portrait';
import AvatarEditor from './avatar-editor';
import GameChat from './game-chat';
import NearbyPanel from './nearby-panel';
import GameRoom from '../utils/game-room';

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
  @tracked joinPassword = '';
  @tracked rooms = null;
  @tracked browsing = false;
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
  setJoinPassword = (event) => (this.joinPassword = event.target.value);

  // The password box shows up once a room has asked for one.
  get showJoinPassword() {
    return Boolean(this.room.needsPassword) || Boolean(this.joinPassword);
  }

  // Connecting over the internet; nearby links show their progress in their own panel.
  get onlineBusy() {
    return this.room.isBusy && !this.room.lan;
  }

  // Joined someone's room online: nothing nearby to set up.
  get hideNearby() {
    return (this.room.status === 'joined' || this.room.status === 'joining' || this.room.status === 'opening') && !this.room.lan;
  }

  join = (event) => {
    event.preventDefault();
    if (this.room.needsPassword && !this.joinInput) this.joinInput = this.room.needsPassword;
    this.room.join(this.joinInput || this.room.needsPassword, this.joinPassword);
  };

  browse = async () => {
    this.browsing = true;
    try {
      this.rooms = await GameRoom.browse(this.room.game);
    } catch {
      this.rooms = [];
    } finally {
      this.browsing = false;
    }
  };

  joinListed = (listed) => {
    this.joinInput = listed.code;
    if (listed.password && !this.joinPassword) {
      // Ask for the password first; the box appears next to the code.
      this.room.needsPassword = listed.code;
      return;
    }
    this.room.join(listed.code, this.joinPassword);
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
                {{#if seat.avatar}}
                  <AvatarPortrait @avatar={{seat.avatar}} @size={{40}} />
                {{else}}
                  <span class="lobby-seat-bot"><Icon @name="bot" @size={{20}} /></span>
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
              {{#if this.room.lan}}
                <p class="fs-status is-connected"><Icon @name="radio-tower" @size={{14}} /> Nearby game open. No internet needed.</p>
              {{else}}
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
                <AccessControls @room={{this.room}} />
                <p class="fs-status is-connected">
                  <Icon @name={{if this.room.listed "users" "lock"}} @size={{14}} />
                  {{#if this.room.listed}}
                    {{if this.room.listing "Public: listed for anyone browsing rooms." "Public: getting listed…"}}
                  {{else}}
                    Private: only people with the code or link can join.
                  {{/if}}
                  {{#if this.room.password}} Password needed.{{/if}}
                </p>
              {{/if}}
              <button type="button" class="fs-reset" {{on "click" this.leaveRoom}}><Icon @name="x" @size={{13}} /> Close room</button>
            {{else if this.onlineBusy}}
              <p class="fs-status"><Icon @name="radio-tower" @size={{14}} /> {{this.statusLabel}}</p>
              {{#if this.room.slow}}
                <p class="tool-hint">Still looking. Keep this tab open. If it never connects, one of the networks (often mobile data, work or school Wi-Fi) is blocking direct browser-to-browser connections; try both devices on the same Wi-Fi, or play nearby below.</p>
              {{/if}}
              <button type="button" class="fs-reset" {{on "click" this.leaveRoom}}><Icon @name="x" @size={{13}} /> Cancel</button>
            {{else if (eq this.room.status "joined")}}
              <p class="fs-status is-connected"><Icon @name="radio-tower" @size={{14}} /> Connected to the host.</p>
              <button type="button" class="fs-reset" {{on "click" this.leaveRoom}}><Icon @name="log-out" @size={{13}} /> Leave room</button>
            {{else if (eq this.room.status "idle")}}
              <span class="qr-label is-muted">Play with friends online</span>
              <AccessControls @room={{this.room}} />
              <button type="button" class="btn lobby-open-btn" {{on "click" this.host}}><Icon @name={{if this.room.listed "radio-tower" "lock"}} @size={{13}} /> {{if this.room.listed "Open public room" "Open private room"}}</button>
              <form class="fs-join" {{on "submit" this.join}}>
                <input type="text" class="fs-code-input" placeholder="Room code" aria-label="Room code" maxlength="8" value={{this.joinInput}} {{on "input" this.setJoinInput}} />
                {{#if this.showJoinPassword}}
                  <input type="password" class="fs-code-input lobby-password" placeholder="Password" aria-label="Room password" maxlength="32" value={{this.joinPassword}} {{on "input" this.setJoinPassword}} />
                {{/if}}
                <button type="submit" class="btn">Join</button>
              </form>
              <div class="lobby-browse">
                <button type="button" class="btn" disabled={{this.browsing}} {{on "click" this.browse}}><Icon @name="search" @size={{13}} /> {{if this.browsing "Looking for rooms…" "Browse public rooms"}}</button>
                {{#if this.rooms}}
                  {{#if this.rooms.length}}
                    <ul class="lobby-rooms">
                      {{#each this.rooms key="code" as |r|}}
                        <li class="lobby-room">
                          <span class="lobby-room-text"><strong>{{r.host}}’s room</strong> <span class="lobby-tag">{{r.players}}/{{r.max}}</span>{{#if r.password}} <Icon @name="lock" @size={{12}} />{{/if}}{{#if r.locked}} <span class="lobby-tag">Playing</span>{{/if}}</span>
                          <button type="button" class="btn" disabled={{if r.locked true (full r)}} {{on "click" (fn this.joinListed r)}}>Join</button>
                        </li>
                      {{/each}}
                    </ul>
                  {{else}}
                    <p class="tool-hint">No public rooms right now. Open one and your friends will see it here.</p>
                  {{/if}}
                {{/if}}
              </div>
            {{/if}}
          </div>

          {{#unless this.hideNearby}}
            <details class="lobby-nearby" open={{this.room.lan}}>
              <summary><Icon @name="wifi" @size={{14}} /> Play nearby without internet (Wi-Fi or hotspot)</summary>
              <NearbyPanel @room={{this.room}} />
            </details>
          {{/unless}}
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
            <AvatarEditor @avatar={{this.room.profile.avatar}} @name={{this.room.profile.name}} @onChange={{this.setAvatar}} />
          {{/if}}
          {{yield to="profile"}}
        </section>

        <GameChat @room={{this.room}} @class="lobby-panel lobby-chat" />
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

// Public or private, and an optional password, for the host.
class AccessControls extends Component {
  get room() {
    return this.args.room;
  }

  setListed = (listed) => this.room.setAccess({ listed });
  setPassword = (event) => this.room.setAccess({ password: event.target.value });

  <template>
    <div class="lobby-access">
      <div class="math-tabs" role="group" aria-label="Who can find the room">
        <button type="button" class="qr-tab {{if this.room.listed 'active'}}" aria-pressed={{if this.room.listed "true" "false"}} {{on "click" (fn this.setListed true)}}>Public</button>
        <button type="button" class="qr-tab {{unless this.room.listed 'active'}}" aria-pressed={{if this.room.listed "false" "true"}} {{on "click" (fn this.setListed false)}}>Private</button>
      </div>
      <input type="password" class="fs-code-input lobby-password" placeholder="Password (optional)" aria-label="Room password" maxlength="32" autocomplete="new-password" value={{this.room.password}} {{on "input" this.setPassword}} />
    </div>
  </template>
}

function full(room) {
  return room.players >= room.max;
}

function isBot(seat) {
  return seat.kind === 'bot';
}

function eq(a, b) {
  return a === b;
}
