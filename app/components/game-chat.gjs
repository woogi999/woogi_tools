import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import Icon from './icon';
import { MAX_CHAT_LENGTH } from '../utils/censor';

// Keeps the newest message in view as the conversation grows.
const stickToBottom = modifier((list, [count]) => {
  void count;
  list.scrollTop = list.scrollHeight;
});

// Room chat. In the lobby it's an open panel; in a game (@floating) it folds
// into a button with an unread count, so it never covers the board for long.
export default class GameChat extends Component {
  maxLength = MAX_CHAT_LENGTH;

  @tracked draft = '';
  @tracked open = false;
  @tracked seenId = null;

  constructor(owner, args) {
    super(owner, args);
    // Whatever was said before this chat appeared (say, in the lobby) isn't news.
    this.markSeen();
  }

  get room() {
    return this.args.room;
  }

  get isOpen() {
    return !this.args.floating || this.open;
  }

  get messages() {
    const selfId = this.room.selfId;
    return this.room.chat.map((m) => ({ ...m, mine: m.from === selfId }));
  }

  // Other people's messages since the chat was last looked at.
  get unread() {
    if (this.isOpen) return 0;
    const chat = this.room.chat;
    const seen = chat.findIndex((m) => m.id === this.seenId);
    return chat.slice(seen + 1).filter((m) => !m.system && m.from !== this.room.selfId).length;
  }

  markSeen() {
    const chat = this.room.chat;
    this.seenId = chat[chat.length - 1]?.id ?? null;
  }

  toggle = () => {
    this.markSeen();
    this.open = !this.open;
  };

  setDraft = (event) => (this.draft = event.target.value);

  send = (event) => {
    event.preventDefault();
    this.room.sendChat(this.draft);
    this.draft = '';
  };

  // Typing in chat shouldn't steer the snake or trigger other game keys.
  stopKeys = (event) => event.stopPropagation();

  <template>
    {{#unless this.room.isBusy}}
      <section class="game-chat {{if @floating 'is-floating'}} {{if this.isOpen 'is-open'}} {{@class}}" aria-label="Chat">
        {{#if @floating}}
          <button type="button" class="game-chat-toggle" aria-expanded={{if this.open "true" "false"}} {{on "click" this.toggle}}>
            <Icon @name={{if this.open "x" "message-circle"}} @size={{15}} />
            <span>{{if this.open "Close chat" "Chat"}}</span>
            {{#if this.unread}}<span class="game-chat-unread">{{this.unread}}</span>{{/if}}
          </button>
        {{else}}
          <h3 class="lobby-panel-title"><Icon @name="message-circle" @size={{14}} /> Chat{{#if this.room.debugOn}} <span class="lobby-tag is-debug"><Icon @name="terminal" @size={{10}} /> Debug on</span>{{/if}}</h3>
        {{/if}}

        {{#if this.isOpen}}
          <ol class="game-chat-list" aria-live="polite" {{stickToBottom this.messages.length}}>
            {{#each this.messages key="id" as |m|}}
              {{#if m.system}}
                <li class="game-chat-system {{if m.debug 'is-debug'}}">{{#if m.debug}}<Icon @name="terminal" @size={{11}} /> {{/if}}{{m.text}}</li>
              {{else}}
                <li class="game-chat-msg {{if m.mine 'is-mine'}} {{if m.bot 'is-bot'}}">
                  <span class="game-chat-name">{{#if m.bot}}<Icon @name="bot" @size={{11}} /> {{/if}}{{if m.mine "You" m.name}}</span>
                  <span class="game-chat-text">{{m.text}}</span>
                </li>
              {{/if}}
            {{else}}
              <li class="game-chat-system">No messages yet. Say hi!</li>
            {{/each}}
          </ol>
          <form class="game-chat-form" {{on "submit" this.send}}>
            <input type="text" placeholder={{if this.room.iHaveDebug "Message, or a /command" (if this.room.isOnline "Message the room" "Say something to the table")}} aria-label="Chat message" maxlength={{this.maxLength}} value={{this.draft}} {{on "input" this.setDraft}} {{on "keydown" this.stopKeys}} />
            <button type="submit" class="btn" aria-label="Send" disabled={{if this.draft false true}}><Icon @name="send" @size={{13}} /></button>
          </form>
        {{/if}}
      </section>
    {{/unless}}
  </template>
}
