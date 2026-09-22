# Translates Ferrite's Rust effect catalogue into the JS one.
import re, io, sys, json

SRC = r'E:\coding_projects\Project_Ferrite\crates\ferrite-core\src\effects.rs'
OUT = r'E:\coding_projects\woogi_tools\app\utils\ferrite\effects.js'

src = io.open(SRC, encoding='utf-8').read()
body = src[src.index('pub static CATALOG'):]

def split_top(text, sep_re):
    idx = [m.start() for m in re.finditer(sep_re, text)]
    return idx

def strip_comments(text):
    return '\n'.join(
        line for line in text.split('\n') if not line.strip().startswith('//')
    )

parts = [strip_comments(x) for x in re.split(r'\n    EffectDef \{\n', body)[1:]]

def strlit(s):
    return json.dumps(s)

def split_args(s):
    """Split a comma-separated arg list respecting nesting and strings."""
    out, depth, cur, i, instr = [], 0, '', 0, False
    while i < len(s):
        ch = s[i]
        if instr:
            cur += ch
            if ch == '\\':
                cur += s[i+1]; i += 2; continue
            if ch == '"': instr = False
            i += 1; continue
        if ch == '"':
            instr = True; cur += ch; i += 1; continue
        if ch in '([{': depth += 1
        if ch in ')]}': depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur.strip()); cur = ''; i += 1; continue
        cur += ch; i += 1
    if cur.strip(): out.append(cur.strip())
    return out

IDENT = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.')

def receiver_before(e, dot):
    """Walk back from a method's dot to the start of what it is called on.

    A greedy character class cannot do this: in `Math.sqrt(Math.max(a, b))`
    the receiver of `.max` is `Math`, not `Math.sqrt(Math`, and a class that
    includes brackets happily swallows the lot and then rewrites its own
    output forever.
    """
    i = dot
    depth = 0
    while i > 0:
        ch = e[i - 1]
        if ch in ')]':
            depth += 1
        elif ch in '([':
            if depth == 0:
                break
            depth -= 1
        elif depth == 0 and ch not in IDENT:
            break
        i -= 1
    return i

def find_call(e, method):
    """Where `.method(` is, and what it is called on, or None."""
    needle = '.%s(' % method
    at = 0
    while True:
        dot = e.find(needle, at)
        if dot < 0:
            return None
        start = receiver_before(e, dot)
        receiver = e[start:dot]
        # `Math.max(...)` is this rule's own output; rewriting it again never
        # terminates.
        if receiver and receiver != 'Math':
            return start, dot, receiver, dot + len(needle)
        at = dot + 1

def call_args(e, i):
    """The arguments of a call whose open bracket has just been passed."""
    args, depth, cur = [], 0, ''
    while i < len(e):
        ch = e[i]
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            if depth == 0:
                break
            depth -= 1
        if ch == ',' and depth == 0:
            args.append(cur.strip()); cur = ''; i += 1; continue
        cur += ch; i += 1
    args.append(cur.strip())
    return [a for a in args if a], i + 1

def expr(e):
    """Rust expression -> JS expression."""
    e = e.strip()
    changed = True
    while changed:
        changed = False
        for name, js in (('abs', 'Math.abs'), ('round', 'Math.round'),
                         ('sqrt', 'Math.sqrt'), ('cos', 'Math.cos'),
                         ('sin', 'Math.sin'), ('max', 'Math.max'),
                         ('min', 'Math.min'), ('powf', 'Math.pow'),
                         ('clamp', 'clamp'), ('to_radians', 'RADIANS')):
            hit = find_call(e, name)
            if not hit:
                continue
            start, _, receiver, after = hit
            args, end = call_args(e, after)
            if js == 'RADIANS':
                rebuilt = '((%s) * Math.PI / 180)' % receiver
            else:
                rebuilt = '%s(%s)' % (js, ', '.join([receiver] + args))
            e = e[:start] + rebuilt + e[end:]
            changed = True
    e = e.replace('.into()', '')
    # Numeric literals carry their type in Rust: `2f32`, `3.0f32`.
    e = re.sub(r'(\d)f32\b', r'\1', e)
    e = re.sub(r'\bf32\b', 'Number', e)
    e = re.sub(r'(\d)_(\d)', r'\1\2', e)
    e = re.sub(r'\b(\d+)\.0\b', r'\1', e)
    e = e.replace('as Number', '')
    return e.strip()

FMT = re.compile(r'\{(:[^}]*)?\}')

def fmt_to_template(fmt, args):
    """Rust format! -> JS template literal."""
    it = iter(args)
    out = []
    i = 0
    while i < len(fmt):
        if fmt.startswith('{{', i):
            out.append('{'); i += 2; continue
        if fmt.startswith('}}', i):
            out.append('}'); i += 2; continue
        m = FMT.match(fmt, i)
        if m:
            spec = m.group(1) or ''
            try:
                a = expr(next(it))
            except StopIteration:
                raise ValueError('not enough args for ' + fmt)
            prec = re.match(r':\.(\d+)', spec)
            if prec:
                a = '(%s).toFixed(%s)' % (a, prec.group(1))
            out.append('${' + a + '}')
            i = m.end(); continue
        c = fmt[i]
        if c == '`': out.append('\\`')
        elif c == '\\': out.append('\\\\')
        elif c == '$': out.append('\\$')
        else: out.append(c)
        i += 1
    return '`' + ''.join(out) + '`'

def rust_string(s):
    """Decode a Rust string literal body."""
    return s.encode().decode('unicode_escape')

def translate_format(call):
    """`format!("...", a, b)` -> JS template literal."""
    inner = call[call.index('(')+1:call.rindex(')')]
    args = split_args(inner)
    fmt = args[0].strip()
    assert fmt.startswith('"') and fmt.endswith('"'), fmt
    return fmt_to_template(rust_string(fmt[1:-1]), args[1:])

def translate_body(b):
    """The body of a render closure -> a JS function body."""
    b = b.strip().rstrip(',').strip()
    lines = []
    # strip an outer block
    if b.startswith('{') and b.endswith('}'):
        b = b[1:-1].strip()
    # statements: `let` lines then a trailing expression
    while b.startswith('let '):
        stmt, b = b.split(';', 1)
        b = b.strip()
        lhs, rhs = stmt[4:].split('=', 1)
        lhs, rhs = lhs.strip(), rhs.strip()
        if lhs.startswith('('):
            names = [n.strip() for n in lhs[1:-1].split(',')]
            vals = split_args(rhs[1:-1]) if rhs.startswith('(') else [rhs]
            lines.append('const [%s] = [%s];' % (', '.join(names), ', '.join(expr(v) for v in vals)))
        else:
            lines.append('const %s = %s;' % (lhs, expr(rhs)))
    b = b.strip()
    if b.startswith('format!'):
        lines.append('return %s;' % translate_format(b))
    elif b.startswith('if '):
        raise ValueError('if')
    else:
        lines.append('return %s;' % expr(b))
    return '\n      '.join(lines)

def parse_params(text):
    """The `params: &[ ... ]` body -> a JS array literal."""
    items = split_args(text)
    out = []
    for it in items:
        it = it.strip()
        if not it: continue
        if it.startswith('space_param()'):
            out.append('spaceParam()')
        elif it.startswith('choice('):
            args = split_args(it[it.index('(')+1:it.rindex(')')])
            label, default, choices = args[0], args[1], args[2]
            names = re.findall(r'"([^"]*)"', choices)
            out.append('choice(%s, %s, [%s])' % (label, expr(default), ', '.join(strlit(n) for n in names)))
        elif it.startswith('p('):
            args = [expr(a) for a in split_args(it[it.index('(')+1:it.rindex(')')])]
            args[0] = split_args(it[it.index('(')+1:it.rindex(')')])[0]
            args[5] = split_args(it[it.index('(')+1:it.rindex(')')])[5]
            out.append('p(%s)' % ', '.join(args))
        else:
            raise ValueError('param: ' + it)
    return '[' + ', '.join(out) + ']'

def parse_colors(text):
    items = split_args(text)
    out = []
    for it in items:
        it = it.strip()
        if not it: continue
        args = split_args(it[it.index('(')+1:it.rindex(')')])
        out.append('c(%s, %s)' % (args[0], args[1]))
    return '[' + ', '.join(out) + ']'

def field(entry, name):
    m = re.search(r'\n        %s: ' % name, entry)
    if not m: return None
    rest = entry[m.end():]
    depth, i = 0, 0
    while i < len(rest):
        ch = rest[i]
        if ch == '"':
            i += 1
            while rest[i] != '"':
                if rest[i] == '\\': i += 1
                i += 1
        elif ch in '([{': depth += 1
        elif ch in ')]}': depth -= 1
        elif ch == ',' and depth == 0:
            break
        i += 1
    return rest[:i].strip()

entries, failed = [], []
for part in parts:
    entry = '\n' + part
    name = field(entry, 'name')
    category = field(entry, 'category')
    description = field(entry, 'description')
    slot = field(entry, 'slot').split('::')[1]
    params = field(entry, 'params')
    colors = field(entry, 'colors')
    # The closure's own `|v, _|` has a top-level comma in it, so the render
    # field is taken as everything from its key to the end of the entry.
    KEY = '\n        render: '
    tail = entry[entry.index(KEY):]
    end = tail.rindex('\n    },')
    render = tail[len(KEY):end].strip().rstrip(',')
    try:
        ps = parse_params(params[params.index('[')+1:params.rindex(']')])
        cs = parse_colors(colors[colors.index('[')+1:colors.rindex(']')])
        assert render.startswith('|'), render[:40]
        rb = render[render.index('|', 1) + 1:]
        fn = 'render: (v, col) => {\n      %s\n    },' % translate_body(rb)
    except Exception as ex:
        failed.append((rust_string(name[1:-1]), str(ex)))
        continue
    entries.append(
        '  {\n'
        '    name: %s,\n'
        '    category: %s,\n'
        '    description: %s,\n'
        '    slot: %s,\n'
        '    params: %s,\n'
        '    colors: %s,\n'
        '    %s\n'
        '  },' % (name, category, description, strlit(slot[0].lower() + slot[1:]), ps, cs, fn)
    )

sys.stderr.write('translated %d, failed %d\n' % (len(entries), len(failed)))
for n, why in failed:
    sys.stderr.write('  FAILED %s: %s\n' % (n, why))

header = '''// Ferrite's effect catalogue, translated from `ferrite-core/src/effects.rs`.
//
// An effect is a named, parameterised contribution to one CSS property of a
// layer. Nothing here rasterises anything: an effect turns its sampled
// parameters into a CSS fragment, and the compositor in `render.js` decides
// what to do with the fragment. Effects in the same slot are joined in stack
// order, which is what makes the stack an After Effects stack — the order in
// the list is the order they apply, and any one can be switched off without
// losing its settings.
//
// This file is generated from the Rust catalogue and then kept by hand; the
// three effects whose Rust bodies branch are written out below the generated
// ones.

const n = (v) =>
  Math.abs(v - Math.round(v)) < 0.0005 ? String(Math.round(v)) : v.toFixed(3);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// One animatable number belonging to an effect.
const p = (label, value, min, max, step, suffix) => ({
  label,
  value,
  min,
  max,
  step,
  suffix,
  choices: [],
});

// A parameter that picks from a short list. The value is the index — still a
// number, and still keyable, because a mode that could not be animated would
// be the one thing on a layer a timeline could not describe.
const choice = (label, value, choices) => ({
  label,
  value,
  min: 0,
  max: Math.max(0, choices.length - 1),
  step: 1,
  suffix: '',
  choices,
});

// The two frames a directional effect can work in. An effect runs on a surface
// the layer was drawn into before it was turned, so every angle is in the
// layer's own frame and turns with it — right for a bevel, whose light is
// bolted to the object, wrong for a long shadow, which is cast onto the world.
export const SPACES = ['Layer', 'Comp'];
const spaceParam = () => choice('Angle follows', 0, SPACES);

// A colour parameter. Colours are not keyframed: the whole declaration is
// interpolated anyway.
const c = (label, value) => ({ label, value });

// The CSS property an effect contributes to, and how two fragments in the same
// slot are joined.
export const SLOTS = {
  filter: { css: 'filter', separator: ' ' },
  backdropFilter: { css: 'backdrop-filter', separator: ' ' },
  boxShadow: { css: 'box-shadow', separator: ', ' },
  maskImage: { css: 'mask-image', separator: ', ' },
  backgroundImage: { css: 'background-image', separator: ', ' },
};

export const CATALOG = [
'''

footer = '''];

export const CATEGORIES = [...new Set(CATALOG.map((d) => d.category))];

export const effectDef = (name) => CATALOG.find((d) => d.name === name);

// A fresh instance of an effect, with every parameter at its default.
let nextEffectId = 1;
export function makeEffect(name) {
  const def = effectDef(name);
  if (!def) return null;
  return {
    id: `fx${nextEffectId++}`,
    name,
    enabled: true,
    // Parameter index -> value, or a keyframe track once the stopwatch is on.
    values: def.params.map((param) => param.value),
    tracks: {},
    colors: def.colors.map((colour) => colour.value),
  };
}
'''

io.open(OUT, 'w', encoding='utf-8').write(header + '\n'.join(entries) + '\n' + footer)
print('wrote', OUT)
