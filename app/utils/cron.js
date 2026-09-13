const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
];

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describeField(raw, field, names) {
  if (raw === '*') return null;
  const parts = raw.split(',').map((part) => {
    const [range, step] = part.split('/');
    const label = (n) => (names ? names[field.name === 'day of week' ? Number(n) % 7 : Number(n)] : n);
    if (range === '*') return step ? `every ${step} ${field.name}${step === '1' ? '' : 's'}` : `every ${field.name}`;
    if (range.includes('-')) {
      const [a, b] = range.split('-');
      return step ? `every ${step} ${field.name}s from ${label(a)} to ${label(b)}` : `${label(a)} through ${label(b)}`;
    }
    return label(range);
  });
  return parts.join(', ');
}

export function describeCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A cron expression needs exactly 5 fields: minute hour day-of-month month day-of-week.');
  for (const [field, raw] of parts.map((r, i) => [FIELDS[i], r])) {
    for (const token of raw.split(',')) {
      const [range, step] = token.split('/');
      if (step !== undefined && !/^\d+$/.test(step)) throw new Error(`Invalid step in "${raw}" for ${field.name}.`);
      if (range === '*') continue;
      const bounds = range.includes('-') ? range.split('-') : [range];
      for (const b of bounds) {
        if (!/^\d+$/.test(b)) throw new Error(`"${b}" isn't a valid ${field.name} (expected ${field.min}-${field.max}).`);
        const n = Number(b);
        if (n < field.min || n > field.max) throw new Error(`${field.name} must be between ${field.min} and ${field.max}, got ${n}.`);
      }
    }
  }

  const [minute, hour, dom, month, dow] = parts;
  const bits = [];
  const hourDesc = describeField(hour, FIELDS[1]);
  const minuteDesc = describeField(minute, FIELDS[0]);
  const isPlainTime = /^\d+$/.test(minute) && /^\d+$/.test(hour);
  let time;
  if (!hourDesc && !minuteDesc) time = 'every minute';
  else if (!hourDesc && minuteDesc.startsWith('every')) time = `${minuteDesc}, every hour`;
  else if (!hourDesc) time = `at minute ${minuteDesc} of every hour`;
  else if (!minuteDesc) time = `every minute during ${hourDesc}`;
  else if (isPlainTime) time = `at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  else time = `at minute ${minuteDesc} past ${hourDesc}`;
  bits.push(time);
  const domDesc = describeField(dom, FIELDS[2]);
  if (domDesc) bits.push(`on day-of-month ${domDesc}`);
  const monthDesc = describeField(month, FIELDS[3], MONTH_NAMES);
  if (monthDesc) bits.push(`in ${monthDesc}`);
  const dowDesc = describeField(dow, FIELDS[4], DAY_NAMES);
  if (dowDesc) bits.push(`on ${dowDesc}`);

  return { text: capitalize(bits.join(', ')), parts: { minute, hour, dom, month, dow } };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const CRON_PRESETS = [
  { label: 'Every minute', expr: '* * * * *' },
  { label: 'Every hour', expr: '0 * * * *' },
  { label: 'Every day at midnight', expr: '0 0 * * *' },
  { label: 'Every day at 9am', expr: '0 9 * * *' },
  { label: 'Every Monday at 9am', expr: '0 9 * * 1' },
  { label: 'Every 1st of the month', expr: '0 0 1 * *' },
  { label: 'Every 15 minutes', expr: '*/15 * * * *' },
  { label: 'Weekdays at 6pm', expr: '0 18 * * 1-5' },
];
