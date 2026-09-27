import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

// A number you can type into or drag sideways to scrub (as in Blender):
// every step of a drag calls @onChange(value, false), the release calls it
// with true, so a whole drag is one undo step. Shift drags finely, Ctrl
// snaps to whole steps.
export default class StNum extends Component {
  @tracked editing = false;
  drag = null;

  get step() {
    return this.args.step ?? 0.01;
  }

  get display() {
    const v = Number(this.args.value ?? 0);
    if (this.args.int) return String(Math.round(v));
    const decimals = this.step >= 1 ? 0 : this.step >= 0.1 ? 2 : 3;
    return (Math.round(v * 10 ** decimals) / 10 ** decimals).toString();
  }

  clamp(v) {
    let out = v;
    if (this.args.min !== undefined) out = Math.max(this.args.min, out);
    if (this.args.max !== undefined) out = Math.min(this.args.max, out);
    return this.args.int ? Math.round(out) : out;
  }

  down = (e) => {
    if (this.editing || e.button !== 0) return;
    e.preventDefault();
    this.drag = {
      x: e.clientX,
      start: Number(this.args.value ?? 0),
      moved: false,
      id: e.pointerId,
    };
    capture(e.currentTarget, e.pointerId);
  };

  move = (e) => {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    const perPx = this.args.int ? 0.1 : this.step * (e.shiftKey ? 0.1 : 1);
    let v = d.start + dx * perPx;
    if (e.ctrlKey)
      v =
        Math.round(v / (this.args.int ? 1 : this.step * 10)) *
        (this.args.int ? 1 : this.step * 10);
    v = this.clamp(v);
    if (v !== this.last) {
      this.last = v;
      this.args.onChange?.(v, false);
    }
  };

  up = () => {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (!d.moved) {
      this.editing = true;
      requestAnimationFrame(() => {
        const input = document.getElementById(this.inputId);
        input?.focus();
        input?.select();
      });
      return;
    }
    this.args.onChange?.(this.last ?? d.start, true);
    this.last = undefined;
  };

  inputId = `stn${Math.random().toString(36).slice(2, 8)}`;

  commit = (e) => {
    // Removing the input fires blur again, mid-render: nothing to do then.
    if (!this.editing) return;
    const raw = e.target.value.trim();
    this.editing = false;
    if (raw === '') return;
    // Simple arithmetic is allowed: "2*3", "1/4 + 0.5".
    let v = Number(raw);
    if (Number.isNaN(v)) v = arithmetic(raw);
    if (Number.isFinite(v)) this.args.onChange?.(this.clamp(v), true);
  };

  key = (e) => {
    if (e.key === 'Enter') e.target.blur();
    if (e.key === 'Escape') {
      this.editing = false;
    }
    e.stopPropagation();
  };

  <template>
    {{! Scrubbing starts on press, as in every 3D app. }}
    {{! template-lint-disable no-pointer-down-event-binding }}
    <label class="st-num {{if @axis (concat 'axis-' @axis)}}" title={{@title}}>
      {{#if @label}}<span class="st-num-label">{{@label}}</span>{{/if}}
      {{#if this.editing}}
        <input
          id={{this.inputId}}
          class="st-num-input"
          type="text"
          value={{this.display}}
          {{on "blur" this.commit}}
          {{on "keydown" this.key}}
        />
      {{else}}
        <span
          class="st-num-value"
          role="spinbutton"
          aria-valuenow={{this.display}}
          aria-label={{if @label @label @title}}
          {{on "pointerdown" this.down}}
          {{on "pointermove" this.move}}
          {{on "pointerup" this.up}}
        >{{this.display}}</span>
      {{/if}}
    </label>
  </template>
}

// + − × ÷ and brackets, without eval.
function arithmetic(src) {
  const tokens = src.match(/\d*\.?\d+(?:e[+-]?\d+)?|[-+*/()]/gi);
  if (!tokens || tokens.join('') !== src.replace(/\s+/g, '')) return NaN;
  let i = 0;
  const expr = () => {
    let v = term();
    while (tokens[i] === '+' || tokens[i] === '-')
      v = tokens[i++] === '+' ? v + term() : v - term();
    return v;
  };
  const term = () => {
    let v = factor();
    while (tokens[i] === '*' || tokens[i] === '/')
      v = tokens[i++] === '*' ? v * factor() : v / factor();
    return v;
  };
  const factor = () => {
    const t = tokens[i++];
    if (t === '-') return -factor();
    if (t === '+') return factor();
    if (t === '(') {
      const v = expr();
      i++;
      return v;
    }
    return Number(t);
  };
  const v = expr();
  return i === tokens.length ? v : NaN;
}

function concat(...parts) {
  return parts.join('');
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
