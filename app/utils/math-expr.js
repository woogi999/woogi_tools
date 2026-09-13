// A small hand-written maths expression parser shared by the Calculator,
// Algebra and Graph tools. Text -> tokens -> AST, then the AST can be
// evaluated numerically (here) or turned into polynomials (utils/algebra.js).
//
// Grammar, loosest to tightest:
//   expr    := term (("+" | "-") term)*
//   term    := unary (("*" | "/" | implicit) unary)*      2x, 3(x+1), (a)(b)
//   unary   := ("-" | "+") unary | power                   -2^2 = -4
//   power   := postfix ("^" unary)?                        right associative
//   postfix := primary ("!" | "%")*
//   primary := number | name | name "(" args ")" | fn operand | "(" expr ")" | "|" expr "|"

export class MathError extends Error {}

const FUNCTIONS = {
  sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1,
  sinh: 1, cosh: 1, tanh: 1, asinh: 1, acosh: 1, atanh: 1,
  sec: 1, csc: 1, cot: 1,
  sqrt: 1, cbrt: 1, abs: 1, exp: 1, ln: 1, log: 1, log2: 1,
  floor: 1, ceil: 1, round: 1, sign: 1,
  nroot: 2, logb: 2, mod: 2, min: 2, max: 2, ncr: 2, npr: 2,
};
const CONSTANTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 };

// Longest names first so "sinh" beats "sin" and "log2" beats "log".
const KNOWN_NAMES = [...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS), 'ans'].sort((a, b) => b.length - a.length);

const SYMBOLS = { '×': '*', '÷': '/', '−': '-', '·': '*', 'π': 'pi', '√': 'sqrt', '²': '^2', '³': '^3' };

export function tokenize(text) {
  const src = [...text].map((ch) => SYMBOLS[ch] ?? ch).join('');
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const match = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!match) throw new MathError(`Unexpected "${ch}"`);
      tokens.push({ type: 'num', value: parseFloat(match[0]) });
      i += match[0].length;
    } else if (/[a-z]/i.test(ch)) {
      const word = /^[a-z][a-z0-9]*/i.exec(src.slice(i))[0].toLowerCase();
      // Split runs like "2xy" or "sinx" into known names and single-letter variables.
      let rest = word;
      while (rest) {
        const known = KNOWN_NAMES.find((name) => rest.startsWith(name));
        const piece = known ?? (/^[a-z]/.test(rest) ? rest[0] : /^\d+/.exec(rest)[0]);
        tokens.push(/^\d/.test(piece) ? { type: 'num', value: +piece } : { type: 'name', value: piece });
        rest = rest.slice(piece.length);
      }
      i += word.length;
    } else if ('+-*/^()!%,|='.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
    } else {
      throw new MathError(`Unexpected "${ch}"`);
    }
  }
  return tokens;
}

export function parse(text) {
  const tokens = tokenize(text);
  if (!tokens.length) throw new MathError('Enter an expression');
  let pos = 0;
  let absDepth = 0;
  const peek = () => tokens[pos];
  const isOp = (value) => peek()?.type === 'op' && peek().value === value;
  const expect = (value) => {
    if (!isOp(value)) throw new MathError(`Expected "${value}"`);
    pos++;
  };

  // Could the next token begin a new operand (for implicit multiplication)?
  const startsOperand = () => {
    const t = peek();
    if (!t) return false;
    if (t.type !== 'op') return true;
    return t.value === '(' || (t.value === '|' && absDepth === 0);
  };

  function expr() {
    let node = term();
    while (isOp('+') || isOp('-')) {
      const op = tokens[pos++].value;
      node = { type: 'bin', op, left: node, right: term() };
    }
    return node;
  }

  function term() {
    let node = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = tokens[pos++].value;
        node = { type: 'bin', op, left: node, right: unary() };
      } else if (startsOperand()) {
        node = { type: 'bin', op: '*', left: node, right: power() };
      } else {
        return node;
      }
    }
  }

  function unary() {
    if (isOp('-')) {
      pos++;
      return { type: 'neg', arg: unary() };
    }
    if (isOp('+')) {
      pos++;
      return unary();
    }
    return power();
  }

  function power() {
    const base = postfix();
    if (isOp('^')) {
      pos++;
      return { type: 'bin', op: '^', left: base, right: unary() };
    }
    return base;
  }

  function postfix() {
    let node = primary();
    while (isOp('!') || isOp('%')) {
      node = { type: 'post', op: tokens[pos++].value, arg: node };
    }
    return node;
  }

  function primary() {
    const t = peek();
    if (!t) throw new MathError('Expression ends too soon');
    if (t.type === 'num') {
      pos++;
      return { type: 'num', value: t.value };
    }
    if (t.type === 'name') {
      pos++;
      if (FUNCTIONS[t.value]) {
        const arity = FUNCTIONS[t.value];
        if (isOp('(')) {
          pos++;
          const args = [expr()];
          while (isOp(',')) {
            pos++;
            args.push(expr());
          }
          expect(')');
          if (args.length !== arity) throw new MathError(`${t.value} takes ${arity} value${arity > 1 ? 's' : ''}`);
          return { type: 'call', name: t.value, args };
        }
        if (arity !== 1) throw new MathError(`${t.value} needs brackets`);
        return { type: 'call', name: t.value, args: [power()] }; // sin x, √2
      }
      if (t.value in CONSTANTS) return { type: 'const', name: t.value };
      return { type: 'var', name: t.value };
    }
    if (t.value === '(') {
      pos++;
      const node = expr();
      expect(')');
      return node;
    }
    if (t.value === '|') {
      pos++;
      absDepth++;
      const node = expr();
      absDepth--;
      expect('|');
      return { type: 'call', name: 'abs', args: [node] };
    }
    throw new MathError(`Unexpected "${t.value}"`);
  }

  const tree = expr();
  if (pos < tokens.length) throw new MathError(`Unexpected "${tokens[pos].value}"`);
  return tree;
}

// Lanczos approximation, so 0.5! and friends work too.
function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7;
  const c = [0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.61503916999186, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
}

export function factorial(n) {
  if (Number.isInteger(n)) {
    if (n < 0) return NaN;
    if (n > 170) return Infinity;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }
  return gamma(n + 1);
}

// Snap float noise like sin(pi) = 1.22e-16 to exact values.
const tidy = (n) => (Math.abs(n) < 1e-14 ? 0 : n);

export function evaluate(node, { vars = {}, degrees = false } = {}) {
  const toRad = (v) => (degrees ? (v * Math.PI) / 180 : v);
  const fromRad = (v) => (degrees ? (v * 180) / Math.PI : v);

  function ev(n) {
    switch (n.type) {
      case 'num':
        return n.value;
      case 'const':
        return CONSTANTS[n.name];
      case 'var':
        if (!(n.name in vars)) throw new MathError(`Unknown variable "${n.name}"`);
        return vars[n.name];
      case 'neg':
        return -ev(n.arg);
      case 'post':
        return n.op === '!' ? factorial(ev(n.arg)) : ev(n.arg) / 100;
      case 'bin': {
        const a = ev(n.left);
        const b = ev(n.right);
        if (n.op === '+') return a + b;
        if (n.op === '-') return a - b;
        if (n.op === '*') return a * b;
        if (n.op === '/') return a / b;
        // Real odd roots of negatives: (-8)^(1/3) = -2
        if (a < 0 && !Number.isInteger(b)) {
          const inv = 1 / b;
          if (Math.abs(inv - Math.round(inv)) < 1e-9 && Math.round(inv) % 2 !== 0) return -((-a) ** b);
        }
        return a ** b;
      }
      case 'call': {
        const [a, b] = n.args.map(ev);
        switch (n.name) {
          case 'sin': return tidy(Math.sin(toRad(a)));
          case 'cos': return tidy(Math.cos(toRad(a)));
          case 'tan': return tidy(Math.tan(toRad(a)));
          case 'sec': return 1 / tidy(Math.cos(toRad(a)));
          case 'csc': return 1 / tidy(Math.sin(toRad(a)));
          case 'cot': return 1 / tidy(Math.tan(toRad(a)));
          case 'asin': return fromRad(Math.asin(a));
          case 'acos': return fromRad(Math.acos(a));
          case 'atan': return fromRad(Math.atan(a));
          case 'sinh': return Math.sinh(a);
          case 'cosh': return Math.cosh(a);
          case 'tanh': return Math.tanh(a);
          case 'asinh': return Math.asinh(a);
          case 'acosh': return Math.acosh(a);
          case 'atanh': return Math.atanh(a);
          case 'sqrt': return Math.sqrt(a);
          case 'cbrt': return Math.cbrt(a);
          case 'nroot': return b < 0 && a % 2 !== 0 ? -((-b) ** (1 / a)) : b ** (1 / a);
          case 'abs': return Math.abs(a);
          case 'exp': return Math.exp(a);
          case 'ln': return Math.log(a);
          case 'log': return Math.log10(a);
          case 'log2': return Math.log2(a);
          case 'logb': return Math.log(b) / Math.log(a);
          case 'floor': return Math.floor(a);
          case 'ceil': return Math.ceil(a);
          case 'round': return Math.round(a);
          case 'sign': return Math.sign(a);
          case 'mod': return ((a % b) + b) % b;
          case 'min': return Math.min(a, b);
          case 'max': return Math.max(a, b);
          case 'ncr': return Math.round(factorial(a) / (factorial(b) * factorial(a - b)));
          case 'npr': return Math.round(factorial(a) / factorial(a - b));
        }
      }
    }
    throw new MathError('Unsupported expression');
  }
  return ev(node);
}

export function variablesIn(node, found = new Set()) {
  if (node.type === 'var') found.add(node.name);
  for (const child of [node.arg, node.left, node.right, ...(node.args ?? [])]) if (child) variablesIn(child, found);
  return found;
}

// Compiles once into a fast (x) => y for plotting.
export function compileFunction(text, variable = 'x') {
  const tree = parse(text);
  const extra = [...variablesIn(tree)].filter((v) => v !== variable);
  if (extra.length) throw new MathError(`Unknown variable "${extra[0]}"`);
  return (value) => evaluate(tree, { vars: { [variable]: value } });
}

export function formatNumber(n, digits = 12) {
  if (Number.isNaN(n)) return 'Undefined';
  if (n === Infinity) return '∞';
  if (n === -Infinity) return '-∞';
  const rounded = parseFloat(n.toPrecision(digits));
  const abs = Math.abs(rounded);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
    return rounded.toExponential(Math.min(digits - 1, 10)).replace(/\.?0+e/, 'e');
  }
  return String(rounded);
}
