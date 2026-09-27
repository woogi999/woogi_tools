import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import Icon from '../icon';

// The 2D UV editor beside the viewport. It shows the active mesh's UVs over
// its texture (or a checker), selects faces (the same selection as edit
// mode in the viewport) and moves, turns and scales them by dragging.

const eq = (a, b) => a === b;

function checker() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 16; j++) {
      x.fillStyle = (i + j) % 2 ? '#3a3f4a' : '#525866';
      x.fillRect(i * 16, j * 16, 16, 16);
    }
  return c;
}

export default class StudioUvEditor extends Component {
  @tracked zoom = 1;
  @tracked pan = [0, 0];
  @tracked width = 400;
  @tracked height = 400;
  @tracked mode = 'move';
  @tracked background = 'texture';
  @tracked tick = 0;
  check = checker();

  get s() {
    return this.args.s;
  }

  get mesh() {
    const s = this.s;
    void s.uvVersion;
    return s.isMesh ? s.baseMesh : null;
  }

  // Unit square → canvas: centred, as large as fits, then zoomed and panned.
  get view() {
    const size = Math.min(this.width, this.height) * 0.86 * this.zoom;
    return {
      size,
      x0: (this.width - size) / 2 + this.pan[0],
      y0: (this.height - size) / 2 + this.pan[1],
    };
  }

  toScreen = (u, v) => {
    const { size, x0, y0 } = this.view;
    return [x0 + u * size, y0 + (1 - v) * size];
  };

  toUv = (x, y) => {
    const { size, x0, y0 } = this.view;
    return [(x - x0) / size, 1 - (y - y0) / size];
  };

  attach = modifier((canvas) => {
    this.canvas = canvas;
    const ro = new ResizeObserver(() => {
      const r = canvas.parentElement.getBoundingClientRect();
      this.width = Math.max(100, r.width);
      this.height = Math.max(100, r.height);
    });
    ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  });

  paint = modifier((canvas, [mesh, edit, width, height, extra]) => {
    void extra;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const { size, x0, y0 } = this.view;
    // Background: the painted texture, an uploaded map, or a checker.
    const set = this.s.texSet;
    const mat = this.s.mat;
    const uploaded = mat?.maps?.color
      ? this.s.images.get(mat.maps.color)
      : null;
    const bg =
      this.background === 'texture'
        ? ((set?.map ? set.canvases.color : uploaded) ?? this.check)
        : this.check;
    ctx.globalAlpha = bg === this.check ? 1 : 0.85;
    ctx.imageSmoothingEnabled = bg !== this.check;
    ctx.drawImage(bg, x0, y0, size, size);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, size, size);
    if (!mesh) return;
    const sel = edit?.faces ?? new Set();
    // Faces: all as a faint wire, the selected ones filled.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(20,22,28,0.85)';
    ctx.beginPath();
    for (const f of mesh.f) {
      f.uv.forEach(([u, v], k) => {
        const [x, y] = this.toScreen(u, v);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(230,232,240,0.55)';
    ctx.stroke();
    if (sel.size) {
      ctx.fillStyle = 'rgba(255,154,60,0.28)';
      ctx.strokeStyle = '#ff9a3c';
      ctx.beginPath();
      for (const fi of sel) {
        const f = mesh.f[fi];
        if (!f) continue;
        f.uv.forEach(([u, v], k) => {
          const [x, y] = this.toScreen(u, v);
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }
    if (this.box) {
      const b = this.box;
      ctx.strokeStyle = '#ff9a3c';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(
        Math.min(b.x0, b.x1) + 0.5,
        Math.min(b.y0, b.y1) + 0.5,
        Math.abs(b.x1 - b.x0),
        Math.abs(b.y1 - b.y0),
      );
      ctx.setLineDash([]);
    }
  });

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  faceAt(uv) {
    const mesh = this.mesh;
    if (!mesh) return null;
    for (let fi = mesh.f.length - 1; fi >= 0; fi--)
      if (inPoly(uv, mesh.f[fi].uv)) return fi;
    return null;
  }

  ensureEdit() {
    const s = this.s;
    if (s.mode !== 'edit') s.enterEdit('face');
    if (s.edit.mode !== 'face') s.setSelectMode('face');
  }

  down = (e) => {
    const [x, y] = this.local(e);
    capture(this.canvas, e.pointerId);
    if (e.button === 1 || e.button === 2 || e.altKey) {
      this.drag = { kind: 'pan', x, y, pan: [...this.pan] };
      return;
    }
    this.ensureEdit();
    const s = this.s;
    const uv = this.toUv(x, y);
    const fi = this.faceAt(uv);
    const sel = s.edit.faces;
    if (fi !== null && sel.has(fi) && !e.shiftKey) {
      const faces = new Set(sel);
      let cu = 0,
        cv = 0,
        n = 0;
      for (const f of faces)
        for (const t of s.baseMesh.f[f].uv) ((cu += t[0]), (cv += t[1]), n++);
      this.drag = {
        kind: 'uv',
        faces,
        start: uv,
        pivot: [cu / n, cv / n],
        moved: false,
      };
      return;
    }
    if (fi !== null) {
      // Clicking a face selects its whole island, as UV work is usually by island.
      const mesh = s.baseMesh;
      const island =
        s.E.uv.uvIslands(mesh).find((isl) => isl.has(fi)) ?? new Set([fi]);
      const next = e.shiftKey ? new Set([...sel, ...island]) : island;
      if (e.shiftKey && [...island].every((f) => sel.has(f)))
        for (const f of island) next.delete(f);
      s.edit = s.withSel({
        mode: 'face',
        verts: new Set(),
        edges: new Set(),
        faces: next,
      });
      this.drag = {
        kind: 'uv',
        faces: next,
        start: uv,
        pivot: this.centre(next),
        moved: false,
      };
      return;
    }
    this.drag = { kind: 'box', add: e.shiftKey };
    this.box = { x0: x, y0: y, x1: x, y1: y };
  };

  centre(faces) {
    let cu = 0,
      cv = 0,
      n = 0;
    for (const f of faces)
      for (const t of this.s.baseMesh.f[f].uv)
        ((cu += t[0]), (cv += t[1]), n++);
    return n ? [cu / n, cv / n] : [0.5, 0.5];
  }

  transformFor(d, uv, e) {
    const du = uv[0] - d.start[0];
    const dv = uv[1] - d.start[1];
    const mode =
      e.ctrlKey || e.metaKey
        ? 'rotate'
        : e.shiftKey && this.mode === 'move'
          ? 'scale'
          : this.mode;
    if (mode === 'rotate') {
      const a0 = Math.atan2(d.start[1] - d.pivot[1], d.start[0] - d.pivot[0]);
      const a1 = Math.atan2(uv[1] - d.pivot[1], uv[0] - d.pivot[0]);
      return { rotate: ((a1 - a0) * 180) / Math.PI, pivot: d.pivot };
    }
    if (mode === 'scale') {
      const r0 =
        Math.hypot(d.start[0] - d.pivot[0], d.start[1] - d.pivot[1]) || 1e-6;
      const r1 = Math.hypot(uv[0] - d.pivot[0], uv[1] - d.pivot[1]);
      const k = r1 / r0;
      return { scale: [k, k], pivot: d.pivot };
    }
    return { move: [du, dv] };
  }

  move = (e) => {
    const d = this.drag;
    if (!d) return;
    const [x, y] = this.local(e);
    if (d.kind === 'pan') {
      this.pan = [d.pan[0] + x - d.x, d.pan[1] + y - d.y];
      return;
    }
    if (d.kind === 'box') {
      this.box = { ...this.box, x1: x, y1: y };
      this.tick++;
      return;
    }
    if (d.kind === 'uv') {
      const uv = this.toUv(x, y);
      if (
        !d.moved &&
        Math.hypot(uv[0] - d.start[0], uv[1] - d.start[1]) * this.view.size < 3
      )
        return;
      d.moved = true;
      d.last = this.transformFor(d, uv, e);
      this.s.uvTransform(d.faces, d.last, false);
    }
  };

  up = () => {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const s = this.s;
    if (d.kind === 'uv' && d.moved) s.uvTransform(d.faces, d.last, true);
    if (d.kind === 'box') {
      const b = this.box;
      this.box = null;
      this.tick++;
      const [u0, v1] = this.toUv(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
      const [u1, v0] = this.toUv(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
      const mesh = s.baseMesh;
      const picked = [];
      mesh.f.forEach((f, fi) => {
        const c = f.uv.reduce(
          (a, t) => [a[0] + t[0] / f.uv.length, a[1] + t[1] / f.uv.length],
          [0, 0],
        );
        if (c[0] >= u0 && c[0] <= u1 && c[1] >= v0 && c[1] <= v1)
          picked.push(fi);
      });
      const faces = d.add
        ? new Set([...s.edit.faces, ...picked])
        : new Set(picked);
      s.edit = s.withSel({
        mode: 'face',
        verts: new Set(),
        edges: new Set(),
        faces,
      });
    }
  };

  wheel = (e) => {
    e.preventDefault();
    const [x, y] = this.local(e);
    const before = this.toUv(x, y);
    this.zoom = Math.max(
      0.2,
      Math.min(20, this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)),
    );
    const after = this.toScreen(...before);
    this.pan = [this.pan[0] + x - after[0], this.pan[1] + y - after[1]];
  };

  fit = () => {
    this.zoom = 1;
    this.pan = [0, 0];
  };

  setMode = (m) => (this.mode = m);
  toggleBg = () =>
    (this.background = this.background === 'texture' ? 'checker' : 'texture');
  prevent = (e) => e.preventDefault();

  <template>
    {{! template-lint-disable no-pointer-down-event-binding no-invalid-interactive }}
    <section class="st-uv" aria-label="UV editor">
      <div class="st-uv-head">
        <span class="st-h">UV editor</span>
        <div class="st-seg" role="group" aria-label="Drag does">
          <button
            type="button"
            class="{{if (eq this.mode 'move') 'on'}}"
            {{on "click" (fn this.setMode "move")}}
          ><Icon @name="move" @size={{12}} />Move</button>
          <button
            type="button"
            class="{{if (eq this.mode 'rotate') 'on'}}"
            {{on "click" (fn this.setMode "rotate")}}
          ><Icon @name="rotate-cw" @size={{12}} />Rotate</button>
          <button
            type="button"
            class="{{if (eq this.mode 'scale') 'on'}}"
            {{on "click" (fn this.setMode "scale")}}
          ><Icon @name="scaling" @size={{12}} />Scale</button>
        </div>
        <span class="st-spacer"></span>
        <button
          type="button"
          class="st-mini"
          title={{if
            (eq this.background "texture")
            "Show a checker"
            "Show the texture"
          }}
          aria-label="Background"
          {{on "click" this.toggleBg}}
        ><Icon
            @name={{if (eq this.background "texture") "image" "grid-3x3"}}
            @size={{12}}
          /></button>
        <button
          type="button"
          class="st-mini"
          title="Fit"
          aria-label="Fit"
          {{on "click" this.fit}}
        ><Icon @name="maximize" @size={{12}} /></button>
      </div>
      <div class="st-uv-wrap">
        <canvas
          class="st-uv-canvas"
          {{this.attach}}
          {{this.paint
            this.mesh
            @s.edit
            this.width
            this.height
            (array
              this.zoom
              this.pan
              this.tick
              this.background
              @s.paintState.texTick
              @s.images
            )
          }}
          {{on "pointerdown" this.down}}
          {{on "pointermove" this.move}}
          {{on "pointerup" this.up}}
          {{on "wheel" this.wheel}}
          {{on "contextmenu" this.prevent}}
        ></canvas>
      </div>
      <p class="st-uv-help">Click a face to pick its island · drag to
        {{this.mode}}
        · Shift adds · Ctrl drag rotates · wheel zooms · right drag pans</p>
    </section>
  </template>
}

function inPoly([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi
    )
      inside = !inside;
  }
  return inside;
}

function array(...xs) {
  return xs;
}

// Pointer capture keeps a drag going outside the element; a pointer the
// browser doesn't know (a synthetic event) can't be captured, which is fine.
function capture(el, id) {
  try {
    el.setPointerCapture?.(id);
    return true;
  } catch {
    return false; // not a live pointer
  }
}
