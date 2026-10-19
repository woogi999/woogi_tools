<script module>
  import { onDestroy } from 'svelte';
  import Component from '../../core/component.js';
  import { truthy, on, prop } from '../../core/helpers.js';
  import { destroy } from '../../core/destroyable.js';
  import Icon from '../icon.svelte';
  import StParams from './params.svelte';

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

  class StudioDialogs extends Component {
    shortcuts = SHORTCUTS;
    format = $state.raw('glb');
    selectionOnly = $state.raw(false);
    animations = $state.raw(true);

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
  }

  function includes(list, x) {
    return list?.includes(x);
  }

  function valueAt(list, i) {
    return list?.[i];
  }
</script>

<script>
  let args = $props();
  const self = new StudioDialogs(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable no-invalid-interactive -->
{#if truthy(eq(args.part, 'lastop'))}
  {#if truthy(args.s?.lastOpDef?.params?.length)}
    <div class="st-lastop" role="group" aria-label="Last operation">
      <p class="st-h4">{args.s?.lastOpDef?.label}</p>
      <StParams
        params={args.s?.lastOpDef?.params}
        values={args.s?.lastOp?.params}
        onChange={args.s?.retuneOp}
      />
    </div>
  {/if}
{:else if truthy(args.s?.dialog)}
  <div class="st-dialog-backdrop" onclick={self.backdrop}>
    <div
      class="st-dialog st-dialog-{args.s?.dialog}"
      role="dialog"
      aria-modal="true"
      {@attach on('keydown', self.stop)}
    >
      <button
        type="button"
        class="st-dialog-close"
        aria-label="Close"
        onclick={args.s?.closeDialog}><Icon name="x" size={16} /></button
      >

      {#if truthy(eq(args.s?.dialog, 'export'))}
        <h2>Export</h2>
        <div class="st-formats" role="radiogroup">
          {#each self.exporters ?? [] as ex}
            <button
              type="button"
              role="radio"
              aria-checked={truthy(eq(ex?.key, self.format)) ? 'true' : 'false'}
              class="st-format st-format-{ex?.key}
                    {truthy(eq(ex?.key, self.format)) ? 'active' : ''}"
              onclick={(..._r) => self.pick(ex?.key, ..._r)}
            >
              <strong>{ex?.label}</strong><span>.{ex?.ext}</span>
            </button>
          {/each}
        </div>
        <p class="st-note">{self.exporter?.about}</p>
        {#if truthy(includes(self.exporter?.options, 'selection'))}
          <label class="st-check"
            ><input
              type="checkbox"
              {@attach prop('checked', () => self.selectionOnly)}
              onchange={self.toggleSel}
            /><span>Only the selection</span></label
          >
        {/if}
        {#if truthy(includes(self.exporter?.options, 'animations'))}
          <label class="st-check"
            ><input
              type="checkbox"
              {@attach prop('checked', () => self.animations)}
              onchange={self.toggleAnim}
            /><span>Animation clips (sampled every frame, IK included)</span
            ></label
          >
        {/if}
        <p class="st-note"
          >For Roblox, bring a GLB or OBJ in through Studio's 3D Importer.</p
        >
        <div class="st-dialog-actions">
          <button
            type="button"
            class="st-btn st-primary st-do-export"
            disabled={truthy(args.s?.busy) ? true : false}
            onclick={self.doExport}
            ><Icon name="download" size={14} />Export
            {self.exporter?.label}</button
          >
        </div>
      {/if}

      {#if truthy(eq(args.s?.dialog, 'open'))}
        <h2>Open</h2>
        <ul class="st-projects">
          {#each args.s?.projects ?? [] as p (p?.id)}
            <li
              class="st-project {truthy(eq(p?.id, args.s?.projectId))
                ? 'active'
                : ''}"
            >
              {#if truthy(p?.thumb)}<img src={p?.thumb} alt="" />{:else}<span
                  class="st-project-blank"><Icon name="box" size={20} /></span
                >{/if}
              <div
                ><strong>{p?.name}</strong><span
                  >{when(p?.savedAt)}
                  ·
                  {p?.objects}
                  objects</span
                ></div
              >
              <button
                type="button"
                class="st-btn"
                onclick={(..._r) => args.s?.openProject(p?.id, ..._r)}
                >Open</button
              >
              <button
                type="button"
                class="st-mini"
                title="Delete"
                aria-label="Delete {p?.name}"
                onclick={(..._r) => args.s?.deleteProject(p?.id, ..._r)}
                ><Icon name="trash-2" size={12} /></button
              >
            </li>
          {:else}
            <li class="st-empty"
              >No saved scenes yet. Save (Ctrl S) keeps one in this browser; the
              scene you're working on is also kept automatically.</li
            >
          {/each}
        </ul>
        <div class="st-dialog-actions">
          <label class="st-btn st-upload"
            ><Icon name="upload" size={14} />Open or import a file…<input
              type="file"
              accept=".json,.w3d,.glb,.gltf,.obj,.stl"
              hidden
              onchange={self.openFile}
            /></label
          >
          <button type="button" class="st-btn" onclick={args.s?.downloadProject}
            ><Icon name="download" size={14} />Download project file</button
          >
          <button
            type="button"
            class="st-btn"
            onclick={(..._r) => args.s?.saveProject(true, ..._r)}
            ><Icon name="save" size={14} />Save as new</button
          >
        </div>
        <p class="st-note"
          >Project files (.w3d.json) keep everything: models, layers and paint,
          rigs and clips. GLB, glTF, OBJ and STL come in as editable meshes.</p
        >
      {/if}

      {#if truthy(eq(args.s?.dialog, 'help'))}
        <h2>Keyboard and mouse</h2>
        <div class="st-help">
          {#each self.shortcuts ?? [] as group}
            <section>
              <h3>{valueAt(group, 0)}</h3>
              <dl>
                {#each valueAt(group, 1) ?? [] as row}
                  <dt><kbd>{valueAt(row, 0)}</kbd></dt>
                  <dd>{valueAt(row, 1)}</dd>
                {/each}
              </dl>
            </section>
          {/each}
        </div>
      {/if}

      {#if truthy(eq(args.s?.dialog, 'retarget'))}
        {#if true}{@const r = self.retarget}
          <h2>Retarget animation</h2>
          <div class="st-row-fields">
            <label class="st-field"
              ><span>From</span>
              <select onchange={(..._r) => self.rt('src', ..._r)}>
                {#each args.s?.armatures ?? [] as a}<option
                    value={a?.id}
                    {@attach prop('selected', () => eq(a?.id, r?.src))}
                    >{a?.name}</option
                  >{/each}
              </select>
            </label>
            <label class="st-field"
              ><span>Clip</span>
              <select onchange={(..._r) => self.rt('clip', ..._r)}>
                {#each args.s?.clips ?? [] as c}<option
                    value={c?.id}
                    {@attach prop('selected', () => eq(c?.id, r?.clip))}
                    >{c?.name}</option
                  >{/each}
              </select>
            </label>
            <label class="st-field"
              ><span>To</span>
              <select onchange={(..._r) => self.rt('dst', ..._r)}>
                {#each args.s?.armatures ?? [] as a}<option
                    value={a?.id}
                    {@attach prop('selected', () => eq(a?.id, r?.dst))}
                    >{a?.name}</option
                  >{/each}
              </select>
            </label>
          </div>
          <div class="st-mapping">
            <div class="st-mapping-head"
              ><span>Source</span><span>Target</span></div
            >
            {#each r?.rows ?? [] as row}
              <div class="st-mapping-row">
                <span>{row?.name}</span>
                <span>→</span>
                <select
                  aria-label="Target for {row?.name}"
                  onchange={(..._r) =>
                    args.s?.setRetargetBone(row?.name, ..._r)}
                >
                  <option value="">(skip)</option>
                  {#each r?.dstBones ?? [] as d}<option
                      value={d}
                      {@attach prop('selected', () => eq(d, row?.to))}
                      >{d}</option
                    >{/each}
                </select>
              </div>
            {/each}
          </div>
          <div class="st-dialog-actions">
            <button
              type="button"
              class="st-btn st-primary"
              disabled={not(r?.clip)}
              onclick={args.s?.runRetarget}
              ><Icon name="arrow-right-left" size={14} />Make retargeted clip</button
            >
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}
