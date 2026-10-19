<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { destroy, registerDestructor } from '../core/destroyable.js';
  import { modifier } from '../core/modifier.js';
  import Link from '../core/link.svelte';
  import { truthy, on, prop } from '../core/helpers.js';
  import Icon from './icon.svelte';
  import { StudioState, WORKSPACES } from './studio/state.svelte.js';
  import StudioToolbar from './studio/toolbar.svelte';
  import StudioOutliner from './studio/outliner.svelte';
  import StudioObjectPanel from './studio/panel-object.svelte';
  import StudioMaterialPanel from './studio/panel-material.svelte';
  import StudioTexturePanel from './studio/panel-texture.svelte';
  import StudioRigPanel from './studio/panel-rig.svelte';
  import StudioAnimPanel from './studio/panel-anim.svelte';
  import StudioTimeline from './studio/timeline.svelte';
  import StudioUvEditor from './studio/uv-editor.svelte';
  import StudioDialogs from './studio/dialogs.svelte';

  // 3D Studio: a general-purpose modeller, texture painter, rigger and
  // animator in the page. The state and every action live in StudioState
  // (components/studio/state.js); the heavy lifting (geometry, rendering,
  // painting, rigging) is the lazily loaded engine in app/lazy/studio.

  const eq = (a, b) => a === b;
  const or = (...xs) => xs.some(Boolean);
  const and = (...xs) => xs.every(Boolean);
  const not = (x) => !x;

  class StudioPage extends Component {
    s = new StudioState(this);
    workspaces = WORKSPACES;

    constructor(args) {
      super(args);
      this.s.load();
      const onKey = (e) => this.s.keydown(e);
      document.addEventListener('keydown', onKey);
      registerDestructor(this, () => {
        document.removeEventListener('keydown', onKey);
        // The scene is kept as you work; this catches the last second of it.
        if (this.s.ready) this.s.autosave();
        this.s.destroy();
      });
    }

    // Mounts the viewport once the engine is in; re-syncs it whenever
    // anything it draws changes (reading viewState is what subscribes).
    mountView = modifier((element) => {
      this.s.attachView(element);
      return () => this.s.detachView();
    });

    syncView = modifier((element, [state]) => {
      if (state) this.s.view?.sync(state);
    });

    get layoutClass() {
      const s = this.s;
      const ws = s.workspace;
      return `st-app ws-${ws} ${ws === 'animate' ? 'has-timeline' : ''} ${ws === 'uv' ? 'has-uv' : ''}`;
    }

    get modeLabel() {
      return (
        {
          object: 'Object',
          edit: 'Edit',
          sculpt: 'Sculpt',
          paint: 'Texture paint',
          weight: 'Weight paint',
          pose: 'Pose',
          bones: 'Edit bones',
        }[this.s.mode] ?? this.s.mode
      );
    }

    get hint() {
      const s = this.s;
      switch (s.mode) {
        case 'edit':
          return '1 2 3 vertex / edge / face · E extrude · I inset · Ctrl B bevel · Ctrl R loop cut · M merge · X delete · Tab done';
        case 'sculpt':
          return 'Drag to sculpt · Ctrl digs in · Shift smooths · [ ] brush size';
        case 'paint':
          return 'Drag to paint · [ ] brush size · the brush reaches across UV seams';
        case 'weight':
          return 'Drag to paint weights for the selected bone · [ ] brush size';
        case 'pose':
          return 'Click a bone or controller, then rotate · I insert key · Ctrl C / Ctrl V copy pose';
        case 'bones':
          return 'Click a bone to edit · E extrude a new bone · X delete';
        default:
          return 'Right drag look · WASD QE fly (Shift faster) · middle drag orbit · Shift middle pan · wheel zoom · F focus';
      }
    }

    get overlayStyle() {
      const b = this.s.brush;
      return `opacity:${b?.overlayOpacity ?? 0.4}`;
    }

    stopKeys = (e) => e.stopPropagation();
  }
</script>

<script>
  let args = $props();
  const self = new StudioPage(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable no-pointer-down-event-binding no-invalid-interactive -->
<div class={self.layoutClass}>
  <header class="st-menubar">
    <Link route="index" class="st-brand" title="Back to Woogi Tools">
      <img src="/icon_expanded.png" alt="Woogi Tools" />
    </Link>
    <div class="st-cluster">
      <button
        type="button"
        class="st-menu-btn"
        disabled={not(self.s?.ready)}
        onclick={self.s?.newProject}
      >
        <Icon name="file-plus" size={14} /><span>New</span>
      </button>
      <button
        type="button"
        class="st-menu-btn st-open"
        disabled={not(self.s?.ready)}
        onclick={(..._r) => self.s?.openDialog('open', ..._r)}
      >
        <Icon name="folder-open" size={14} /><span>Open</span>
      </button>
      <button
        type="button"
        class="st-menu-btn st-save"
        title="Save in this browser (Ctrl+S)"
        disabled={not(self.s?.ready)}
        onclick={(..._r) => self.s?.saveProject(false, ..._r)}
      >
        <Icon name="save" size={14} /><span>Save</span>
      </button>
      <button
        type="button"
        class="st-menu-btn st-export"
        disabled={not(self.s?.ready)}
        onclick={(..._r) => self.s?.openDialog('export', ..._r)}
      >
        <Icon name="download" size={14} /><span>Export</span>
      </button>
    </div>
    {#if truthy(self.s?.ready)}
      <div class="st-name">
        <input
          type="text"
          class="st-name-input"
          aria-label="Scene name"
          maxlength="60"
          spellcheck="false"
          {@attach prop('value', () => self.s?.doc?.name)}
          {@attach on('keydown', self.stopKeys)}
          onchange={self.s?.setDocName}
        />
        <span
          class="st-dirty {truthy(self.s?.dirty) ? 'is-dirty' : ''}"
          title={truthy(self.s?.dirty) ? 'Changed since it was saved' : 'Saved'}
        ></span>
      </div>
    {/if}
    <div class="st-cluster">
      <button
        type="button"
        class="st-menu-btn"
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        disabled={not(self.s?.canUndo)}
        onclick={self.s?.undo}
      >
        <Icon name="undo-2" size={14} />
      </button>
      <button
        type="button"
        class="st-menu-btn"
        title="Redo (Ctrl+Y)"
        aria-label="Redo"
        disabled={not(self.s?.canRedo)}
        onclick={self.s?.redo}
      >
        <Icon name="redo-2" size={14} />
      </button>
    </div>
    <nav class="st-workspaces" aria-label="Workspaces">
      {#each self.workspaces ?? [] as w}
        <button
          type="button"
          class="st-ws {truthy(eq(w?.id, self.s?.workspace)) ? 'active' : ''}"
          title="{w?.label} ({w?.key})"
          disabled={not(self.s?.ready)}
          onclick={(..._r) => self.s?.setWorkspace(w?.id, ..._r)}
        >
          <Icon name={w?.icon} size={14} /><span>{w?.label}</span>
        </button>
      {/each}
    </nav>
    <span class="st-spacer"></span>
    <button
      type="button"
      class="st-menu-btn"
      title="Keyboard shortcuts (?)"
      aria-label="Help"
      onclick={(..._r) => self.s?.openDialog('help', ..._r)}
    >
      <Icon name="keyboard" size={14} />
    </button>
  </header>

  {#if truthy(self.s?.ready)}
    <StudioToolbar s={self.s} />

    <aside class="st-left" aria-label="Scene">
      <StudioOutliner s={self.s} />
    </aside>

    <main class="st-center">
      <div
        class="st-viewport"
        {@attach self.mountView?.()}
        {@attach self.syncView?.([self.s?.viewState])}
      >
        {#if truthy(self.s?.brushOverlay)}
          <img
            class="st-stencil"
            src={self.s?.brush?.image?.url}
            alt=""
            style={self.overlayStyle}
          />
        {/if}
        <div class="st-vp-top">
          <span class="st-mode-chip">{self.modeLabel}</span>
          {#if truthy(self.s?.animating)}
            <span class="st-mode-chip is-anim"
              >Frame
              {self.s?.frame}{truthy(self.s?.autoKey)
                ? ' · auto key'
                : ''}</span
            >
          {/if}
          <span class="st-spacer"></span>
          <div class="st-views" role="group" aria-label="Views">
            <button
              type="button"
              title="Front"
              onclick={(..._r) => self.s?.setView('front', ..._r)}>Front</button
            >
            <button
              type="button"
              title="Right"
              onclick={(..._r) => self.s?.setView('right', ..._r)}>Right</button
            >
            <button
              type="button"
              title="Top"
              onclick={(..._r) => self.s?.setView('top', ..._r)}>Top</button
            >
            <button
              type="button"
              title="Perspective"
              onclick={(..._r) => self.s?.setView('persp', ..._r)}>3D</button
            >
            <button
              type="button"
              class={truthy(self.s?.showGrid) ? 'on' : ''}
              title="Grid"
              aria-label="Grid"
              onclick={(..._r) => self.s?.toggle('showGrid', ..._r)}
              ><Icon name="grid-3x3" size={12} /></button
            >
            <button
              type="button"
              class={truthy(self.s?.showBones) ? 'on' : ''}
              title="Bones"
              aria-label="Bones"
              onclick={(..._r) => self.s?.toggle('showBones', ..._r)}
              ><Icon name="bone" size={12} /></button
            >
            <button
              type="button"
              class={truthy(self.s?.showHelpers) ? 'on' : ''}
              title="Lights and cameras"
              aria-label="Lights and cameras"
              onclick={(..._r) => self.s?.toggle('showHelpers', ..._r)}
              ><Icon name="lightbulb" size={12} /></button
            >
            {#if truthy(eq(self.s?.mode, 'edit'))}
              <button
                type="button"
                class={truthy(self.s?.xray) ? 'on' : ''}
                title="X-ray: select through the model"
                aria-label="X-ray"
                onclick={(..._r) => self.s?.toggle('xray', ..._r)}
                ><Icon name="scan-eye" size={12} /></button
              >
            {/if}
          </div>
        </div>
        {#if truthy(self.s?.lastOp)}
          <StudioDialogs s={self.s} part="lastop" />
        {/if}
      </div>
      {#if truthy(eq(self.s?.workspace, 'uv'))}
        <StudioUvEditor s={self.s} />
      {/if}
    </main>

    <aside class="st-right" aria-label="Properties">
      <div class="st-tabs" role="tablist">
        {#if truthy(or(eq(self.s?.workspace, 'model'), eq(self.s?.workspace, 'uv'), eq(self.s?.workspace, 'material'), eq(self.s?.workspace, 'sculpt')))}
          <button
            type="button"
            role="tab"
            class="st-tab {truthy(eq(self.s?.rightTab, 'object'))
              ? 'active'
              : ''}"
            onclick={(..._r) => self.s?.setRightTab('object', ..._r)}
            >Object</button
          >
          <button
            type="button"
            role="tab"
            class="st-tab {truthy(eq(self.s?.rightTab, 'material'))
              ? 'active'
              : ''}"
            onclick={(..._r) => self.s?.setRightTab('material', ..._r)}
            >Material</button
          >
        {/if}
      </div>
      <div class="st-right-body">
        {#if truthy(eq(self.s?.workspace, 'texture'))}
          <StudioTexturePanel s={self.s} />
        {:else if truthy(eq(self.s?.workspace, 'rig'))}
          {#if truthy(and(self.s?.obj, not(eq(self.s?.obj?.type, 'armature'))))}
            <StudioObjectPanel s={self.s} compact={true} />
          {/if}
          <StudioRigPanel s={self.s} />
        {:else if truthy(eq(self.s?.workspace, 'animate'))}
          {#if truthy(eq(self.s?.mode, 'object'))}
            <StudioObjectPanel s={self.s} compact={true} />
          {/if}
          <StudioAnimPanel s={self.s} />
        {:else if truthy(eq(self.s?.rightTab, 'material'))}
          <StudioMaterialPanel s={self.s} />
        {:else}
          <StudioObjectPanel s={self.s} />
        {/if}
      </div>
    </aside>

    {#if truthy(eq(self.s?.workspace, 'animate'))}
      <section class="st-bottom">
        <StudioTimeline s={self.s} />
      </section>
    {/if}

    <footer class="st-status">
      {#if truthy(self.s?.status)}
        <span class="st-status-msg is-{self.s?.status?.kind}" role="status"
          >{self.s?.status?.text}</span
        >
      {:else if truthy(self.s?.busy)}
        <span class="st-status-msg" role="status">{self.s?.busy}</span>
      {:else}
        <span class="st-hint">{self.hint}</span>
      {/if}
      <span class="st-spacer"></span>
      <span class="st-counts">
        {self.s?.counts?.objects}
        objects ·
        {self.s?.counts?.verts}
        verts ·
        {self.s?.counts?.faces}
        faces ·
        {self.s?.counts?.tris}
        tris
      </span>
    </footer>

    <StudioDialogs s={self.s} />
  {:else if truthy(self.s?.loadError)}
    <div class="st-loading" role="alert">
      <Icon name="circle-alert" size={20} />
      <p>{self.s?.loadError}</p>
    </div>
  {:else}
    <div class="st-loading" role="status">
      <span class="st-spinner"></span>
      <p>Loading the 3D engine…</p>
    </div>
  {/if}
</div>
