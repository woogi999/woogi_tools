import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import { LinkTo } from '@ember/routing';
import Icon from './icon';
import { StudioState, WORKSPACES } from './studio/state';
import StudioToolbar from './studio/toolbar';
import StudioOutliner from './studio/outliner';
import StudioObjectPanel from './studio/panel-object';
import StudioMaterialPanel from './studio/panel-material';
import StudioTexturePanel from './studio/panel-texture';
import StudioRigPanel from './studio/panel-rig';
import StudioAnimPanel from './studio/panel-anim';
import StudioTimeline from './studio/timeline';
import StudioUvEditor from './studio/uv-editor';
import StudioDialogs from './studio/dialogs';

// 3D Studio: a general-purpose modeller, texture painter, rigger and
// animator in the page. The state and every action live in StudioState
// (components/studio/state.js); the heavy lifting (geometry, rendering,
// painting, rigging) is the lazily loaded engine in app/lazy/studio.

const eq = (a, b) => a === b;
const or = (...xs) => xs.some(Boolean);
const and = (...xs) => xs.every(Boolean);
const not = (x) => !x;

export default class StudioPage extends Component {
  s = new StudioState(this);
  workspaces = WORKSPACES;

  constructor(owner, args) {
    super(owner, args);
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
    return htmlSafe(`opacity:${b?.overlayOpacity ?? 0.4}`);
  }

  stopKeys = (e) => e.stopPropagation();

  <template>
    {{! template-lint-disable no-pointer-down-event-binding no-invalid-interactive }}
    <div class={{this.layoutClass}}>
      <header class="st-menubar">
        <LinkTo @route="index" class="st-brand" title="Back to Woogi Tools">
          <img src="/icon_expanded.png" alt="Woogi Tools" />
        </LinkTo>
        <div class="st-cluster">
          <button
            type="button"
            class="st-menu-btn"
            disabled={{not this.s.ready}}
            {{on "click" this.s.newProject}}
          >
            <Icon @name="file-plus" @size={{14}} /><span>New</span>
          </button>
          <button
            type="button"
            class="st-menu-btn st-open"
            disabled={{not this.s.ready}}
            {{on "click" (fn this.s.openDialog "open")}}
          >
            <Icon @name="folder-open" @size={{14}} /><span>Open</span>
          </button>
          <button
            type="button"
            class="st-menu-btn st-save"
            title="Save in this browser (Ctrl+S)"
            disabled={{not this.s.ready}}
            {{on "click" (fn this.s.saveProject false)}}
          >
            <Icon @name="save" @size={{14}} /><span>Save</span>
          </button>
          <button
            type="button"
            class="st-menu-btn st-export"
            disabled={{not this.s.ready}}
            {{on "click" (fn this.s.openDialog "export")}}
          >
            <Icon @name="download" @size={{14}} /><span>Export</span>
          </button>
        </div>
        {{#if this.s.ready}}
          <div class="st-name">
            <input
              type="text"
              class="st-name-input"
              aria-label="Scene name"
              maxlength="60"
              spellcheck="false"
              value={{this.s.doc.name}}
              {{on "change" this.s.setDocName}}
              {{on "keydown" this.stopKeys}}
            />
            <span
              class="st-dirty {{if this.s.dirty 'is-dirty'}}"
              title={{if this.s.dirty "Changed since it was saved" "Saved"}}
            ></span>
          </div>
        {{/if}}
        <div class="st-cluster">
          <button
            type="button"
            class="st-menu-btn"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={{not this.s.canUndo}}
            {{on "click" this.s.undo}}
          >
            <Icon @name="undo-2" @size={{14}} />
          </button>
          <button
            type="button"
            class="st-menu-btn"
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            disabled={{not this.s.canRedo}}
            {{on "click" this.s.redo}}
          >
            <Icon @name="redo-2" @size={{14}} />
          </button>
        </div>
        <nav class="st-workspaces" aria-label="Workspaces">
          {{#each this.workspaces as |w|}}
            <button
              type="button"
              class="st-ws {{if (eq w.id this.s.workspace) 'active'}}"
              title="{{w.label}} ({{w.key}})"
              disabled={{not this.s.ready}}
              {{on "click" (fn this.s.setWorkspace w.id)}}
            >
              <Icon @name={{w.icon}} @size={{14}} /><span>{{w.label}}</span>
            </button>
          {{/each}}
        </nav>
        <span class="st-spacer"></span>
        <button
          type="button"
          class="st-menu-btn"
          title="Keyboard shortcuts (?)"
          aria-label="Help"
          {{on "click" (fn this.s.openDialog "help")}}
        >
          <Icon @name="keyboard" @size={{14}} />
        </button>
      </header>

      {{#if this.s.ready}}
        <StudioToolbar @s={{this.s}} />

        <aside class="st-left" aria-label="Scene">
          <StudioOutliner @s={{this.s}} />
        </aside>

        <main class="st-center">
          <div
            class="st-viewport"
            {{this.mountView}}
            {{this.syncView this.s.viewState}}
          >
            {{#if this.s.brushOverlay}}
              <img
                class="st-stencil"
                src={{this.s.brush.image.url}}
                alt=""
                style={{this.overlayStyle}}
              />
            {{/if}}
            <div class="st-vp-top">
              <span class="st-mode-chip">{{this.modeLabel}}</span>
              {{#if this.s.animating}}
                <span class="st-mode-chip is-anim">Frame
                  {{this.s.frame}}{{if this.s.autoKey " · auto key"}}</span>
              {{/if}}
              <span class="st-spacer"></span>
              <div class="st-views" role="group" aria-label="Views">
                <button
                  type="button"
                  title="Front"
                  {{on "click" (fn this.s.setView "front")}}
                >Front</button>
                <button
                  type="button"
                  title="Right"
                  {{on "click" (fn this.s.setView "right")}}
                >Right</button>
                <button
                  type="button"
                  title="Top"
                  {{on "click" (fn this.s.setView "top")}}
                >Top</button>
                <button
                  type="button"
                  title="Perspective"
                  {{on "click" (fn this.s.setView "persp")}}
                >3D</button>
                <button
                  type="button"
                  class="{{if this.s.showGrid 'on'}}"
                  title="Grid"
                  aria-label="Grid"
                  {{on "click" (fn this.s.toggle "showGrid")}}
                ><Icon @name="grid-3x3" @size={{12}} /></button>
                <button
                  type="button"
                  class="{{if this.s.showBones 'on'}}"
                  title="Bones"
                  aria-label="Bones"
                  {{on "click" (fn this.s.toggle "showBones")}}
                ><Icon @name="bone" @size={{12}} /></button>
                <button
                  type="button"
                  class="{{if this.s.showHelpers 'on'}}"
                  title="Lights and cameras"
                  aria-label="Lights and cameras"
                  {{on "click" (fn this.s.toggle "showHelpers")}}
                ><Icon @name="lightbulb" @size={{12}} /></button>
                {{#if (eq this.s.mode "edit")}}
                  <button
                    type="button"
                    class="{{if this.s.xray 'on'}}"
                    title="X-ray: select through the model"
                    aria-label="X-ray"
                    {{on "click" (fn this.s.toggle "xray")}}
                  ><Icon @name="scan-eye" @size={{12}} /></button>
                {{/if}}
              </div>
            </div>
            {{#if this.s.lastOp}}
              <StudioDialogs @s={{this.s}} @part="lastop" />
            {{/if}}
          </div>
          {{#if (eq this.s.workspace "uv")}}
            <StudioUvEditor @s={{this.s}} />
          {{/if}}
        </main>

        <aside class="st-right" aria-label="Properties">
          <div class="st-tabs" role="tablist">
            {{#if
              (or
                (eq this.s.workspace "model")
                (eq this.s.workspace "uv")
                (eq this.s.workspace "material")
                (eq this.s.workspace "sculpt")
              )
            }}
              <button
                type="button"
                role="tab"
                class="st-tab {{if (eq this.s.rightTab 'object') 'active'}}"
                {{on "click" (fn this.s.setRightTab "object")}}
              >Object</button>
              <button
                type="button"
                role="tab"
                class="st-tab {{if (eq this.s.rightTab 'material') 'active'}}"
                {{on "click" (fn this.s.setRightTab "material")}}
              >Material</button>
            {{/if}}
          </div>
          <div class="st-right-body">
            {{#if (eq this.s.workspace "texture")}}
              <StudioTexturePanel @s={{this.s}} />
            {{else if (eq this.s.workspace "rig")}}
              {{#if (and this.s.obj (not (eq this.s.obj.type "armature")))}}
                <StudioObjectPanel @s={{this.s}} @compact={{true}} />
              {{/if}}
              <StudioRigPanel @s={{this.s}} />
            {{else if (eq this.s.workspace "animate")}}
              {{#if (eq this.s.mode "object")}}
                <StudioObjectPanel @s={{this.s}} @compact={{true}} />
              {{/if}}
              <StudioAnimPanel @s={{this.s}} />
            {{else if (eq this.s.rightTab "material")}}
              <StudioMaterialPanel @s={{this.s}} />
            {{else}}
              <StudioObjectPanel @s={{this.s}} />
            {{/if}}
          </div>
        </aside>

        {{#if (eq this.s.workspace "animate")}}
          <section class="st-bottom">
            <StudioTimeline @s={{this.s}} />
          </section>
        {{/if}}

        <footer class="st-status">
          {{#if this.s.status}}
            <span
              class="st-status-msg is-{{this.s.status.kind}}"
              role="status"
            >{{this.s.status.text}}</span>
          {{else if this.s.busy}}
            <span class="st-status-msg" role="status">{{this.s.busy}}</span>
          {{else}}
            <span class="st-hint">{{this.hint}}</span>
          {{/if}}
          <span class="st-spacer"></span>
          <span class="st-counts">
            {{this.s.counts.objects}}
            objects ·
            {{this.s.counts.verts}}
            verts ·
            {{this.s.counts.faces}}
            faces ·
            {{this.s.counts.tris}}
            tris
          </span>
        </footer>

        <StudioDialogs @s={{this.s}} />
      {{else if this.s.loadError}}
        <div class="st-loading" role="alert">
          <Icon @name="circle-alert" @size={{20}} />
          <p>{{this.s.loadError}}</p>
        </div>
      {{else}}
        <div class="st-loading" role="status">
          <span class="st-spinner"></span>
          <p>Loading the 3D engine…</p>
        </div>
      {{/if}}
    </div>
  </template>
}
