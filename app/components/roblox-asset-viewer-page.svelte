<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import ToolPage from './tool-page.svelte';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { keepState } from '../utils/tool-state.js';

  const eq = (a, b) => a === b;
  const API = '/api/roblox';

  const MODES = [
    { id: 'auto', label: 'Work it out' },
    { id: 'audio', label: 'Audio' },
    { id: 'image', label: 'Image or decal' },
    { id: '3d', label: '3D model' },
  ];

  const TYPE_NAMES = {
    1: 'Image',
    2: 'T-shirt',
    3: 'Audio',
    4: 'Mesh',
    5: 'Lua script',
    8: 'Hat',
    9: 'Place',
    10: 'Model',
    11: 'Shirt',
    12: 'Pants',
    13: 'Decal',
    17: 'Head',
    18: 'Face',
    19: 'Gear',
    21: 'Badge',
    24: 'Animation',
    27: 'Torso',
    28: 'Right arm',
    29: 'Left arm',
    30: 'Left leg',
    31: 'Right leg',
    32: 'Package',
    34: 'Game pass',
    38: 'Plugin',
    40: 'MeshPart',
    41: 'Hair accessory',
    42: 'Face accessory',
    43: 'Neck accessory',
    44: 'Shoulder accessory',
    45: 'Front accessory',
    46: 'Back accessory',
    47: 'Waist accessory',
    48: 'Climb animation',
    49: 'Death animation',
    50: 'Fall animation',
    51: 'Idle animation',
    52: 'Jump animation',
    53: 'Run animation',
    54: 'Swim animation',
    55: 'Walk animation',
    56: 'Pose animation',
    61: 'Emote animation',
    62: 'Video',
    64: 'T-shirt accessory',
    65: 'Shirt accessory',
    66: 'Pants accessory',
    67: 'Jacket accessory',
    68: 'Sweater accessory',
    69: 'Shorts accessory',
    70: 'Left shoe accessory',
    71: 'Right shoe accessory',
    72: 'Dress skirt accessory',
    73: 'Font family',
    76: 'Eyebrow accessory',
    77: 'Eyelash accessory',
    78: 'Mood animation',
    79: 'Dynamic head',
  };
  const IMAGE_TYPES = new Set([1, 2, 11, 12, 13, 18]);
  // Types whose file is XML pointing at the real image.
  const WRAPPED_IMAGE_TYPES = new Set([2, 11, 12, 13, 18]);
  const MODEL_TYPES = new Set([
    4, 8, 10, 17, 19, 27, 28, 29, 30, 31, 32, 40, 41, 42, 43, 44, 45, 46, 47,
    64, 65, 66, 67, 68, 69, 70, 71, 72, 76, 77, 79,
  ]);

  function parseId(text) {
    const t = text.trim();
    const m =
      t.match(/^(\d{1,20})$/) ??
      t.match(/rbxassetid:\/\/(\d+)/) ??
      t.match(/[?&]id=(\d+)/) ??
      t.match(/\/(?:library|catalog|bundles)\/(\d+)/) ??
      t.match(/(\d{5,20})/);
    return m ? m[1] : null;
  }

  async function ask(params) {
    const response = await fetch(`${API}?${new URLSearchParams(params)}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Roblox did not answer.');
    return body;
  }

  class RobloxAssetViewerPage extends Component {
    modes = MODES;

    input = $state.raw('');
    mode = $state.raw('auto');
    busy = $state.raw(false);
    error = $state.raw(null);
    details = $state.raw(null);
    thumb = $state.raw(null);
    view = $state.raw(null); // { kind: 'audio' | 'image' | '3d' | 'thumb', src?, parts? }
    modelError = $state.raw(null);

    model = null;
    request = 0;

    constructor(args) {
      super(args);
      keepState(this, 'roblox-asset-viewer', ['input', 'mode']);
      registerDestructor(this, () => this.model?.dispose());
    }

    get id() {
      return parseId(this.input);
    }

    get typeName() {
      if (!this.details) return '';
      return TYPE_NAMES[this.details.typeId] ?? `Type ${this.details.typeId}`;
    }

    get pageUrl() {
      return this.details
        ? `https://www.roblox.com/library/${this.details.id}`
        : '';
    }

    get rbxassetid() {
      return this.details ? `rbxassetid://${this.details.id}` : '';
    }

    setInput = (event) => (this.input = event.target.value);
    setMode = (event) => {
      this.mode = event.target.value;
      if (this.details) this.look();
    };

    submit = (event) => {
      event.preventDefault();
      this.look();
    };

    look = async () => {
      const id = this.id;
      if (!id) {
        this.error = 'Paste an asset ID, or a link to the asset.';
        return;
      }
      const request = ++this.request;
      this.busy = true;
      this.error = null;
      this.modelError = null;
      this.view = null;
      this.model?.dispose();
      this.model = null;
      try {
        const [details, thumb] = await Promise.all([
          ask({ kind: 'details', id }),
          ask({ kind: 'thumb', id }).catch(() => ({ url: null })),
        ]);
        if (request !== this.request) return;
        this.details = details;
        this.thumb = thumb.url;
        this.view = await this.viewFor(details, id);
      } catch (err) {
        if (request !== this.request) return;
        this.details = null;
        this.thumb = null;
        this.error = err.message;
      } finally {
        if (request === this.request) this.busy = false;
      }
    };

    async viewFor(details, id) {
      let mode = this.mode;
      if (mode === 'auto') {
        const t = details.typeId;
        mode =
          t === 3
            ? 'audio'
            : IMAGE_TYPES.has(t)
              ? 'image'
              : MODEL_TYPES.has(t)
                ? '3d'
                : 'thumb';
      }
      if (mode === 'audio')
        return { kind: 'audio', src: `${API}?kind=asset&id=${id}` };
      if (mode === 'image') {
        let imageId = id;
        if (WRAPPED_IMAGE_TYPES.has(details.typeId)) {
          const text = await (await fetch(`${API}?kind=asset&id=${id}`)).text();
          imageId = text.match(/[?&]id=(\d+)/)?.[1] ?? id;
        }
        return { kind: 'image', src: `${API}?kind=asset&id=${imageId}` };
      }
      if (mode === '3d') {
        const parts = await ask({ kind: '3d', id });
        return { kind: '3d', parts };
      }
      return { kind: 'thumb' };
    }

    // The 3D view is mounted when its box is on the page, and torn down with it.
    mount = modifier((container, [parts]) => {
      let live = true;
      import('../lazy/roblox-model.js')
        .then(({ mountRobloxModel }) => mountRobloxModel(container, parts))
        .then((model) => {
          if (!live) return model.dispose();
          this.model = model;
        })
        .catch(() => {
          if (live) this.modelError = 'That model could not be drawn.';
        });
      return () => {
        live = false;
        this.model?.dispose();
        this.model = null;
      };
    });
  }
</script>

<script>
  let args = $props();
  const self = new RobloxAssetViewerPage(args);
  onDestroy(() => destroy(self));
</script>

<ToolPage
  route="roblox-asset-viewer"
  busy={self.busy}
  closeWarning="Close the Roblox Asset Viewer? The asset still loading will stop."
  subtitle="Paste a Roblox asset ID or link and see what it is: listen to the audio, look at the image, or spin the model round."
>
  <div class="math-grid pop-in">
    <section class="math-card">
      <form class="rbx-form" onsubmit={self.submit}>
        <label class="math-field">
          <span class="qr-label is-muted">Asset ID or link</span>
          <input
            type="text"
            class="math-input"
            placeholder="1837879082, or https://www.roblox.com/library/…"
            spellcheck="false"
            {@attach prop('value', () => self.input)}
            oninput={self.setInput}
          />
        </label>
        <label class="math-field">
          <span class="qr-label is-muted">Show it as</span>
          <select class="select" onchange={self.setMode}>
            {#each self.modes ?? [] as m}
              <option
                value={m?.id}
                {@attach prop('selected', () => eq(m?.id, self.mode))}
                >{m?.label}</option
              >
            {/each}
          </select>
        </label>
        <button type="submit" class="btn active" disabled={self.busy}>
          <Icon name="search" size={13} />
          {truthy(self.busy) ? 'Fetching…' : 'Look it up'}</button
        >
      </form>
      {#if truthy(self.error)}<p class="tool-error">{self.error}</p>{/if}

      {#if truthy(self.details)}
        <dl class="rbx-facts">
          <dt>Name</dt>
          <dd>{self.details?.name}</dd>
          <dt>Type</dt>
          <dd>{self.typeName}</dd>
          {#if truthy(self.details?.creator)}
            <dt>Creator</dt>
            <dd>{self.details?.creator}</dd>
          {/if}
          <dt>ID</dt>
          <dd>{self.details?.id}</dd>
        </dl>
        {#if truthy(self.details?.description)}
          <p class="rbx-description">{self.details?.description}</p>
        {/if}
        <div class="settings-actions">
          <CopyButton value={self.rbxassetid} label="Copy rbxassetid://" />
          <a
            class="btn"
            href={self.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="link" size={13} />
            Open on Roblox</a
          >
        </div>
      {:else}
        <p class="tool-hint"
          >Only assets Roblox has made public can be fetched: most catalogue
          items, free models and decals, and audio that its owner has left open.</p
        >
      {/if}
    </section>

    <section class="math-card">
      <h3 class="qr-heading">Preview</h3>
      {#if truthy(self.view)}
        {#if truthy(eq(self.view?.kind, 'audio'))}
          {#if truthy(self.thumb)}
            <img src={self.thumb} alt="" class="rbx-thumb" />
          {/if}
          <!-- template-lint-disable require-media-caption -->
          <audio controls src={self.view?.src} class="rbx-audio"></audio>
          <div class="settings-actions">
            <a
              class="btn fs-save"
              href={self.view?.src}
              download="{self.details?.id}.ogg"
            >
              <Icon name="download" size={13} />
              Save audio</a
            >
          </div>
        {:else if truthy(eq(self.view?.kind, 'image'))}
          <img
            src={self.view?.src}
            alt={self.details?.name}
            class="rbx-image"
          />
          <div class="settings-actions">
            <a
              class="btn fs-save"
              href={self.view?.src}
              download="{self.details?.id}.png"
            >
              <Icon name="download" size={13} />
              Save image</a
            >
          </div>
        {:else if truthy(eq(self.view?.kind, '3d'))}
          <div class="rbx-stage" {@attach self.mount?.([self.view?.parts])}
          ></div>
          {#if truthy(self.modelError)}
            <p class="tool-error">{self.modelError}</p>
          {:else}
            <p class="tool-hint">Drag to turn it, scroll to zoom.</p>
          {/if}
        {:else}
          {#if truthy(self.thumb)}
            <img src={self.thumb} alt={self.details?.name} class="rbx-image" />
            <p class="tool-hint"
              >That sort of asset can't be played or drawn here, so this is
              Roblox's own thumbnail of it.</p
            >
          {:else}
            <p class="tool-hint">Roblox has no preview for that asset.</p>
          {/if}
        {/if}
      {:else if truthy(self.busy)}
        <p class="tool-hint">Fetching from Roblox…</p>
      {:else}
        <p class="tool-hint">Look something up and it appears here.</p>
      {/if}
    </section>
  </div>
</ToolPage>
