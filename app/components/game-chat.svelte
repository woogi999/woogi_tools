<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, on, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import { MAX_CHAT_LENGTH } from '../utils/censor.js';

  // Keeps the newest message in view as the conversation grows.
  const stickToBottom = modifier((list, [count]) => {
    void count;
    list.scrollTop = list.scrollHeight;
  });

  // Room chat. In the lobby it's an open panel; in a game (@floating) it folds
  // into a button with an unread count, so it never covers the board for long.
  class GameChat extends Component {
    maxLength = MAX_CHAT_LENGTH;

    draft = $state.raw('');
    open = $state.raw(false);
    seenId = $state.raw(null);

    constructor(args) {
      super(args);
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
      return chat
        .slice(seen + 1)
        .filter((m) => !m.system && m.from !== this.room.selfId).length;
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
  }
</script>

<script>
  let args = $props();
  const self = new GameChat(args);
  onDestroy(() => destroy(self));
</script>

{#if !truthy(self.room?.isBusy)}
  <section
    class="game-chat
          {truthy(args.floating) ? 'is-floating' : ''}
          {truthy(self.isOpen) ? 'is-open' : ''}
          {args.class}"
    aria-label="Chat"
  >
    {#if truthy(args.floating)}
      <button
        type="button"
        class="game-chat-toggle"
        aria-expanded={truthy(self.open) ? 'true' : 'false'}
        onclick={self.toggle}
      >
        <Icon name={truthy(self.open) ? 'x' : 'message-circle'} size={15} />
        <span>{truthy(self.open) ? 'Close chat' : 'Chat'}</span>
        {#if truthy(self.unread)}<span class="game-chat-unread"
            >{self.unread}</span
          >{/if}
      </button>
    {:else}
      <h3 class="lobby-panel-title"
        ><Icon name="message-circle" size={14} />
        Chat{#if truthy(self.room?.debugOn)}
          <span class="lobby-tag is-debug"
            ><Icon name="terminal" size={10} />
            Debug on</span
          >{/if}</h3
      >
    {/if}

    {#if truthy(self.isOpen)}
      <ol
        class="game-chat-list"
        aria-live="polite"
        {@attach stickToBottom([self.messages?.length])}
      >
        {#each self.messages ?? [] as m (m?.id)}
          {#if truthy(m?.system)}
            <li class="game-chat-system {truthy(m?.debug) ? 'is-debug' : ''}"
              >{#if truthy(m?.debug)}<Icon name="terminal" size={11} />
              {/if}{m?.text}</li
            >
          {:else}
            <li
              class="game-chat-msg
                    {truthy(m?.mine) ? 'is-mine' : ''}
                    {truthy(m?.bot) ? 'is-bot' : ''}"
            >
              <span class="game-chat-name"
                >{#if truthy(m?.bot)}<Icon name="bot" size={11} />
                {/if}{truthy(m?.mine) ? 'You' : m?.name}</span
              >
              <span class="game-chat-text">{m?.text}</span>
            </li>
          {/if}
        {:else}
          <li class="game-chat-system">No messages yet. Say hi!</li>
        {/each}
      </ol>
      <form class="game-chat-form" onsubmit={self.send}>
        <input
          type="text"
          placeholder={truthy(self.room?.iHaveDebug)
            ? 'Message, or a /command'
            : truthy(self.room?.isOnline)
              ? 'Message the room'
              : 'Say something to the table'}
          aria-label="Chat message"
          maxlength={self.maxLength}
          {@attach prop('value', () => self.draft)}
          {@attach on('keydown', self.stopKeys)}
          oninput={self.setDraft}
        />
        <button
          type="submit"
          class="btn"
          aria-label="Send"
          disabled={truthy(self.draft) ? false : true}
          ><Icon name="send" size={13} /></button
        >
      </form>
    {/if}
  </section>
{/if}
