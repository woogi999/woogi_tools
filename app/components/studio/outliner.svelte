<script module>
  import { onDestroy } from 'svelte';
  import Component from '../../core/component.js';
  import { modifier } from '../../core/modifier.js';
  import { truthy, on, prop } from '../../core/helpers.js';
  import { destroy } from '../../core/destroyable.js';
  import Icon from '../icon.svelte';

  // The scene as a tree. Each model shows how it's made, top to bottom:
  //
  //   Sword
  //   ├── Cube                 (its source)
  //   ├── Bevel
  //   ├── Boolean Subtract
  //   │   └── Cylinder         (the cutter, a real object you can select)
  //   ├── Smooth
  //   └── Outline
  //
  // Rows drag onto other rows to parent them (middle) or reorder (edges).

  const TYPE_ICON = {
    mesh: 'box',
    group: 'folder',
    empty: 'crosshair',
    armature: 'bone',
    camera: 'camera',
    light: 'lightbulb',
    control: 'circle-dot',
  };

  const eq = (a, b) => a === b;

  class StudioOutliner extends Component {
    collapsed = $state.raw(new Set());
    drop = $state.raw(null); // { id, where: 'before' | 'inside' | 'after' }
    filter = $state.raw('');

    get s() {
      return this.args.s;
    }

    get rows() {
      const s = this.s;
      const doc = s.doc;
      const q = this.filter.trim().toLowerCase();
      const sel = new Set(s.selected);
      const rows = [];
      const cutterOf = new Map();
      for (const o of Object.values(doc.objects))
        for (const m of o.stack ?? [])
          if (m.type === 'boolean' && m.params.operand)
            cutterOf.set(m.params.operand, o.id);
      const objRow = (o, depth) => {
        const hasKids = o.children.length > 0 || (o.stack?.length ?? 0) > 0;
        rows.push({
          kind: 'object',
          key: o.id,
          o,
          depth,
          icon:
            o.type === 'mesh' && o.source?.kind === 'primitive'
              ? (s.E.PRIMITIVES[o.source.prim]?.icon ?? 'box')
              : o.source?.kind === 'outline'
                ? 'circle-dashed'
                : (TYPE_ICON[o.type] ?? 'box'),
          selected: sel.has(o.id),
          active: o.id === s.active,
          hidden: o.visible === false,
          cutter: cutterOf.has(o.id),
          hasKids,
          open: !this.collapsed.has(o.id),
          drop: this.drop?.id === o.id ? this.drop.where : null,
          style: `padding-left:${6 + depth * 14}px`,
        });
      };
      const visit = (id, depth) => {
        const o = doc.objects[id];
        if (!o) return;
        if (q && !o.name.toLowerCase().includes(q)) {
          for (const c of o.children) visit(c, depth);
          return;
        }
        objRow(o, depth);
        if (this.collapsed.has(o.id) || q) return;
        if (o.type === 'mesh') {
          const src = o.source;
          const srcLabel =
            src?.kind === 'primitive'
              ? s.E.PRIMITIVES[src.prim]?.label
              : src?.kind === 'outline'
                ? `Outline of ${doc.objects[src.of]?.name ?? '?'}`
                : 'Mesh';
          if (o.stack?.length)
            rows.push({
              kind: 'source',
              key: `${o.id}:src`,
              label: srcLabel,
              icon:
                src?.kind === 'primitive'
                  ? (s.E.PRIMITIVES[src.prim]?.icon ?? 'box')
                  : 'spline-pointer',
              style: `padding-left:${6 + (depth + 1) * 14}px`,
            });
          for (const m of o.stack ?? []) {
            const def = s.E.MODIFIERS[m.type];
            const label =
              m.type === 'boolean'
                ? `Boolean ${m.params.op[0].toUpperCase()}${m.params.op.slice(1)}`
                : (def?.label ?? m.type);
            rows.push({
              kind: 'mod',
              key: m.id,
              o,
              mod: m,
              label,
              icon: def?.icon ?? 'layers',
              off: !m.on,
              style: `padding-left:${6 + (depth + 1) * 14}px`,
            });
            if (
              m.type === 'boolean' &&
              doc.objects[m.params.operand]?.parent === o.id
            )
              visit(m.params.operand, depth + 2);
          }
        }
        for (const c of o.children) {
          const cut = cutterOf.get(c);
          if (
            cut === o.id &&
            o.stack?.some((m) => m.type === 'boolean' && m.params.operand === c)
          )
            continue;
          visit(c, depth + 1);
        }
      };
      for (const id of doc.roots) visit(id, 0);
      return rows;
    }

    toggleOpen = (id, e) => {
      e.stopPropagation();
      const next = new Set(this.collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      this.collapsed = next;
    };

    pick = (id, e) => this.s.selectOne(id, e);

    pickMod = (o, e) => {
      this.s.selectOne(o.id, e);
      this.s.rightTab = 'object';
    };

    eye = (id, e) => {
      e.stopPropagation();
      this.s.toggleVisible(id);
    };

    lock = (id, e) => {
      e.stopPropagation();
      this.s.toggleLock(id);
    };

    modToggle = (o, mod, e) => {
      e.stopPropagation();
      if (this.s.active !== o.id) this.s.select([o.id]);
      this.s.toggleMod(mod.id);
    };

    startRename = (id) => this.s.startRename(id);

    finishRename = (id, e) => this.s.rename(id, e.target.value);

    renameKey = (id, e) => {
      e.stopPropagation();
      if (e.key === 'Enter') e.target.blur();
      if (e.key === 'Escape') this.s.renaming = null;
    };

    focusInput = (el) => requestAnimationFrame(() => el.select());

    // ─── Drag and drop ────────────────────────────────────────────────

    dragStart = (id, e) => {
      e.dataTransfer.setData('text/x-studio-object', id);
      e.dataTransfer.effectAllowed = 'move';
      this.dragging = id;
    };

    dragOver = (id, e) => {
      if (!this.dragging || this.dragging === id) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      const where = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
      if (this.drop?.id !== id || this.drop.where !== where)
        this.drop = { id, where };
    };

    dragLeave = (id) => {
      if (this.drop?.id === id) this.drop = null;
    };

    dropOn = (id, e) => {
      e.preventDefault();
      const src = this.dragging;
      const d = this.drop;
      this.drop = null;
      this.dragging = null;
      if (!src || !d) return;
      const doc = this.s.doc;
      const target = doc.objects[id];
      if (d.where === 'inside') return this.s.reparent(src, id, -1);
      const siblings = target.parent
        ? doc.objects[target.parent].children
        : doc.roots;
      let index = siblings.indexOf(id) + (d.where === 'after' ? 1 : 0);
      const from = siblings.indexOf(src);
      if (from >= 0 && from < index) index--;
      this.s.reparent(src, target.parent ?? null, index);
    };

    dropRoot = (e) => {
      e.preventDefault();
      const src = this.dragging;
      this.dragging = null;
      this.drop = null;
      if (src) this.s.reparent(src, null, -1);
    };

    allowRoot = (e) => {
      if (this.dragging) e.preventDefault();
    };

    setFilter = (e) => (this.filter = e.target.value);
    stop = (e) => e.stopPropagation();
  }

  function concat(...parts) {
    return parts.join('');
  }

  // Runs a callback with the element once it's in the page.
  const focusOnInsert = modifier((element, [callback]) => {
    callback(element);
  });
</script>

<script>
  let args = $props();
  const self = new StudioOutliner(args);
  onDestroy(() => destroy(self));
</script>

<!-- template-lint-disable no-invalid-interactive -->
<section class="st-outliner" aria-label="Scene">
  <div class="st-panel-head">
    <span>Scene</span>
    <input
      type="search"
      class="st-filter"
      placeholder="Filter"
      aria-label="Filter objects"
      {@attach prop('value', () => self.filter)}
      {@attach on('keydown', self.stop)}
      oninput={self.setFilter}
    />
  </div>
  <ul class="st-tree" ondrop={self.dropRoot} ondragover={self.allowRoot}>
    {#each self.rows ?? [] as r}
      {#if truthy(eq(r?.kind, 'object'))}
        <li
          class="st-row
                {truthy(r?.selected) ? 'selected' : ''}
                {truthy(r?.active) ? 'active' : ''}
                {truthy(r?.hidden) ? 'is-hidden' : ''}
                {truthy(r?.cutter) ? 'is-cutter' : ''}
                {truthy(r?.drop) ? concat('drop-', r?.drop) : ''}"
          style={r?.style}
          draggable="true"
          data-id={r?.o?.id}
          ondrop={(..._r) => self.dropOn(r?.o?.id, ..._r)}
          ondragleave={(..._r) => self.dragLeave(r?.o?.id, ..._r)}
          ondragover={(..._r) => self.dragOver(r?.o?.id, ..._r)}
          ondragstart={(..._r) => self.dragStart(r?.o?.id, ..._r)}
          ondblclick={(..._r) => self.startRename(r?.o?.id, ..._r)}
          onclick={(..._r) => self.pick(r?.o?.id, ..._r)}
        >
          {#if truthy(r?.hasKids)}
            <button
              type="button"
              class="st-twisty {truthy(r?.open) ? 'open' : ''}"
              aria-label={truthy(r?.open) ? 'Collapse' : 'Expand'}
              {@attach on('click', (..._r) => self.toggleOpen(r?.o?.id, ..._r))}
              ><Icon name="chevron-right" size={11} /></button
            >
          {:else}
            <span class="st-twisty"></span>
          {/if}
          <Icon name={r?.icon} size={13} class="st-row-icon" />
          {#if truthy(eq(args.s?.renaming, r?.o?.id))}
            <input
              class="st-rename"
              type="text"
              {@attach prop('value', () => r?.o?.name)}
              aria-label="Name"
              {@attach on('keydown', (..._r) =>
                self.renameKey(r?.o?.id, ..._r),
              )}
              onblur={(..._r) => self.finishRename(r?.o?.id, ..._r)}
              {@attach focusOnInsert([self.focusInput])}
            />
          {:else}
            <span class="st-row-name">{r?.o?.name}</span>
          {/if}
          {#if truthy(r?.o?.locked)}<Icon
              name="lock"
              size={11}
              class="st-row-flag"
            />{/if}
          <button
            type="button"
            class="st-row-btn"
            title={truthy(r?.o?.locked) ? 'Unlock' : 'Lock'}
            aria-label={truthy(r?.o?.locked) ? 'Unlock' : 'Lock'}
            {@attach on('click', (..._r) => self.lock(r?.o?.id, ..._r))}
            ><Icon
              name={truthy(r?.o?.locked) ? 'lock' : 'lock-open'}
              size={12}
            /></button
          >
          <button
            type="button"
            class="st-row-btn st-eye"
            title={truthy(r?.hidden) ? 'Show' : 'Hide'}
            aria-label={truthy(r?.hidden) ? 'Show' : 'Hide'}
            {@attach on('click', (..._r) => self.eye(r?.o?.id, ..._r))}
            ><Icon
              name={truthy(r?.hidden) ? 'eye-off' : 'eye'}
              size={12}
            /></button
          >
        </li>
      {:else if truthy(eq(r?.kind, 'source'))}
        <li class="st-row st-row-sub is-source" style={r?.style}>
          <span class="st-twisty"></span>
          <Icon name={r?.icon} size={12} class="st-row-icon" />
          <span class="st-row-name">{r?.label}</span>
        </li>
      {:else}
        <li
          class="st-row st-row-sub is-mod {truthy(r?.off) ? 'is-off' : ''}"
          style={r?.style}
          onclick={(..._r) => self.pickMod(r?.o, ..._r)}
        >
          <span class="st-twisty"></span>
          <Icon name={r?.icon} size={12} class="st-row-icon" />
          <span class="st-row-name">{r?.label}</span>
          <button
            type="button"
            class="st-row-btn st-eye"
            title={truthy(r?.off) ? 'Turn on' : 'Turn off'}
            aria-label={truthy(r?.off) ? 'Turn on' : 'Turn off'}
            {@attach on('click', (..._r) =>
              self.modToggle(r?.o, r?.mod, ..._r),
            )}
            ><Icon
              name={truthy(r?.off) ? 'eye-off' : 'eye'}
              size={12}
            /></button
          >
        </li>
      {/if}
    {:else}
      <li class="st-empty">Nothing here yet. Add something with +.</li>
    {/each}
  </ul>
</section>
