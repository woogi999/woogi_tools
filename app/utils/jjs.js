// Turns the JJS reference notes (lazy/jjs-data.js) into tabs of titled groups.
// The notes are hand-written text, so this reads them the way a person would:
//   **Name:**            a heading ("Gojo:", "Lapse Blue:")
//   HONORED ONE / Vessel: headings in the tabs written without bold
//   **- Finisher:**      a sub-heading inside the current group
//   123456789 Label      a sound ID with what it's for, maybe a speed "(1.2x)"
//   Lapse blue 0.483~    a move and its startup time
//   ---                  the end of a character
// A heading followed straight away by another heading is a category (a
// character, "Items"); the groups under it are listed with it as their parent.

export const TABS = [
  {
    id: 'sounds',
    label: 'Sounds',
    source: 'ALL JJS Sounds',
    hint: 'Every sound ID, by item, M1 set and character. Speeds like 1.2x are the playback speed to set.',
  },
  {
    id: 'emotes',
    label: 'Emote music',
    source: 'Emotes',
    hint: 'Music and sound IDs used by emotes.',
  },
  {
    id: 'punches',
    label: 'Punches',
    source: 'Punches + Direction',
    hint: 'Which arm each move punches with, and which way.',
  },
  {
    id: 'kicks',
    label: 'Kicks',
    source: 'Kicks + Direction',
    hint: 'Which leg each move kicks with, and which way.',
  },
  {
    id: 'flips',
    label: 'Flips',
    source: 'Flips + Direction',
    hint: 'Animations with a flip in them, and which way they flip.',
  },
  {
    id: 'movement',
    label: 'Run & walk',
    source: 'Run/Walk Anim',
    hint: 'Move and emote animations that work as runs, walks and slides.',
  },
  {
    id: 'startups',
    label: 'Startups',
    source: 'Moves Startup',
    hint: 'Seconds from pressing a move to it coming out, for timing your own.',
  },
  {
    id: 'presets',
    label: 'Presets',
    hint: 'Skill Builder presets. Copy one and import it in the game.',
  },
  {
    id: 'templates',
    label: 'Templates',
    hint: 'Ready-made skills for a character: fill in the form, copy the code, and import it in the Skill Builder.',
  },
];

const SOUND = /^(\d{6,})\s*(?:\((\d+(?:\.\d+)?x)\))?\s*-?\s*(.*)$/;
// "Hit1 - 135367226283909": the label written first.
const SOUND_AFTER = /^(\D.*?)\s*-?\s+(\d{6,})$/;
const STARTUP = /^(.*?):?\s+(\d+\.\d+)~\s*(.*)$/;
const SPEED = /\s*\((\d+(?:\.\d+)?x)\)/i;
const BOLD_HEADING = /^\*\*(.+?)\*\*\s*(.*)$/;
const PLAIN_CATEGORIES =
  /^(melee (punches|kicks)|running animations|walking animations)$/i;
// Legend and credit lines at the top of a tab, before the moves start.
const NOTE_LINE = /=|credit|\bby\b|^\(\?\)|key:/i;

const stripBold = (text) => text.replace(/\*\*/g, '');
const isCaps = (text) => /[A-Z]/.test(text) && !/[a-z]/.test(text);
// "HONORED ONE" -> "Honored One", but acronyms like TNT and RB1 stay as written.
const titleCase = (text) =>
  text.replace(/\p{L}[\p{L}\d']*/gu, (word) =>
    /\d/.test(word) || /^(TNT|JSD|VFX|AI)$/.test(word)
      ? word
      : word[0] + word.slice(1).toLowerCase(),
  );

// Reads one line as a heading, or null. `dash` marks "- Finisher" style sub-headings.
function heading(line) {
  const bold = BOLD_HEADING.exec(line);
  if (bold && !/^\d/.test(bold[2])) {
    const raw = bold[1].trim();
    const dash = /^[—–-]/.test(raw);
    const title = raw
      .replace(/^[—–-]+\s*/, '')
      .replace(/:$/, '')
      .trim();
    return title ? { title, note: stripBold(bold[2]).trim(), dash } : null;
  }
  if (/\d/.test(line) || line.length > 40) return null;
  if (PLAIN_CATEGORIES.test(line))
    return { title: line, note: '', dash: false };
  if (isCaps(line) && line.length > 2)
    return { title: line.replace(/:$/, ''), note: '', dash: false };
  if (/^[^:]{2,30}:$/.test(line) && line.split(/\s+/).length <= 4)
    return { title: line.slice(0, -1), note: '', dash: false };
  return null;
}

function row(line) {
  // "-Beam", "-2:": a sub-heading written without bold.
  if (/^-[^-\d]|^-\d+:?$/.test(line) && line.length < 30)
    return {
      kind: 'sub',
      text: line.replace(/^-\s*/, '').replace(/:$/, ''),
      note: '',
    };
  const after = SOUND_AFTER.exec(line);
  if (after)
    return {
      kind: 'sound',
      id: after[2],
      label: stripBold(after[1]).trim(),
      speed: null,
    };
  const sound = SOUND.exec(line);
  if (sound) {
    let label = stripBold(sound[3]).trim();
    let speed = sound[2] ?? null;
    const inLabel = SPEED.exec(label);
    if (!speed && inLabel) {
      speed = inLabel[1];
      label = label.replace(SPEED, '').trim();
    }
    return { kind: 'sound', id: sound[1], label, speed };
  }
  const startup = STARTUP.exec(line);
  if (startup)
    return {
      kind: 'startup',
      name: stripBold(startup[1]).trim(),
      time: startup[2],
      note: stripBold(startup[3]).trim(),
    };
  return { kind: 'text', text: stripBold(line) };
}

export function parseNotes(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const intro = [];
  const groups = [];
  let top = null;
  let category = null;
  let current = null;

  const openGroup = (title, note) => {
    const parent = [top, category].filter((p) => p && p !== title).join(' › ');
    const group = { key: `g${groups.length}`, title, note, parent, rows: [] };
    groups.push(group);
    return group;
  };

  const nextLine = (i) => {
    for (let j = i + 1; j < lines.length; j++) if (lines[j]) return lines[j];
    return null;
  };

  lines.forEach((line, i) => {
    if (!line) return;
    if (/^-{3,}$/.test(line)) {
      category = null;
      current = null;
      return;
    }
    const h = heading(line);
    if (!h) {
      // Notes stay at the top only until the first move.
      if (!current && !groups.length && NOTE_LINE.test(line)) {
        intro.push(stripBold(line));
        return;
      }
      if (!current) current = openGroup('Moves', '');
      current.rows.push(row(line));
      return;
    }
    const next = nextLine(i);
    const nextHeading = next ? heading(next) : null;
    if (PLAIN_CATEGORIES.test(h.title)) {
      // "Melee Kicks": a category that may also have rows of its own.
      category = h.title;
      current = nextHeading ? null : openGroup(h.title, '');
      return;
    }
    if (nextHeading && !nextHeading.dash) {
      // A category: remembered as the parent of the groups that follow.
      if (isCaps(h.title) || h.dash) {
        top = titleCase(h.title);
        category = null;
      } else {
        category = h.title;
      }
      current = null;
      return;
    }
    if (h.dash && current) {
      current.rows.push({ kind: 'sub', text: h.title, note: h.note });
      return;
    }
    current = openGroup(isCaps(h.title) ? titleCase(h.title) : h.title, h.note);
  });
  return { intro, groups: groups.filter((g) => g.rows.length) };
}

const rowText = (r) =>
  [r.id, r.label, r.speed, r.name, r.time, r.note, r.text]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

// Every word has to appear somewhere. A group whose title matches keeps all
// its rows; otherwise only the matching rows stay.
export function filterGroups(groups, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  const out = [];
  for (const group of groups) {
    const head = `${group.parent} ${group.title} ${group.note}`.toLowerCase();
    if (words.every((w) => head.includes(w))) {
      out.push(group);
      continue;
    }
    const rows = group.rows.filter((r) => {
      const text = `${head} ${rowText(r)}`;
      return words.every((w) => text.includes(w));
    });
    if (rows.length) out.push({ ...group, rows });
  }
  return out;
}
