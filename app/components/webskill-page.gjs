import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerDestructor, isDestroyed } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import { waitForPromise } from '@ember/test-waiters';
import { LinkTo } from '@ember/routing';
import { textureUrl } from '../utils/roblox-texture';
import Icon from './icon';
import WsNodeInspector from './ws-node-inspector';
import { keepState } from '../utils/tool-state';
import { makeShelf } from '../utils/idb-store';
import {
  decodeMoveset,
  encodeMoveset,
  branchNames,
  lineOf,
  reqOf,
  linePath,
  reqPath,
  branchObject,
  newProgram,
  newUid,
  setIn,
} from '../utils/skillbuilder/format';
import {
  CATEGORIES,
  categoryOf,
  NODES,
  GROUPS,
  PROP_FLAGS,
  REQ_KINDS,
  SKILL_FIELDS,
  nodeTitle,
  newNode,
} from '../utils/skillbuilder/schema';
import { simulate } from '../utils/skillbuilder/sim';
import { starterMoveset, blankSkill } from '../utils/skillbuilder/starter';

// Webskill Shenanigans: JJS's Skill Builder in the browser. Movesets come in
// and go out as the codes the Skill Builder copies; in between, skills are
// edited node by node (as in the game: branches along the top, a timeline of
// coloured nodes, their conditions and properties), and played on a 3D
// character against a dummy. The format and the rules come from reading real
// JJS exports: see docs/jjs-skill-builder.md.

const eq = (a, b) => a === b;
const not = (v) => !v;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const shelf = makeShelf('webskill');
const BRANCH_FIELDS = [
  'BRANCH',
  'BRANCH TARGET',
  'BRANCH FINISHER',
  'BRANCH COLLIDED',
];

const isTyping = (el) =>
  el?.isContentEditable ||
  ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName);

function whenSaved(at) {
  if (!at) return '';
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} hr ago` : new Date(at).toLocaleDateString();
}

export default class WebskillPage extends Component {
  @tracked skills = starterMoveset();
  @tracked name = 'My character';
  @tracked category = 'SKILL';
  @tracked skillUid = this.skills[0].uid;
  @tracked branch = '';
  @tracked tab = 'timeline';
  @tracked nodeIndex = 0;
  @tracked past = [];
  @tracked future = [];
  @tracked dialog = null;
  @tracked importText = '';
  @tracked importMode = 'replace';
  @tracked importError = null;
  @tracked exportScope = 'all';
  @tracked exportCode = '';
  @tracked copied = false;
  @tracked status = null;
  @tracked designId = null;
  @tracked dirty = false;
  @tracked designs = [];
  // Playback.
  @tracked run = null;
  @tracked time = 0;
  @tracked playing = false;
  @tracked speed = 1;
  @tracked fromBranch = false;
  @tracked hits = 'auto';
  @tracked conds = {
    AIR: false,
    JUMP: false,
    HOLD: false,
    ULT: false,
    BAR: 100,
  };
  @tracked follow = true;
  @tracked sounds = false;
  @tracked viewReady = false;
  @tracked viewError = null;

  categories = CATEGORIES;
  groups = GROUPS;
  reqKinds = REQ_KINDS;
  propFlags = PROP_FLAGS;
  uid = `ws${Math.random().toString(36).slice(2, 7)}`;
  scene = null;
  frame = 0;
  audio = new Map();
  lastKey = null;
  lastAt = 0;

  constructor(owner, args) {
    super(owner, args);
    keepState(
      this,
      'webskill',
      [
        'skills',
        'name',
        'category',
        'skillUid',
        'branch',
        'tab',
        'hits',
        'conds',
        'designId',
        'dirty',
        'follow',
        'sounds',
      ],
      (restored) => {
        if (!restored) return;
        if (!Array.isArray(this.skills) || !this.skills.length)
          this.skills = starterMoveset();
        this.skills = this.skills.map((s) =>
          s.uid ? s : { ...s, uid: newUid() },
        );
        if (!this.skill) this.skillUid = this.skills[0]?.uid ?? null;
        if (this.branch && !branchNames(this.program).includes(this.branch))
          this.branch = '';
        this.nodeIndex = 0;
        this.resimulate();
      },
    );
    const onKey = (event) => this.key(event);
    document.addEventListener('keydown', onKey);
    registerDestructor(this, () => {
      document.removeEventListener('keydown', onKey);
      cancelAnimationFrame(this.frame);
      clearTimeout(this.simTimer);
      for (const a of this.audio.values()) a?.pause?.();
      this.scene?.dispose();
    });
  }

  // ─── Derived ─────────────────────────────────────────────────────────

  get skill() {
    return this.skills.find((s) => s.uid === this.skillUid) ?? null;
  }

  get program() {
    return this.skill?.DATA ?? null;
  }

  get categoryRows() {
    return CATEGORIES.map((c) => ({
      ...c,
      count: this.skills.filter((s) => s.K_NAME === c.id).length,
      active: c.id === this.category,
      style: htmlSafe(`--ws-colour:${c.color}`),
    }));
  }

  get skillRows() {
    const colour = categoryOf(this.category);
    return this.skills
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => s.K_NAME === this.category)
      .map(({ s, index }) => ({
        uid: s.uid,
        index,
        name: s.NAME ?? '',
        label: s.K_NAME,
        separator: s.ADD === false && !s.DATA,
        active: s.uid === this.skillUid,
        key: s.KEY,
        style: htmlSafe(`--ws-colour:${colour.color}`),
        icon: colour.icon,
      }));
  }

  get branchTabs() {
    return [
      { name: '', label: 'Default', active: this.branch === '' },
      ...branchNames(this.program).map((name) => ({
        name,
        label: name,
        active: this.branch === name,
      })),
    ];
  }

  get branches() {
    return branchNames(this.program);
  }

  get line() {
    return lineOf(this.program, this.branch);
  }

  get nodes() {
    return this.line.map((node, index) => {
      const title = nodeTitle(node);
      return {
        index,
        ...title,
        active: index === this.nodeIndex,
        playing: this.playingAt.has(index),
        style: htmlSafe(`--ws-colour:${title.color}`),
      };
    });
  }

  // The nodes of this branch whose events are live at the playhead.
  get playingAt() {
    const out = new Set();
    if (!this.run) return out;
    for (const e of this.run.events)
      if (
        e.branch === this.branch &&
        this.time >= e.t &&
        this.time < e.end &&
        e.index !== undefined
      )
        out.add(e.index);
    return out;
  }

  get selectedNode() {
    return this.line[this.nodeIndex] ?? null;
  }

  get palette() {
    return GROUPS.map((group) => ({
      group,
      nodes: NODES.filter((n) => n.group === group).map((n) => ({
        ...n,
        style: htmlSafe(`--ws-colour:${n.color}`),
      })),
    }));
  }

  get reqs() {
    return reqOf(this.program, this.branch).map((req, index) => ({
      index,
      kind: req.K_NAME,
      flip: Boolean(req.FLIP),
      amount: req.AMOUNT,
      hasAmount: req.K_NAME === 'BAR' || 'AMOUNT' in req,
      label: REQ_KINDS.find((k) => k.id === req.K_NAME)?.label ?? req.K_NAME,
    }));
  }

  get skillFields() {
    const cat = this.skill?.K_NAME;
    return [...SKILL_FIELDS.common, ...(SKILL_FIELDS[cat] ?? [])].map((f) => ({
      ...f,
      value: this.skill?.[f.key] ?? f.def,
      has: this.skill && f.key in this.skill,
      id: `${this.uid}-skill-${f.key.replace(/\W+/g, '-')}`,
    }));
  }

  get props() {
    const prop = this.program?.Prop;
    const obj = prop && !Array.isArray(prop) ? prop : {};
    return {
      flags: PROP_FLAGS.map((f) => ({ ...f, on: Boolean(obj[f.key]) })),
      variable: obj.VAR ?? '',
      others: Object.entries(obj)
        .filter(([k]) => k !== 'VAR' && !PROP_FLAGS.some((f) => f.key === k))
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
    };
  }

  get hasProgram() {
    return Boolean(this.program);
  }

  get duration() {
    return this.run?.duration ?? 0;
  }

  get timeLabel() {
    return `${this.time.toFixed(2)} / ${this.duration.toFixed(2)}s`;
  }

  get targetHp() {
    if (!this.run) return 100;
    const hp = [...this.run.hp].reverse().find((h) => h.t <= this.time);
    return hp?.hp ?? 100;
  }

  get hpStyle() {
    return htmlSafe(`width:${this.targetHp}%`);
  }

  // States and tags live at the playhead, for the overlay on the view.
  get hud() {
    if (!this.run) return { user: [], target: [] };
    const out = { user: [], target: [] };
    for (const e of this.run.events)
      if (
        e.kind === 'STATE' &&
        !e.node.CHECK &&
        this.time >= e.t &&
        this.time < e.end
      )
        out[e.who].push(
          `${e.node.STATE ?? 'Stun'} ${Math.max(0, e.end - this.time).toFixed(1)}s`,
        );
    const tags = new Map();
    for (const t of this.run.tags)
      if (t.t <= this.time) tags.set(`${t.who}:${t.tag}`, t);
    for (const t of tags.values())
      if (t.value !== null) out[t.who].push(`${t.tag} = ${t.value}`);
    return out;
  }

  get logRows() {
    if (!this.run) return [];
    return this.run.log.slice(0, 400).map((l, i) => ({
      ...l,
      i,
      when: l.t.toFixed(2),
      past: l.t <= this.time,
      place: `${l.branch ? l.branch : 'Default'}${l.index !== undefined ? ` #${l.index + 1}` : ''}`,
    }));
  }

  get cannotUndo() {
    return !this.past.length;
  }

  get cannotRedo() {
    return !this.future.length;
  }

  // ─── History ─────────────────────────────────────────────────────────

  remember(key = null) {
    const now = performance.now();
    const same = key && key === this.lastKey && now - this.lastAt < 1000;
    this.lastKey = key;
    this.lastAt = now;
    if (same) return;
    this.past = [...this.past.slice(-79), this.skills];
    this.future = [];
  }

  change(skills, key) {
    this.remember(key);
    this.skills = skills;
    this.dirty = true;
    this.status = null;
    this.resimulate();
  }

  undo = () => {
    if (!this.past.length) return;
    this.future = [this.skills, ...this.future];
    this.skills = this.past.at(-1);
    this.past = this.past.slice(0, -1);
    this.afterHistory();
  };

  redo = () => {
    if (!this.future.length) return;
    this.past = [...this.past, this.skills];
    this.skills = this.future[0];
    this.future = this.future.slice(1);
    this.afterHistory();
  };

  afterHistory() {
    this.lastKey = null;
    if (!this.skill) this.skillUid = this.skills[0]?.uid ?? null;
    if (this.branch && !this.branches.includes(this.branch)) this.branch = '';
    this.nodeIndex = clamp(
      this.nodeIndex,
      0,
      Math.max(0, this.line.length - 1),
    );
    this.resimulate();
  }

  // ─── Editing ─────────────────────────────────────────────────────────

  editSkill(fnOf, key) {
    const uid = this.skillUid;
    this.change(
      this.skills.map((s) => (s.uid === uid ? fnOf(s) : s)),
      key,
    );
  }

  // Changes the program at a path, making one if the skill has none.
  editProgram(path, value, key) {
    this.editSkill((s) => {
      let data = s.DATA ?? newProgram();
      if (path[0] === 'Branch' && Array.isArray(data.Branch))
        data = { ...data, Branch: {} };
      if (path[0] === 'Prop' && Array.isArray(data.Prop))
        data = { ...data, Prop: {} };
      return { ...s, DATA: setIn(data, path, value) };
    }, key);
  }

  setLine(line, key) {
    this.editProgram(linePath(this.branch), line, key);
  }

  pickCategory = (id) => {
    this.category = id;
    const first = this.skills.find((s) => s.K_NAME === id);
    if (first && this.skill?.K_NAME !== id) this.pickSkill(first.uid);
  };

  pickSkill = (uid) => {
    this.skillUid = uid;
    this.branch = '';
    this.nodeIndex = 0;
    this.stop();
    this.resimulate();
  };

  pickBranch = (name) => {
    this.branch = name;
    this.nodeIndex = 0;
  };

  pickTab = (tab) => (this.tab = tab);
  pickNode = (index) => (this.nodeIndex = index);

  addNode = (kind) => {
    const line = [...this.line];
    const at = line.length ? clamp(this.nodeIndex + 1, 0, line.length) : 0;
    line.splice(at, 0, newNode(kind));
    this.setLine(line);
    this.nodeIndex = at;
  };

  moveNode = (step) => {
    const i = this.nodeIndex;
    const j = i + step;
    const line = [...this.line];
    if (j < 0 || j >= line.length) return;
    [line[i], line[j]] = [line[j], line[i]];
    this.setLine(line);
    this.nodeIndex = j;
  };

  duplicateNode = () => {
    const node = this.selectedNode;
    if (!node) return;
    const line = [...this.line];
    line.splice(this.nodeIndex + 1, 0, structuredClone(node));
    this.setLine(line);
    this.nodeIndex += 1;
  };

  deleteNode = () => {
    if (!this.selectedNode) return;
    const line = this.line.filter((_, i) => i !== this.nodeIndex);
    this.setLine(line);
    this.nodeIndex = clamp(this.nodeIndex, 0, Math.max(0, line.length - 1));
  };

  setNodeField = (key, value) => {
    const i = this.nodeIndex;
    this.editProgram(
      [...linePath(this.branch), i, key],
      value,
      `${this.skillUid}:${this.branch}:${i}:${key}`,
    );
  };

  clearNodeField = (key) => {
    const i = this.nodeIndex;
    const { [key]: _gone, ...rest } = this.line[i];
    this.editProgram([...linePath(this.branch), i], rest);
  };

  // Drag a node onto another to move it there.
  dragStart = (index, event) => {
    this.dragFrom = index;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  };

  dragOver = (event) => event.preventDefault();

  dropOn = (index, event) => {
    event.preventDefault();
    const from = this.dragFrom;
    this.dragFrom = null;
    if (from === undefined || from === null || from === index) return;
    const line = [...this.line];
    const [moved] = line.splice(from, 1);
    line.splice(index, 0, moved);
    this.setLine(line);
    this.nodeIndex = index;
  };

  // Branches.
  addBranch = () => {
    const names = new Set(this.branches);
    let n = names.size + 1;
    while (names.has(`Branch${n}`)) n++;
    const name = `Branch${n}`;
    this.editProgram(['Branch', name], { Line: [], Req: [] });
    this.branch = name;
    this.nodeIndex = 0;
  };

  // Renaming keeps every BRANCH, BRANCH TARGET… and RANDOM that pointed at it.
  renameBranch = (event) => {
    const from = this.branch;
    const to = event.target.value.trim();
    if (!from || !to || to === from || this.branches.includes(to)) {
      event.target.value = from;
      return;
    }
    const rename = (node) => {
      let out = node;
      for (const key of BRANCH_FIELDS)
        if (out[key] === from) out = { ...out, [key]: to };
      if (
        typeof out.RANDOM === 'string' &&
        out.RANDOM.split(',').some((s) => s.trim() === from)
      )
        out = {
          ...out,
          RANDOM: out.RANDOM.split(',')
            .map((s) => (s.trim() === from ? to : s.trim()))
            .join(', '),
        };
      return out;
    };
    this.editSkill((s) => {
      const data = s.DATA;
      const branches = {};
      for (const [name, b] of Object.entries(branchObject(data)))
        branches[name === from ? to : name] = {
          ...b,
          Line: (b.Line ?? []).map(rename),
        };
      return {
        ...s,
        DATA: {
          ...data,
          Line: (data.Line ?? []).map(rename),
          Branch: branches,
        },
      };
    });
    this.branch = to;
  };

  deleteBranch = () => {
    const name = this.branch;
    if (!name) return;
    this.editSkill((s) => {
      const { [name]: _gone, ...rest } = branchObject(s.DATA);
      return { ...s, DATA: { ...s.DATA, Branch: rest } };
    });
    this.branch = '';
    this.nodeIndex = 0;
  };

  // Conditions.
  addReq = (kind) => {
    const req =
      kind === 'BAR'
        ? { K_NAME: 'BAR', AMOUNT: 99.99 }
        : { FLIP: false, K_NAME: kind };
    this.editProgram(reqPath(this.branch), [
      ...reqOf(this.program, this.branch),
      req,
    ]);
  };

  toggleReqFlip = (index) => {
    const reqs = [...reqOf(this.program, this.branch)];
    reqs[index] = { ...reqs[index], FLIP: !reqs[index].FLIP };
    this.editProgram(reqPath(this.branch), reqs);
  };

  setReqAmount = (index, event) => {
    const reqs = [...reqOf(this.program, this.branch)];
    reqs[index] = { ...reqs[index], AMOUNT: Number(event.target.value) || 0 };
    this.editProgram(reqPath(this.branch), reqs, `req:${index}`);
  };

  removeReq = (index) => {
    this.editProgram(
      reqPath(this.branch),
      reqOf(this.program, this.branch).filter((_, i) => i !== index),
    );
  };

  // Skill properties.
  setSkillField = (field, event) => {
    const el = event.target;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (field.type === 'num') value = Number(value) || 0;
    this.editSkill((s) => ({ ...s, [field.key]: value }), `skill:${field.key}`);
  };

  toggleFlag = (key) => {
    const prop = this.program?.Prop;
    const on = prop && !Array.isArray(prop) && prop[key];
    if (on) {
      const { [key]: _gone, ...rest } = prop;
      this.editProgram(['Prop'], rest);
    } else this.editProgram(['Prop', key], true);
  };

  setVariable = (event) => {
    const value = event.target.value.trim();
    const prop = this.program?.Prop;
    const base = prop && !Array.isArray(prop) ? prop : {};
    const { VAR: _old, ...rest } = base;
    this.editProgram(['Prop'], value ? { ...rest, VAR: value } : rest);
  };

  // Skills.
  addSkill = () => {
    const count = this.skills.filter((s) => s.K_NAME === this.category).length;
    const skill = blankSkill(
      this.category,
      this.category === 'MELEE' ? String(count + 1) : 'New skill',
    );
    const lastOfCategory = this.skills.findLastIndex(
      (s) => s.K_NAME === this.category,
    );
    const skills = [...this.skills];
    skills.splice(
      lastOfCategory < 0 ? skills.length : lastOfCategory + 1,
      0,
      skill,
    );
    this.change(skills);
    this.pickSkill(skill.uid);
  };

  duplicateSkill = () => {
    const skill = this.skill;
    if (!skill) return;
    const copy = {
      ...structuredClone(skill),
      uid: newUid(),
      NAME: `${skill.NAME} copy`,
    };
    const i = this.skills.indexOf(skill);
    const skills = [...this.skills];
    skills.splice(i + 1, 0, copy);
    this.change(skills);
    this.pickSkill(copy.uid);
  };

  deleteSkill = () => {
    const skill = this.skill;
    if (!skill) return;
    const i = this.skills.indexOf(skill);
    const skills = this.skills.filter((s) => s !== skill);
    this.change(skills);
    const next =
      skills.slice(i).find((s) => s.K_NAME === this.category) ??
      skills.findLast((s) => s.K_NAME === this.category) ??
      skills[0];
    this.skillUid = next?.uid ?? null;
    this.branch = '';
    this.nodeIndex = 0;
  };

  // Up or down among the skills of the same category.
  moveSkill = (step) => {
    const rows = this.skillRows;
    const at = rows.findIndex((r) => r.uid === this.skillUid);
    const other = rows[at + step];
    if (at < 0 || !other) return;
    const skills = [...this.skills];
    [skills[rows[at].index], skills[other.index]] = [
      skills[other.index],
      skills[rows[at].index],
    ];
    this.change(skills);
  };

  setName = (event) => {
    this.name = event.target.value.trim().slice(0, 60) || 'My character';
    this.dirty = true;
  };

  // ─── Import, export, save ────────────────────────────────────────────

  openDialog = (name) => {
    this.dialog = name;
    this.importError = null;
    this.copied = false;
    if (name === 'export') this.makeExport();
    if (name === 'open') this.refreshDesigns();
  };

  closeDialog = () => (this.dialog = null);

  backdrop = (event) => {
    if (event.target === event.currentTarget) this.closeDialog();
  };

  setImportText = (event) => (this.importText = event.target.value);
  setImportMode = (mode) => (this.importMode = mode);

  importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) this.importText = (await file.text()).trim();
  };

  doImport = async () => {
    try {
      const skills = await waitForPromise(decodeMoveset(this.importText));
      if (this.importMode === 'append')
        this.change([...this.skills, ...skills]);
      else {
        this.change(skills);
        this.designId = null;
      }
      const first = skills.find((s) => s.DATA) ?? skills[0];
      if (first) {
        this.category = first.K_NAME;
        this.pickSkill(first.uid);
      }
      this.dialog = null;
      this.importText = '';
      this.status = `Imported ${skills.length} skill${skills.length === 1 ? '' : 's'}.`;
    } catch (error) {
      this.importError = error.message;
    }
  };

  setExportScope = (scope) => {
    this.exportScope = scope;
    this.makeExport();
  };

  makeExport = async () => {
    this.exportCode = '';
    this.copied = false;
    const skills =
      this.exportScope === 'skill' && this.skill ? [this.skill] : this.skills;
    const code = await waitForPromise(encodeMoveset(skills));
    if (!isDestroyed(this)) this.exportCode = code;
  };

  copyExport = async () => {
    try {
      await navigator.clipboard.writeText(this.exportCode);
      this.copied = true;
    } catch {
      this.copied = false;
    }
  };

  downloadExport = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(
      new Blob([this.exportCode], { type: 'text/plain' }),
    );
    link.download = `${this.name || 'moveset'}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  };

  saveHere = async () => {
    this.designId ??= `ws-${Date.now().toString(36)}`;
    const ok = await shelf.store(
      this.designId,
      { name: this.name, skills: this.skills.length },
      { name: this.name, skills: this.skills },
    );
    if (ok) this.dirty = false;
    this.status = ok
      ? `Saved “${this.name}” in this browser.`
      : 'This browser wouldn’t keep it: export the code instead.';
    if (this.dialog === 'open') this.refreshDesigns();
  };

  refreshDesigns = async () => {
    const list = await shelf.list();
    this.designs = list.map((d) => ({
      ...d,
      when: whenSaved(d.savedAt),
      current: d.id === this.designId,
    }));
  };

  openSaved = async (id) => {
    const saved = await shelf.load(id);
    if (!saved?.skills) return this.refreshDesigns();
    this.change(saved.skills.map((s) => (s.uid ? s : { ...s, uid: newUid() })));
    this.name = saved.name ?? 'My character';
    this.designId = id;
    this.dirty = false;
    const first = this.skills[0];
    if (first) {
      this.category = first.K_NAME;
      this.pickSkill(first.uid);
    }
    this.dialog = null;
  };

  deleteSaved = async (id) => {
    await shelf.forget(id);
    if (this.designId === id) this.designId = null;
    this.refreshDesigns();
  };

  newMoveset = () => {
    this.change(starterMoveset());
    this.name = 'My character';
    this.designId = null;
    this.dirty = false;
    this.category = 'SKILL';
    this.pickSkill(this.skills[0].uid);
  };

  // ─── Playing ─────────────────────────────────────────────────────────

  bindView = modifier((element) => {
    let gone = false;
    import('../lazy/skill-scene')
      .then(({ mountSkillScene }) => {
        if (gone) return;
        this.scene = mountSkillScene(element, { textureUrl });
        this.scene.setFollow(this.follow);
        if (this.run) this.scene.setRun(this.run);
        this.scene.show(this.time);
        this.viewReady = true;
      })
      .catch(
        (error) =>
          (this.viewError = error?.message ?? 'The 3D view couldn’t start'),
      );
    return () => {
      gone = true;
      this.scene?.dispose();
      this.scene = null;
      this.viewReady = false;
    };
  });

  resimulate() {
    clearTimeout(this.simTimer);
    this.simTimer = setTimeout(() => this.simulateNow(), 120);
  }

  simulateNow() {
    if (isDestroyed(this)) return;
    const skill = this.skill;
    this.run = skill?.DATA
      ? simulate(skill, {
          conditions: this.conds,
          hits: this.hits,
          start: this.fromBranch ? this.branch : '',
        })
      : null;
    this.time = Math.min(this.time, this.run?.duration ?? 0);
    this.scene?.setRun(this.run);
    this.scene?.show(this.time);
  }

  play = () => {
    if (this.playing) return this.stop();
    this.simulateNow();
    if (!this.run) return;
    if (this.time >= this.run.duration - 0.01) this.time = 0;
    this.playing = true;
    let last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      const before = this.time;
      this.time = Math.min(
        this.run.duration,
        this.time + ((now - last) / 1000) * this.speed,
      );
      last = now;
      this.soundsBetween(before, this.time);
      this.scene?.show(this.time);
      if (this.time >= this.run.duration) {
        this.playing = false;
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  };

  stop() {
    this.playing = false;
    cancelAnimationFrame(this.frame);
  }

  restart = () => {
    this.stop();
    this.time = 0;
    this.scene?.show(0);
    this.play();
  };

  scrub = (event) => {
    this.stop();
    this.time = Number(event.target.value) || 0;
    this.scene?.show(this.time);
  };

  setSpeed = (event) => (this.speed = Number(event.target.value) || 1);

  setCond = (key, event) => {
    const value =
      key === 'BAR'
        ? clamp(Number(event.target.value) || 0, 0, 100)
        : event.target.checked;
    this.conds = { ...this.conds, [key]: value };
    this.simulateNow();
  };

  setHits = (mode) => {
    this.hits = mode;
    this.simulateNow();
  };

  toggleFromBranch = () => {
    this.fromBranch = !this.fromBranch;
    this.simulateNow();
  };

  toggleFollow = () => {
    this.follow = !this.follow;
    this.scene?.setFollow(this.follow);
  };

  toggleSounds = () => (this.sounds = !this.sounds);

  resetCamera = () => this.scene?.resetCamera();

  // Sounds play as the playhead passes them, when the site can fetch them
  // (Roblox keeps many sounds private; those stay silent).
  soundsBetween(from, to) {
    if (!this.sounds || !this.run) return;
    for (const e of this.run.events) {
      if (e.kind !== 'SFX' || e.t < from || e.t >= to) continue;
      const id = String(e.node.ID ?? '');
      if (!id || id === '0') continue;
      let audio = this.audio.get(id);
      if (audio === undefined) {
        audio = new Audio(
          `/api/roblox?kind=asset&id=${encodeURIComponent(id)}`,
        );
        audio.preload = 'auto';
        this.audio.set(id, audio);
      }
      try {
        audio.currentTime = Number(e.node.START) || 0;
        audio.volume = clamp((Number(e.node.VOLUME) || 1) / 5, 0, 1);
        audio.playbackRate = clamp(Number(e.node.SPEED) || 1, 0.25, 4);
        audio.play().catch(() => {});
      } catch {
        // not playable
      }
    }
  }

  // A log line takes you to its node and its moment.
  jumpTo = (row) => {
    this.stop();
    this.time = row.t;
    this.scene?.show(row.t);
    if (
      row.branch !== undefined &&
      (row.branch === '' || this.branches.includes(row.branch))
    ) {
      this.branch = row.branch ?? '';
      if (row.index !== undefined) this.nodeIndex = row.index;
      this.tab = 'timeline';
    }
  };

  // ─── Keys ────────────────────────────────────────────────────────────

  key(event) {
    if (this.dialog) {
      if (event.key === 'Escape') this.closeDialog();
      return;
    }
    if (isTyping(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const k = event.key.toLowerCase();
    if (mod && k === 'z') {
      event.preventDefault();
      return event.shiftKey ? this.redo() : this.undo();
    }
    if (mod && k === 'y') {
      event.preventDefault();
      return this.redo();
    }
    if (mod && k === 's') {
      event.preventDefault();
      return this.saveHere();
    }
    if (mod && k === 'd') {
      event.preventDefault();
      return this.duplicateNode();
    }
    if (k === ' ' && !mod) {
      event.preventDefault();
      return this.play();
    }
    if (this.tab !== 'timeline') return;
    if (k === 'delete' || k === 'backspace') {
      event.preventDefault();
      return this.deleteNode();
    }
    if (k === 'arrowup' || k === 'arrowdown') {
      event.preventDefault();
      if (event.altKey) return this.moveNode(k === 'arrowup' ? -1 : 1);
      this.nodeIndex = clamp(
        this.nodeIndex + (k === 'arrowup' ? -1 : 1),
        0,
        Math.max(0, this.line.length - 1),
      );
    }
  }

  <template>
    {{! template-lint-disable no-pointer-down-event-binding }}
    <div class="ws-app">
      {{! ── Menu ── }}
      <header class="ws-menubar">
        <LinkTo @route="index" class="ws-brand" title="Back to Woogi Tools">
          <img src="/icon_expanded.png" alt="Woogi Tools" />
        </LinkTo>
        <div class="ws-cluster">
          <button
            type="button"
            class="ws-menu-btn"
            {{on "click" this.newMoveset}}
          >
            <Icon @name="file-plus" @size={{14}} /><span>New</span>
          </button>
          <button
            type="button"
            class="ws-menu-btn ws-import"
            {{on "click" (fn this.openDialog "import")}}
          >
            <Icon @name="upload" @size={{14}} /><span>Import</span>
          </button>
          <button
            type="button"
            class="ws-menu-btn ws-open"
            {{on "click" (fn this.openDialog "open")}}
          >
            <Icon @name="folder" @size={{14}} /><span>Open</span>
          </button>
          <button
            type="button"
            class="ws-menu-btn ws-save"
            title="Save in this browser (Ctrl+S)"
            {{on "click" this.saveHere}}
          >
            <Icon @name="save" @size={{14}} /><span>Save</span>
          </button>
        </div>
        <span class="ws-sep"></span>
        <div class="ws-name">
          <input
            type="text"
            class="ws-name-input"
            aria-label="Moveset name"
            maxlength="60"
            spellcheck="false"
            value={{this.name}}
            {{on "change" this.setName}}
          />
          <span
            class="ws-dirty {{if this.dirty 'is-dirty'}}"
            title={{if this.dirty "Changed since it was saved" "Saved"}}
          ></span>
        </div>
        <span class="ws-sep"></span>
        <div class="ws-cluster">
          <button
            type="button"
            class="ws-menu-btn"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={{this.cannotUndo}}
            {{on "click" this.undo}}
          >
            <Icon @name="undo-2" @size={{14}} />
          </button>
          <button
            type="button"
            class="ws-menu-btn"
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            disabled={{this.cannotRedo}}
            {{on "click" this.redo}}
          >
            <Icon @name="rotate-cw" @size={{14}} />
          </button>
        </div>
        <span class="ws-spacer"></span>
        <button
          type="button"
          class="ws-primary ws-export"
          {{on "click" (fn this.openDialog "export")}}
        >
          <Icon @name="copy" @size={{14}} /><span>Export code</span>
        </button>
      </header>

      {{! ── Moveset ── }}
      <aside class="ws-moveset">
        <div class="ws-categories" role="tablist" aria-label="Categories">
          {{#each this.categoryRows as |c|}}
            <button
              type="button"
              role="tab"
              class="ws-bar ws-category {{if c.active 'active'}}"
              style={{c.style}}
              aria-selected={{if c.active "true" "false"}}
              {{on "click" (fn this.pickCategory c.id)}}
            >
              <Icon @name={{c.icon}} @size={{15}} />
              <span class="ws-bar-label">{{c.id}}</span>
              <span class="ws-count">{{c.count}}</span>
            </button>
          {{/each}}
        </div>
        <ul class="ws-skills" aria-label="Skills">
          {{#each this.skillRows key="uid" as |row|}}
            <li>
              <button
                type="button"
                class="ws-bar ws-skill
                  {{if row.active 'active'}}
                  {{if row.separator 'is-separator'}}"
                style={{row.style}}
                {{on "click" (fn this.pickSkill row.uid)}}
              >
                <Icon @name={{row.icon}} @size={{14}} />
                <span class="ws-bar-label">[{{row.name}}] {{row.label}}</span>
              </button>
            </li>
          {{else}}
            <li class="ws-empty">No {{this.category}} yet.</li>
          {{/each}}
        </ul>
        <div class="ws-panel-foot">
          <button
            type="button"
            title="Add a skill"
            aria-label="Add a skill"
            {{on "click" this.addSkill}}
          ><Icon @name="plus" @size={{14}} /></button>
          <button
            type="button"
            title="Move up"
            aria-label="Move skill up"
            {{on "click" (fn this.moveSkill -1)}}
          ><Icon @name="arrow-up" @size={{14}} /></button>
          <button
            type="button"
            title="Move down"
            aria-label="Move skill down"
            {{on "click" (fn this.moveSkill 1)}}
          ><Icon @name="arrow-down" @size={{14}} /></button>
          <button
            type="button"
            title="Duplicate"
            aria-label="Duplicate skill"
            {{on "click" this.duplicateSkill}}
          ><Icon @name="copy" @size={{14}} /></button>
          <span class="ws-spacer"></span>
          <button
            type="button"
            title="Delete"
            aria-label="Delete skill"
            disabled={{not this.skill}}
            {{on "click" this.deleteSkill}}
          ><Icon @name="trash-2" @size={{14}} /></button>
        </div>
      </aside>

      {{! ── Skill editor ── }}
      <section class="ws-editor" aria-label="Skill">
        {{#if this.skill}}
          <div class="ws-branches" role="tablist" aria-label="Branches">
            {{#each this.branchTabs key="name" as |b|}}
              <button
                type="button"
                role="tab"
                class="ws-branch {{if b.active 'active'}}"
                aria-selected={{if b.active "true" "false"}}
                {{on "click" (fn this.pickBranch b.name)}}
              >{{b.label}}</button>
            {{/each}}
            <button
              type="button"
              class="ws-branch ws-add-branch"
              title="Add a branch"
              aria-label="Add a branch"
              {{on "click" this.addBranch}}
            >
              <Icon @name="plus" @size={{13}} />
            </button>
          </div>
          <div class="ws-tabs" role="tablist" aria-label="Skill editor">
            {{#each (tabList) as |t|}}
              <button
                type="button"
                role="tab"
                class={{if (eq this.tab t.id) "active"}}
                aria-selected={{if (eq this.tab t.id) "true" "false"}}
                {{on "click" (fn this.pickTab t.id)}}
              >{{t.label}}</button>
            {{/each}}
          </div>

          {{#if (eq this.tab "timeline")}}
            <div class="ws-timeline">
              <div class="ws-palette" aria-label="Add a node">
                {{#each this.palette as |g|}}
                  <h4 class="ws-palette-group">{{g.group}}</h4>
                  {{#each g.nodes as |n|}}
                    <button
                      type="button"
                      class="ws-bar ws-palette-node"
                      style={{n.style}}
                      title={{n.about}}
                      {{on "click" (fn this.addNode n.kind)}}
                    >
                      <Icon @name={{n.icon}} @size={{13}} />
                      <span class="ws-bar-label">{{n.label}}</span>
                    </button>
                  {{/each}}
                {{/each}}
              </div>
              <ol class="ws-nodes" aria-label="Nodes">
                {{#each this.nodes as |n|}}
                  <li
                    draggable="true"
                    {{on "dragstart" (fn this.dragStart n.index)}}
                    {{on "dragover" this.dragOver}}
                    {{on "drop" (fn this.dropOn n.index)}}
                  >
                    <button
                      type="button"
                      class="ws-bar ws-node
                        {{if n.active 'active'}}
                        {{if n.playing 'is-playing'}}"
                      style={{n.style}}
                      {{on "click" (fn this.pickNode n.index)}}
                    >
                      <span class="ws-node-n">{{inc n.index}}</span>
                      <Icon @name={{n.icon}} @size={{13}} />
                      <span class="ws-bar-label">{{#if n.detail}}[{{n.detail}}]
                        {{/if}}{{n.label}}</span>
                    </button>
                  </li>
                {{else}}
                  <li class="ws-empty">Empty. Add nodes from the left.</li>
                {{/each}}
              </ol>
            </div>
            <div class="ws-node-panel">
              <div class="ws-node-tools">
                <strong>{{if
                    this.selectedNode
                    (nodeLabel this.selectedNode)
                    "No node"
                  }}</strong>
                <span class="ws-spacer"></span>
                <button
                  type="button"
                  title="Move up (Alt+↑)"
                  aria-label="Move node up"
                  disabled={{not this.selectedNode}}
                  {{on "click" (fn this.moveNode -1)}}
                ><Icon @name="arrow-up" @size={{13}} /></button>
                <button
                  type="button"
                  title="Move down (Alt+↓)"
                  aria-label="Move node down"
                  disabled={{not this.selectedNode}}
                  {{on "click" (fn this.moveNode 1)}}
                ><Icon @name="arrow-down" @size={{13}} /></button>
                <button
                  type="button"
                  title="Duplicate (Ctrl+D)"
                  aria-label="Duplicate node"
                  disabled={{not this.selectedNode}}
                  {{on "click" this.duplicateNode}}
                ><Icon @name="copy" @size={{13}} /></button>
                <button
                  type="button"
                  title="Delete (Del)"
                  aria-label="Delete node"
                  disabled={{not this.selectedNode}}
                  {{on "click" this.deleteNode}}
                ><Icon @name="trash-2" @size={{13}} /></button>
              </div>
              {{#if this.selectedNode}}
                <WsNodeInspector
                  @node={{this.selectedNode}}
                  @branches={{this.branches}}
                  @uid={{this.uid}}
                  @onSet={{this.setNodeField}}
                  @onClear={{this.clearNodeField}}
                />
              {{/if}}
            </div>
          {{/if}}

          {{#if (eq this.tab "conditions")}}
            <div class="ws-scroll">
              {{#if this.branch}}
                <section class="ws-group">
                  <h4 class="ws-group-title">Branch</h4>
                  <label class="ws-row"><span>Name</span><input
                      type="text"
                      class="math-input ws-branch-name"
                      spellcheck="false"
                      value={{this.branch}}
                      {{on "change" this.renameBranch}}
                    /></label>
                  <p class="ws-hint">Renaming also renames every BRANCH, target
                    and random pick that goes here.</p>
                  <button
                    type="button"
                    class="btn"
                    {{on "click" this.deleteBranch}}
                  >
                    <Icon @name="trash-2" @size={{13}} />
                    Delete this branch
                  </button>
                </section>
              {{/if}}
              <section class="ws-group">
                <h4 class="ws-group-title">{{if
                    this.branch
                    "Only enters when"
                    "Only starts when"
                  }}</h4>
                {{#each this.reqs as |r|}}
                  <div class="ws-req">
                    <button
                      type="button"
                      class="ws-flip {{if r.flip 'is-flipped'}}"
                      title="FLIP: the opposite"
                      {{on "click" (fn this.toggleReqFlip r.index)}}
                    >{{if r.flip "NOT" "IS"}}</button>
                    <span class="ws-req-label">{{r.label}}</span>
                    {{#if r.hasAmount}}
                      <input
                        type="number"
                        step="any"
                        class="math-input ws-req-amount"
                        aria-label="Amount"
                        value={{r.amount}}
                        {{on "change" (fn this.setReqAmount r.index)}}
                      />
                    {{/if}}
                    <button
                      type="button"
                      class="ws-icon-btn"
                      aria-label="Remove condition"
                      {{on "click" (fn this.removeReq r.index)}}
                    ><Icon @name="x" @size={{12}} /></button>
                  </div>
                {{else}}
                  <p class="ws-hint">No conditions:
                    {{if
                      this.branch
                      "any BRANCH to here enters."
                      "the skill always starts."
                    }}</p>
                {{/each}}
                <div class="ws-chips">
                  {{#each this.reqKinds as |k|}}
                    <button type="button" {{on "click" (fn this.addReq k.id)}}>+
                      {{k.label}}</button>
                  {{/each}}
                </div>
                <p class="ws-hint">A BRANCH whose conditions don’t hold is
                  skipped and the line carries on: that’s how one move gets
                  ground, air and jump versions.</p>
              </section>
            </div>
          {{/if}}

          {{#if (eq this.tab "properties")}}
            <div class="ws-scroll">
              <section class="ws-group">
                <h4 class="ws-group-title">{{this.skill.K_NAME}}</h4>
                {{#each this.skillFields key="key" as |f|}}
                  <label class="ws-row" title={{f.hint}}>
                    <span>{{f.label}}</span>
                    {{#if (eq f.type "bool")}}
                      <input
                        type="checkbox"
                        checked={{f.value}}
                        {{on "change" (fn this.setSkillField f)}}
                      />
                    {{else}}
                      <input
                        type={{if (eq f.type "num") "number" "text"}}
                        step="any"
                        class="math-input"
                        value={{f.value}}
                        {{on "change" (fn this.setSkillField f)}}
                      />
                    {{/if}}
                  </label>
                {{/each}}
              </section>
              {{#if this.hasProgram}}
                <section class="ws-group">
                  <h4 class="ws-group-title">Flags</h4>
                  <div class="ws-flags">
                    {{#each this.props.flags as |p|}}
                      <label class="math-check" title={{p.hint}}><input
                          type="checkbox"
                          checked={{p.on}}
                          {{on "change" (fn this.toggleFlag p.key)}}
                        />
                        {{p.label}}</label>
                    {{/each}}
                  </div>
                  <label class="ws-row"><span>VAR</span><input
                      type="text"
                      class="math-input"
                      spellcheck="false"
                      placeholder="none"
                      value={{this.props.variable}}
                      {{on "change" this.setVariable}}
                    /></label>
                  {{#each this.props.others as |o|}}<p class="ws-hint">Also:
                      {{o}}</p>{{/each}}
                  <p class="ws-hint">Hover a flag for what it seems to do; the
                    handbook marks these meanings as inferred.</p>
                </section>
              {{else}}
                <p class="ws-hint ws-pad">A separator: it has no program, only a
                  place in the list.</p>
              {{/if}}
            </div>
          {{/if}}
        {{else}}
          <p class="ws-hint ws-pad">Pick a skill, or add one with + under the
            list.</p>
        {{/if}}
      </section>

      {{! ── 3D view and playback ── }}
      <section class="ws-view" aria-label="Preview">
        <div class="ws-viewport" {{this.bindView}}>
          {{#unless this.viewReady}}
            <p class="ws-view-note">{{if
                this.viewError
                this.viewError
                "Loading the 3D view…"
              }}</p>
          {{/unless}}
          <div class="ws-hud">
            <div class="ws-hp" title="The dummy’s health">
              <span class="ws-hp-fill" style={{this.hpStyle}}></span>
              <span class="ws-hp-text">Dummy {{this.targetHp}}</span>
            </div>
            <div class="ws-hud-cols">
              <ul class="ws-hud-list">{{#each this.hud.user as |s|}}<li
                  >{{s}}</li>{{/each}}</ul>
              <ul class="ws-hud-list is-target">{{#each
                  this.hud.target
                  as |s|
                }}<li>{{s}}</li>{{/each}}</ul>
            </div>
          </div>
          <div class="ws-view-tools">
            <button
              type="button"
              class="ws-chip {{if this.follow 'active'}}"
              title="Keep both characters in view"
              {{on "click" this.toggleFollow}}
            >Follow</button>
            <button
              type="button"
              class="ws-chip {{if this.sounds 'active'}}"
              title="Play the skill’s Roblox sounds, where they’re public"
              {{on "click" this.toggleSounds}}
            >Sounds</button>
            <button
              type="button"
              class="ws-chip"
              title="Put the camera back"
              {{on "click" this.resetCamera}}
            ><Icon @name="locate-fixed" @size={{12}} /></button>
          </div>
        </div>
        <div class="ws-playbar">
          <button
            type="button"
            class="ws-menu-btn ws-play"
            aria-label={{if this.playing "Pause" "Play"}}
            title="Play (Space)"
            disabled={{not this.hasProgram}}
            {{on "click" this.play}}
          >
            <Icon @name={{if this.playing "pause" "play"}} @size={{15}} />
          </button>
          <button
            type="button"
            class="ws-menu-btn"
            aria-label="Play from the start"
            title="From the start"
            disabled={{not this.hasProgram}}
            {{on "click" this.restart}}
          >
            <Icon @name="skip-back" @size={{14}} />
          </button>
          <input
            type="range"
            class="ws-scrub"
            min="0"
            max={{this.duration}}
            step="0.01"
            value={{this.time}}
            aria-label="Time"
            {{on "input" this.scrub}}
          />
          <span class="ws-time">{{this.timeLabel}}</span>
          <select
            class="select ws-speed"
            aria-label="Speed"
            {{on "change" this.setSpeed}}
          >
            <option value="1" selected={{eq this.speed 1}}>1×</option>
            <option value="0.5" selected={{eq this.speed 0.5}}>0.5×</option>
            <option value="0.25" selected={{eq this.speed 0.25}}>0.25×</option>
          </select>
        </div>
        <div class="ws-conds">
          <label class="math-check"><input
              type="checkbox"
              checked={{this.conds.AIR}}
              {{on "change" (fn this.setCond "AIR")}}
            />
            Air</label>
          <label class="math-check"><input
              type="checkbox"
              checked={{this.conds.JUMP}}
              {{on "change" (fn this.setCond "JUMP")}}
            />
            Jump</label>
          <label class="math-check"><input
              type="checkbox"
              checked={{this.conds.HOLD}}
              {{on "change" (fn this.setCond "HOLD")}}
            />
            Hold</label>
          <label class="math-check"><input
              type="checkbox"
              checked={{this.conds.ULT}}
              {{on "change" (fn this.setCond "ULT")}}
            />
            Awakened</label>
          <label class="ws-bar-input"><span>Bar</span><input
              type="number"
              min="0"
              max="100"
              class="math-input"
              value={{this.conds.BAR}}
              {{on "change" (fn this.setCond "BAR")}}
            /></label>
          <span class="ws-sep"></span>
          <div class="ws-seg" role="group" aria-label="Hits">
            {{#each (hitModes) as |m|}}
              <button
                type="button"
                class={{if (eq this.hits m.id) "active"}}
                title={{m.title}}
                {{on "click" (fn this.setHits m.id)}}
              >{{m.label}}</button>
            {{/each}}
          </div>
          <label
            class="math-check"
            title="Play the branch open in the editor instead of the whole skill"
          ><input
              type="checkbox"
              checked={{this.fromBranch}}
              {{on "change" this.toggleFromBranch}}
            />
            This branch</label>
        </div>
        <ol class="ws-log" aria-label="What happened">
          {{#each this.run.warnings as |w|}}<li
              class="ws-log-warn"
            >{{w}}</li>{{/each}}
          {{#each this.logRows as |l|}}
            <li class="{{if l.past 'is-past'}} is-{{l.who}}">
              <button type="button" {{on "click" (fn this.jumpTo l)}}>
                <span class="ws-log-t">{{l.when}}</span>
                <span class="ws-log-who">{{if
                    (eq l.who "user")
                    "You"
                    "Dummy"
                  }}</span>
                <span class="ws-log-text">{{l.text}}</span>
                <span class="ws-log-at">{{l.place}}</span>
              </button>
            </li>
          {{/each}}
        </ol>
      </section>

      <footer class="ws-status">
        <span class="ws-status-msg" role="status">{{#if
            this.status
          }}{{this.status}}{{else}}{{this.skills.length}}
            skills · the dummy stands 5 studs ahead · a model of JJS, not JJS{{/if}}</span>
      </footer>

      {{! ── Dialogs ── }}
      {{#if (eq this.dialog "import")}}
        {{! template-lint-disable no-invalid-interactive }}
        <div class="ws-dialog-backdrop" {{on "click" this.backdrop}}>
          {{! template-lint-enable no-invalid-interactive }}
          <div
            class="ws-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Import"
          >
            <div class="ws-dialog-head">
              <h3>Import a moveset</h3>
              <button
                type="button"
                class="ws-menu-btn"
                aria-label="Close"
                {{on "click" this.closeDialog}}
              ><Icon @name="x" @size={{14}} /></button>
            </div>
            <div class="ws-dialog-body">
              <p class="ws-hint">Paste the code JJS’s Skill Builder copies out
                (the export button at the bottom of its skill list).</p>
              <textarea
                class="math-input ws-code"
                rows="7"
                spellcheck="false"
                aria-label="Skill code"
                placeholder="KLUv/…"
                value={{this.importText}}
                {{on "input" this.setImportText}}
              ></textarea>
              <div class="ws-actions">
                <label class="btn">
                  <Icon @name="file-text" @size={{13}} />
                  From a file
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    class="sr-only"
                    {{on "change" this.importFile}}
                  />
                </label>
                <div class="ws-seg" role="group" aria-label="Import as">
                  <button
                    type="button"
                    class={{if (eq this.importMode "replace") "active"}}
                    {{on "click" (fn this.setImportMode "replace")}}
                  >Replace</button>
                  <button
                    type="button"
                    class={{if (eq this.importMode "append") "active"}}
                    {{on "click" (fn this.setImportMode "append")}}
                  >Add to these</button>
                </div>
              </div>
              {{#if this.importError}}<p
                  class="tool-error"
                >{{this.importError}}</p>{{/if}}
              <button
                type="button"
                class="ws-primary ws-do-import"
                disabled={{not this.importText}}
                {{on "click" this.doImport}}
              >Import</button>
            </div>
          </div>
        </div>
      {{/if}}

      {{#if (eq this.dialog "export")}}
        {{! template-lint-disable no-invalid-interactive }}
        <div class="ws-dialog-backdrop" {{on "click" this.backdrop}}>
          {{! template-lint-enable no-invalid-interactive }}
          <div
            class="ws-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Export"
          >
            <div class="ws-dialog-head">
              <h3>Export code</h3>
              <button
                type="button"
                class="ws-menu-btn"
                aria-label="Close"
                {{on "click" this.closeDialog}}
              ><Icon @name="x" @size={{14}} /></button>
            </div>
            <div class="ws-dialog-body">
              <div class="ws-seg" role="group" aria-label="What to export">
                <button
                  type="button"
                  class={{if (eq this.exportScope "all") "active"}}
                  {{on "click" (fn this.setExportScope "all")}}
                >Whole moveset</button>
                <button
                  type="button"
                  class={{if (eq this.exportScope "skill") "active"}}
                  {{on "click" (fn this.setExportScope "skill")}}
                >This skill</button>
              </div>
              <textarea
                class="math-input ws-code ws-export-code"
                rows="7"
                readonly
                spellcheck="false"
                aria-label="Code"
                value={{this.exportCode}}
              ></textarea>
              <p class="ws-hint">Paste it into JJS’s Skill Builder with its
                import button.</p>
              <div class="ws-actions">
                <button
                  type="button"
                  class="ws-primary"
                  disabled={{not this.exportCode}}
                  {{on "click" this.copyExport}}
                >
                  <Icon @name={{if this.copied "check" "copy"}} @size={{14}} />
                  <span>{{if this.copied "Copied" "Copy code"}}</span>
                </button>
                <button
                  type="button"
                  class="btn"
                  disabled={{not this.exportCode}}
                  {{on "click" this.downloadExport}}
                >
                  <Icon @name="download" @size={{13}} />
                  Download .txt
                </button>
              </div>
            </div>
          </div>
        </div>
      {{/if}}

      {{#if (eq this.dialog "open")}}
        {{! template-lint-disable no-invalid-interactive }}
        <div class="ws-dialog-backdrop" {{on "click" this.backdrop}}>
          {{! template-lint-enable no-invalid-interactive }}
          <div
            class="ws-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Your movesets"
          >
            <div class="ws-dialog-head">
              <h3>Your movesets</h3>
              <button
                type="button"
                class="ws-menu-btn"
                aria-label="Close"
                {{on "click" this.closeDialog}}
              ><Icon @name="x" @size={{14}} /></button>
            </div>
            <div class="ws-dialog-body">
              {{#each this.designs key="id" as |d|}}
                <div class="ws-saved {{if d.current 'is-current'}}">
                  <button
                    type="button"
                    class="ws-saved-open"
                    {{on "click" (fn this.openSaved d.id)}}
                  >
                    <strong>{{d.name}}</strong>
                    <span>{{d.skills}} skills · {{d.when}}</span>
                  </button>
                  <button
                    type="button"
                    class="ws-menu-btn"
                    aria-label="Delete {{d.name}}"
                    {{on "click" (fn this.deleteSaved d.id)}}
                  ><Icon @name="trash-2" @size={{13}} /></button>
                </div>
              {{else}}
                <p class="ws-hint">Nothing saved in this browser yet: Save (or
                  Ctrl+S) keeps the moveset here.</p>
              {{/each}}
            </div>
          </div>
        </div>
      {{/if}}
    </div>
  </template>
}

const tabList = () => [
  { id: 'timeline', label: 'Timeline' },
  { id: 'conditions', label: 'Conditions' },
  { id: 'properties', label: 'Properties' },
];

const hitModes = () => [
  {
    id: 'auto',
    label: 'Hits if in range',
    title: 'Hitboxes and projectiles hit the dummy when it’s inside them',
  },
  { id: 'always', label: 'Always hit', title: 'Every hitbox hits' },
  { id: 'never', label: 'Whiff', title: 'Nothing hits' },
];

const inc = (n) => n + 1;
const nodeLabel = (node) => nodeTitle(node).label;
