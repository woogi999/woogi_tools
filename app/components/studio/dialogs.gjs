import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from '../icon';
import StParams from './params';

// 3D Studio's dialogs (export, open, help, retarget) and the floating
// "last operation" panel that lets an edit be retuned after the fact.

const eq = (a, b) => a === b;
const not = (x) => !x;
const when = (t) => (t ? new Date(t).toLocaleString() : '');

const SHORTCUTS = [
  [
    'Camera',
    [
      ['Right mouse drag', 'Look around'],
      ['W A S D', 'Fly forward, left, back, right'],
      ['Q / E', 'Down / up'],
      ['Shift', 'Move faster'],
      ['Mouse wheel', 'Zoom towards the cursor'],
      ['Middle drag', 'Orbit'],
      ['Shift + middle drag', 'Pan'],
      ['Alt + left drag', 'Orbit (trackpads)'],
      ['F', 'Focus the selection'],
    ],
  ],
  [
    'Everywhere',
    [
      ['F1 – F7', 'Model · Sculpt · UV · Texture · Material · Rig · Animate'],
      ['Ctrl 1 / 2 / 3 / 4', 'Select · Move · Scale · Rotate'],
      ['Ctrl Z / Ctrl Y', 'Undo / redo'],
      ['Ctrl S', 'Save'],
      ['Ctrl D', 'Duplicate'],
      ['Ctrl G / Ctrl Shift G', 'Group / ungroup'],
      ['Ctrl A', 'Select all'],
      ['X or Delete', 'Delete'],
      ['H / Alt H', 'Hide / show all'],
      ['Tab', 'Edit mode'],
    ],
  ],
  [
    'Edit mode',
    [
      ['1 / 2 / 3', 'Vertices · edges · faces'],
      ['E', 'Extrude'],
      ['I', 'Inset'],
      ['Ctrl B', 'Bevel'],
      ['Ctrl R', 'Loop cut'],
      ['B', 'Bridge'],
      ['M', 'Merge'],
      ['N', 'Flip normals'],
      ['P', 'Separate'],
      ['L / Ctrl L', 'Select linked'],
      ['Ctrl I', 'Invert selection'],
    ],
  ],
  [
    'Painting & sculpting',
    [
      ['[ / ]', 'Brush size'],
      ['Ctrl (sculpt)', 'Dig in'],
      ['Shift (sculpt)', 'Smooth'],
    ],
  ],
  [
    'Animation',
    [
      ['Space', 'Play / pause'],
      ['← / →', 'Frame back / forward'],
      ['Shift ← / →', 'Start / end'],
      ['↑ / ↓', 'Next / previous key'],
      ['I', 'Insert keys'],
      ['Ctrl C / Ctrl V', 'Copy / paste keys (or a pose)'],
      ['Alt drag keys', 'Duplicate them'],
    ],
  ],
];

export default class StudioDialogs extends Component {
  shortcuts = SHORTCUTS;
  @tracked format = 'glb';
  @tracked selectionOnly = false;
  @tracked animations = true;

  get s() {
    return this.args.s;
  }

  get exporters() {
    return Object.entries(this.s.E.EXPORTERS).map(([key, v]) => ({
      key,
      ...v,
    }));
  }

  get exporter() {
    return this.s.E.EXPORTERS[this.format];
  }

  get retarget() {
    const r = this.s.anim.retarget;
    if (!r) return null;
    const src = this.s.doc.objects[r.src];
    const dst = this.s.doc.objects[r.dst];
    return {
      ...r,
      srcBones: src?.bones ?? [],
      dstBones: (dst?.bones ?? []).map((b) => b.name),
      rows: (src?.bones ?? []).map((b) => ({
        name: b.name,
        to: r.map[b.name] ?? '',
      })),
    };
  }

  pick = (key) => (this.format = key);
  toggleSel = (e) => (this.selectionOnly = e.target.checked);
  toggleAnim = (e) => (this.animations = e.target.checked);
  doExport = () => {
    this.s.exportAs(this.format, {
      selection: this.selectionOnly,
      animations: this.animations,
    });
    this.s.closeDialog();
  };
  openFile = (e) => {
    this.s.openFile(e.target.files?.[0]);
    e.target.value = '';
    this.s.closeDialog();
  };
  stop = (e) => e.stopPropagation();
  backdrop = (e) => {
    if (e.target === e.currentTarget) this.s.closeDialog();
  };
  rt = (key, e) => this.s.setRetarget(key, e.target.value);

  <template>
    {{! template-lint-disable no-invalid-interactive }}
    {{#if (eq @part "lastop")}}
      {{#if @s.lastOpDef.params.length}}
        <div class="st-lastop" role="group" aria-label="Last operation">
          <p class="st-h4">{{@s.lastOpDef.label}}</p>
          <StParams
            @params={{@s.lastOpDef.params}}
            @values={{@s.lastOp.params}}
            @onChange={{@s.retuneOp}}
          />
        </div>
      {{/if}}
    {{else if @s.dialog}}
      <div class="st-dialog-backdrop" {{on "click" this.backdrop}}>
        <div
          class="st-dialog st-dialog-{{@s.dialog}}"
          role="dialog"
          aria-modal="true"
          {{on "keydown" this.stop}}
        >
          <button
            type="button"
            class="st-dialog-close"
            aria-label="Close"
            {{on "click" @s.closeDialog}}
          ><Icon @name="x" @size={{16}} /></button>

          {{#if (eq @s.dialog "export")}}
            <h2>Export</h2>
            <div class="st-formats" role="radiogroup">
              {{#each this.exporters as |ex|}}
                <button
                  type="button"
                  role="radio"
                  aria-checked={{if (eq ex.key this.format) "true" "false"}}
                  class="st-format st-format-{{ex.key}}
                    {{if (eq ex.key this.format) 'active'}}"
                  {{on "click" (fn this.pick ex.key)}}
                >
                  <strong>{{ex.label}}</strong><span>.{{ex.ext}}</span>
                </button>
              {{/each}}
            </div>
            <p class="st-note">{{this.exporter.about}}</p>
            {{#if (includes this.exporter.options "selection")}}
              <label class="st-check"><input
                  type="checkbox"
                  checked={{this.selectionOnly}}
                  {{on "change" this.toggleSel}}
                /><span>Only the selection</span></label>
            {{/if}}
            {{#if (includes this.exporter.options "animations")}}
              <label class="st-check"><input
                  type="checkbox"
                  checked={{this.animations}}
                  {{on "change" this.toggleAnim}}
                /><span>Animation clips (sampled every frame, IK included)</span></label>
            {{/if}}
            <p class="st-note">For Roblox, bring a GLB or OBJ in through
              Studio's 3D Importer.</p>
            <div class="st-dialog-actions">
              <button
                type="button"
                class="st-btn st-primary st-do-export"
                disabled={{if @s.busy true false}}
                {{on "click" this.doExport}}
              ><Icon @name="download" @size={{14}} />Export
                {{this.exporter.label}}</button>
            </div>
          {{/if}}

          {{#if (eq @s.dialog "open")}}
            <h2>Open</h2>
            <ul class="st-projects">
              {{#each @s.projects key="id" as |p|}}
                <li class="st-project {{if (eq p.id @s.projectId) 'active'}}">
                  {{#if p.thumb}}<img src={{p.thumb}} alt="" />{{else}}<span
                      class="st-project-blank"
                    ><Icon @name="box" @size={{20}} /></span>{{/if}}
                  <div><strong>{{p.name}}</strong><span>{{when p.savedAt}}
                      ·
                      {{p.objects}}
                      objects</span></div>
                  <button
                    type="button"
                    class="st-btn"
                    {{on "click" (fn @s.openProject p.id)}}
                  >Open</button>
                  <button
                    type="button"
                    class="st-mini"
                    title="Delete"
                    aria-label="Delete {{p.name}}"
                    {{on "click" (fn @s.deleteProject p.id)}}
                  ><Icon @name="trash-2" @size={{12}} /></button>
                </li>
              {{else}}
                <li class="st-empty">No saved scenes yet. Save (Ctrl S) keeps
                  one in this browser; the scene you're working on is also kept
                  automatically.</li>
              {{/each}}
            </ul>
            <div class="st-dialog-actions">
              <label class="st-btn st-upload"><Icon
                  @name="upload"
                  @size={{14}}
                />Open or import a file…<input
                  type="file"
                  accept=".json,.w3d,.glb,.gltf,.obj,.stl"
                  hidden
                  {{on "change" this.openFile}}
                /></label>
              <button
                type="button"
                class="st-btn"
                {{on "click" @s.downloadProject}}
              ><Icon @name="download" @size={{14}} />Download project file</button>
              <button
                type="button"
                class="st-btn"
                {{on "click" (fn @s.saveProject true)}}
              ><Icon @name="save" @size={{14}} />Save as new</button>
            </div>
            <p class="st-note">Project files (.w3d.json) keep everything:
              models, layers and paint, rigs and clips. GLB, glTF, OBJ and STL
              come in as editable meshes.</p>
          {{/if}}

          {{#if (eq @s.dialog "help")}}
            <h2>Keyboard and mouse</h2>
            <div class="st-help">
              {{#each this.shortcuts as |group|}}
                <section>
                  <h3>{{valueAt group 0}}</h3>
                  <dl>
                    {{#each (valueAt group 1) as |row|}}
                      <dt><kbd>{{valueAt row 0}}</kbd></dt>
                      <dd>{{valueAt row 1}}</dd>
                    {{/each}}
                  </dl>
                </section>
              {{/each}}
            </div>
          {{/if}}

          {{#if (eq @s.dialog "retarget")}}
            {{#let this.retarget as |r|}}
              <h2>Retarget animation</h2>
              <div class="st-row-fields">
                <label class="st-field"><span>From</span>
                  <select {{on "change" (fn this.rt "src")}}>
                    {{#each @s.armatures as |a|}}<option
                        value={{a.id}}
                        selected={{eq a.id r.src}}
                      >{{a.name}}</option>{{/each}}
                  </select>
                </label>
                <label class="st-field"><span>Clip</span>
                  <select {{on "change" (fn this.rt "clip")}}>
                    {{#each @s.clips as |c|}}<option
                        value={{c.id}}
                        selected={{eq c.id r.clip}}
                      >{{c.name}}</option>{{/each}}
                  </select>
                </label>
                <label class="st-field"><span>To</span>
                  <select {{on "change" (fn this.rt "dst")}}>
                    {{#each @s.armatures as |a|}}<option
                        value={{a.id}}
                        selected={{eq a.id r.dst}}
                      >{{a.name}}</option>{{/each}}
                  </select>
                </label>
              </div>
              <div class="st-mapping">
                <div class="st-mapping-head"><span>Source</span><span
                  >Target</span></div>
                {{#each r.rows as |row|}}
                  <div class="st-mapping-row">
                    <span>{{row.name}}</span>
                    <span>→</span>
                    <select
                      aria-label="Target for {{row.name}}"
                      {{on "change" (fn @s.setRetargetBone row.name)}}
                    >
                      <option value="">(skip)</option>
                      {{#each r.dstBones as |d|}}<option
                          value={{d}}
                          selected={{eq d row.to}}
                        >{{d}}</option>{{/each}}
                    </select>
                  </div>
                {{/each}}
              </div>
              <div class="st-dialog-actions">
                <button
                  type="button"
                  class="st-btn st-primary"
                  disabled={{not r.clip}}
                  {{on "click" @s.runRetarget}}
                ><Icon @name="arrow-right-left" @size={{14}} />Make retargeted
                  clip</button>
              </div>
            {{/let}}
          {{/if}}
        </div>
      </div>
    {{/if}}
  </template>
}

function includes(list, x) {
  return list?.includes(x);
}

function valueAt(list, i) {
  return list?.[i];
}
