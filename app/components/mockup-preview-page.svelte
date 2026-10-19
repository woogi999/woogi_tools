<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import { snapshot, fileToDataUrl } from '../utils/snapshot-dom.js';
  import { keepState } from '../utils/tool-state.js';

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
  const bg = (url) => (url ? `background-image:url(${url})` : '');
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
    return escaped;
  }

  class MockupPreviewPage extends Component {
    platform = $state.raw('x');
    dark = $state.raw(false);
    name = $state.raw('Woogi Tools');
    handle = $state.raw('woogitools');
    verified = $state.raw(true);
    text = $state.raw(
      'Just shipped a bunch of new tools. Try the Mockup Preview to see your post before you post it. #buildinpublic',
    );
    when = $state.raw('2h');
    likes = $state.raw(1284);
    comments = $state.raw(96);
    shares = $state.raw(212);
    views = $state.raw(48200);
    avatar = $state.raw(null);
    image = $state.raw(null);
    title = $state.raw(
      'I built 15 tools in one weekend (here’s what happened)',
    );
    duration = $state.raw('12:34');
    busy = $state.raw(false);
    error = $state.raw(null);
    pngUrl = $state.raw(null);

    platforms = PLATFORMS;
    card = null;

    constructor(args) {
      super(args);
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
  }
</script>

<script>
  let args = $props();
  const self = new MockupPreviewPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="mockup-preview"
  busy={self.busy}
  closeWarning="Close Mockup Preview? The mockup being saved will be lost."
  subtitle="See a post the way it will actually look on Facebook, X, Instagram, YouTube, TikTok, LinkedIn, Reddit or Threads before you post it, in light or dark, and save the mockup as a picture."
>
  <div class="ie-layout mk-layout pop-in">
    <div class="mk-stage">
      <div class="cipher-picks" role="tablist" aria-label="Network">
        {#each self.platforms ?? [] as p}
          <button
            type="button"
            role="tab"
            class="qr-tab {truthy(eq(self.platform, p?.id)) ? 'active' : ''}"
            aria-selected={truthy(eq(self.platform, p?.id)) ? 'true' : 'false'}
            onclick={(..._r) => self.pick('platform', p?.id, ..._r)}
            >{p?.label}</button
          >
        {/each}
      </div>

      <div class="mk-canvas {truthy(self.dark) ? 'is-dark' : ''}">
        <div
          class="mk-card mk-{self.platform} {truthy(self.dark)
            ? 'is-dark'
            : ''}"
          {@attach self.bindCard?.()}
        >
          {#if truthy(self.is?.facebook)}
            <div class="fb-head">
              <div class="mk-avatar fb-avatar" style={self.avatarStyle}
                >{!truthy(self.avatar) ? self.initial : ''}</div
              >
              <div class="fb-who">
                <div class="fb-name"
                  >{self.name}{#if truthy(self.verified)}<span
                      class="fb-verified"
                      aria-label="Verified"
                    ></span>{/if}</div
                >
                <div class="fb-meta"
                  >{self.when}
                  ·
                  <span class="fb-globe"></span></div
                >
              </div>
              <div class="fb-dots">···</div>
            </div>
            <div class="fb-text">{@html self.body}</div>
            {#if truthy(self.image)}<div
                class="mk-image fb-image"
                style={self.imageStyle}
              ></div>{/if}
            <div class="fb-counts">
              <span
                ><span class="fb-react fb-like"></span><span
                  class="fb-react fb-love"
                ></span>{self.counts?.likesFull}</span
              >
              <span
                >{self.counts?.comments}
                comments ·
                {self.counts?.shares}
                shares</span
              >
            </div>
            <div class="fb-actions">
              <span>👍 Like</span><span>💬 Comment</span><span>↪ Share</span>
            </div>
          {/if}

          {#if truthy(self.is?.x)}
            <div class="x-row">
              <div class="mk-avatar x-avatar" style={self.avatarStyle}
                >{!truthy(self.avatar) ? self.initial : ''}</div
              >
              <div class="x-main">
                <div class="x-head">
                  <span class="x-name">{self.name}</span>
                  {#if truthy(self.verified)}<span
                      class="x-verified"
                      aria-label="Verified"
                    ></span>{/if}
                  <span class="x-handle"
                    >@{self.handle}
                    ·
                    {self.when}</span
                  >
                  <span class="x-dots">···</span>
                </div>
                <div class="x-text">{@html self.body}</div>
                {#if truthy(self.image)}<div
                    class="mk-image x-image"
                    style={self.imageStyle}
                  ></div>{/if}
                <div class="x-actions">
                  <span>💬 {self.counts?.comments}</span>
                  <span>🔁 {self.counts?.shares}</span>
                  <span>♡ {self.counts?.likes}</span>
                  <span>📊 {self.counts?.views}</span>
                  <span>🔖 ↗</span>
                </div>
              </div>
            </div>
          {/if}

          {#if truthy(self.is?.instagram)}
            <div class="ig-head">
              <div class="ig-ring"
                ><div class="mk-avatar ig-avatar" style={self.avatarStyle}
                  >{!truthy(self.avatar) ? self.initial : ''}</div
                ></div
              >
              <div class="ig-who"
                ><span class="ig-name">{self.handle}</span
                >{#if truthy(self.verified)}<span class="ig-verified"
                  ></span>{/if}<span class="ig-when"
                  >·
                  {self.when}</span
                ></div
              >
              <span class="ig-dots">···</span>
            </div>
            <div class="mk-image ig-image" style={self.imageStyle}
              >{!truthy(self.image) ? 'Add a picture' : ''}</div
            >
            <div class="ig-actions"
              ><span>♡</span><span>💬</span><span>➤</span><span class="ig-save"
                >🔖</span
              ></div
            >
            <div class="ig-likes">{self.counts?.likesFull} likes</div>
            <div class="ig-caption"
              ><span class="ig-name">{self.handle}</span>
              {@html self.body}</div
            >
            <div class="ig-comments"
              >View all
              {self.counts?.commentsFull}
              comments</div
            >
          {/if}

          {#if truthy(self.is?.youtube)}
            <div class="yt-thumb" style={self.imageStyle}>
              {!truthy(self.image) ? 'Thumbnail (16:9)' : ''}
              <span class="yt-duration">{self.duration}</span>
            </div>
            <div class="yt-row">
              <div class="mk-avatar yt-avatar" style={self.avatarStyle}
                >{!truthy(self.avatar) ? self.initial : ''}</div
              >
              <div class="yt-info">
                <div class="yt-title">{self.title}</div>
                <div class="yt-meta"
                  >{self.name}{#if truthy(self.verified)}<span
                      class="yt-verified"
                    ></span>{/if}</div
                >
                <div class="yt-meta"
                  >{self.counts?.views}
                  views ·
                  {self.when}
                  ago</div
                >
              </div>
              <div class="yt-dots">⋮</div>
            </div>
          {/if}

          {#if truthy(self.is?.tiktok)}
            <div class="tt-video" style={self.imageStyle}>
              <div class="tt-side">
                <div class="mk-avatar tt-avatar" style={self.avatarStyle}
                  >{!truthy(self.avatar) ? self.initial : ''}</div
                >
                <span class="tt-plus">+</span>
                <div class="tt-stat"
                  ><span class="tt-icon">♥</span>{self.counts?.likes}</div
                >
                <div class="tt-stat"
                  ><span class="tt-icon">💬</span>{self.counts?.comments}</div
                >
                <div class="tt-stat"
                  ><span class="tt-icon">🔖</span>{self.counts?.views}</div
                >
                <div class="tt-stat"
                  ><span class="tt-icon">➤</span>{self.counts?.shares}</div
                >
              </div>
              <div class="tt-bottom">
                <div class="tt-name"
                  >@{self.handle}{#if truthy(self.verified)}<span
                      class="tt-verified"
                    ></span>{/if}</div
                >
                <div class="tt-text">{@html self.body}</div>
                <div class="tt-sound">♫ original sound - {self.name}</div>
              </div>
            </div>
          {/if}

          {#if truthy(self.is?.linkedin)}
            <div class="li-head">
              <div class="mk-avatar li-avatar" style={self.avatarStyle}
                >{!truthy(self.avatar) ? self.initial : ''}</div
              >
              <div class="li-who">
                <div class="li-name"
                  >{self.name}{#if truthy(self.verified)}<span
                      class="li-verified"
                    ></span>{/if}
                  <span class="li-degree">· 1st</span></div
                >
                <div class="li-meta">{self.title}</div>
                <div class="li-meta"
                  >{self.when}
                  ·
                  <span class="li-globe"></span></div
                >
              </div>
              <div class="li-follow">+ Follow</div>
            </div>
            <div class="li-text">{@html self.body}</div>
            {#if truthy(self.image)}<div
                class="mk-image li-image"
                style={self.imageStyle}
              ></div>{/if}
            <div class="li-counts"
              ><span
                ><span class="li-react"></span>{self.counts?.likesFull}</span
              ><span
                >{self.counts?.comments}
                comments ·
                {self.counts?.shares}
                reposts</span
              ></div
            >
            <div class="li-actions"
              ><span>👍 Like</span><span>💬 Comment</span><span>🔁 Repost</span
              ><span>➤ Send</span></div
            >
          {/if}

          {#if truthy(self.is?.reddit)}
            <div class="rd-head">
              <div class="mk-avatar rd-avatar" style={self.avatarStyle}
                >{!truthy(self.avatar) ? self.initial : ''}</div
              >
              <span class="rd-sub">r/{self.handle}</span>
              <span class="rd-meta">· {self.when}</span>
              <span class="rd-join">Join</span>
            </div>
            <div class="rd-title">{self.title}</div>
            <div class="rd-text">{@html self.body}</div>
            {#if truthy(self.image)}<div
                class="mk-image rd-image"
                style={self.imageStyle}
              ></div>{/if}
            <div class="rd-actions">
              <span class="rd-pill">▲ {self.counts?.likes} ▼</span>
              <span class="rd-pill">💬 {self.counts?.comments}</span>
              <span class="rd-pill">↗ Share</span>
            </div>
          {/if}

          {#if truthy(self.is?.threads)}
            <div class="x-row">
              <div class="mk-avatar th-avatar" style={self.avatarStyle}
                >{!truthy(self.avatar) ? self.initial : ''}</div
              >
              <div class="x-main">
                <div class="th-head"
                  ><span class="th-name">{self.handle}</span
                  >{#if truthy(self.verified)}<span class="ig-verified"
                    ></span>{/if}<span class="th-when">{self.when}</span><span
                    class="x-dots">···</span
                  ></div
                >
                <div class="th-text">{@html self.body}</div>
                {#if truthy(self.image)}<div
                    class="mk-image th-image"
                    style={self.imageStyle}
                  ></div>{/if}
                <div class="th-actions"
                  ><span
                    >♡
                    {self.counts?.likes}</span
                  ><span
                    >💬
                    {self.counts?.comments}</span
                  ><span
                    >🔁
                    {self.counts?.shares}</span
                  ><span>➤</span></div
                >
              </div>
            </div>
          {/if}
        </div>
      </div>

      <div class="fc-toolbar">
        <label class="math-check"
          ><input
            type="checkbox"
            {@attach prop('checked', () => self.dark)}
            onchange={(..._r) => self.toggle('dark', ..._r)}
          />
          Dark mode</label
        >
        <div class="settings-actions">
          <button
            type="button"
            class="btn active"
            disabled={self.busy}
            onclick={self.save}
            ><Icon name="download" size={13} />
            {truthy(self.busy) ? 'Drawing…' : 'Save as PNG'}</button
          >
        </div>
      </div>
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}
    </div>

    <aside class="ie-panel">
      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted">Display name</span><input
            type="text"
            class="math-input"
            {@attach prop('value', () => self.name)}
            oninput={(..._r) => self.setText('name', ..._r)}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Handle</span><input
            type="text"
            class="math-input"
            {@attach prop('value', () => self.handle)}
            oninput={(..._r) => self.setText('handle', ..._r)}
          /></label
        >
      </div>
      <label class="math-check"
        ><input
          type="checkbox"
          {@attach prop('checked', () => self.verified)}
          onchange={(..._r) => self.toggle('verified', ..._r)}
        />
        Verified badge</label
      >
      <label class="math-field"
        ><span class="qr-label is-muted">Post text</span><textarea
          class="textarea"
          rows="4"
          {@attach prop('value', () => self.text)}
          oninput={(..._r) => self.setText('text', ..._r)}></textarea></label
      >
      <label class="math-field"
        ><span class="qr-label is-muted"
          >Title (YouTube, LinkedIn headline, Reddit)</span
        ><input
          type="text"
          class="math-input"
          {@attach prop('value', () => self.title)}
          oninput={(..._r) => self.setText('title', ..._r)}
        /></label
      >
      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted">When</span><input
            type="text"
            class="math-input"
            {@attach prop('value', () => self.when)}
            oninput={(..._r) => self.setText('when', ..._r)}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Video length</span><input
            type="text"
            class="math-input"
            {@attach prop('value', () => self.duration)}
            oninput={(..._r) => self.setText('duration', ..._r)}
          /></label
        >
      </div>
      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted">Likes</span><input
            type="number"
            class="math-input"
            min="0"
            {@attach prop('value', () => self.likes)}
            oninput={(..._r) => self.number('likes', ..._r)}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Comments</span><input
            type="number"
            class="math-input"
            min="0"
            {@attach prop('value', () => self.comments)}
            oninput={(..._r) => self.number('comments', ..._r)}
          /></label
        >
      </div>
      <div class="math-row">
        <label class="math-field"
          ><span class="qr-label is-muted">Shares</span><input
            type="number"
            class="math-input"
            min="0"
            {@attach prop('value', () => self.shares)}
            oninput={(..._r) => self.number('shares', ..._r)}
          /></label
        >
        <label class="math-field"
          ><span class="qr-label is-muted">Views</span><input
            type="number"
            class="math-input"
            min="0"
            {@attach prop('value', () => self.views)}
            oninput={(..._r) => self.number('views', ..._r)}
          /></label
        >
      </div>
      <div class="settings-actions">
        <label class="btn"
          ><Icon name="image-plus" size={13} />
          Avatar<input
            type="file"
            accept="image/*"
            class="sr-only"
            onchange={(..._r) => self.loadPicture('avatar', ..._r)}
          /></label
        >
        {#if truthy(self.avatar)}<button
            type="button"
            class="btn"
            onclick={(..._r) => self.clearPicture('avatar', ..._r)}
            >Remove</button
          >{/if}
      </div>
      <div class="settings-actions">
        <label class="btn"
          ><Icon name="image-plus" size={13} />
          Picture / thumbnail<input
            type="file"
            accept="image/*"
            class="sr-only"
            onchange={(..._r) => self.loadPicture('image', ..._r)}
          /></label
        >
        {#if truthy(self.image)}<button
            type="button"
            class="btn"
            onclick={(..._r) => self.clearPicture('image', ..._r)}
            >Remove</button
          >{/if}
      </div>
      <p class="tool-hint"
        >Layouts follow each network's current web design: type sizes, spacing,
        badge shapes and colours. They're mockups, so the buttons don't do
        anything.</p
      >
    </aside>
  </div>
</ToolPage>
