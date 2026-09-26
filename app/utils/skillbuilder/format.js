// Reading and writing JJS Skill Builder codes (see docs/jjs-skill-builder.md).
//
// A code is base64(zstd(JSON)) of an array of skills; each skill's program
// sits in DATA as a JSON string of its own. In memory the program is kept
// parsed, and everything else is kept exactly as JJS wrote it: unknown node
// kinds and fields pass through untouched, and so does key order.
//
// Two quirks of JJS's JSON (it's Roblox's encoder, writing Lua tables) are
// copied on the way out:
//   * an empty table is `[]`, so an empty Branch or Prop stays `[]`;
//   * "for ever" is 1e38, not JavaScript's 1e+38.
// Roblox also writes some floats with 17 digits where JavaScript writes the
// shortest form that reads back the same; the numbers are identical.

import { compressBytes, decompressBytes } from '../codec';

const toBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const fromBase64 = (text) =>
  Uint8Array.from(atob(text.replace(/\s+/g, '')), (c) => c.charCodeAt(0));

let uid = 0;
export const newUid = () => `s${Date.now().toString(36)}${(uid++).toString(36)}`;

// JSON text for JJS: 1e38 as it writes it.
export const toJjsJson = (value) =>
  JSON.stringify(value).replace(/(\d)e\+(\d)/g, '$1e$2');

function parseProgram(data) {
  if (typeof data !== 'string') return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return { __unreadable: data };
  }
}

/**
 * A code to skills: each { uid, ...the skill as JJS has it }, with DATA
 * parsed (or absent, as JJS's separators have it). Throws on anything that
 * isn't a JJS code.
 */
export async function decodeMoveset(code) {
  let text;
  try {
    const bytes = fromBase64(String(code ?? '').trim());
    text = new TextDecoder().decode(await decompressBytes(bytes, 'zstd'));
  } catch {
    throw new Error('That isn’t a Skill Builder code: it should be the long text JJS copies out.');
  }
  let skills;
  try {
    skills = JSON.parse(text);
  } catch {
    throw new Error('That code opened, but what’s inside isn’t a skill list.');
  }
  if (!Array.isArray(skills) || !skills.every((s) => s && typeof s === 'object'))
    throw new Error('That code opened, but what’s inside isn’t a skill list.');
  return skills.map((skill) => {
    const out = { uid: newUid(), ...skill };
    if ('DATA' in skill) out.DATA = parseProgram(skill.DATA);
    return out;
  });
}

// One skill back to JJS's shape: DATA as a string, no uid.
export function toJjsSkill({ uid: _uid, ...skill }) {
  if (skill.DATA === undefined) return skill;
  const data =
    skill.DATA && '__unreadable' in skill.DATA
      ? skill.DATA.__unreadable
      : toJjsJson(emptyAsArrays(skill.DATA));
  return { ...skill, DATA: data };
}

// Lua has one kind of table: an empty Branch or Prop is written [].
function emptyAsArrays(program) {
  const out = { ...program };
  for (const key of ['Branch', 'Prop'])
    if (out[key] && !Array.isArray(out[key]) && !Object.keys(out[key]).length)
      out[key] = [];
  return out;
}

/** Skills to a code JJS will import. */
export async function encodeMoveset(skills) {
  const json = toJjsJson(skills.map(toJjsSkill));
  return toBase64(await compressBytes(new TextEncoder().encode(json), 'zstd', 19));
}

// ─── Reaching into a program ────────────────────────────────────────────
// Branch '' is the skill's own line ("Default" in the builder).

export const DEFAULT_BRANCH = '';

export function branchNames(program) {
  const branches = program?.Branch;
  return branches && !Array.isArray(branches) ? Object.keys(branches) : [];
}

export function lineOf(program, branch) {
  if (!program) return [];
  if (!branch) return Array.isArray(program.Line) ? program.Line : [];
  const b = program.Branch?.[branch];
  return Array.isArray(b?.Line) ? b.Line : [];
}

export function reqOf(program, branch) {
  if (!program) return [];
  const req = branch ? program.Branch?.[branch]?.Req : program.Req;
  return Array.isArray(req) ? req : [];
}

// The path (for setIn) to a branch's Line or Req.
export const linePath = (branch) => (branch ? ['Branch', branch, 'Line'] : ['Line']);
export const reqPath = (branch) => (branch ? ['Branch', branch, 'Req'] : ['Req']);

// A program's Branch as an object, whatever JJS wrote for an empty one.
export const branchObject = (program) =>
  program?.Branch && !Array.isArray(program.Branch) ? program.Branch : {};

// A new, empty program, as the builder makes one.
export const newProgram = () => ({ Req: [], Line: [], Prop: {}, Branch: {} });

// Immutable set by a path of keys (array indexes included).
export function setIn(target, [head, ...rest], value) {
  const copy = Array.isArray(target) ? [...target] : { ...target };
  copy[head] = rest.length ? setIn(target?.[head] ?? (typeof rest[0] === 'number' ? [] : {}), rest, value) : value;
  return copy;
}

export function getIn(target, path) {
  return path.reduce((v, key) => v?.[key], target);
}
