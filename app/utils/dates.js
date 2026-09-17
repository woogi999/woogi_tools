export const daysInMonth = (year, month) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const pad = (n) => String(n).padStart(2, '0');

// "YYYY-MM-DD" for <input type="date">, from local calendar fields.
export const toDateInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toDateTimeInput = (d) =>
  `${toDateInput(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Date-only values live at UTC midnight so DST can never shift a day.
export function parseDateInput(value) {
  const m = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

export function parseDateTimeInput(value) {
  const m = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

// Calendar difference, borrowing like long subtraction: days from the month
// before `to`, months from the year. Both dates use the same field getters.
export function calendarDiff(from, to, utc = true) {
  const get = (d) =>
    utc
      ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0]
      : [
          d.getFullYear(),
          d.getMonth(),
          d.getDate(),
          d.getHours() * 60 + d.getMinutes(),
        ];
  const [y1, m1, d1, t1] = get(from);
  const [y2, m2, d2, t2] = get(to);
  let years = y2 - y1;
  let months = m2 - m1;
  let days = d2 - d1;
  let minutes = t2 - t1;
  if (minutes < 0) {
    minutes += 1440;
    days--;
  }
  if (days < 0) {
    months--;
    days += daysInMonth(m2 === 0 ? y2 - 1 : y2, (m2 + 11) % 12);
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  return {
    years,
    months,
    days,
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  };
}

// Whole calendar days between two dates, ignoring time of day and DST.
export function calendarDays(from, to) {
  const utc = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utc(to) - utc(from)) / 86400000);
}

// Mon–Fri days in [from, to), both local dates.
export function weekdaysBetween(from, to) {
  const total = calendarDays(from, to);
  const weeks = Math.floor(total / 7);
  let count = weeks * 5;
  const startDay = from.getDay();
  for (let i = 0; i < total % 7; i++) {
    const day = (startDay + i) % 7;
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export function plural(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

export function joinParts(parts) {
  const shown = parts.filter(([n]) => n);
  if (!shown.length) return '0 days';
  return shown.map(([n, word]) => plural(n, word)).join(', ');
}
