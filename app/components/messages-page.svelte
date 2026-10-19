<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import AvatarPortrait from './avatar-portrait.svelte';
  import AvatarPicker from './avatar-picker.svelte';
  import MeshChat, {
    MAX_MESSAGE,
    MAX_IMAGE_BYTES,
  } from '../utils/mesh-chat.svelte.js';
  import { NAME_LENGTH } from '../utils/profile.js';
  import { renderMarkdown } from '../utils/markdown.js';
  import MeshCall from '../utils/mesh-call.svelte.js';
  import MeshFiles, {
    MAX_FILE_BYTES,
    formatBytes,
  } from '../utils/mesh-files.svelte.js';
  import { groupReactions } from '../utils/mesh-log.js';
  import { askConfirm } from '../utils/confirm.svelte.js';

  // Messages: the screen on top of the host-free chat in utils/mesh-chat.js.
  //
  // It takes the whole page, the way the games do, and is laid out the way
  // everybody already expects a chat to be: conversations down the left, the
  // conversation itself in the middle, the chat's details and invite link down
  // the right, and a call that slides in above the messages.

  const eq = (a, b) => a === b;
  const any = (list) => Boolean(list?.length);

  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  // Messages from the same person inside this gap are drawn as one run.
  const GROUP_MS = 5 * 60 * 1000;
  // Pictures are shrunk to something a chat log can carry before they are sent.
  const IMAGE_MAX_EDGE = 1280;
  // A picture larger than this is treated as a file rather than shrunk.
  const IMAGE_SOURCE_LIMIT = 24 * 1024 * 1024;
  // A chat's photo is small: it is in every member's log for good.
  const PHOTO_EDGE = 192;

  const stickToBottom = modifier((list, [signal]) => {
    void signal;
    // Only follow the conversation if you were already near the bottom of it, so
    // reading back through the history isn't yanked away by a new message.
    const nearBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 260;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  });

  const playStream = modifier((element, [stream, muted]) => {
    // Your own tile is muted through the property, not the attribute: a
    // `muted` attribute set after the element exists is ignored by browsers,
    // which is how you end up hearing your own voice a beat late.
    element.muted = Boolean(muted);
    element.srcObject = stream ?? null;
    return () => (element.srcObject = null);
  });

  const focusMe = modifier((element) => element.focus());

  const timeOf = (at) =>
    new Date(at).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });

  // The chat list shows a time for today, a weekday for this week and a date
  // for anything older.
  const stampOf = (at) => {
    if (!at) return '';
    const date = new Date(at);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return timeOf(at);
    const days = (today - date) / 86400000;
    if (days < 7)
      return date.toLocaleDateString(undefined, { weekday: 'short' });
    return date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
  };

  const dayOf = (at) => {
    const date = new Date(at);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(date, today)) return 'Today';
    if (same(date, yesterday)) return 'Yesterday';
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  };

  const initials = (name) =>
    String(name || '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? '')
      .join('')
      .toUpperCase();

  // A member's colour comes from their device id, so the same person is the
  // same colour on everyone's screen without anybody having to agree on it.
  const hueOf = (id) => {
    let hash = 0;
    for (const char of String(id))
      hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return hash;
  };
  const tint = (id) => `--who-hue: ${hueOf(id)}`;
  const markdown = (text) => renderMarkdown(text);
  const hasFiles = (event) =>
    [...(event.dataTransfer?.types ?? [])].includes('Files');
  const barWidth = (done, size) =>
    `width: ${Math.min(100, Math.round((done / (size || 1)) * 100))}%`;

  async function shrinkImage(
    file,
    edge = IMAGE_MAX_EDGE,
    limit = MAX_IMAGE_BYTES,
  ) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext('2d')
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    for (const quality of [0.72, 0.6, 0.45, 0.3]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      // A data URL carries three bytes in every four characters.
      if (url.length * 0.75 <= limit) return url;
    }
    return '';
  }

  // A chat's photo is cropped square, the way every chat app draws them.
  async function squarePhoto(file) {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PHOTO_EDGE;
    canvas
      .getContext('2d')
      .drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        PHOTO_EDGE,
        PHOTO_EDGE,
      );
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  // A member drawn as their avatar when the log knows it, or their initials
  // until it does.

  // A chat drawn as its photo when it has one, or its initials.

  class MessagesPage extends Component {
    maxLength = MAX_MESSAGE;
    nameLength = NAME_LENGTH;
    reactions = QUICK_REACTIONS;
    maxFile = formatBytes(MAX_FILE_BYTES);

    draft = $state.raw('');
    // What is attached and not yet sent: [{ key, image } | { key, file, label }].
    pending = $state.raw([]);
    dragging = $state.raw(false);
    attachError = $state.raw('');
    photoError = $state.raw('');
    pickingAvatar = $state.raw(false);
    // The rename field in the details panel, and which chat it was typed for.
    chatName = $state.raw('');
    chatNameFor = $state.raw('');
    replyTo = $state.raw('');
    editingId = $state.raw('');
    editDraft = $state.raw('');
    reactingId = $state.raw('');
    showMembers = $state.raw(false);
    showChats = $state.raw(false);
    pane = $state.raw(''); // '' | 'new' | 'join' | 'me'
    newName = $state.raw('');
    joinValue = $state.raw('');
    joinError = $state.raw('');
    myName = $state.raw('');
    search = $state.raw('');
    // Bumped whenever the log changes, to nudge the "stick to the bottom" modifier.
    revision = $state.raw(0);

    constructor(args) {
      super(args);
      this.mesh = new MeshChat({ onChange: () => this.revision++ });
      this.call = new MeshCall(this.mesh);
      this.files = new MeshFiles(this.mesh);
      this.myName = this.mesh.device.name;
      // Starting up reads the stored chats and their logs, which means writing
      // tracked fields; a microtask puts that after this render rather than in
      // the middle of it.
      queueMicrotask(() => {
        if (this.isDestroying || this.isDestroyed) return;
        this.mesh.start().catch(() => {});
      });
      // Coming back from the Avatar Editor or Settings in another tab: use the
      // profile saved there.
      const onFocus = () => this.mesh.reloadProfile();
      window.addEventListener('focus', onFocus);
      registerDestructor(this, () => {
        window.removeEventListener('focus', onFocus);
        this.files.destroy();
        this.call.destroy();
        this.mesh.destroy();
      });
    }

    // A call or a transfer should survive walking away from the page, the way
    // File Share's does: the tool floats in a picture-in-picture window.
    get pipBusy() {
      return (
        this.call.active ||
        this.files.transfers.some((t) => t.state === 'going')
      );
    }

    get pipWarning() {
      return this.call.active
        ? 'Close Messages? The call you are in will end.'
        : 'Close Messages? A file is still being sent.';
    }

    // ─── What the screen shows ───────────────────────────────────────────

    get chats() {
      const query = this.search.trim().toLowerCase();
      return [...this.mesh.chats]
        .filter((chat) => !query || chat.label.toLowerCase().includes(query))
        .sort((a, b) => b.lastAt - a.lastAt)
        .map((chat) => ({ ...chat, stamp: stampOf(chat.lastAt) }));
    }

    get active() {
      return this.mesh.active;
    }

    get members() {
      return this.mesh.members.map((member) => ({
        ...member,
        initials: initials(member.name),
        tint: tint(member.id),
        you: member.id === this.mesh.selfId,
        online: member.id === this.mesh.selfId || this.mesh.isOnline(member.id),
      }));
    }

    get me() {
      return this.mesh.device;
    }

    get profile() {
      const { name, avatar, pose } = this.mesh.device;
      return { name, avatar, pose, look: null };
    }

    get onlineCount() {
      return this.members.filter((member) => member.online).length;
    }

    get rows() {
      const view = this.mesh.view;
      const selfId = this.mesh.selfId;
      const byId = new Map(
        view.messages.map((message) => [message.id, message]),
      );
      let lastDay = '';
      let previous = null;
      return view.messages.map((message) => {
        const author = view.members.get(message.author);
        const name = author?.name ?? 'Someone';
        const day = dayOf(message.at);
        const dayLabel = day === lastDay ? '' : day;
        lastDay = day;
        const grouped =
          previous &&
          previous.author === message.author &&
          message.at - previous.at < GROUP_MS &&
          !dayLabel &&
          !message.call;
        previous = message;
        const replied = message.replyTo ? byId.get(message.replyTo) : null;
        return {
          ...message,
          name,
          author: author ?? { id: message.author, name },
          mine: message.author === selfId,
          grouped,
          dayLabel,
          initials: initials(name),
          tint: tint(message.author),
          time: timeOf(message.at),
          reacts: groupReactions(message.reactions, view.members, selfId),
          file: message.file
            ? {
                ...message.file,
                label: formatBytes(message.file.size),
                transfer: this.files.transferFor(message.file.tid),
                here:
                  Boolean(message.file.inline) ||
                  this.files.has(message.file.tid),
              }
            : null,
          reply: replied
            ? {
                name: view.members.get(replied.author)?.name ?? 'Someone',
                text: replied.unsent
                  ? 'Message taken back'
                  : replied.text ||
                    (replied.image ? 'a picture' : replied.file?.name) ||
                    'a message',
              }
            : null,
          // A call that happened reads as a line in the history, not a bubble.
          callLabel:
            message.call === 'video'
              ? 'started a video call'
              : message.call === 'voice'
                ? 'started a voice call'
                : '',
        };
      });
    }

    get typingLine() {
      const names = this.mesh.typing;
      if (!names.length) return '';
      if (names.length === 1) return `${names[0]} is typing…`;
      if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
      return 'Several people are typing…';
    }

    get sending() {
      return this.files.transfers.filter(
        (transfer) => transfer.way === 'out' && transfer.state === 'going',
      );
    }

    get inviteUrl() {
      return this.active ? this.mesh.linkFor(this.active.id) : '';
    }

    get canSend() {
      return Boolean(this.draft.trim() || this.pending.length);
    }

    get presence() {
      const others = this.onlineCount - 1;
      if (this.mesh.status !== 'online') return 'Offline';
      if (others > 0)
        return `${others} ${others === 1 ? 'other' : 'others'} here now`;
      return 'Nobody else here right now';
    }

    get statusLine() {
      if (this.mesh.error) return this.mesh.error;
      if (this.mesh.status === 'starting') return 'Connecting…';
      if (this.mesh.status === 'offline')
        return 'Offline. Everything you write is kept and sent when you are back.';
      if (!this.active) return 'Connected';
      if (this.onlineCount > 1)
        return 'Up to date with everyone online. Anyone away gets all of it when they next open the chat.';
      return 'Nobody else is online. What you write here reaches them when they are.';
    }

    // ─── Chats ───────────────────────────────────────────────────────────

    pick = (chatId) => {
      this.mesh.select(chatId);
      this.replyTo = '';
      this.editingId = '';
      this.showChats = false;
      this.photoError = '';
      this.revision++;
    };

    setSearch = (event) => (this.search = event.target.value);

    openPane = (which) => {
      this.pane = this.pane === which ? '' : which;
      this.joinError = '';
      this.pickingAvatar = false;
      if (this.pane === 'me') this.myName = this.mesh.device.name;
      // The panes live in the chat list, which is slid off screen on a phone,
      // so opening one has to bring the list with it.
      if (this.pane) this.showChats = true;
    };

    setNewName = (event) => (this.newName = event.target.value);
    setJoinValue = (event) => (this.joinValue = event.target.value);
    setMyName = (event) => (this.myName = event.target.value);

    createChat = async (event) => {
      event.preventDefault();
      const chat = await this.mesh.createChat(
        this.newName.trim() || 'New chat',
      );
      this.newName = '';
      this.pane = '';
      this.pick(chat.id);
      // A new chat is no use without sending someone the link, so the panel
      // with the link in it opens itself.
      this.showMembers = true;
    };

    joinChat = async (event) => {
      event.preventDefault();
      this.joinError = '';
      try {
        const chat = await this.mesh.joinFromLink(this.joinValue);
        this.joinValue = '';
        this.pane = '';
        this.pick(chat.id);
      } catch (error) {
        this.joinError = error.message;
      }
    };

    saveMyName = async (event) => {
      event.preventDefault();
      const name = this.myName.trim();
      if (name) await this.mesh.setProfile({ name });
      this.myName = this.mesh.device.name;
      this.pane = '';
      this.pickingAvatar = false;
    };

    toggleAvatarPicker = () => (this.pickingAvatar = !this.pickingAvatar);
    pickAvatar = (look) => this.mesh.setProfile(look);

    // The name in the title bar saves as soon as you leave it.
    renameChat = (event) => {
      const name = event.target.value.trim();
      if (name && this.active && name !== this.active.label)
        this.mesh.rename(this.active.id, name);
    };

    get chatNameDraft() {
      return this.chatNameFor === this.active?.id
        ? this.chatName
        : (this.active?.label ?? '');
    }

    setChatName = (event) => {
      this.chatName = event.target.value;
      this.chatNameFor = this.active?.id ?? '';
    };

    saveChatName = (event) => {
      event.preventDefault();
      const name = this.chatNameDraft.trim();
      if (name && this.active && name !== this.active.label)
        this.mesh.rename(this.active.id, name);
      this.chatNameFor = '';
    };

    setPhoto = async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      this.photoError = '';
      if (!file || !this.active) return;
      if (!file.type.startsWith('image/')) {
        this.photoError = 'Choose a picture for the chat photo.';
        return;
      }
      try {
        await this.mesh.setPhoto(this.active.id, await squarePhoto(file));
      } catch {
        this.photoError = "Couldn't read that picture.";
      }
    };

    removePhoto = () => this.active && this.mesh.setPhoto(this.active.id, '');

    leaveChat = async () => {
      const chat = this.active;
      if (!chat) return;
      const sure = await askConfirm({
        title: `Leave ${chat.label}?`,
        message:
          "This device's copy of the conversation and its files are deleted, and the others stop trying to reach you. Everyone else keeps their own copy, so the chat carries on without you.",
        confirmLabel: 'Hold to leave',
        holdMs: 1500,
      });
      if (sure) await this.mesh.leave(chat.id);
    };

    toggleMembers = () => (this.showMembers = !this.showMembers);
    toggleChats = () => (this.showChats = !this.showChats);

    // ─── Writing ─────────────────────────────────────────────────────────

    setDraft = (event) => {
      this.draft = event.target.value;
      this.mesh.sendTyping();
    };

    // Enter sends, shift+Enter starts a new line, as every chat does.
    onKey = (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.send(event);
      }
    };

    // The text and the first attachment go as one message, so a caption sits
    // with its picture; every attachment after that is a message of its own.
    send = async (event) => {
      event.preventDefault();
      if (!this.canSend || !this.active) return;
      const chatId = this.active.id;
      const body = this.draft;
      const pending = this.pending;
      const replyTo = this.replyTo;
      this.draft = '';
      this.pending = [];
      this.replyTo = '';
      const parts = pending.length ? pending : [{}];
      for (const [index, part] of parts.entries()) {
        let offer = null;
        if (part.file) {
          try {
            offer = await this.files.offer(chatId, part.file);
          } catch (error) {
            this.attachError = error.message;
            continue;
          }
        }
        await this.mesh.send(
          index === 0 ? body : '',
          part.image ?? '',
          index === 0 ? replyTo : '',
          offer,
        );
      }
      this.revision++;
    };

    // One button for everything: a picture becomes a picture in the
    // conversation, and anything else becomes a file the others can save.
    attach = async (event) => {
      const files = [...(event.target.files ?? [])];
      event.target.value = '';
      await this.takeFiles(files);
    };

    async takeFiles(files) {
      this.attachError = '';
      for (const file of files) await this.takeFile(file);
    }

    async takeFile(file) {
      const key = `${file.name}:${file.size}:${Date.now()}:${Math.random()}`;
      if (file.type.startsWith('image/') && file.size <= IMAGE_SOURCE_LIMIT) {
        const image = await shrinkImage(file).catch(() => '');
        if (image) {
          this.pending = [...this.pending, { key, image }];
          return;
        }
      }
      if (file.size > MAX_FILE_BYTES) {
        this.attachError = `${file.name} is ${formatBytes(file.size)}. Files up to ${this.maxFile} can be sent.`;
        return;
      }
      this.pending = [
        ...this.pending,
        { key, file, label: `${file.name} (${formatBytes(file.size)})` },
      ];
    }

    clearAttachment = (part) => {
      this.pending = this.pending.filter((other) => other !== part);
      this.attachError = '';
    };

    // Files dragged from the desktop land in the composer, ready to send.
    dragOver = (event) => {
      if (!hasFiles(event) || !this.active) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      this.dragging = true;
    };

    dragLeave = (event) => {
      // Leaving a child still counts as being over the drop zone.
      if (event.currentTarget.contains(event.relatedTarget)) return;
      this.dragging = false;
    };

    drop = async (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      this.dragging = false;
      if (!this.active) return;
      await this.takeFiles([...event.dataTransfer.files]);
    };

    // Pasting a screenshot works the way dropping one does.
    paste = async (event) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (!files.length) return;
      event.preventDefault();
      await this.takeFiles(files);
    };

    download = (row) => this.files.download(this.active.id, row.file);

    startReply = (row) => {
      this.replyTo = row.id;
      this.editingId = '';
    };
    cancelReply = () => (this.replyTo = '');

    get replyPreview() {
      return this.rows.find((row) => row.id === this.replyTo) ?? null;
    }

    startEdit = (row) => {
      this.editingId = row.id;
      this.editDraft = row.text;
    };
    setEditDraft = (event) => (this.editDraft = event.target.value);
    cancelEdit = () => (this.editingId = '');
    saveEdit = async (event) => {
      event.preventDefault();
      const id = this.editingId;
      this.editingId = '';
      if (id) await this.mesh.edit(id, this.editDraft);
    };

    unsend = async (row) => {
      const sure = await askConfirm({
        title: 'Take this message back?',
        message:
          'It goes from every device in the chat, including the ones that are offline right now: they take it back as soon as they catch up.',
        confirmLabel: 'Hold to take back',
        holdMs: 1200,
      });
      if (sure) await this.mesh.unsend(row.id);
    };

    openReactions = (row) =>
      (this.reactingId = this.reactingId === row.id ? '' : row.id);

    react = async (row, emoji) => {
      this.reactingId = '';
      await this.mesh.react(row.id, emoji);
    };

    // ─── Calls ───────────────────────────────────────────────────────────

    startVoice = () => this.call.start(this.active?.id, 'audio');
    startVideo = () => this.call.start(this.active?.id, 'video');
    accept = () => this.call.accept();
    decline = () => this.call.decline();
    hangUp = () => this.call.hangUp();

    get callTitle() {
      if (this.call.state === 'ringing') return 'Ringing…';
      const count = this.call.participants.length;
      return `${this.call.mode === 'video' ? 'Video call' : 'Voice call'} · ${count + 1} in`;
    }
  }
</script>

<script>
  let args = $props();
  const self = new MessagesPage(args);
  onDestroy(() => destroy(self));
</script>

{#snippet Face(args)}
  <span
    class="msgr-avatar {truthy(args.member?.avatar)
      ? 'has-portrait'
      : ''} {args.class}"
    aria-hidden="true"
  >
    {#if truthy(args.member?.avatar)}
      <AvatarPortrait
        avatar={args.member?.avatar}
        pose={args.member?.pose}
        size={args.size}
      />
    {:else}
      {initials(args.member?.name)}
    {/if}
  </span>
{/snippet}

{#snippet ChatFace(args)}
  <span
    class="msgr-avatar msgr-avatar-chat
      {truthy(args.chat?.photo) ? 'has-photo' : ''}
      {args.class}"
    aria-hidden="true"
  >
    {#if truthy(args.chat?.photo)}
      <img src={args.chat?.photo} alt="" />
    {:else}
      {initials(args.chat?.label)}
    {/if}
  </span>
{/snippet}

<ToolPage
  route="messages"
  game={true}
  subtitle="A group chat nobody hosts: everyone invited keeps their own copy, with voice, video, screen sharing and files."
  busy={self.pipBusy}
  closeWarning={self.pipWarning}
>
  <div class="msgr">
    <!-- ─── Conversations ─────────────────────────────────────── -->
    <aside
      class="msgr-rail {truthy(self.showChats) ? 'is-open' : ''}"
      aria-label="Your chats"
    >
      <div class="msgr-rail-head">
        <h3 class="msgr-rail-title">Chats</h3>
        <button
          type="button"
          class="msgr-icon-btn"
          title="New chat"
          aria-label="New chat"
          onclick={(..._r) => self.openPane('new', ..._r)}
          ><Icon name="plus" size={16} /></button
        >
        <button
          type="button"
          class="msgr-icon-btn"
          title="Join with a link"
          aria-label="Join with a link"
          onclick={(..._r) => self.openPane('join', ..._r)}
          ><Icon name="link" size={16} /></button
        >
      </div>

      <div class="msgr-search">
        <Icon name="search" size={14} />
        <input
          type="search"
          placeholder="Search chats"
          aria-label="Search chats"
          {@attach prop('value', () => self.search)}
          oninput={self.setSearch}
        />
      </div>

      {#if truthy(eq(self.pane, 'new'))}
        <form class="msgr-pane" onsubmit={self.createChat}>
          <input
            type="text"
            class="msgr-input"
            placeholder="What is this chat called?"
            maxlength="60"
            aria-label="Chat name"
            {@attach prop('value', () => self.newName)}
            oninput={self.setNewName}
            {@attach focusMe()}
          />
          <button type="submit" class="btn active">Create</button>
        </form>
      {/if}

      {#if truthy(eq(self.pane, 'join'))}
        <form class="msgr-pane" onsubmit={self.joinChat}>
          <input
            type="text"
            class="msgr-input"
            placeholder="Paste an invite link"
            aria-label="Invite link to join"
            {@attach prop('value', () => self.joinValue)}
            oninput={self.setJoinValue}
            {@attach focusMe()}
          />
          <button type="submit" class="btn active">Join</button>
          {#if truthy(self.joinError)}
            <p class="tool-error">{self.joinError}</p>
          {/if}
        </form>
      {/if}

      <ul class="msgr-chats">
        {#each self.chats ?? [] as chat (chat?.id)}
          <li>
            <button
              type="button"
              class="msgr-chat
                    {truthy(eq(chat?.id, self.mesh?.activeId))
                ? 'is-active'
                : ''}
                    {truthy(chat?.unread) ? 'is-unread' : ''}"
              style={tint(chat?.id)}
              onclick={(..._r) => self.pick(chat?.id, ..._r)}
            >
              {@render ChatFace({ chat: chat })}
              <span class="msgr-chat-body">
                <span class="msgr-chat-top">
                  <span class="msgr-chat-name">{chat?.label}</span>
                  <span class="msgr-chat-stamp">{chat?.stamp}</span>
                </span>
                <span class="msgr-chat-bottom">
                  <span class="msgr-chat-last">{chat?.lastText}</span>
                  {#if truthy(chat?.unread)}
                    <span class="msgr-badge">{chat?.unread}</span>
                  {/if}
                </span>
              </span>
            </button>
          </li>
        {:else}
          <li class="msgr-empty-rail"
            >No chats yet. Create one and send someone the invite link, or paste
            a link you were sent.</li
          >
        {/each}
      </ul>

      <div class="msgr-me">
        {#if truthy(eq(self.pane, 'me'))}
          <form class="msgr-pane" onsubmit={self.saveMyName}>
            <div class="msgr-me-row" style={tint(self.mesh?.selfId)}>
              {@render Face({ member: self.me, size: 40 })}
              <input
                type="text"
                class="msgr-input"
                maxlength={self.nameLength}
                aria-label="Your name"
                {@attach prop('value', () => self.myName)}
                oninput={self.setMyName}
                {@attach focusMe()}
              />
            </div>
            <p class="msgr-side-hint"
              >This is your name and avatar from the games, so changing them
              here changes them there too.</p
            >
            <button
              type="button"
              class="btn {truthy(self.pickingAvatar) ? 'active' : ''}"
              aria-expanded={truthy(self.pickingAvatar) ? 'true' : 'false'}
              onclick={self.toggleAvatarPicker}
              ><Icon name="shirt" size={13} />
              {truthy(self.pickingAvatar) ? 'Done' : 'Change avatar'}</button
            >
            {#if truthy(self.pickingAvatar)}
              <AvatarPicker
                profile={self.profile}
                onPick={self.pickAvatar}
                size={44}
              />
            {/if}
            <button type="submit" class="btn active">Save</button>
          </form>
        {:else}
          <button
            type="button"
            class="msgr-me-btn"
            style={tint(self.mesh?.selfId)}
            onclick={(..._r) => self.openPane('me', ..._r)}
          >
            {@render Face({ member: self.me, size: 40 })}
            <span class="msgr-me-body">
              <span class="msgr-chat-name">{self.mesh?.device?.name}</span>
              <span class="msgr-chat-last"
                >{truthy(eq(self.mesh?.status, 'online'))
                  ? 'Online'
                  : 'Offline'}
                · this device</span
              >
            </span>
            <Icon name="square-pen" size={14} />
          </button>
        {/if}
      </div>
    </aside>

    <!-- ─── The conversation ──────────────────────────────────── -->
    <section
      class="msgr-main {truthy(self.dragging) ? 'is-dragging' : ''}"
      ondrop={self.drop}
      ondragleave={self.dragLeave}
      ondragover={self.dragOver}
      ondragenter={self.dragOver}
    >
      {#if truthy(self.dragging)}
        <div class="msgr-drop" aria-hidden="true">
          <Icon name="upload" size={28} />
          <span>Drop to send</span>
        </div>
      {/if}
      {#if truthy(self.active)}
        <header class="msgr-head">
          <button
            type="button"
            class="msgr-icon-btn msgr-only-narrow"
            aria-label="Chats"
            onclick={self.toggleChats}><Icon name="menu" size={17} /></button
          >
          <span style={tint(self.active?.id)}>
            {@render ChatFace({ chat: self.active, class: 'msgr-head-face' })}
          </span>
          <div class="msgr-head-name">
            <input
              type="text"
              class="msgr-title-input"
              aria-label="Chat name"
              maxlength="60"
              {@attach prop('value', () => self.active?.label)}
              onchange={self.renameChat}
            />
            <span class="msgr-head-sub">{self.presence}</span>
          </div>
          <div class="msgr-head-actions">
            <button
              type="button"
              class="msgr-icon-btn"
              title="Voice call"
              aria-label="Voice call"
              disabled={self.call?.active}
              onclick={self.startVoice}><Icon name="phone" size={17} /></button
            >
            <button
              type="button"
              class="msgr-icon-btn"
              title="Video call"
              aria-label="Video call"
              disabled={self.call?.active}
              onclick={self.startVideo}><Icon name="video" size={17} /></button
            >
            <button
              type="button"
              class="msgr-icon-btn {truthy(self.showMembers) ? 'is-on' : ''}"
              title="Chat details"
              aria-label="Chat details"
              onclick={self.toggleMembers}
              ><Icon name="users" size={17} /></button
            >
          </div>
        </header>

        {#if truthy(self.call?.incoming)}
          <div class="msgr-ring">
            <Icon name="bell-ring" size={16} />
            <span
              ><strong>{self.call?.incoming?.name}</strong>
              is starting a
              {truthy(eq(self.call?.incoming?.mode, 'video'))
                ? 'video call'
                : 'voice call'}.</span
            >
            <button type="button" class="btn active" onclick={self.accept}
              >Join</button
            >
            <button type="button" class="btn" onclick={self.decline}
              >Not now</button
            >
          </div>
        {/if}

        {#if truthy(self.call?.active)}
          <div class="msgr-call">
            <div class="msgr-call-head">
              <span class="msgr-call-title"
                ><Icon
                  name={truthy(eq(self.call?.mode, 'video'))
                    ? 'video'
                    : 'phone'}
                  size={14}
                />
                {self.callTitle}</span
              >
              {#if truthy(self.call?.error)}
                <span class="tool-error">{self.call?.error}</span>
              {/if}
            </div>
            <div class="msgr-tiles">
              <div class="msgr-tile is-self">
                {#if truthy(self.call?.localStream)}
                  <!-- template-lint-disable require-media-caption -->
                  <video
                    class="msgr-video"
                    autoplay
                    muted
                    playsinline
                    {@attach playStream([self.call?.localStream, true])}
                  ></video>
                {/if}
                {#if !truthy(self.call?.camOn)}
                  {#if !truthy(self.call?.sharing)}
                    <span style={tint(self.mesh?.selfId)}>
                      {@render Face({
                        member: self.me,
                        size: 48,
                        class: 'msgr-tile-avatar',
                      })}
                    </span>
                  {/if}
                {/if}
                <span class="msgr-tile-name"
                  >You{#if !truthy(self.call?.micOn)}
                    · muted{/if}</span
                >
              </div>
              {#each self.call?.participants ?? [] as person}
                <div class="msgr-tile">
                  <!-- template-lint-disable require-media-caption -->
                  <video
                    class="msgr-video"
                    autoplay
                    playsinline
                    {@attach playStream([person?.stream, false])}
                  ></video>
                  <span class="msgr-tile-name">{person?.name}</span>
                </div>
              {:else}
                <div class="msgr-tile is-waiting">
                  <Icon name="loader-pinwheel" size={20} />
                  <span class="msgr-tile-name">Waiting for someone to join</span
                  >
                </div>
              {/each}
            </div>
            <div class="msgr-call-bar">
              <button
                type="button"
                class="msgr-call-btn {!truthy(self.call?.micOn)
                  ? 'is-off'
                  : ''}"
                onclick={self.call?.toggleMic}
                ><Icon
                  name={truthy(self.call?.micOn) ? 'mic' : 'mic-off'}
                  size={16}
                />
                {truthy(self.call?.micOn) ? 'Mute' : 'Unmute'}</button
              >
              <button
                type="button"
                class="msgr-call-btn {!truthy(self.call?.camOn)
                  ? 'is-off'
                  : ''}"
                onclick={self.call?.toggleCam}
                ><Icon
                  name={truthy(self.call?.camOn) ? 'video' : 'video-off'}
                  size={16}
                />
                {truthy(self.call?.camOn) ? 'Camera off' : 'Camera on'}</button
              >
              {#if truthy(self.call?.canShare)}
                <button
                  type="button"
                  class="msgr-call-btn {truthy(self.call?.sharing)
                    ? 'is-live'
                    : ''}"
                  onclick={self.call?.toggleShare}
                  ><Icon
                    name={truthy(self.call?.sharing)
                      ? 'screen-share-off'
                      : 'screen-share'}
                    size={16}
                  />
                  {truthy(self.call?.sharing)
                    ? 'Stop sharing'
                    : 'Share screen'}</button
                >
              {/if}
              <button
                type="button"
                class="msgr-call-btn is-end"
                onclick={self.hangUp}
                ><Icon name="phone-off" size={16} /> Leave</button
              >
            </div>
          </div>
        {/if}

        <ol class="msgr-list" {@attach stickToBottom([self.revision])}>
          {#each self.rows ?? [] as row (row?.id)}
            {#if truthy(row?.dayLabel)}
              <li class="msgr-day">{row?.dayLabel}</li>
            {/if}
            {#if truthy(row?.callLabel)}
              <li class="msgr-system"
                ><Icon name="phone" size={12} />
                {truthy(row?.mine) ? 'You' : row?.name}
                {row?.callLabel}
                ·
                {row?.time}</li
              >
            {:else}
              <li
                class="msgr-row
                      {truthy(row?.mine) ? 'is-mine' : ''}
                      {truthy(row?.grouped) ? 'is-grouped' : ''}"
                style={row?.tint}
              >
                {#if !truthy(row?.mine)}
                  {#if truthy(row?.grouped)}
                    <span class="msgr-avatar msgr-row-avatar" aria-hidden="true"
                    ></span>
                  {:else}
                    {@render Face({
                      member: row?.author,
                      size: 30,
                      class: 'msgr-row-avatar',
                    })}
                  {/if}
                {/if}
                <div class="msgr-bubble-wrap">
                  {#if !truthy(row?.grouped)}
                    <span class="msgr-who"
                      >{truthy(row?.mine) ? 'You' : row?.name}<span
                        class="msgr-when">{row?.time}</span
                      ></span
                    >
                  {/if}
                  {#if truthy(row?.reply)}
                    <span class="msgr-quote"
                      ><strong>{row?.reply?.name}</strong>
                      {row?.reply?.text}</span
                    >
                  {/if}
                  {#if truthy(eq(self.editingId, row?.id))}
                    <form class="msgr-edit" onsubmit={self.saveEdit}>
                      <input
                        type="text"
                        class="msgr-input"
                        maxlength={self.maxLength}
                        aria-label="Edit message"
                        {@attach prop('value', () => self.editDraft)}
                        oninput={self.setEditDraft}
                        {@attach focusMe()}
                      />
                      <button type="submit" class="btn active">Save</button>
                      <button
                        type="button"
                        class="btn"
                        onclick={self.cancelEdit}>Cancel</button
                      >
                    </form>
                  {:else}
                    <div
                      class="msgr-bubble {truthy(row?.unsent)
                        ? 'is-unsent'
                        : ''}"
                    >
                      {#if truthy(row?.unsent)}
                        <span class="msgr-gone">Message taken back</span>
                      {:else}
                        {#if truthy(row?.image)}
                          <img
                            class="msgr-image"
                            src={row?.image}
                            alt="Sent in this chat"
                          />
                        {/if}
                        {#if truthy(row?.file)}
                          <span class="msgr-file">
                            <span class="msgr-file-icon"
                              ><Icon name="file" size={18} /></span
                            >
                            <span class="msgr-file-body">
                              <span class="msgr-file-name"
                                >{row?.file?.name}</span
                              >
                              <span class="msgr-file-size"
                                >{row?.file
                                  ?.label}{#if truthy(row?.file?.inline)}
                                  · kept in the chat{:else if truthy(row?.file?.here)}
                                  · you have a copy{/if}</span
                              >
                              {#if truthy(row?.file?.transfer)}
                                {#if truthy(eq(row?.file?.transfer?.state, 'going'))}
                                  <span class="msgr-file-bar"
                                    ><span
                                      class="msgr-file-fill"
                                      style={barWidth(
                                        row?.file?.transfer?.done,
                                        row?.file?.size,
                                      )}
                                    ></span></span
                                  >
                                  <span class="msgr-file-size"
                                    >{formatBytes(row?.file?.transfer?.done)}
                                    of
                                    {row?.file?.label}</span
                                  >
                                {:else if truthy(eq(row?.file?.transfer?.state, 'asking'))}
                                  <span class="msgr-file-size"
                                    >Looking for someone who has it…</span
                                  >
                                {:else if truthy(row?.file?.transfer?.error)}
                                  <span class="msgr-file-size is-bad"
                                    >{row?.file?.transfer?.error}</span
                                  >
                                {/if}
                              {/if}
                            </span>
                            {#if truthy(row?.file?.inline)}
                              <a
                                class="msgr-file-btn"
                                href={row?.file?.inline}
                                download={row?.file?.name}
                                aria-label="Save this file"
                                ><Icon name="download" size={15} /></a
                              >
                            {:else}
                              <button
                                type="button"
                                class="msgr-file-btn"
                                aria-label="Save this file"
                                onclick={(..._r) => self.download(row, ..._r)}
                                ><Icon name="download" size={15} /></button
                              >
                            {/if}
                          </span>
                        {/if}
                        {#if truthy(row?.text)}
                          <span class="msgr-text"
                            >{@html markdown(row?.text)}</span
                          >
                        {/if}
                        {#if truthy(row?.editedAt)}
                          <span class="msgr-edited">edited</span>
                        {/if}
                      {/if}
                    </div>
                  {/if}

                  {#if truthy(row?.reacts?.length)}
                    <span class="msgr-reacts">
                      {#each row?.reacts ?? [] as group}
                        <button
                          type="button"
                          class="msgr-react {truthy(group?.mine)
                            ? 'is-mine'
                            : ''}"
                          title={group?.who}
                          onclick={(..._r) =>
                            self.react(row, group?.emoji, ..._r)}
                          >{group?.emoji}
                          {group?.count}</button
                        >
                      {/each}
                    </span>
                  {/if}

                  {#if !truthy(row?.unsent)}
                    <span class="msgr-tools">
                      <button
                        type="button"
                        class="msgr-tool"
                        title="React"
                        aria-label="React"
                        onclick={(..._r) => self.openReactions(row, ..._r)}
                        ><Icon name="smile" size={14} /></button
                      >
                      <button
                        type="button"
                        class="msgr-tool"
                        title="Reply"
                        aria-label="Reply"
                        onclick={(..._r) => self.startReply(row, ..._r)}
                        ><Icon name="repeat" size={14} /></button
                      >
                      {#if truthy(row?.mine)}
                        {#if truthy(row?.text)}
                          <button
                            type="button"
                            class="msgr-tool"
                            title="Edit"
                            aria-label="Edit"
                            onclick={(..._r) => self.startEdit(row, ..._r)}
                            ><Icon name="pen-line" size={14} /></button
                          >
                        {/if}
                        <button
                          type="button"
                          class="msgr-tool"
                          title="Take back"
                          aria-label="Take back"
                          onclick={(..._r) => self.unsend(row, ..._r)}
                          ><Icon name="trash-2" size={14} /></button
                        >
                      {/if}
                    </span>
                    {#if truthy(eq(self.reactingId, row?.id))}
                      <span class="msgr-react-picker">
                        {#each self.reactions ?? [] as emoji}
                          <button
                            type="button"
                            class="msgr-react-pick"
                            onclick={(..._r) => self.react(row, emoji, ..._r)}
                            >{emoji}</button
                          >
                        {/each}
                      </span>
                    {/if}
                  {/if}
                </div>
              </li>
            {/if}
          {:else}
            <li class="msgr-empty">
              <Icon name="message-circle" size={22} />
              <p
                >Nothing here yet. Send the invite link to whoever should be in
                this chat, then say something.</p
              >
            </li>
          {/each}
        </ol>

        <div class="msgr-foot">
          {#if truthy(self.typingLine)}
            <span class="msgr-typing">{self.typingLine}</span>
          {/if}
          {#if truthy(self.replyPreview)}
            <div class="msgr-replying">
              <span
                >Replying to
                <strong>{self.replyPreview?.name}</strong>:
                {self.replyPreview?.text}</span
              >
              <button
                type="button"
                class="msgr-tool"
                aria-label="Stop replying"
                onclick={self.cancelReply}><Icon name="x" size={14} /></button
              >
            </div>
          {/if}
          {#if truthy(self.attachError)}
            <p class="tool-error">{self.attachError}</p>
          {/if}
          {#if truthy(self.pending?.length)}
            <div class="msgr-attached-list">
              {#each self.pending ?? [] as part}
                <div class="msgr-attached">
                  {#if truthy(part?.image)}
                    <img src={part?.image} alt="Attached, not yet sent" />
                  {:else}
                    <Icon name="file" size={16} />
                    <span>{part?.label}</span>
                  {/if}
                  <button
                    type="button"
                    class="msgr-tool"
                    aria-label="Remove this attachment"
                    onclick={(..._r) => self.clearAttachment(part, ..._r)}
                    ><Icon name="x" size={14} /></button
                  >
                </div>
              {/each}
            </div>
          {/if}
          {#each self.sending ?? [] as transfer (transfer?.tid)}
            <div class="msgr-sending">
              <span
                >Sending
                {transfer?.name}
                ·
                {formatBytes(transfer?.done)}
                of
                {formatBytes(transfer?.size)}</span
              >
              <span class="msgr-file-bar"
                ><span
                  class="msgr-file-fill"
                  style={barWidth(transfer?.done, transfer?.size)}
                ></span></span
              >
            </div>
          {/each}
          <form class="msgr-composer" onsubmit={self.send}>
            <span class="msgr-icon-btn" title="Send a picture or a file">
              <Icon name="upload" size={17} />
              <input
                type="file"
                class="msgr-file-input"
                multiple
                aria-label="Send a picture or a file"
                onchange={self.attach}
              />
            </span>
            <textarea
              class="msgr-draft"
              rows="1"
              placeholder="Write a message (markdown works)"
              maxlength={self.maxLength}
              aria-label="Message"
              {@attach prop('value', () => self.draft)}
              onpaste={self.paste}
              onkeydown={self.onKey}
              oninput={self.setDraft}></textarea>
            <button
              type="submit"
              class="msgr-send"
              aria-label="Send"
              disabled={truthy(self.canSend) ? false : true}
              ><Icon name="send" size={16} /></button
            >
          </form>
          <p class="msgr-status">{self.statusLine}</p>
        </div>
      {:else}
        <div class="msgr-blank">
          <Icon name="message-circle" size={26} />
          <h3>No chat open</h3>
          <p
            >Create a chat and send people its invite link, or paste a link
            someone sent you. Nothing is uploaded: a chat lives on the devices
            of the people in it, and any two of them that are online at the same
            time bring each other up to date.</p
          >
          <div class="tool-controls">
            <button
              type="button"
              class="btn active"
              onclick={(..._r) => self.openPane('new', ..._r)}
              ><Icon name="plus" size={13} /> New chat</button
            >
            <button
              type="button"
              class="btn"
              onclick={(..._r) => self.openPane('join', ..._r)}
              ><Icon name="link" size={13} /> Join with a link</button
            >
          </div>
        </div>
      {/if}
    </section>

    <!-- ─── Details ──────────────────────────────────────────── -->
    {#if truthy(self.showMembers)}
      <aside class="msgr-people" aria-label="Chat details">
        <div class="msgr-rail-head">
          <h3 class="msgr-rail-title">Chat details</h3>
          <button
            type="button"
            class="msgr-icon-btn"
            aria-label="Close the details"
            onclick={self.toggleMembers}><Icon name="x" size={16} /></button
          >
        </div>
        <div class="msgr-people-body">
          <h4 class="msgr-side-title">Name and photo</h4>
          <div class="msgr-photo-row" style={tint(self.active?.id)}>
            {@render ChatFace({ chat: self.active, class: 'msgr-photo-big' })}
            <div class="msgr-photo-actions">
              <span class="msgr-icon-btn btn" title="Choose a chat photo">
                <Icon name="image-plus" size={14} />
                Choose a photo
                <input
                  type="file"
                  class="msgr-file-input"
                  accept="image/*"
                  aria-label="Choose a chat photo"
                  onchange={self.setPhoto}
                />
              </span>
              {#if truthy(self.active?.photo)}
                <button type="button" class="btn" onclick={self.removePhoto}
                  ><Icon name="x" size={13} /> Remove the photo</button
                >
              {/if}
            </div>
          </div>
          {#if truthy(self.photoError)}
            <p class="tool-error">{self.photoError}</p>
          {/if}
          <form class="msgr-invite-row" onsubmit={self.saveChatName}>
            <input
              type="text"
              class="msgr-input"
              maxlength="60"
              aria-label="Rename this chat"
              placeholder="Chat name"
              {@attach prop('value', () => self.chatNameDraft)}
              oninput={self.setChatName}
            />
            <button type="submit" class="btn active">Rename</button>
          </form>
          <p class="msgr-side-hint"
            >The name and photo are shared: everyone in the chat sees the
            change.</p
          >

          <h4 class="msgr-side-title">Invite link</h4>
          <p class="msgr-side-hint"
            >Anyone with this link can read and write in this chat, so send it
            the way you would a key. The secret is in the part after the #,
            which browsers never send to a server.</p
          >
          <div class="msgr-invite-row">
            <input
              type="text"
              class="msgr-input"
              readonly
              aria-label="This chat's invite link"
              {@attach prop('value', () => self.inviteUrl)}
            />
            <CopyButton value={self.inviteUrl} />
          </div>

          <h4 class="msgr-side-title">In this chat ({self.members?.length})</h4>
          <ul class="msgr-member-list">
            {#each self.members ?? [] as member (member?.id)}
              <li style={member?.tint}>
                {@render Face({ member: member, size: 34 })}
                <span class="msgr-member-body">
                  <span class="msgr-chat-name"
                    >{member?.name}{#if truthy(member?.you)}
                      (you){/if}</span
                  >
                  <span class="msgr-chat-last"
                    >{truthy(member?.online) ? 'Online' : 'Offline'}</span
                  >
                </span>
                <span
                  class="msgr-dot {truthy(member?.online) ? 'is-on' : ''}"
                  aria-hidden="true"
                ></span>
              </li>
            {/each}
          </ul>

          <h4 class="msgr-side-title">Files</h4>
          <p class="msgr-side-hint"
            >Files up to
            {self.maxFile}
            go straight from one device to another when somebody asks for them, so
            nothing is uploaded anywhere. Small ones ride along inside the chat and
            are always there; for the big ones, someone who has a copy has to be online.</p
          >
          {#if truthy(any(self.files?.transfers))}
            <ul class="msgr-transfers">
              {#each self.files?.transfers ?? [] as transfer (transfer?.tid)}
                <li>
                  <span class="msgr-chat-name">{transfer?.name}</span>
                  <span class="msgr-chat-last">
                    {truthy(eq(transfer?.way, 'out')) ? 'Sent' : 'Received'}
                    ·
                    {#if truthy(eq(transfer?.state, 'done'))}
                      finished
                    {:else if truthy(eq(transfer?.state, 'failed'))}
                      stopped
                    {:else}
                      {formatBytes(transfer?.done)}
                      of
                      {formatBytes(transfer?.size)}
                    {/if}
                  </span>
                </li>
              {/each}
            </ul>
            <button
              type="button"
              class="btn"
              onclick={self.files?.clearFinished}
              >Clear the finished ones</button
            >
          {:else}
            <p class="msgr-side-hint">No transfers yet.</p>
          {/if}

          <h4 class="msgr-side-title">Leaving</h4>
          <button type="button" class="btn" onclick={self.leaveChat}
            ><Icon name="log-out" size={13} /> Leave this chat</button
          >
        </div>
      </aside>
    {/if}
  </div>
</ToolPage>
