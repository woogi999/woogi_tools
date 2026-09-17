import {
  parse,
  evaluate,
  variablesIn,
  formatNumber,
  MathError,
} from './math-expr';

// ─── Polynomials ─────────────────────────────────────────────────────────
// A polynomial is a Map from a monomial key ("" for constants, "x^2*y") to
// its coefficient. Anything the AST can express with + - * and whole-number
// powers becomes one; everything else throws NotPolynomial.

class NotPolynomial extends Error {}

const EPS = 1e-10;
const near = (a, b = 0, eps = 1e-9) => Math.abs(a - b) < eps;

const keyOf = (powers) =>
  Object.keys(powers)
    .filter((v) => powers[v])
    .sort()
    .map((v) => (powers[v] === 1 ? v : `${v}^${powers[v]}`))
    .join('*');

function powersOf(key) {
  const powers = {};
  if (!key) return powers;
  for (const part of key.split('*')) {
    const [v, p] = part.split('^');
    powers[v] = p ? +p : 1;
  }
  return powers;
}

const degreeOfKey = (key) =>
  Object.values(powersOf(key)).reduce((a, b) => a + b, 0);

function clean(poly) {
  for (const [k, c] of poly) if (Math.abs(c) < EPS) poly.delete(k);
  return poly;
}

const constant = (c) => clean(new Map([['', c]]));

function add(a, b, sign = 1) {
  const out = new Map(a);
  for (const [k, c] of b) out.set(k, (out.get(k) ?? 0) + sign * c);
  return clean(out);
}

function mul(a, b) {
  const out = new Map();
  for (const [ka, ca] of a) {
    const pa = powersOf(ka);
    for (const [kb, cb] of b) {
      const powers = { ...pa };
      for (const [v, p] of Object.entries(powersOf(kb)))
        powers[v] = (powers[v] ?? 0) + p;
      const key = keyOf(powers);
      out.set(key, (out.get(key) ?? 0) + ca * cb);
    }
  }
  return clean(out);
}

const scale = (poly, s) =>
  clean(new Map([...poly].map(([k, c]) => [k, c * s])));
const isConstant = (poly) => [...poly.keys()].every((k) => k === '');
const constantValue = (poly) => poly.get('') ?? 0;

export function toPolynomial(node) {
  switch (node.type) {
    case 'var':
      return new Map([[node.name, 1]]);
    case 'neg':
      return scale(toPolynomial(node.arg), -1);
    case 'bin': {
      const left = toPolynomial(node.left);
      if (node.op === '^') {
        const exponent = toPolynomial(node.right);
        if (!isConstant(exponent)) throw new NotPolynomial();
        const n = constantValue(exponent);
        if (isConstant(left)) return constant(constantValue(left) ** n);
        if (!Number.isInteger(n) || n < 0 || n > 30) throw new NotPolynomial();
        let result = constant(1);
        for (let i = 0; i < n; i++) result = mul(result, left);
        return result;
      }
      const right = toPolynomial(node.right);
      if (node.op === '+') return add(left, right);
      if (node.op === '-') return add(left, right, -1);
      if (node.op === '*') return mul(left, right);
      if (!isConstant(right)) throw new NotPolynomial();
      if (near(constantValue(right), 0, EPS))
        throw new MathError('Division by zero');
      return scale(left, 1 / constantValue(right));
    }
    default:
      if (variablesIn(node).size) throw new NotPolynomial();
      return constant(evaluate(node));
  }
}

const polyDegree = (poly) => Math.max(0, ...[...poly.keys()].map(degreeOfKey));

// Coefficients of a single-variable polynomial, highest power first.
function coefficients(poly, variable) {
  const degree = polyDegree(poly);
  const coeffs = new Array(degree + 1).fill(0);
  for (const [k, c] of poly) {
    const p = powersOf(k)[variable] ?? 0;
    coeffs[degree - p] += c;
  }
  return coeffs;
}

// ─── Formatting ──────────────────────────────────────────────────────────

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

// 0.75 -> "3/4" when a small denominator reproduces the value exactly.
export function formatValue(n) {
  return rawValue(n).replace(/^-/, '−');
}

function rawValue(n) {
  if (!Number.isFinite(n)) return formatNumber(n);
  if (near(n, Math.round(n))) return formatNumber(Math.round(n));
  for (let d = 2; d <= 1000; d++) {
    const top = Math.round(n * d);
    if (near(top / d, n, 1e-9)) return `${top}/${d}`;
  }
  return formatNumber(n, 10);
}

function formatMonomial(key) {
  return key
    .split('*')
    .map((part) => part.replace(/\^(\d+)/, (_, p) => toSuperscript(p)))
    .join('');
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const toSuperscript = (digits) =>
  [...digits].map((d) => SUPERSCRIPT[+d]).join('');

export function formatPolynomial(poly) {
  const terms = [...poly]
    .filter(([, c]) => !near(c, 0, EPS))
    .sort(([a], [b]) => degreeOfKey(b) - degreeOfKey(a) || a.localeCompare(b));
  if (!terms.length) return '0';
  return terms
    .map(([k, c], i) => {
      const sign = c < 0 ? (i ? ' − ' : '−') : i ? ' + ' : '';
      const abs = Math.abs(c);
      const coef = k && near(abs, 1) ? '' : formatValue(abs);
      const wrapped = k && coef.includes('/') ? `(${coef})` : coef;
      return `${sign}${wrapped}${k ? formatMonomial(k) : ''}`;
    })
    .join('');
}

// ─── Root finding ────────────────────────────────────────────────────────

const cAdd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const cSub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cMul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
function cDiv(a, b) {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}

// Durand–Kerner: all complex roots of a polynomial at once.
function allRoots(coeffs) {
  const monic = coeffs.map((c) => c / coeffs[0]);
  const n = monic.length - 1;
  const evalAt = (z) =>
    monic.reduce((acc, c) => cAdd(cMul(acc, z), [c, 0]), [0, 0]);
  let roots = Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n + 0.4;
    return [0.9 * Math.cos(angle), 0.9 * Math.sin(angle)];
  });
  const radius = 1 + Math.max(...monic.slice(1).map(Math.abs));
  roots = roots.map(([re, im]) => [re * radius, im * radius]);
  for (let iter = 0; iter < 500; iter++) {
    let moved = 0;
    roots = roots.map((r, i) => {
      let denom = [1, 0];
      roots.forEach((s, j) => {
        if (i !== j) denom = cMul(denom, cSub(r, s));
      });
      const step = cDiv(evalAt(r), denom);
      moved = Math.max(moved, Math.hypot(...step));
      return cSub(r, step);
    });
    if (moved < 1e-14) break;
  }
  return roots.map(([re, im]) => [
    near(re, 0, 1e-9) ? 0 : re,
    near(im, 0, 1e-7) ? 0 : im,
  ]);
}

function formatComplex([re, im]) {
  if (!im) return formatValue(re);
  let imAbs = near(Math.abs(im), 1) ? '' : formatValue(Math.abs(im));
  if (!re) return `${im < 0 ? '−' : ''}${imAbs}i`;
  let reText = formatValue(re);
  // Don't mix a fraction with a long decimal in one number.
  if (imAbs.includes('.') !== reText.includes('.')) {
    reText = formatNumber(re, 10).replace(/^-/, '−');
    imAbs = formatNumber(Math.abs(im), 10);
  }
  return `${reText} ${im < 0 ? '−' : '+'} ${imAbs}i`;
}

// Square-free split: 72 -> [6, 2] because 72 = 6²·2
function splitSquare(n) {
  let outside = 1;
  let inside = n;
  for (let f = 2; f * f <= inside; f++) {
    while (inside % (f * f) === 0) {
      inside /= f * f;
      outside *= f;
    }
  }
  return [outside, inside];
}

// Exact form for quadratics with whole-number coefficients, e.g. "(−2 ± 3√2) / 4".
function exactQuadratic(a, b, c, variable) {
  if (![a, b, c].every((n) => Number.isInteger(n) && Math.abs(n) < 1e9))
    return null;
  const disc = b * b - 4 * a * c;
  if (!disc) return null;
  const [outside, inside] = splitSquare(Math.abs(disc));
  if (inside === 1 && disc >= 0) return null; // rational roots, the decimal list already says it
  let top = -b;
  let root = outside;
  let bottom = 2 * a;
  const g = gcd(gcd(top, root), bottom);
  [top, root, bottom] = [top / g, root / g, bottom / g];
  if (bottom < 0) [top, bottom] = [-top, -bottom];
  const radical = `${root === 1 ? '' : root}${inside === 1 ? '' : `√${inside}`}${disc < 0 ? 'i' : ''}`;
  const numerator = top ? `${formatValue(top)} ± ${radical}` : `±${radical}`;
  return `${variable} = ${bottom === 1 ? numerator : `(${numerator}) / ${bottom}`}`;
}

const MAX_NUMERIC_ROOTS = 10;

function numericRealRoots(f, from = -100, to = 100, steps = 4000) {
  const roots = [];
  const h = (to - from) / steps;
  let prevX = from;
  let prevY = f(prevX);
  const push = (x) => {
    if (!roots.some((r) => near(r, x, 1e-6))) roots.push(x);
  };
  for (let i = 1; i <= steps; i++) {
    const x = from + i * h;
    const y = f(x);
    if (Number.isFinite(prevY) && Math.abs(prevY) < 1e-12) push(prevX);
    else if (Number.isFinite(prevY) && Number.isFinite(y) && prevY * y < 0) {
      let lo = prevX;
      let hi = x;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2;
        if (f(lo) * f(mid) <= 0) hi = mid;
        else lo = mid;
      }
      const root = (lo + hi) / 2;
      // A sign change across a pole (like 1/x) isn't a root.
      if (Math.abs(f(root)) < 1e-6) push(root);
    }
    prevX = x;
    prevY = y;
  }
  return roots.map((r) => (near(r, Math.round(r), 1e-9) ? Math.round(r) : r));
}

// ─── Public operations ───────────────────────────────────────────────────

function splitEquation(line) {
  const sides = line.split('=');
  if (sides.length > 2) throw new MathError('Use a single "=" per equation');
  const left = parse(sides[0]);
  const right =
    sides.length === 2 ? parse(sides[1]) : { type: 'num', value: 0 };
  return { left, right, tree: { type: 'bin', op: '-', left, right } };
}

export function simplify(text) {
  const tree = parse(text);
  try {
    const poly = toPolynomial(tree);
    return {
      result: formatPolynomial(poly),
      note: isConstant(poly) ? null : `Degree ${polyDegree(poly)} polynomial`,
    };
  } catch (error) {
    if (!(error instanceof NotPolynomial)) throw error;
    if (variablesIn(tree).size)
      throw new MathError('Only polynomial expressions can be expanded');
    return { result: formatNumber(evaluate(tree)), note: null };
  }
}

// Rational root theorem on whole-number coefficients; leftovers stay as one factor.
export function factor(text) {
  const tree = parse(text);
  const vars = [...variablesIn(tree)];
  if (vars.length !== 1)
    throw new MathError('Factoring works on one variable, like x² − 5x + 6');
  const [v] = vars;
  let poly;
  try {
    poly = toPolynomial(tree);
  } catch (error) {
    if (error instanceof NotPolynomial)
      throw new MathError('Only polynomials can be factored');
    throw error;
  }
  let coeffs = coefficients(poly, v);
  if (!coeffs.every((c) => near(c, Math.round(c))))
    throw new MathError('Factoring needs whole-number coefficients');
  coeffs = coeffs.map(Math.round);

  let content = coeffs.reduce((g, c) => gcd(g, c), 0) || 1;
  if (coeffs[0] < 0) content = -content;
  coeffs = coeffs.map((c) => c / content);

  const factors = [];
  // Pull out x^k first
  let zeros = 0;
  while (coeffs.length > 1 && coeffs[coeffs.length - 1] === 0) {
    coeffs.pop();
    zeros++;
  }
  if (zeros)
    factors.push(zeros === 1 ? v : `${v}${toSuperscript(String(zeros))}`);

  const divisors = (n) => {
    const out = [];
    for (let i = 1; i <= Math.abs(n); i++) if (n % i === 0) out.push(i);
    return out;
  };
  const counts = new Map();
  let found = true;
  while (found && coeffs.length > 2) {
    found = false;
    const lead = coeffs[0];
    const last = coeffs[coeffs.length - 1];
    if (Math.abs(last) > 1e6 || Math.abs(lead) > 1e6) break;
    outer: for (const p of divisors(last)) {
      for (const q of divisors(lead)) {
        for (const sign of [1, -1]) {
          const r = (sign * p) / q;
          const value = coeffs.reduce((acc, c) => acc * r + c, 0);
          if (!near(value, 0, 1e-9)) continue;
          // Synthetic division by (x − r); dividing by q turns that into (q·x − sign·p).
          const quotient = [];
          let carry = 0;
          for (let i = 0; i < coeffs.length - 1; i++) {
            carry = coeffs[i] + carry * r;
            quotient.push(carry);
          }
          const label = linearLabel(q, -sign * p);
          counts.set(label, (counts.get(label) ?? 0) + 1);
          coeffs = quotient.map((b) => Math.round(b / q));
          found = true;
          break outer;
        }
      }
    }
  }
  if (coeffs.length === 2 && counts.size) {
    const label = linearLabel(coeffs[0], coeffs[1]);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    coeffs = [1];
  }
  for (const [label, count] of counts)
    factors.push(count > 1 ? `${label}${toSuperscript(String(count))}` : label);

  const rest = new Map(
    coeffs.map((c, i) => [keyOf({ [v]: coeffs.length - 1 - i }), c]),
  );
  const restText = formatPolynomial(clean(rest));
  if (restText !== '1')
    factors.push(
      coeffs.length > 1 && factors.length ? `(${restText})` : restText,
    );

  const prefix =
    content === 1 ? '' : content === -1 ? '−' : formatValue(content);
  const result = `${prefix}${factors.join('')}` || '1';
  return {
    result,
    note:
      counts.size || zeros || coeffs.length < 3
        ? null
        : 'No rational factors found',
  };

  function linearLabel(a, b) {
    return `(${a === 1 ? '' : a}${v} ${b < 0 ? '−' : '+'} ${Math.abs(b)})`;
  }
}

export function solve(text) {
  const lines = text
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new MathError('Enter an equation');
  return lines.length === 1 ? solveOne(lines[0]) : solveSystem(lines);
}

function solveOne(line) {
  const { tree } = splitEquation(line);
  const vars = [...variablesIn(tree)].sort();
  let poly = null;
  try {
    poly = toPolynomial(tree);
  } catch (error) {
    if (!(error instanceof NotPolynomial)) throw error;
  }

  if (!vars.length) {
    const value = evaluate(tree);
    return {
      heading: near(value, 0) ? 'True' : 'False',
      lines: [
        near(value, 0) ? 'Both sides are equal.' : 'Both sides are not equal.',
      ],
    };
  }

  if (vars.length > 1) {
    if (!poly)
      throw new MathError(
        'With several variables, only polynomial equations can be rearranged',
      );
    return rearrange(poly, vars);
  }

  const [v] = vars;
  if (!poly) {
    const f = (x) => evaluate(tree, { vars: { [v]: x } });
    const roots = numericRealRoots(f);
    const shown = [...roots]
      .sort((a, b) => Math.abs(a) - Math.abs(b))
      .slice(0, MAX_NUMERIC_ROOTS)
      .sort((a, b) => a - b);
    return {
      heading: roots.length
        ? `${roots.length} real solution${roots.length > 1 ? 's' : ''} found`
        : 'No real solutions found',
      lines: shown.map(
        (r) => `${v} ${Number.isInteger(r) ? '=' : '≈'} ${formatValue(r)}`,
      ),
      note: `Solved numerically between −100 and 100${roots.length > shown.length ? `, showing the ${shown.length} closest to 0` : ''}.`,
    };
  }

  const coeffs = coefficients(poly, v);
  const degree = coeffs.length - 1;
  if (degree === 0) {
    return near(coeffs[0], 0)
      ? { heading: 'Infinitely many solutions', lines: ['Every value works.'] }
      : {
          heading: 'No solution',
          lines: ['The equation simplifies to a contradiction.'],
        };
  }

  const lines = [];
  const note = `Rearranged: ${formatPolynomial(poly)} = 0`;
  if (degree === 1) {
    lines.push(`${v} = ${formatValue(-coeffs[1] / coeffs[0])}`);
    return { heading: 'Linear equation', lines, note };
  }

  const roots = degree === 2 ? quadraticRoots(...coeffs) : allRoots(coeffs);
  const exact = degree === 2 ? exactQuadratic(...coeffs, v) : null;
  if (exact) lines.push(exact);
  const unique = [];
  for (const root of roots)
    if (
      !unique.some(
        (u) => near(u[0], root[0], 1e-7) && near(u[1], root[1], 1e-7),
      )
    )
      unique.push(root);
  unique.sort(
    (a, b) => (a[1] ? 1 : 0) - (b[1] ? 1 : 0) || a[0] - b[0] || a[1] - b[1],
  );
  for (const root of unique) {
    const text = formatComplex(root);
    lines.push(`${v} ${text.includes('.') ? '≈' : '='} ${text}`);
  }
  const names = { 2: 'Quadratic', 3: 'Cubic', 4: 'Quartic' };
  const real = unique.filter((r) => !r[1]).length;
  return {
    heading: `${names[degree] ?? `Degree ${degree}`} equation · ${real} real solution${real === 1 ? '' : 's'}`,
    lines,
    note,
  };
}

function quadraticRoots(a, b, c) {
  const disc = b * b - 4 * a * c;
  if (near(disc, 0, 1e-12)) return [[-b / (2 * a), 0]];
  if (disc > 0)
    return [
      [(-b - Math.sqrt(disc)) / (2 * a), 0],
      [(-b + Math.sqrt(disc)) / (2 * a), 0],
    ];
  const re = -b / (2 * a);
  const im = Math.sqrt(-disc) / (2 * Math.abs(a));
  return [
    [re, -im],
    [re, im],
  ];
}

// "y = 2x + 3" style: solve for each variable the equation is linear in.
function rearrange(poly, vars) {
  const lines = [];
  for (const v of vars) {
    let coefficient = new Map();
    let rest = new Map();
    let linear = true;
    for (const [k, c] of poly) {
      const powers = powersOf(k);
      const p = powers[v] ?? 0;
      if (p > 1) linear = false;
      delete powers[v];
      const target = p === 1 ? coefficient : rest;
      const key = keyOf(powers);
      target.set(key, (target.get(key) ?? 0) + c);
    }
    if (!linear || !coefficient.size) continue;
    coefficient = clean(coefficient);
    rest = clean(rest);
    if (isConstant(coefficient)) {
      lines.push(
        `${v} = ${formatPolynomial(scale(rest, -1 / constantValue(coefficient)))}`,
      );
    } else {
      lines.push(
        `${v} = ${formatPolynomial(scale(rest, -1))} / (${formatPolynomial(coefficient)})`,
      );
    }
  }
  if (!lines.length) throw new MathError('Could not isolate any variable');
  return {
    heading: 'Rearranged',
    lines,
    note: `From ${formatPolynomial(poly)} = 0`,
  };
}

function solveSystem(lines) {
  const polys = lines.map((line) => {
    try {
      return toPolynomial(splitEquation(line).tree);
    } catch (error) {
      if (error instanceof NotPolynomial)
        throw new MathError('Systems must be linear, like 2x + y = 5');
      throw error;
    }
  });
  if (polys.some((p) => polyDegree(p) > 1))
    throw new MathError('Systems must be linear, like 2x + y = 5');
  const vars = [
    ...new Set(polys.flatMap((p) => [...p.keys()].filter(Boolean))),
  ].sort();
  if (!vars.length) throw new MathError('No variables to solve for');

  // Augmented matrix [A | b] from a·vars + c = 0  ->  a·vars = −c
  const rows = polys.map((p) => [
    ...vars.map((v) => p.get(v) ?? 0),
    -(p.get('') ?? 0),
  ]);
  const n = vars.length;
  let pivotRow = 0;
  const pivotCols = [];
  for (let col = 0; col < n && pivotRow < rows.length; col++) {
    let best = pivotRow;
    for (let r = pivotRow + 1; r < rows.length; r++)
      if (Math.abs(rows[r][col]) > Math.abs(rows[best][col])) best = r;
    if (near(rows[best][col], 0, 1e-12)) continue;
    [rows[pivotRow], rows[best]] = [rows[best], rows[pivotRow]];
    const pivot = rows[pivotRow][col];
    rows[pivotRow] = rows[pivotRow].map((x) => x / pivot);
    for (let r = 0; r < rows.length; r++) {
      if (r === pivotRow) continue;
      const factorValue = rows[r][col];
      rows[r] = rows[r].map((x, i) => x - factorValue * rows[pivotRow][i]);
    }
    pivotCols.push(col);
    pivotRow++;
  }
  if (rows.slice(pivotRow).some((row) => !near(row[n], 0, 1e-9))) {
    return {
      heading: 'No solution',
      lines: ['The equations contradict each other.'],
    };
  }
  if (pivotCols.length < n) {
    const free = vars.filter((_, i) => !pivotCols.includes(i));
    return {
      heading: 'Infinitely many solutions',
      lines: pivotCols.map((col, r) => {
        const terms = new Map([['', rows[r][n]]]);
        free.forEach((fv) => terms.set(fv, -rows[r][vars.indexOf(fv)]));
        return `${vars[col]} = ${formatPolynomial(clean(terms))}`;
      }),
      note: `Free variable${free.length > 1 ? 's' : ''}: ${free.join(', ')}`,
    };
  }
  return {
    heading: `System of ${lines.length} equations`,
    lines: pivotCols.map(
      (col, r) => `${vars[col]} = ${formatValue(rows[r][n])}`,
    ),
  };
}
