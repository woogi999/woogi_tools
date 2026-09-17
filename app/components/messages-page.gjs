import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import CopyButton from './copy-button';
import MeshChat, { MAX_MESSAGE, MAX_IMAGE_BYTES } from '../utils/mesh-chat';
import MeshCall from '../utils/mesh-call';
import MeshFiles, { MAX_FILE_BYTES, formatBytes } from '../utils/mesh-files';
import { groupReactions } from '../utils/mesh-log';
import { askConfirm } from '../utils/confirm';

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

const stickToBottom = modifier((list, [signal]) => {
  void signal;
  // Only follow the conversation if you were already near the bottom of it, so
  // reading back through the history isn't yanked away by a new message.
  const nearBottom =
    list.scrollHeight - list.scrollTop - list.clientHeight < 260;
  if (nearBottom) list.scrollTop = list.scrollHeight;
});

const playStream = modifier((element, [stream]) => {
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
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
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
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
};
const tint = (id) => htmlSafe(`--who-hue: ${hueOf(id)}`);
const barWidth = (done, size) =>
  htmlSafe(`width: ${Math.min(100, Math.round((done / (size || 1)) * 100))}%`);

async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.72, 0.6, 0.45, 0.3]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    // A data URL carries three bytes in every four characters.
    if (url.length * 0.75 <= MAX_IMAGE_BYTES) return url;
  }
  return '';
}

export default class MessagesPage extends Component {
  maxLength = MAX_MESSAGE;
  reactions = QUICK_REACTIONS;
  maxFile = formatBytes(MAX_FILE_BYTES);

  @tracked draft = '';
  @tracked attachment = '';
  @tracked pendingFile = null;
  @tracked attachError = '';
  @tracked replyTo = '';
  @tracked editingId = '';
  @tracked editDraft = '';
  @tracked reactingId = '';
  @tracked showMembers = false;
  @tracked showChats = false;
  @tracked pane = ''; // '' | 'new' | 'join' | 'me'
  @tracked newName = '';
  @tracked joinValue = '';
  @tracked joinError = '';
  @tracked myName = '';
  @tracked search = '';
  // Bumped whenever the log changes, to nudge the "stick to the bottom" modifier.
  @tracked revision = 0;

  constructor(owner, args) {
    super(owner, args);
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
    registerDestructor(this, () => {
      this.files.destroy();
      this.call.destroy();
      this.mesh.destroy();
    });
  }

  // A call or a transfer should survive walking away from the page, the way
  // File Share's does: the tool floats in a picture-in-picture window.
  get pipBusy() {
    return (
      this.call.active || this.files.transfers.some((t) => t.state === 'going')
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

  get onlineCount() {
    return this.members.filter((member) => member.online).length;
  }

  get rows() {
    const view = this.mesh.view;
    const selfId = this.mesh.selfId;
    const byId = new Map(view.messages.map((message) => [message.id, message]));
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
    return Boolean(this.draft.trim() || this.attachment || this.pendingFile);
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
    this.revision++;
  };

  setSearch = (event) => (this.search = event.target.value);

  openPane = (which) => {
    this.pane = this.pane === which ? '' : which;
    this.joinError = '';
    // The panes live in the chat list, which is slid off screen on a phone,
    // so opening one has to bring the list with it.
    if (this.pane) this.showChats = true;
  };

  setNewName = (event) => (this.newName = event.target.value);
  setJoinValue = (event) => (this.joinValue = event.target.value);
  setMyName = (event) => (this.myName = event.target.value);

  createChat = async (event) => {
    event.preventDefault();
    const chat = await this.mesh.createChat(this.newName.trim() || 'New chat');
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
    await this.mesh.setDisplayName(this.myName);
    this.myName = this.mesh.device.name;
    this.pane = '';
  };

  renameChat = (event) => {
    const name = event.target.value.trim();
    if (name && this.active && name !== this.active.label)
      this.mesh.rename(this.active.id, name);
  };

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

  send = async (event) => {
    event.preventDefault();
    if (!this.canSend || !this.active) return;
    const body = this.draft;
    const image = this.attachment;
    const file = this.pendingFile;
    const replyTo = this.replyTo;
    this.draft = '';
    this.attachment = '';
    this.pendingFile = null;
    this.replyTo = '';
    let offer = null;
    if (file) {
      try {
        offer = await this.files.offer(this.active.id, file);
      } catch (error) {
        this.attachError = error.message;
        return;
      }
    }
    await this.mesh.send(body, image, replyTo, offer);
    this.revision++;
  };

  // One button for everything: a picture becomes a picture in the
  // conversation, and anything else becomes a file the others can save.
  attach = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    this.attachError = '';
    if (!file) return;
    if (file.type.startsWith('image/') && file.size <= IMAGE_SOURCE_LIMIT) {
      const url = await shrinkImage(file);
      if (url) {
        this.attachment = url;
        this.pendingFile = null;
        return;
      }
    }
    if (file.size > MAX_FILE_BYTES) {
      this.attachError = `${file.name} is ${formatBytes(file.size)}. Files up to ${this.maxFile} can be sent.`;
      return;
    }
    this.pendingFile = file;
    this.attachment = '';
  };

  get pendingFileLabel() {
    const file = this.pendingFile;
    return file ? `${file.name} (${formatBytes(file.size)})` : '';
  }

  clearAttachment = () => {
    this.attachment = '';
    this.pendingFile = null;
    this.attachError = '';
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

  <template>
    <ToolPage
      @route="messages"
      @game={{true}}
      @subtitle="A group chat nobody hosts: everyone invited keeps their own copy, with voice, video, screen sharing and files."
      @busy={{this.pipBusy}}
      @closeWarning={{this.pipWarning}}
    >
      <div class="msgr">
        {{! ─── Conversations ─────────────────────────────────────── }}
        <aside
          class="msgr-rail {{if this.showChats 'is-open'}}"
          aria-label="Your chats"
        >
          <div class="msgr-rail-head">
            <h3 class="msgr-rail-title">Chats</h3>
            <button
              type="button"
              class="msgr-icon-btn"
              title="New chat"
              aria-label="New chat"
              {{on "click" (fn this.openPane "new")}}
            ><Icon @name="plus" @size={{16}} /></button>
            <button
              type="button"
              class="msgr-icon-btn"
              title="Join with a link"
              aria-label="Join with a link"
              {{on "click" (fn this.openPane "join")}}
            ><Icon @name="link" @size={{16}} /></button>
          </div>

          <div class="msgr-search">
            <Icon @name="search" @size={{14}} />
            <input
              type="search"
              placeholder="Search chats"
              aria-label="Search chats"
              value={{this.search}}
              {{on "input" this.setSearch}}
            />
          </div>

          {{#if (eq this.pane "new")}}
            <form class="msgr-pane" {{on "submit" this.createChat}}>
              <input
                type="text"
                class="msgr-input"
                placeholder="What is this chat called?"
                maxlength="60"
                aria-label="Chat name"
                value={{this.newName}}
                {{on "input" this.setNewName}}
                {{focusMe}}
              />
              <button type="submit" class="btn active">Create</button>
            </form>
          {{/if}}

          {{#if (eq this.pane "join")}}
            <form class="msgr-pane" {{on "submit" this.joinChat}}>
              <input
                type="text"
                class="msgr-input"
                placeholder="Paste an invite link"
                aria-label="Invite link to join"
                value={{this.joinValue}}
                {{on "input" this.setJoinValue}}
                {{focusMe}}
              />
              <button type="submit" class="btn active">Join</button>
              {{#if this.joinError}}
                <p class="tool-error">{{this.joinError}}</p>
              {{/if}}
            </form>
          {{/if}}

          <ul class="msgr-chats">
            {{#each this.chats key="id" as |chat|}}
              <li>
                <button
                  type="button"
                  class="msgr-chat
                    {{if (eq chat.id this.mesh.activeId) 'is-active'}}
                    {{if chat.unread 'is-unread'}}"
                  style={{tint chat.id}}
                  {{on "click" (fn this.pick chat.id)}}
                >
                  <span
                    class="msgr-avatar msgr-avatar-chat"
                    aria-hidden="true"
                  >{{initials chat.label}}</span>
                  <span class="msgr-chat-body">
                    <span class="msgr-chat-top">
                      <span class="msgr-chat-name">{{chat.label}}</span>
                      <span class="msgr-chat-stamp">{{chat.stamp}}</span>
                    </span>
                    <span class="msgr-chat-bottom">
                      <span class="msgr-chat-last">{{chat.lastText}}</span>
                      {{#if chat.unread}}
                        <span class="msgr-badge">{{chat.unread}}</span>
                      {{/if}}
                    </span>
                  </span>
                </button>
              </li>
            {{else}}
              <li class="msgr-empty-rail">No chats yet. Create one and send
                someone the invite link, or paste a link you were sent.</li>
            {{/each}}
          </ul>

          <div class="msgr-me">
            {{#if (eq this.pane "me")}}
              <form class="msgr-pane" {{on "submit" this.saveMyName}}>
                <input
                  type="text"
                  class="msgr-input"
                  maxlength="40"
                  aria-label="Your name"
                  value={{this.myName}}
                  {{on "input" this.setMyName}}
                  {{focusMe}}
                />
                <button type="submit" class="btn active">Save</button>
              </form>
            {{else}}
              <button
                type="button"
                class="msgr-me-btn"
                style={{tint this.mesh.selfId}}
                {{on "click" (fn this.openPane "me")}}
              >
                <span class="msgr-avatar" aria-hidden="true">{{initials
                    this.mesh.device.name
                  }}</span>
                <span class="msgr-me-body">
                  <span class="msgr-chat-name">{{this.mesh.device.name}}</span>
                  <span class="msgr-chat-last">{{if
                      (eq this.mesh.status "online")
                      "Online"
                      "Offline"
                    }}
                    · this device</span>
                </span>
                <Icon @name="square-pen" @size={{14}} />
              </button>
            {{/if}}
          </div>
        </aside>

        {{! ─── The conversation ──────────────────────────────────── }}
        <section class="msgr-main">
          {{#if this.active}}
            <header class="msgr-head">
              <button
                type="button"
                class="msgr-icon-btn msgr-only-narrow"
                aria-label="Chats"
                {{on "click" this.toggleChats}}
              ><Icon @name="menu" @size={{17}} /></button>
              <span
                class="msgr-avatar msgr-avatar-chat"
                style={{tint this.active.id}}
                aria-hidden="true"
              >{{initials this.active.label}}</span>
              <div class="msgr-head-name">
                <input
                  type="text"
                  class="msgr-title-input"
                  aria-label="Chat name"
                  maxlength="60"
                  value={{this.active.label}}
                  {{on "change" this.renameChat}}
                />
                <span class="msgr-head-sub">{{this.presence}}</span>
              </div>
              <div class="msgr-head-actions">
                <button
                  type="button"
                  class="msgr-icon-btn"
                  title="Voice call"
                  aria-label="Voice call"
                  disabled={{this.call.active}}
                  {{on "click" this.startVoice}}
                ><Icon @name="phone" @size={{17}} /></button>
                <button
                  type="button"
                  class="msgr-icon-btn"
                  title="Video call"
                  aria-label="Video call"
                  disabled={{this.call.active}}
                  {{on "click" this.startVideo}}
                ><Icon @name="video" @size={{17}} /></button>
                <button
                  type="button"
                  class="msgr-icon-btn {{if this.showMembers 'is-on'}}"
                  title="Chat details"
                  aria-label="Chat details"
                  {{on "click" this.toggleMembers}}
                ><Icon @name="users" @size={{17}} /></button>
              </div>
            </header>

            {{#if this.call.incoming}}
              <div class="msgr-ring">
                <Icon @name="bell-ring" @size={{16}} />
                <span><strong>{{this.call.incoming.name}}</strong>
                  is starting a
                  {{if
                    (eq this.call.incoming.mode "video")
                    "video call"
                    "voice call"
                  }}.</span>
                <button
                  type="button"
                  class="btn active"
                  {{on "click" this.accept}}
                >Join</button>
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.decline}}
                >Not now</button>
              </div>
            {{/if}}

            {{#if this.call.active}}
              <div class="msgr-call">
                <div class="msgr-call-head">
                  <span class="msgr-call-title"><Icon
                      @name={{if (eq this.call.mode "video") "video" "phone"}}
                      @size={{14}}
                    />
                    {{this.callTitle}}</span>
                  {{#if this.call.error}}
                    <span class="tool-error">{{this.call.error}}</span>
                  {{/if}}
                </div>
                <div class="msgr-tiles">
                  <div class="msgr-tile is-self">
                    {{#if this.call.localStream}}
                      {{! template-lint-disable require-media-caption }}
                      <video
                        class="msgr-video"
                        autoplay
                        muted
                        playsinline
                        {{playStream this.call.localStream}}
                      ></video>
                    {{/if}}
                    {{#unless this.call.camOn}}
                      {{#unless this.call.sharing}}
                        <span
                          class="msgr-avatar msgr-tile-avatar"
                          style={{tint this.mesh.selfId}}
                        >{{initials this.mesh.device.name}}</span>
                      {{/unless}}
                    {{/unless}}
                    <span class="msgr-tile-name">You{{#unless this.call.micOn}}
                        · muted{{/unless}}</span>
                  </div>
                  {{#each this.call.participants key="device" as |person|}}
                    <div class="msgr-tile">
                      {{! template-lint-disable require-media-caption }}
                      <video
                        class="msgr-video"
                        autoplay
                        playsinline
                        {{playStream person.stream}}
                      ></video>
                      <span class="msgr-tile-name">{{person.name}}</span>
                    </div>
                  {{else}}
                    <div class="msgr-tile is-waiting">
                      <Icon @name="loader-pinwheel" @size={{20}} />
                      <span class="msgr-tile-name">Waiting for someone to join</span>
                    </div>
                  {{/each}}
                </div>
                <div class="msgr-call-bar">
                  <button
                    type="button"
                    class="msgr-call-btn {{unless this.call.micOn 'is-off'}}"
                    {{on "click" this.call.toggleMic}}
                  ><Icon
                      @name={{if this.call.micOn "mic" "mic-off"}}
                      @size={{16}}
                    />
                    {{if this.call.micOn "Mute" "Unmute"}}</button>
                  <button
                    type="button"
                    class="msgr-call-btn {{unless this.call.camOn 'is-off'}}"
                    {{on "click" this.call.toggleCam}}
                  ><Icon
                      @name={{if this.call.camOn "video" "video-off"}}
                      @size={{16}}
                    />
                    {{if this.call.camOn "Camera off" "Camera on"}}</button>
                  {{#if this.call.canShare}}
                    <button
                      type="button"
                      class="msgr-call-btn {{if this.call.sharing 'is-live'}}"
                      {{on "click" this.call.toggleShare}}
                    ><Icon
                        @name={{if
                          this.call.sharing
                          "screen-share-off"
                          "screen-share"
                        }}
                        @size={{16}}
                      />
                      {{if
                        this.call.sharing
                        "Stop sharing"
                        "Share screen"
                      }}</button>
                  {{/if}}
                  <button
                    type="button"
                    class="msgr-call-btn is-end"
                    {{on "click" this.hangUp}}
                  ><Icon @name="phone-off" @size={{16}} /> Leave</button>
                </div>
              </div>
            {{/if}}

            <ol class="msgr-list" {{stickToBottom this.revision}}>
              {{#each this.rows key="id" as |row|}}
                {{#if row.dayLabel}}
                  <li class="msgr-day">{{row.dayLabel}}</li>
                {{/if}}
                {{#if row.callLabel}}
                  <li class="msgr-system"><Icon @name="phone" @size={{12}} />
                    {{if row.mine "You" row.name}}
                    {{row.callLabel}}
                    ·
                    {{row.time}}</li>
                {{else}}
                  <li
                    class="msgr-row
                      {{if row.mine 'is-mine'}}
                      {{if row.grouped 'is-grouped'}}"
                    style={{row.tint}}
                  >
                    {{#unless row.mine}}
                      <span
                        class="msgr-avatar msgr-row-avatar"
                        aria-hidden="true"
                      >{{unless row.grouped row.initials}}</span>
                    {{/unless}}
                    <div class="msgr-bubble-wrap">
                      {{#unless row.grouped}}
                        <span class="msgr-who">{{if
                            row.mine
                            "You"
                            row.name
                          }}<span class="msgr-when">{{row.time}}</span></span>
                      {{/unless}}
                      {{#if row.reply}}
                        <span class="msgr-quote"><strong
                          >{{row.reply.name}}</strong>
                          {{row.reply.text}}</span>
                      {{/if}}
                      {{#if (eq this.editingId row.id)}}
                        <form class="msgr-edit" {{on "submit" this.saveEdit}}>
                          <input
                            type="text"
                            class="msgr-input"
                            maxlength={{this.maxLength}}
                            aria-label="Edit message"
                            value={{this.editDraft}}
                            {{on "input" this.setEditDraft}}
                            {{focusMe}}
                          />
                          <button type="submit" class="btn active">Save</button>
                          <button
                            type="button"
                            class="btn"
                            {{on "click" this.cancelEdit}}
                          >Cancel</button>
                        </form>
                      {{else}}
                        <div class="msgr-bubble {{if row.unsent 'is-unsent'}}">
                          {{#if row.unsent}}
                            <span class="msgr-gone">Message taken back</span>
                          {{else}}
                            {{#if row.image}}
                              <img
                                class="msgr-image"
                                src={{row.image}}
                                alt="Sent in this chat"
                              />
                            {{/if}}
                            {{#if row.file}}
                              <span class="msgr-file">
                                <span class="msgr-file-icon"><Icon
                                    @name="file"
                                    @size={{18}}
                                  /></span>
                                <span class="msgr-file-body">
                                  <span
                                    class="msgr-file-name"
                                  >{{row.file.name}}</span>
                                  <span
                                    class="msgr-file-size"
                                  >{{row.file.label}}{{#if row.file.inline}}
                                      · kept in the chat{{else if
                                      row.file.here
                                    }}
                                      · you have a copy{{/if}}</span>
                                  {{#if row.file.transfer}}
                                    {{#if (eq row.file.transfer.state "going")}}
                                      <span class="msgr-file-bar"><span
                                          class="msgr-file-fill"
                                          style={{barWidth
                                            row.file.transfer.done
                                            row.file.size
                                          }}
                                        ></span></span>
                                      <span class="msgr-file-size">{{formatBytes
                                          row.file.transfer.done
                                        }}
                                        of
                                        {{row.file.label}}</span>
                                    {{else if
                                      (eq row.file.transfer.state "asking")
                                    }}
                                      <span class="msgr-file-size">Looking for
                                        someone who has it…</span>
                                    {{else if row.file.transfer.error}}
                                      <span
                                        class="msgr-file-size is-bad"
                                      >{{row.file.transfer.error}}</span>
                                    {{/if}}
                                  {{/if}}
                                </span>
                                {{#if row.file.inline}}
                                  <a
                                    class="msgr-file-btn"
                                    href={{row.file.inline}}
                                    download={{row.file.name}}
                                    aria-label="Save this file"
                                  ><Icon @name="download" @size={{15}} /></a>
                                {{else}}
                                  <button
                                    type="button"
                                    class="msgr-file-btn"
                                    aria-label="Save this file"
                                    {{on "click" (fn this.download row)}}
                                  ><Icon
                                      @name="download"
                                      @size={{15}}
                                    /></button>
                                {{/if}}
                              </span>
                            {{/if}}
                            {{#if row.text}}
                              <span class="msgr-text">{{row.text}}</span>
                            {{/if}}
                            {{#if row.editedAt}}
                              <span class="msgr-edited">edited</span>
                            {{/if}}
                          {{/if}}
                        </div>
                      {{/if}}

                      {{#if row.reacts.length}}
                        <span class="msgr-reacts">
                          {{#each row.reacts key="emoji" as |group|}}
                            <button
                              type="button"
                              class="msgr-react {{if group.mine 'is-mine'}}"
                              title={{group.who}}
                              {{on "click" (fn this.react row group.emoji)}}
                            >{{group.emoji}}
                              {{group.count}}</button>
                          {{/each}}
                        </span>
                      {{/if}}

                      {{#unless row.unsent}}
                        <span class="msgr-tools">
                          <button
                            type="button"
                            class="msgr-tool"
                            title="React"
                            aria-label="React"
                            {{on "click" (fn this.openReactions row)}}
                          ><Icon @name="smile" @size={{14}} /></button>
                          <button
                            type="button"
                            class="msgr-tool"
                            title="Reply"
                            aria-label="Reply"
                            {{on "click" (fn this.startReply row)}}
                          ><Icon @name="repeat" @size={{14}} /></button>
                          {{#if row.mine}}
                            {{#if row.text}}
                              <button
                                type="button"
                                class="msgr-tool"
                                title="Edit"
                                aria-label="Edit"
                                {{on "click" (fn this.startEdit row)}}
                              ><Icon @name="pen-line" @size={{14}} /></button>
                            {{/if}}
                            <button
                              type="button"
                              class="msgr-tool"
                              title="Take back"
                              aria-label="Take back"
                              {{on "click" (fn this.unsend row)}}
                            ><Icon @name="trash-2" @size={{14}} /></button>
                          {{/if}}
                        </span>
                        {{#if (eq this.reactingId row.id)}}
                          <span class="msgr-react-picker">
                            {{#each this.reactions as |emoji|}}
                              <button
                                type="button"
                                class="msgr-react-pick"
                                {{on "click" (fn this.react row emoji)}}
                              >{{emoji}}</button>
                            {{/each}}
                          </span>
                        {{/if}}
                      {{/unless}}
                    </div>
                  </li>
                {{/if}}
              {{else}}
                <li class="msgr-empty">
                  <Icon @name="message-circle" @size={{22}} />
                  <p>Nothing here yet. Send the invite link to whoever should be
                    in this chat, then say something.</p>
                </li>
              {{/each}}
            </ol>

            <div class="msgr-foot">
              {{#if this.typingLine}}
                <span class="msgr-typing">{{this.typingLine}}</span>
              {{/if}}
              {{#if this.replyPreview}}
                <div class="msgr-replying">
                  <span>Replying to
                    <strong>{{this.replyPreview.name}}</strong>:
                    {{this.replyPreview.text}}</span>
                  <button
                    type="button"
                    class="msgr-tool"
                    aria-label="Stop replying"
                    {{on "click" this.cancelReply}}
                  ><Icon @name="x" @size={{14}} /></button>
                </div>
              {{/if}}
              {{#if this.attachError}}
                <p class="tool-error">{{this.attachError}}</p>
              {{/if}}
              {{#if this.attachment}}
                <div class="msgr-attached">
                  <img src={{this.attachment}} alt="Attached, not yet sent" />
                  <button
                    type="button"
                    class="msgr-tool"
                    aria-label="Remove the picture"
                    {{on "click" this.clearAttachment}}
                  ><Icon @name="x" @size={{14}} /></button>
                </div>
              {{/if}}
              {{#if this.pendingFile}}
                <div class="msgr-attached">
                  <Icon @name="file" @size={{16}} />
                  <span>{{this.pendingFileLabel}}</span>
                  <button
                    type="button"
                    class="msgr-tool"
                    aria-label="Remove the file"
                    {{on "click" this.clearAttachment}}
                  ><Icon @name="x" @size={{14}} /></button>
                </div>
              {{/if}}
              {{#each this.sending key="tid" as |transfer|}}
                <div class="msgr-sending">
                  <span>Sending
                    {{transfer.name}}
                    ·
                    {{formatBytes transfer.done}}
                    of
                    {{formatBytes transfer.size}}</span>
                  <span class="msgr-file-bar"><span
                      class="msgr-file-fill"
                      style={{barWidth transfer.done transfer.size}}
                    ></span></span>
                </div>
              {{/each}}
              <form class="msgr-composer" {{on "submit" this.send}}>
                <span class="msgr-icon-btn" title="Send a picture or a file">
                  <Icon @name="upload" @size={{17}} />
                  <input
                    type="file"
                    class="msgr-file-input"
                    aria-label="Send a picture or a file"
                    {{on "change" this.attach}}
                  />
                </span>
                <textarea
                  class="msgr-draft"
                  rows="1"
                  placeholder="Write a message"
                  maxlength={{this.maxLength}}
                  aria-label="Message"
                  value={{this.draft}}
                  {{on "input" this.setDraft}}
                  {{on "keydown" this.onKey}}
                ></textarea>
                <button
                  type="submit"
                  class="msgr-send"
                  aria-label="Send"
                  disabled={{if this.canSend false true}}
                ><Icon @name="send" @size={{16}} /></button>
              </form>
              <p class="msgr-status">{{this.statusLine}}</p>
            </div>
          {{else}}
            <div class="msgr-blank">
              <Icon @name="message-circle" @size={{26}} />
              <h3>No chat open</h3>
              <p>Create a chat and send people its invite link, or paste a link
                someone sent you. Nothing is uploaded: a chat lives on the
                devices of the people in it, and any two of them that are online
                at the same time bring each other up to date.</p>
              <div class="tool-controls">
                <button
                  type="button"
                  class="btn active"
                  {{on "click" (fn this.openPane "new")}}
                ><Icon @name="plus" @size={{13}} /> New chat</button>
                <button
                  type="button"
                  class="btn"
                  {{on "click" (fn this.openPane "join")}}
                ><Icon @name="link" @size={{13}} /> Join with a link</button>
              </div>
            </div>
          {{/if}}
        </section>

        {{! ─── Details ──────────────────────────────────────────── }}
        {{#if this.showMembers}}
          <aside class="msgr-people" aria-label="Chat details">
            <div class="msgr-rail-head">
              <h3 class="msgr-rail-title">Chat details</h3>
              <button
                type="button"
                class="msgr-icon-btn"
                aria-label="Close the details"
                {{on "click" this.toggleMembers}}
              ><Icon @name="x" @size={{16}} /></button>
            </div>
            <div class="msgr-people-body">
              <h4 class="msgr-side-title">Invite link</h4>
              <p class="msgr-side-hint">Anyone with this link can read and write
                in this chat, so send it the way you would a key. The secret is
                in the part after the #, which browsers never send to a server.</p>
              <div class="msgr-invite-row">
                <input
                  type="text"
                  class="msgr-input"
                  readonly
                  aria-label="This chat's invite link"
                  value={{this.inviteUrl}}
                />
                <CopyButton @value={{this.inviteUrl}} />
              </div>

              <h4 class="msgr-side-title">In this chat ({{this.members.length}})</h4>
              <ul class="msgr-member-list">
                {{#each this.members key="id" as |member|}}
                  <li style={{member.tint}}>
                    <span
                      class="msgr-avatar"
                      aria-hidden="true"
                    >{{member.initials}}</span>
                    <span class="msgr-member-body">
                      <span class="msgr-chat-name">{{member.name}}{{#if
                          member.you
                        }} (you){{/if}}</span>
                      <span class="msgr-chat-last">{{if
                          member.online
                          "Online"
                          "Offline"
                        }}</span>
                    </span>
                    <span
                      class="msgr-dot {{if member.online 'is-on'}}"
                      aria-hidden="true"
                    ></span>
                  </li>
                {{/each}}
              </ul>

              <h4 class="msgr-side-title">Files</h4>
              <p class="msgr-side-hint">Files up to
                {{this.maxFile}}
                go straight from one device to another when somebody asks for
                them, so nothing is uploaded anywhere. Small ones ride along
                inside the chat and are always there; for the big ones, someone
                who has a copy has to be online.</p>
              {{#if (any this.files.transfers)}}
                <ul class="msgr-transfers">
                  {{#each this.files.transfers key="tid" as |transfer|}}
                    <li>
                      <span class="msgr-chat-name">{{transfer.name}}</span>
                      <span class="msgr-chat-last">
                        {{if (eq transfer.way "out") "Sent" "Received"}}
                        ·
                        {{#if (eq transfer.state "done")}}
                          finished
                        {{else if (eq transfer.state "failed")}}
                          stopped
                        {{else}}
                          {{formatBytes transfer.done}}
                          of
                          {{formatBytes transfer.size}}
                        {{/if}}
                      </span>
                    </li>
                  {{/each}}
                </ul>
                <button
                  type="button"
                  class="btn"
                  {{on "click" this.files.clearFinished}}
                >Clear the finished ones</button>
              {{else}}
                <p class="msgr-side-hint">No transfers yet.</p>
              {{/if}}

              <h4 class="msgr-side-title">Leaving</h4>
              <button
                type="button"
                class="btn"
                {{on "click" this.leaveChat}}
              ><Icon @name="log-out" @size={{13}} /> Leave this chat</button>
            </div>
          </aside>
        {{/if}}
      </div>
    </ToolPage>
  </template>
}
