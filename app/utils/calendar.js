// The calendar's events, kept in the browser. An event:
//   { id, title, date: 'YYYY-MM-DD', start: 'HH:MM' | '', end: 'HH:MM' | '',
//     colour, notes, noteId, repeat: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' }
// Repeats are worked out when a month is drawn, so one saved event can fill
// many days without being copied.

const KEY = 'woogi-calendar';

export const COLOURS = [
  '#4f8cff',
  '#3ddc84',
  '#f5a524',
  '#ff5c72',
  '#b06cff',
  '#20c4c4',
];
export const REPEATS = [
  { id: 'none', label: 'Does not repeat' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekly', label: 'Every week' },
  { id: 'monthly', label: 'Every month' },
  { id: 'yearly', label: 'Every year' },
];

export function loadEvents() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((e) => e && e.id && e.date) : [];
  } catch {
    return [];
  }
}

export function saveEvents(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage blocked or full
  }
}

export const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const pad = (n) => String(n).padStart(2, '0');
export const key = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// Does this event land on this day, counting its repeats?
export function occursOn(event, dayKey) {
  if (event.date === dayKey) return true;
  if (!event.repeat || event.repeat === 'none') return false;
  if (dayKey < event.date) return false;
  const from = parseKey(event.date);
  const day = parseKey(dayKey);
  switch (event.repeat) {
    case 'daily':
      return true;
    case 'weekly':
      return from.getDay() === day.getDay();
    case 'monthly':
      return from.getDate() === day.getDate();
    case 'yearly':
      return (
        from.getDate() === day.getDate() && from.getMonth() === day.getMonth()
      );
    default:
      return false;
  }
}

export const sortByTime = (a, b) =>
  (a.start || '00:00').localeCompare(b.start || '00:00') ||
  a.title.localeCompare(b.title);

// The grid for a month: six rows of seven, Monday first, with days from
// the months either side filling the corners.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + i,
    );
    cells.push({ date, key: key(date), inMonth: date.getMonth() === month });
  }
  return cells;
}

// An .ics file, so the events can go into any other calendar.
export function toIcs(events) {
  const stamp = (date, time) => {
    const d = date.replace(/-/g, '');
    return time ? `${d}T${time.replace(':', '')}00` : d;
  };
  const rrule = {
    daily: 'DAILY',
    weekly: 'WEEKLY',
    monthly: 'MONTHLY',
    yearly: 'YEARLY',
  };
  const escape = (s) =>
    String(s ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/[,;]/g, (m) => `\\${m}`);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Woogi Tools//Calendar//EN',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@woogi.xyz`,
      `SUMMARY:${escape(e.title)}`,
    );
    if (e.start) {
      lines.push(`DTSTART:${stamp(e.date, e.start)}`);
      lines.push(`DTEND:${stamp(e.date, e.end || e.start)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${stamp(e.date)}`);
    }
    if (rrule[e.repeat]) lines.push(`RRULE:FREQ=${rrule[e.repeat]}`);
    if (e.notes) lines.push(`DESCRIPTION:${escape(e.notes)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
