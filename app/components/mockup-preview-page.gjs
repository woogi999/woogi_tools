import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import { snapshot, fileToDataUrl } from '../utils/snapshot-dom';
import { keepState } from '../utils/tool-state';

// See a post the way it will really look on each network before you post it:
// Facebook, X, Instagram, YouTube, TikTok, LinkedIn, Reddit and Threads, in
// light and dark, drawn to each one's own layout, type and colours.

const PLATFORMS = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'x', label: 'X' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'threads', label: 'Threads' },
];
const eq = (a, b) => a === b;
const bg = (url) => htmlSafe(url ? `background-image:url(${url})` : '');
const compact = (n) =>
  Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(n) || 0);
const full = (n) => (Number(n) || 0).toLocaleString('en');
const initial = (name) => (name?.trim()[0] ?? 'W').toUpperCase();

// Text with #hashtags and @mentions coloured the way each network does it.
function markUp(text, { hashClass = 'mk-link' } = {}) {
  const escaped = text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br>')
    .replace(/(^|\s)([#@][\w]+)/g, `$1<span class="${hashClass}">$2</span>`);
  return htmlSafe(escaped);
}

export default class MockupPreviewPage extends Component {
  @tracked platform = 'x';
  @tracked dark = false;
  @tracked name = 'Woogi Tools';
  @tracked handle = 'woogitools';
  @tracked verified = true;
  @tracked text =
    'Just shipped a bunch of new tools. Try the Mockup Preview to see your post before you post it. #buildinpublic';
  @tracked when = '2h';
  @tracked likes = 1284;
  @tracked comments = 96;
  @tracked shares = 212;
  @tracked views = 48200;
  @tracked avatar = null;
  @tracked image = null;
  @tracked title = 'I built 15 tools in one weekend (here’s what happened)';
  @tracked duration = '12:34';
  @tracked busy = false;
  @tracked error = null;
  @tracked pngUrl = null;

  platforms = PLATFORMS;
  card = null;

  constructor(owner, args) {
    super(owner, args);
    keepState(this, 'mockup-preview', [
      'platform',
      'dark',
      'name',
      'handle',
      'verified',
      'text',
      'when',
      'likes',
      'comments',
      'shares',
      'views',
      'title',
      'duration',
    ]);
    registerDestructor(this, () => {
      if (this.pngUrl) URL.revokeObjectURL(this.pngUrl);
    });
  }

  get is() {
    return Object.fromEntries(
      PLATFORMS.map((p) => [p.id, p.id === this.platform]),
    );
  }

  get body() {
    return markUp(this.text);
  }

  get counts() {
    return {
      likes: compact(this.likes),
      comments: compact(this.comments),
      shares: compact(this.shares),
      views: compact(this.views),
      likesFull: full(this.likes),
      commentsFull: full(this.comments),
      sharesFull: full(this.shares),
      viewsFull: full(this.views),
    };
  }

  get avatarStyle() {
    return bg(this.avatar);
  }

  get imageStyle() {
    return bg(this.image);
  }

  get initial() {
    return initial(this.name);
  }

  get fileName() {
    return `${this.platform}-mockup${this.dark ? '-dark' : ''}.png`;
  }

  bindCard = modifier((element) => {
    this.card = element;
    return () => (this.card = null);
  });

  pick = (key, value) => (this[key] = value);
  setText = (key, event) => (this[key] = event.target.value);
  number = (key, event) =>
    (this[key] = Math.max(0, Math.floor(Number(event.target.value)) || 0));
  toggle = (key, event) => (this[key] = event.target.checked);

  loadPicture = async (key, event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file?.type.startsWith('image/')) return;
    // Data URLs, not blob ones: the PNG export can only draw those.
    this[key] = await fileToDataUrl(file);
  };

  clearPicture = (key) => (this[key] = null);

  save = async () => {
    if (!this.card || this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const blob = await snapshot(this.card, { scale: 2 });
      if (this.pngUrl) URL.revokeObjectURL(this.pngUrl);
      this.pngUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = this.pngUrl;
      link.download = this.fileName;
      link.click();
    } catch (error) {
      this.error = error?.message ?? 'Couldn’t save the mockup';
    } finally {
      this.busy = false;
    }
  };

  <template>
    <ToolPage
      @route="mockup-preview"
      @subtitle="See a post the way it will actually look on Facebook, X, Instagram, YouTube, TikTok, LinkedIn, Reddit or Threads before you post it, in light or dark, and save the mockup as a picture."
    >
      <div class="ie-layout mk-layout pop-in">
        <div class="mk-stage">
          <div class="cipher-picks" role="tablist" aria-label="Network">
            {{#each this.platforms as |p|}}
              <button
                type="button"
                role="tab"
                class="qr-tab {{if (eq this.platform p.id) 'active'}}"
                aria-selected={{if (eq this.platform p.id) "true" "false"}}
                {{on "click" (fn this.pick "platform" p.id)}}
              >{{p.label}}</button>
            {{/each}}
          </div>

          <div class="mk-canvas {{if this.dark 'is-dark'}}">
            <div
              class="mk-card mk-{{this.platform}} {{if this.dark 'is-dark'}}"
              {{this.bindCard}}
            >

              {{#if this.is.facebook}}
                <div class="fb-head">
                  <div
                    class="mk-avatar fb-avatar"
                    style={{this.avatarStyle}}
                  >{{unless this.avatar this.initial}}</div>
                  <div class="fb-who">
                    <div class="fb-name">{{this.name}}{{#if this.verified}}<span
                          class="fb-verified"
                          aria-label="Verified"
                        ></span>{{/if}}</div>
                    <div class="fb-meta">{{this.when}}
                      ·
                      <span class="fb-globe"></span></div>
                  </div>
                  <div class="fb-dots">···</div>
                </div>
                <div class="fb-text">{{this.body}}</div>
                {{#if this.image}}<div
                    class="mk-image fb-image"
                    style={{this.imageStyle}}
                  ></div>{{/if}}
                <div class="fb-counts">
                  <span><span class="fb-react fb-like"></span><span
                      class="fb-react fb-love"
                    ></span>{{this.counts.likesFull}}</span>
                  <span>{{this.counts.comments}}
                    comments ·
                    {{this.counts.shares}}
                    shares</span>
                </div>
                <div class="fb-actions">
                  <span>👍 Like</span><span>💬 Comment</span><span>↪ Share</span>
                </div>
              {{/if}}

              {{#if this.is.x}}
                <div class="x-row">
                  <div
                    class="mk-avatar x-avatar"
                    style={{this.avatarStyle}}
                  >{{unless this.avatar this.initial}}</div>
                  <div class="x-main">
                    <div class="x-head">
                      <span class="x-name">{{this.name}}</span>
                      {{#if this.verified}}<span
                          class="x-verified"
                          aria-label="Verified"
                        ></span>{{/if}}
                      <span class="x-handle">@{{this.handle}}
                        ·
                        {{this.when}}</span>
                      <span class="x-dots">···</span>
                    </div>
                    <div class="x-text">{{this.body}}</div>
                    {{#if this.image}}<div
                        class="mk-image x-image"
                        style={{this.imageStyle}}
                      ></div>{{/if}}
                    <div class="x-actions">
                      <span>💬 {{this.counts.comments}}</span>
                      <span>🔁 {{this.counts.shares}}</span>
                      <span>♡ {{this.counts.likes}}</span>
                      <span>📊 {{this.counts.views}}</span>
                      <span>🔖 ↗</span>
                    </div>
                  </div>
                </div>
              {{/if}}

              {{#if this.is.instagram}}
                <div class="ig-head">
                  <div class="ig-ring"><div
                      class="mk-avatar ig-avatar"
                      style={{this.avatarStyle}}
                    >{{unless this.avatar this.initial}}</div></div>
                  <div class="ig-who"><span
                      class="ig-name"
                    >{{this.handle}}</span>{{#if this.verified}}<span
                        class="ig-verified"
                      ></span>{{/if}}<span class="ig-when">·
                      {{this.when}}</span></div>
                  <span class="ig-dots">···</span>
                </div>
                <div
                  class="mk-image ig-image"
                  style={{this.imageStyle}}
                >{{unless this.image "Add a picture"}}</div>
                <div class="ig-actions"><span>♡</span><span>💬</span><span
                  >➤</span><span class="ig-save">🔖</span></div>
                <div class="ig-likes">{{this.counts.likesFull}} likes</div>
                <div class="ig-caption"><span
                    class="ig-name"
                  >{{this.handle}}</span>
                  {{this.body}}</div>
                <div class="ig-comments">View all
                  {{this.counts.commentsFull}}
                  comments</div>
              {{/if}}

              {{#if this.is.youtube}}
                <div class="yt-thumb" style={{this.imageStyle}}>
                  {{unless this.image "Thumbnail (16:9)"}}
                  <span class="yt-duration">{{this.duration}}</span>
                </div>
                <div class="yt-row">
                  <div
                    class="mk-avatar yt-avatar"
                    style={{this.avatarStyle}}
                  >{{unless this.avatar this.initial}}</div>
                  <div class="yt-info">
                    <div class="yt-title">{{this.title}}</div>
                    <div class="yt-meta">{{this.name}}{{#if this.verified}}<span
                          class="yt-verified"
                        ></span>{{/if}}</div>
                    <div class="yt-meta">{{this.counts.views}}
                      views ·
                      {{this.when}}
                      ago</div>
                  </div>
                  <div class="yt-dots">⋮</div>
                </div>
              {{/if}}

              {{#if this.is.tiktok}}
                <div class="tt-video" style={{this.imageStyle}}>
                  <div class="tt-side">
                    <div
                      class="mk-avatar tt-avatar"
                      style={{this.avatarStyle}}
                    >{{unless this.avatar this.initial}}</div>
                    <span class="tt-plus">+</span>
                    <div class="tt-stat"><span
                        class="tt-icon"
                      >♥</span>{{this.counts.likes}}</div>
                    <div class="tt-stat"><span
                        class="tt-icon"
                      >💬</span>{{this.counts.comments}}</div>
                    <div class="tt-stat"><span
                        class="tt-icon"
                      >🔖</span>{{this.counts.views}}</div>
                    <div class="tt-stat"><span
                        class="tt-icon"
                      >➤</span>{{this.counts.shares}}</div>
                  </div>
                  <div class="tt-bottom">
                    <div class="tt-name">@{{this.handle}}{{#if
                        this.verified
                      }}<span class="tt-verified"></span>{{/if}}</div>
                    <div class="tt-text">{{this.body}}</div>
                    <div class="tt-sound">♫ original sound - {{this.name}}</div>
                  </div>
                </div>
              {{/if}}

              {{#if this.is.linkedin}}
                <div class="li-head">
                  <div
                    class="mk-avatar li-avatar"
                    style={{this.avatarStyle}}
                  >{{unless this.avatar this.initial}}</div>
                  <div class="li-who">
                    <div class="li-name">{{this.name}}{{#if this.verified}}<span
                          class="li-verified"
                        ></span>{{/if}}
                      <span class="li-degree">· 1st</span></div>
                    <div class="li-meta">{{this.title}}</div>
                    <div class="li-meta">{{this.when}}
                      ·
                      <span class="li-globe"></span></div>
                  </div>
                  <div class="li-follow">+ Follow</div>
                </div>
                <div class="li-text">{{this.body}}</div>
                {{#if this.image}}<div
                    class="mk-image li-image"
                    style={{this.imageStyle}}
                  ></div>{{/if}}
                <div class="li-counts"><span><span
                      class="li-react"
                    ></span>{{this.counts.likesFull}}</span><span
                  >{{this.counts.comments}}
                    comments ·
                    {{this.counts.shares}}
                    reposts</span></div>
                <div class="li-actions"><span>👍 Like</span><span>💬 Comment</span><span
                  >🔁 Repost</span><span>➤ Send</span></div>
              {{/if}}

              {{#if this.is.reddit}}
                <div class="rd-head">
                  <div
                    class="mk-avatar rd-avatar"
                    style={{this.avatarStyle}}
                  >{{unless this.avatar this.initial}}</div>
                  <span class="rd-sub">r/{{this.handle}}</span>
                  <span class="rd-meta">· {{this.when}}</span>
                  <span class="rd-join">Join</span>
                </div>
                <div class="rd-title">{{this.title}}</div>
                <div class="rd-text">{{this.body}}</div>
                {{#if this.image}}<div
                    class="mk-image rd-image"
                    style={{this.imageStyle}}
                  ></div>{{/if}}
                <div class="rd-actions">
                  <span class="rd-pill">▲ {{this.counts.likes}} ▼</span>
                  <span class="rd-pill">💬 {{this.counts.comments}}</span>
                  <span class="rd-pill">↗ Share</span>
                </div>
              {{/if}}

              {{#if this.is.threads}}
                <div class="x-row">
                  <div
                    class="mk-avatar th-avatar"
                    style={{this.avatarStyle}}
                  >{{unless this.avatar this.initial}}</div>
                  <div class="x-main">
                    <div class="th-head"><span
                        class="th-name"
                      >{{this.handle}}</span>{{#if this.verified}}<span
                          class="ig-verified"
                        ></span>{{/if}}<span
                        class="th-when"
                      >{{this.when}}</span><span class="x-dots">···</span></div>
                    <div class="th-text">{{this.body}}</div>
                    {{#if this.image}}<div
                        class="mk-image th-image"
                        style={{this.imageStyle}}
                      ></div>{{/if}}
                    <div class="th-actions"><span>♡
                        {{this.counts.likes}}</span><span>💬
                        {{this.counts.comments}}</span><span>🔁
                        {{this.counts.shares}}</span><span>➤</span></div>
                  </div>
                </div>
              {{/if}}

            </div>
          </div>

          <div class="fc-toolbar">
            <label class="math-check"><input
                type="checkbox"
                checked={{this.dark}}
                {{on "change" (fn this.toggle "dark")}}
              />
              Dark mode</label>
            <div class="settings-actions">
              <button
                type="button"
                class="btn active"
                disabled={{this.busy}}
                {{on "click" this.save}}
              ><Icon @name="download" @size={{13}} />
                {{if this.busy "Drawing…" "Save as PNG"}}</button>
            </div>
          </div>
          {{#if this.error}}<p class="tool-error">{{this.error}}</p>{{/if}}
        </div>

        <aside class="ie-panel">
          <div class="math-row">
            <label class="math-field"><span class="qr-label is-muted">Display
                name</span><input
                type="text"
                class="math-input"
                value={{this.name}}
                {{on "input" (fn this.setText "name")}}
              /></label>
            <label class="math-field"><span
                class="qr-label is-muted"
              >Handle</span><input
                type="text"
                class="math-input"
                value={{this.handle}}
                {{on "input" (fn this.setText "handle")}}
              /></label>
          </div>
          <label class="math-check"><input
              type="checkbox"
              checked={{this.verified}}
              {{on "change" (fn this.toggle "verified")}}
            />
            Verified badge</label>
          <label class="math-field"><span class="qr-label is-muted">Post text</span><textarea
              class="textarea"
              rows="4"
              value={{this.text}}
              {{on "input" (fn this.setText "text")}}
            ></textarea></label>
          <label class="math-field"><span class="qr-label is-muted">Title
              (YouTube, LinkedIn headline, Reddit)</span><input
              type="text"
              class="math-input"
              value={{this.title}}
              {{on "input" (fn this.setText "title")}}
            /></label>
          <div class="math-row">
            <label class="math-field"><span
                class="qr-label is-muted"
              >When</span><input
                type="text"
                class="math-input"
                value={{this.when}}
                {{on "input" (fn this.setText "when")}}
              /></label>
            <label class="math-field"><span class="qr-label is-muted">Video
                length</span><input
                type="text"
                class="math-input"
                value={{this.duration}}
                {{on "input" (fn this.setText "duration")}}
              /></label>
          </div>
          <div class="math-row">
            <label class="math-field"><span
                class="qr-label is-muted"
              >Likes</span><input
                type="number"
                class="math-input"
                min="0"
                value={{this.likes}}
                {{on "input" (fn this.number "likes")}}
              /></label>
            <label class="math-field"><span
                class="qr-label is-muted"
              >Comments</span><input
                type="number"
                class="math-input"
                min="0"
                value={{this.comments}}
                {{on "input" (fn this.number "comments")}}
              /></label>
          </div>
          <div class="math-row">
            <label class="math-field"><span
                class="qr-label is-muted"
              >Shares</span><input
                type="number"
                class="math-input"
                min="0"
                value={{this.shares}}
                {{on "input" (fn this.number "shares")}}
              /></label>
            <label class="math-field"><span
                class="qr-label is-muted"
              >Views</span><input
                type="number"
                class="math-input"
                min="0"
                value={{this.views}}
                {{on "input" (fn this.number "views")}}
              /></label>
          </div>
          <div class="settings-actions">
            <label class="btn"><Icon @name="image-plus" @size={{13}} />
              Avatar<input
                type="file"
                accept="image/*"
                class="sr-only"
                {{on "change" (fn this.loadPicture "avatar")}}
              /></label>
            {{#if this.avatar}}<button
                type="button"
                class="btn"
                {{on "click" (fn this.clearPicture "avatar")}}
              >Remove</button>{{/if}}
          </div>
          <div class="settings-actions">
            <label class="btn"><Icon @name="image-plus" @size={{13}} />
              Picture / thumbnail<input
                type="file"
                accept="image/*"
                class="sr-only"
                {{on "change" (fn this.loadPicture "image")}}
              /></label>
            {{#if this.image}}<button
                type="button"
                class="btn"
                {{on "click" (fn this.clearPicture "image")}}
              >Remove</button>{{/if}}
          </div>
          <p class="tool-hint">Layouts follow each network's current web design:
            type sizes, spacing, badge shapes and colours. They're mockups, so
            the buttons don't do anything.</p>
        </aside>
      </div>
    </ToolPage>
  </template>
}
