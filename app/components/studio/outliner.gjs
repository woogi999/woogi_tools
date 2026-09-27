import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import Icon from '../icon';

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

export default class StudioOutliner extends Component {
  @tracked collapsed = new Set();
  @tracked drop = null; // { id, where: 'before' | 'inside' | 'after' }
  @tracked filter = '';

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
        style: htmlSafe(`padding-left:${6 + depth * 14}px`),
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
            style: htmlSafe(`padding-left:${6 + (depth + 1) * 14}px`),
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
            style: htmlSafe(`padding-left:${6 + (depth + 1) * 14}px`),
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

  <template>
    {{! template-lint-disable no-invalid-interactive }}
    <section class="st-outliner" aria-label="Scene">
      <div class="st-panel-head">
        <span>Scene</span>
        <input
          type="search"
          class="st-filter"
          placeholder="Filter"
          aria-label="Filter objects"
          value={{this.filter}}
          {{on "input" this.setFilter}}
          {{on "keydown" this.stop}}
        />
      </div>
      <ul
        class="st-tree"
        {{on "dragover" this.allowRoot}}
        {{on "drop" this.dropRoot}}
      >
        {{#each this.rows key="key" as |r|}}
          {{#if (eq r.kind "object")}}
            <li
              class="st-row
                {{if r.selected 'selected'}}
                {{if r.active 'active'}}
                {{if r.hidden 'is-hidden'}}
                {{if r.cutter 'is-cutter'}}
                {{if r.drop (concat 'drop-' r.drop)}}"
              style={{r.style}}
              draggable="true"
              data-id={{r.o.id}}
              {{on "click" (fn this.pick r.o.id)}}
              {{on "dblclick" (fn this.startRename r.o.id)}}
              {{on "dragstart" (fn this.dragStart r.o.id)}}
              {{on "dragover" (fn this.dragOver r.o.id)}}
              {{on "dragleave" (fn this.dragLeave r.o.id)}}
              {{on "drop" (fn this.dropOn r.o.id)}}
            >
              {{#if r.hasKids}}
                <button
                  type="button"
                  class="st-twisty {{if r.open 'open'}}"
                  aria-label={{if r.open "Collapse" "Expand"}}
                  {{on "click" (fn this.toggleOpen r.o.id)}}
                ><Icon @name="chevron-right" @size={{11}} /></button>
              {{else}}
                <span class="st-twisty"></span>
              {{/if}}
              <Icon @name={{r.icon}} @size={{13}} class="st-row-icon" />
              {{#if (eq @s.renaming r.o.id)}}
                <input
                  class="st-rename"
                  type="text"
                  value={{r.o.name}}
                  aria-label="Name"
                  {{on "blur" (fn this.finishRename r.o.id)}}
                  {{on "keydown" (fn this.renameKey r.o.id)}}
                  {{focusOnInsert this.focusInput}}
                />
              {{else}}
                <span class="st-row-name">{{r.o.name}}</span>
              {{/if}}
              {{#if r.o.locked}}<Icon
                  @name="lock"
                  @size={{11}}
                  class="st-row-flag"
                />{{/if}}
              <button
                type="button"
                class="st-row-btn"
                title={{if r.o.locked "Unlock" "Lock"}}
                aria-label={{if r.o.locked "Unlock" "Lock"}}
                {{on "click" (fn this.lock r.o.id)}}
              ><Icon
                  @name={{if r.o.locked "lock" "lock-open"}}
                  @size={{12}}
                /></button>
              <button
                type="button"
                class="st-row-btn st-eye"
                title={{if r.hidden "Show" "Hide"}}
                aria-label={{if r.hidden "Show" "Hide"}}
                {{on "click" (fn this.eye r.o.id)}}
              ><Icon
                  @name={{if r.hidden "eye-off" "eye"}}
                  @size={{12}}
                /></button>
            </li>
          {{else if (eq r.kind "source")}}
            <li class="st-row st-row-sub is-source" style={{r.style}}>
              <span class="st-twisty"></span>
              <Icon @name={{r.icon}} @size={{12}} class="st-row-icon" />
              <span class="st-row-name">{{r.label}}</span>
            </li>
          {{else}}
            <li
              class="st-row st-row-sub is-mod {{if r.off 'is-off'}}"
              style={{r.style}}
              {{on "click" (fn this.pickMod r.o)}}
            >
              <span class="st-twisty"></span>
              <Icon @name={{r.icon}} @size={{12}} class="st-row-icon" />
              <span class="st-row-name">{{r.label}}</span>
              <button
                type="button"
                class="st-row-btn st-eye"
                title={{if r.off "Turn on" "Turn off"}}
                aria-label={{if r.off "Turn on" "Turn off"}}
                {{on "click" (fn this.modToggle r.o r.mod)}}
              ><Icon @name={{if r.off "eye-off" "eye"}} @size={{12}} /></button>
            </li>
          {{/if}}
        {{else}}
          <li class="st-empty">Nothing here yet. Add something with +.</li>
        {{/each}}
      </ul>
    </section>
  </template>
}

function concat(...parts) {
  return parts.join('');
}

// Runs a callback with the element once it's in the page.
const focusOnInsert = modifier((element, [callback]) => {
  callback(element);
});
