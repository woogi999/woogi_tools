// Time zones, straight out of the browser. Every modern engine ships the IANA
// database and Intl knows how to use it, so there is no list to keep up to
// date here and no library to pull in: the names come from the platform and
// the arithmetic is done by asking Intl what the clock says somewhere.

// Intl.supportedValuesOf is the proper way to ask; the fallback list is for
// the handful of older engines that don't have it, and covers the places
// people actually convert between.
const FALLBACK = [
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Anchorage',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Chicago',
  'America/Denver',
  'America/Halifax',
  'America/Lima',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Phoenix',
  'America/Sao_Paulo',
  'America/Toronto',
  'America/Vancouver',
  'Asia/Bangkok',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Jerusalem',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Manila',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Brisbane',
  'Australia/Melbourne',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Berlin',
  'Europe/Dublin',
  'Europe/Istanbul',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Zurich',
  'Pacific/Auckland',
  'Pacific/Honolulu',
  'UTC',
];

export function allZones() {
  try {
    const zones = Intl.supportedValuesOf?.('timeZone');
    if (zones?.length) return zones;
  } catch {
    // older engine: the shortlist below is better than nothing
  }
  return FALLBACK;
}

export function localZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// "Europe/Zurich" → "Zurich, Europe". The city is what people search for, so
// it goes first; the region stays because there is more than one Georgetown.
export function zoneLabel(zone) {
  const parts = zone.split('/');
  const city = parts.at(-1).replaceAll('_', ' ');
  return parts.length === 1
    ? city
    : `${city}, ${parts[0].replaceAll('_', ' ')}`;
}

// The parts of the wall clock in `zone` at `instant`, as numbers. Formatting
// to en-CA gives ISO-ish output, which parses back without guesswork.
function partsIn(zone, instant) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out = {};
  for (const { type, value } of fmt.formatToParts(instant))
    if (type !== 'literal') out[type] = Number(value);
  // Midnight comes back as hour 24 in some engines' hour12:false output.
  if (out.hour === 24) out.hour = 0;
  return out;
}

// How far `zone` is from UTC at `instant`, in minutes. Worked out by asking
// what the wall clock reads there and comparing it with the same instant read
// as UTC: this is DST-correct for free, because Intl already applied it.
export function offsetMinutes(zone, instant = new Date()) {
  const p = partsIn(zone, instant);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  // Seconds are whole on both sides, so rounding to the minute is exact.
  return Math.round(
    (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000,
  );
}

/**
 * The instant at which the clock in `zone` reads the given wall-clock time.
 *
 * Going this way needs care: the offset depends on the instant, and the
 * instant is what we're solving for. Guessing with the offset at the naive
 * time and then correcting once converges everywhere, because a zone's offset
 * never changes twice within the error of the first guess.
 */
export function instantFor(zone, { year, month, day, hour, minute }) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = new Date(naive - offsetMinutes(zone, new Date(naive)) * 60000);
  guess = new Date(naive - offsetMinutes(zone, guess) * 60000);
  return guess;
}

// "+05:30", or "UTC" for zero. The sign is always shown: a bare "5:30" reads
// as a duration rather than a position.
export function offsetLabel(minutes) {
  if (!minutes) return 'UTC';
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// The short name the place itself uses: GMT, PDT, AEST, and so on. Some zones
// only ever report a numeric one (GMT+7), which is the honest answer there.
export function abbreviation(zone, instant = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'short',
    }).formatToParts(instant);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

export function formatIn(zone, instant, options) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    ...options,
  }).format(instant);
}

// Whether a zone is on a different calendar day from the reference one, so the
// UI can say "tomorrow" instead of leaving you to work it out.
export function dayShift(zone, referenceZone, instant) {
  const a = partsIn(zone, instant);
  const b = partsIn(referenceZone, instant);
  const days =
    Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
  const shift = Math.round(days / 86400000);
  if (shift === 0) return '';
  if (shift === 1) return 'next day';
  if (shift === -1) return 'previous day';
  return `${shift > 0 ? '+' : ''}${shift} days`;
}

// Roughly how awake someone there is likely to be, for the meeting planner.
export function hourClass(hour) {
  if (hour >= 9 && hour < 18) return 'good'; // office hours
  if (hour >= 7 && hour < 22) return 'ok'; // awake, but it's their evening
  return 'bad'; // asleep
}
