// Runs a Skill Builder skill outside Roblox, well enough to watch it.
//
// Two characters: you ("user"), at the origin facing +z, and a training
// dummy ("target") a few studs in front, facing you. Each runs lines of nodes
// on its own threads, in time order:
//
//   WAIT      moves the thread's clock on
//   BRANCH    jumps to a branch if that branch's conditions (Req) hold, and
//             otherwise carries on; a missing branch is a comment
//   LOOP      goes back LOOP BACK nodes, LOOP AMOUNT times
//   TAG       checks / sets / adds to a named value, with an expiry
//   STATE     puts a character in a state, or checks for one
//   HITBOX    hits the other character if it's inside the box (or always, or
//             never, as asked); a hit starts BRANCH on the attacker and
//             BRANCH TARGET on the one hit (BRANCH FINISHER on a kill)
//   PROJECTILE flies forward and does the same when it passes through
//   VELO / TELEPORT move a character; LAST HIT picks who
//
// Everything else (animations, sounds, effects) becomes a timed event for
// the 3D view to draw. This is a model of the rules read from real exports
// (docs/jjs-skill-builder.md), not JJS's code: timings, physics and damage
// are close, not exact.

import { branchObject, lineOf, reqOf } from './format';
import { vec3 } from './schema';

const MAX_STEPS = 50000;
const MAX_EVENTS = 6000;
const GRAVITY = 110;
export const RATE = 60;

// A small seeded generator. The seed is mixed first: consecutive seeds would
// otherwise start almost the same.
function random(seed) {
  let s = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ 0xc2b2ae35;
  s = Math.imul(s ^ (s >>> 13), 0x27d4eb2f) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// A local offset (x right, y up, z forward) turned by a heading.
export function toWorld([x, y, z], yaw) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return [-fz * x + fx * z, y, fx * x + fz * z];
}

const other = (who) => (who === 'user' ? 'target' : 'user');

/**
 * Runs `skill` (a decoded skill, DATA parsed).
 *
 * options.conditions  { AIR, JUMP, HOLD, ULT, BAR } for your character
 * options.hits        'auto' (by the boxes), 'always' or 'never'
 * options.start       branch to start from ('' is the skill's own line)
 * options.maxTime     seconds to run a skill that never ends (a passive)
 * options.seed        for RANDOM branches
 * options.distance    how far in front the dummy stands
 */
export function simulate(skill, options = {}) {
  const {
    conditions = {},
    hits = 'auto',
    start = '',
    maxTime = 12,
    seed = 7,
    distance = 5,
  } = options;
  const program = skill?.DATA ?? null;
  const branches = branchObject(program);
  const rand = random(seed);
  const events = [];
  const log = [];
  const warnings = [];

  const people = {
    user: { pos: [0, 0, 0], yaw: 0, segments: [], teleports: [], hp: 100, tags: new Map(), states: new Map(), lastHit: -Infinity },
    target: { pos: [0, 0, distance], yaw: Math.PI, segments: [], teleports: [], hp: 100, tags: new Map(), states: new Map(), lastHit: -Infinity },
  };
  const projectiles = new Map();
  const shots = [];
  const grabs = [];
  const hpTrack = [{ t: 0, hp: 100 }];
  const tagTrack = [];

  const conditionsOf = (who) => (who === 'user' ? conditions : {});
  function reqOk(reqs, who) {
    const c = conditionsOf(who);
    return reqs.every((req) => {
      let ok;
      switch (req?.K_NAME) {
        case 'AIR':
        case 'JUMP':
        case 'HOLD':
        case 'ULT':
          ok = Boolean(c[req.K_NAME]);
          break;
        case 'BAR':
          ok = num(c.BAR, 0) >= num(req.AMOUNT, 0);
          break;
        default:
          ok = true;
      }
      return req?.FLIP ? !ok : ok;
    });
  }

  const skillReq = reqOf(program, '');
  if (!start && skillReq.length && !reqOk(skillReq, 'user'))
    warnings.push('The skill’s own conditions don’t hold with these settings: in JJS it wouldn’t start.');

  // Where a character is at `t`, from its pushes and teleports so far
  // (without gravity: good enough to aim hitboxes with).
  function posAt(who, t) {
    const p = people[who];
    const jump = [...p.teleports].reverse().find((j) => j.t <= t);
    const base = jump ? [...jump.pos] : who === 'user' ? [0, 0, 0] : [0, 0, distance];
    const from = jump ? jump.t : 0;
    for (const s of p.segments) {
      const a = Math.max(s.t0, from);
      const b = Math.min(s.t1, t);
      if (b <= a) continue;
      const k = s.fade ? fadeIntegral(s, a, b) : b - a;
      for (let i = 0; i < 3; i++) base[i] += s.v[i] * k;
    }
    base[1] = Math.max(0, base[1]);
    return base;
  }

  function emit(event) {
    if (events.length < MAX_EVENTS) events.push({ id: events.length, ...event });
  }
  function say(t, who, text, branch, index) {
    if (log.length < MAX_EVENTS) log.push({ t, who, text, branch, index });
  }

  // ─── Threads ────────────────────────────────────────────────────────
  const threads = [];
  let serial = 0;
  function spawn(who, branch, t, origin) {
    if (!branch || branch === 'nil') return;
    if (branch && !branches[branch]) return say(t, who, `No branch “${branch}”: nothing runs`);
    threads.push({ n: serial++, who, branch, i: 0, t, loops: new Map(), origin: origin ?? who });
    say(t, who, `starts ${branch || 'Default'}`, branch, 0);
  }

  // Who a node acts on. LAST HIT -1 (or none) is whoever runs it; a number
  // is the one they last hit, if within that many seconds.
  function actorOf(node, thread) {
    const window = node['LAST HIT'];
    if (window === undefined || num(window, -1) < 0) return thread.who;
    const them = people[thread.who];
    return thread.t - them.lastHit <= Math.max(0.05, num(window)) + 1e-6 ? other(thread.who) : null;
  }

  function headingFor(node, thread, actor) {
    return node['RELATIVE FROM BRANCH'] === false ? people[actor].yaw : people[thread.origin].yaw;
  }

  function tagMatch(current, wanted) {
    const want = String(wanted ?? '');
    const now = current === undefined ? undefined : String(current);
    const m = /^([<>]=?)\s*(-?[\d.]+)$/.exec(want);
    if (m) {
      const a = num(now, 0);
      const b = Number(m[2]);
      return m[1] === '<' ? a < b : m[1] === '>' ? a > b : m[1] === '<=' ? a <= b : a >= b;
    }
    if (now === undefined) return false;
    if (now !== '' && want !== '' && Number.isFinite(Number(now)) && Number.isFinite(Number(want)))
      return Number(now) === Number(want);
    return now === want;
  }

  function jump(thread, name, why) {
    if (!name) return false;
    const target = branches[name];
    if (!target) {
      say(thread.t, thread.who, `${why} → “${name}” (no such branch: a comment)`, thread.branch, thread.i);
      return false;
    }
    if (!reqOk(reqOf(program, name), thread.who)) {
      say(thread.t, thread.who, `${why} → ${name}: its conditions don’t hold, carrying on`, thread.branch, thread.i);
      return false;
    }
    say(thread.t, thread.who, `${why} → ${name}`, thread.branch, thread.i);
    thread.branch = name;
    thread.i = 0;
    thread.loops = new Map();
    return true;
  }

  function hit(thread, node, t, how, index) {
    const attacker = thread.who;
    const victim = other(attacker);
    const them = people[victim];
    people[attacker].lastHit = t;
    const damage = num(node.DAMAGE, 0);
    them.hp = Math.max(0, them.hp - damage);
    if (victim === 'target') hpTrack.push({ t, hp: them.hp });
    const stun = num(node.STUN, 0);
    if (stun > 0) them.states.set('Stun', { value: 1, until: t + stun });
    emit({ kind: 'HIT', t, end: t + 0.25, who: victim, by: attacker, damage, how, branch: thread.branch, index });
    say(t, attacker, `${how} hits for ${damage}${stun ? `, stuns ${stun}s` : ''}`, thread.branch, index);
    const kill = them.hp <= 0 && node['CAN KILL'] !== false;
    const mine = kill && node['BRANCH FINISHER'] && node['BRANCH FINISHER'] !== 'nil' ? node['BRANCH FINISHER'] : node.BRANCH;
    spawn(attacker, mine, t, attacker);
    spawn(victim, node['BRANCH TARGET'], t, attacker);
  }

  function inBox(center, size, yaw, point) {
    const d = [point[0] - center[0], point[1] - center[1], point[2] - center[2]];
    // back into the box's own frame
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const local = [-fz * d[0] + fx * d[2], d[1], fx * d[0] + fz * d[2]];
    return local.every((v, i) => Math.abs(v) <= size[i] / 2 + 1);
  }

  function runNode(thread, node) {
    const t = thread.t;
    const kind = node?.K_NAME;
    const at = { t, branch: thread.branch, index: thread.i };
    switch (kind) {
      case 'WAIT':
        thread.t += Math.max(0, num(node.TIME, 0));
        return;
      case 'BRANCH': {
        let name = node.BRANCH;
        if (node.RANDOM) {
          const options = String(node.RANDOM).split(',').map((s) => s.trim()).filter(Boolean);
          if (options.length) name = options[Math.floor(rand() * options.length)];
        }
        if (jump(thread, name, node.RANDOM ? 'random' : 'branch')) return 'jumped';
        return;
      }
      case 'LOOP': {
        const key = `${thread.branch}:${thread.i}`;
        const holdOff = node.HOLD && !conditionsOf(thread.who).HOLD;
        const left = thread.loops.has(key) ? thread.loops.get(key) : num(node['LOOP AMOUNT'], 0);
        if (!holdOff && left > 0) {
          thread.loops.set(key, left - 1);
          thread.i = Math.max(0, thread.i - num(node['LOOP BACK'], 0));
          return 'jumped';
        }
        thread.loops.delete(key);
        return;
      }
      case 'TAG': {
        const store = people[thread.who].tags;
        const current = store.get(node.TAG);
        const value = current && current.until > t ? current.value : undefined;
        if (node.CHECK) {
          if (tagMatch(value, node.VALUE) && jump(thread, node.BRANCH, `${node.TAG} ${node.VALUE}`)) return 'jumped';
          return;
        }
        const time = num(node.TIME, 1e38);
        let next;
        if (node.SET) next = time <= 0 ? undefined : String(node.VALUE);
        else if (Number.isFinite(Number(node.VALUE)))
          next = String(num(value, 0) + Number(node.VALUE));
        else next = String(node.VALUE);
        if (next === undefined) store.delete(node.TAG);
        else store.set(node.TAG, { value: next, until: t + (time > 1e9 ? 1e9 : time) });
        tagTrack.push({ t, who: thread.who, tag: node.TAG, value: next ?? null });
        say(t, thread.who, `tag ${node.TAG} = ${next ?? '(cleared)'}`, thread.branch, thread.i);
        return;
      }
      case 'STATE': {
        const actor = actorOf(node, thread);
        if (!actor) return;
        const store = people[actor].states;
        const name = node.STATE ?? 'Stun';
        if (node.CHECK) {
          const s = store.get(name);
          if (s && s.until > t && jump(thread, node.BRANCH, `in ${name}`)) return 'jumped';
          return;
        }
        const time = num(node.TIME, 0);
        store.set(name, { value: node.VALUE, until: t + time });
        emit({ kind, t, end: t + Math.min(time, 30), who: actor, node, ...at });
        return;
      }
      case 'VELO': {
        const actor = actorOf(node, thread);
        if (!actor) return;
        const time = Math.max(0.01, num(node.TIME, 0.2));
        const v = toWorld(vec3(node.FORCE), headingFor(node, thread, actor));
        people[actor].segments.push({ t0: t, t1: t + time, v, fade: Boolean(node.FADE) });
        const ragdoll = num(node.RAGDOLL, 0);
        emit({ kind, t, end: t + Math.max(time, ragdoll), who: actor, node, ragdoll, ...at });
        return;
      }
      case 'TELEPORT': {
        const actor = actorOf(node, thread);
        if (!actor) return;
        let pos;
        const shot = node['PROJECTILE TAG'] && projectiles.get(node['PROJECTILE TAG']);
        if (shot) pos = shotPos(shot, t);
        else {
          const off = toWorld(vec3(node.POSITION), people[actor].yaw);
          pos = posAt(actor, t).map((c, i) => c + off[i]);
        }
        pos[1] = Math.min(Math.max(pos[1], 0), 60);
        people[actor].teleports.push({ t, pos });
        people[actor].segments = people[actor].segments.map((s) => (s.t1 > t ? { ...s, t1: Math.max(s.t0, t) } : s));
        emit({ kind, t, end: t + 0.3, who: actor, node, ...at });
        return;
      }
      case 'HITBOX': {
        emit({ kind, t, end: t + 0.2, who: thread.who, node, ...at });
        const size = vec3(node.SIZE, [5, 5, 5]);
        const me = thread.who;
        const yaw = people[me].yaw;
        const off = toWorld(vec3(node.POSITION), yaw);
        const center = posAt(me, t).map((c, i) => c + off[i] + (i === 1 ? 2.5 : 0));
        const them = posAt(other(me), t);
        const body = [them[0], them[1] + 2.5, them[2]];
        const inside = inBox(center, size, yaw, body);
        if (hits === 'always' || (hits === 'auto' && inside)) hit(thread, node, t, 'hitbox', thread.i);
        else say(t, me, 'hitbox misses', thread.branch, thread.i);
        return;
      }
      case 'PROJECTILE': {
        const me = thread.who;
        const yaw = people[me].yaw;
        const off = toWorld(vec3(node.POSITION), yaw);
        const origin = posAt(me, t).map((c, i) => c + off[i] + (i === 1 ? 2.5 : 0));
        const speed = num(node.SPEED, 0);
        const time = Math.max(0.05, num(node.TIME, 2));
        const shot = { id: shots.length, tag: node['PROJECTILE TAG'] ?? '', t0: t, t1: t + time, origin, dir: toWorld([0, 0, 1], yaw), speed, size: vec3(node.SIZE, [6, 6, 6]), node, who: me };
        shots.push(shot);
        if (shot.tag) projectiles.set(shot.tag, shot);
        emit({ kind, t, end: shot.t1, who: me, node, shot: shot.id, ...at });
        const wantsHit = node['BRANCH TARGET'] || num(node.DAMAGE, 0) > 0;
        if (hits !== 'never' && wantsHit) {
          const them = posAt(other(me), t);
          const body = [them[0], them[1] + 2.5, them[2]];
          const reach = Math.max(...shot.size) / 2 + 1.5;
          let when = null;
          for (let s = t; s <= shot.t1; s += 1 / 30) {
            const p = shotPos(shot, s);
            if (Math.hypot(p[0] - body[0], p[1] - body[1], p[2] - body[2]) <= reach) {
              when = s;
              break;
            }
          }
          if (when === null && hits === 'always') when = t + Math.min(time, speed > 0 ? distance / speed : 0.1);
          if (when !== null) {
            if (node.CONTINUE === false) shot.t1 = when;
            threads.push({ n: serial++, who: me, branch: thread.branch, i: thread.i, t: when, loops: new Map(), origin: me, shotHit: node });
          }
        }
        return;
      }
      case 'GRAB': {
        const actor = actorOf(node, thread);
        if (actor !== other(thread.who)) {
          say(t, thread.who, 'grab: nobody hit recently', thread.branch, thread.i);
          return;
        }
        const time = num(node.TIME, 1);
        grabs.push({ t0: t, t1: t + time, by: thread.who, who: actor, node });
        emit({ kind, t, end: t + time, who: actor, by: thread.who, node, ...at });
        return;
      }
      case 'HPGIB': {
        const actor = actorOf(node, thread);
        if (!actor) return;
        const p = people[actor];
        p.hp = Math.max(node['CAN KILL'] === false ? 1 : 0, Math.min(100, p.hp + num(node.AMOUNT, 0)));
        if (actor === 'target') hpTrack.push({ t, hp: p.hp });
        emit({ kind, t, end: t + 0.3, who: actor, node, ...at });
        return;
      }
      default: {
        // Timed looks and bookkeeping: drawn or listed, not simulated.
        const actor = kind === 'SETCD' || kind === 'SETMELEE' || kind === 'ULTGIB' || kind === 'COUNTER' ? thread.who : actorOf(node, thread);
        if (!actor) return;
        const dur =
          kind === 'ANIM'
            ? animLength(node)
            : kind === 'SFX'
              ? 0.6
              : Math.max(0.05, num(node.TIME, kind === 'VISUAL' ? 0.5 : 0.3));
        emit({ kind: kind ?? '?', t, end: t + Math.min(dur, 30), who: actor, node, origin: thread.origin, ...at });
      }
    }
  }

  function shotPos(shot, t) {
    const k = Math.max(0, Math.min(t, shot.t1) - shot.t0) * shot.speed;
    return shot.origin.map((c, i) => c + shot.dir[i] * k);
  }

  // ─── Run ────────────────────────────────────────────────────────────
  if (start) spawn('user', start, 0, 'user');
  else threads.push({ n: serial++, who: 'user', branch: '', i: 0, t: 0, loops: new Map(), origin: 'user' });
  let steps = 0;
  let stopped = false;
  while (threads.length) {
    threads.sort((a, b) => a.t - b.t || a.n - b.n);
    const thread = threads[0];
    if (thread.t > maxTime) {
      stopped = true;
      break;
    }
    if (thread.shotHit) {
      threads.shift();
      hit(thread, thread.shotHit, thread.t, 'projectile', thread.i);
      continue;
    }
    const line = lineOf(program, thread.branch);
    if (thread.i >= line.length) {
      threads.shift();
      continue;
    }
    if (++steps > MAX_STEPS) {
      warnings.push('Stopped after too many steps: something loops without waiting.');
      break;
    }
    const result = runNode(thread, line[thread.i]);
    if (result !== 'jumped') thread.i++;
  }
  if (stopped) warnings.push(`Runs for ever (a passive loop): shown for the first ${maxTime} seconds.`);

  const end = Math.min(
    maxTime,
    Math.max(0.5, ...events.map((e) => e.end), ...log.map((l) => l.t)) + 0.4,
  );
  return {
    duration: end,
    events,
    log,
    warnings,
    shots,
    grabs,
    hp: hpTrack,
    tags: tagTrack,
    motion: {
      user: sampleMotion(people.user, [0, 0, 0], end),
      target: sampleMotion(people.target, [0, 0, distance], end),
    },
    yaw: { user: people.user.yaw, target: people.target.yaw },
  };
}

// Velocity segments that fade out: how far they carry, as seconds at full speed.
function fadeIntegral(s, a, b) {
  const len = s.t1 - s.t0 || 1;
  const at = (x) => (x - s.t0) - ((x - s.t0) ** 2) / (2 * len);
  return at(b) - at(a);
}

function animLength(node) {
  const [a, b] = Array.isArray(node.PREVIEW) ? node.PREVIEW.map(Number) : [0, 0.5];
  const speed = Math.abs(num(node.SPEED, 1)) || 1;
  return Math.max(0.15, Math.min(6, (b - a) / speed || 0.5));
}

// Where a character is, 60 times a second, with its pushes, teleports and
// gravity (a push with any upward part holds it in the air while it lasts).
function sampleMotion(person, home, duration) {
  const out = [];
  const pos = [...home];
  let fall = 0;
  const dt = 1 / RATE;
  const jumps = [...person.teleports].sort((a, b) => a.t - b.t);
  let j = 0;
  for (let f = 0; f <= Math.ceil(duration * RATE); f++) {
    const t = f * dt;
    while (j < jumps.length && jumps[j].t <= t) {
      pos.splice(0, 3, ...jumps[j].pos);
      fall = 0;
      j++;
    }
    const v = [0, 0, 0];
    let lifting = false;
    for (const s of person.segments) {
      if (t < s.t0 || t >= s.t1) continue;
      const k = s.fade ? 1 - (t - s.t0) / (s.t1 - s.t0 || 1) : 1;
      for (let i = 0; i < 3; i++) v[i] += s.v[i] * k;
      if (Math.abs(s.v[1]) > 0.01) lifting = true;
    }
    if (lifting) fall = 0;
    else if (pos[1] > 0) fall -= GRAVITY * dt;
    else fall = 0;
    pos[0] += v[0] * dt;
    pos[1] = Math.max(0, pos[1] + (v[1] + fall) * dt);
    pos[2] += v[2] * dt;
    out.push([pos[0], pos[1], pos[2]]);
  }
  return out;
}

// The sample for time `t`.
export const motionAt = (samples, t) =>
  samples[Math.max(0, Math.min(samples.length - 1, Math.round(t * RATE)))] ?? [0, 0, 0];
