// A birth chart from a date, time and place, with the planets' positions
// worked out from Paul Schlyter's simplified orbital elements (good to a
// degree or so, which is plenty for which sign something sits in), the
// Ascendant and Midheaven from local sidereal time, and equal houses from
// the Ascendant. Tropical zodiac throughout.

const rad = Math.PI / 180;
const deg = 180 / Math.PI;
const norm = (a) => ((a % 360) + 360) % 360;
const sin = (a) => Math.sin(a * rad);
const cos = (a) => Math.cos(a * rad);
const atan2 = (y, x) => norm(Math.atan2(y, x) * deg);

export const SIGNS = [
  {
    name: 'Aries',
    icon: 'flame',
    element: 'Fire',
    modality: 'Cardinal',
    ruler: 'Mars',
    colour: 'Red',
    from: 'Mar 21',
    to: 'Apr 19',
    lucky: 9,
    day: 'Tuesday',
    traits:
      'Bold, direct and quick to start things; impatient with anything that dawdles.',
    famous: ['Lady Gaga', 'Robert Downey Jr.', 'Emma Watson'],
    matches: ['Leo', 'Sagittarius', 'Gemini'],
  },
  {
    name: 'Taurus',
    icon: 'leaf',
    element: 'Earth',
    modality: 'Fixed',
    ruler: 'Venus',
    colour: 'Green',
    from: 'Apr 20',
    to: 'May 20',
    lucky: 6,
    day: 'Friday',
    traits:
      'Steady, loyal and fond of comfort; slow to change course once set on one.',
    famous: ['Adele', 'Dwayne Johnson', 'Audrey Hepburn'],
    matches: ['Virgo', 'Capricorn', 'Cancer'],
  },
  {
    name: 'Gemini',
    icon: 'users',
    element: 'Air',
    modality: 'Mutable',
    ruler: 'Mercury',
    colour: 'Yellow',
    from: 'May 21',
    to: 'Jun 20',
    lucky: 5,
    day: 'Wednesday',
    traits:
      'Curious, talkative and quick-witted; bored by routine and prone to two minds.',
    famous: ['Marilyn Monroe', 'Kanye West', 'Angelina Jolie'],
    matches: ['Libra', 'Aquarius', 'Aries'],
  },
  {
    name: 'Cancer',
    icon: 'moon',
    element: 'Water',
    modality: 'Cardinal',
    ruler: 'Moon',
    colour: 'Silver',
    from: 'Jun 21',
    to: 'Jul 22',
    lucky: 2,
    day: 'Monday',
    traits:
      'Caring, protective and deeply tied to home; moody when the tide turns.',
    famous: ['Tom Hanks', 'Selena Gomez', 'Frida Kahlo'],
    matches: ['Scorpio', 'Pisces', 'Taurus'],
  },
  {
    name: 'Leo',
    icon: 'sun',
    element: 'Fire',
    modality: 'Fixed',
    ruler: 'Sun',
    colour: 'Gold',
    from: 'Jul 23',
    to: 'Aug 22',
    lucky: 1,
    day: 'Sunday',
    traits:
      'Warm, generous and made for the stage; wounded by not being noticed.',
    famous: ['Barack Obama', 'Jennifer Lopez', 'Daniel Radcliffe'],
    matches: ['Aries', 'Sagittarius', 'Libra'],
  },
  {
    name: 'Virgo',
    icon: 'scan-face',
    element: 'Earth',
    modality: 'Mutable',
    ruler: 'Mercury',
    colour: 'Navy blue',
    from: 'Aug 23',
    to: 'Sep 22',
    lucky: 5,
    day: 'Wednesday',
    traits:
      'Practical, precise and helpful; hard on themselves and on loose ends.',
    famous: ['Beyoncé', 'Keanu Reeves', 'Zendaya'],
    matches: ['Taurus', 'Capricorn', 'Cancer'],
  },
  {
    name: 'Libra',
    icon: 'scale',
    element: 'Air',
    modality: 'Cardinal',
    ruler: 'Venus',
    colour: 'Pink',
    from: 'Sep 23',
    to: 'Oct 22',
    lucky: 6,
    day: 'Friday',
    traits:
      'Charming, fair-minded and drawn to beauty; takes an age to decide.',
    famous: ['Will Smith', 'Kim Kardashian', 'Serena Williams'],
    matches: ['Gemini', 'Aquarius', 'Leo'],
  },
  {
    name: 'Scorpio',
    icon: 'bug',
    element: 'Water',
    modality: 'Fixed',
    ruler: 'Pluto (Mars)',
    colour: 'Black',
    from: 'Oct 23',
    to: 'Nov 21',
    lucky: 8,
    day: 'Tuesday',
    traits: 'Intense, private and all in; never forgets, rarely forgives.',
    famous: ['Leonardo DiCaprio', 'Drake', 'Ryan Gosling'],
    matches: ['Cancer', 'Pisces', 'Virgo'],
  },
  {
    name: 'Sagittarius',
    icon: 'bow-arrow',
    element: 'Fire',
    modality: 'Mutable',
    ruler: 'Jupiter',
    colour: 'Purple',
    from: 'Nov 22',
    to: 'Dec 21',
    lucky: 3,
    day: 'Thursday',
    traits: 'Restless, frank and hopeful; allergic to being fenced in.',
    famous: ['Taylor Swift', 'Brad Pitt', 'Miley Cyrus'],
    matches: ['Aries', 'Leo', 'Aquarius'],
  },
  {
    name: 'Capricorn',
    icon: 'mountain',
    element: 'Earth',
    modality: 'Cardinal',
    ruler: 'Saturn',
    colour: 'Brown',
    from: 'Dec 22',
    to: 'Jan 19',
    lucky: 8,
    day: 'Saturday',
    traits: 'Ambitious, disciplined and dry-humoured; works now, plays later.',
    famous: ['Michelle Obama', 'Timothée Chalamet', 'Dolly Parton'],
    matches: ['Taurus', 'Virgo', 'Scorpio'],
  },
  {
    name: 'Aquarius',
    icon: 'droplets',
    element: 'Air',
    modality: 'Fixed',
    ruler: 'Uranus (Saturn)',
    colour: 'Electric blue',
    from: 'Jan 20',
    to: 'Feb 18',
    lucky: 4,
    day: 'Saturday',
    traits:
      'Original, principled and a little aloof; friends with everyone, close to few.',
    famous: ['Oprah Winfrey', 'Harry Styles', 'Shakira'],
    matches: ['Gemini', 'Libra', 'Sagittarius'],
  },
  {
    name: 'Pisces',
    icon: 'fish',
    element: 'Water',
    modality: 'Mutable',
    ruler: 'Neptune (Jupiter)',
    colour: 'Sea green',
    from: 'Feb 19',
    to: 'Mar 20',
    lucky: 7,
    day: 'Thursday',
    traits:
      'Dreamy, kind and porous to every mood in the room; needs an escape hatch.',
    famous: ['Rihanna', 'Albert Einstein', 'Justin Bieber'],
    matches: ['Cancer', 'Scorpio', 'Capricorn'],
  },
];

// The sun sign's edges, by month and day (the Sun's real position decides the
// chart; this is the everyday calendar version).
const SIGN_STARTS = [
  [1, 20, 10],
  [2, 19, 11],
  [3, 21, 0],
  [4, 20, 1],
  [5, 21, 2],
  [6, 21, 3],
  [7, 23, 4],
  [8, 23, 5],
  [9, 23, 6],
  [10, 23, 7],
  [11, 22, 8],
  [12, 22, 9],
];

export function sunSignByDate(month, day) {
  let index = 9; // Capricorn before Jan 20
  for (const [m, d, i] of SIGN_STARTS)
    if (month > m || (month === m && day >= d)) index = i;
  return SIGNS[index];
}

export const BIRTHSTONES = [
  'Garnet',
  'Amethyst',
  'Aquamarine',
  'Diamond',
  'Emerald',
  'Pearl',
  'Ruby',
  'Peridot',
  'Sapphire',
  'Opal',
  'Topaz',
  'Turquoise',
];
export const BIRTH_FLOWERS = [
  'Carnation',
  'Violet',
  'Daffodil',
  'Daisy',
  'Lily of the valley',
  'Rose',
  'Larkspur',
  'Gladiolus',
  'Aster',
  'Marigold',
  'Chrysanthemum',
  'Narcissus',
];

const CHINESE = [
  'Rat',
  'Ox',
  'Tiger',
  'Rabbit',
  'Dragon',
  'Snake',
  'Horse',
  'Goat',
  'Monkey',
  'Rooster',
  'Dog',
  'Pig',
];
const CHINESE_ELEMENTS = ['Wood', 'Fire', 'Earth', 'Metal', 'Water'];
export function chineseZodiac(year) {
  const animal = CHINESE[(((year - 4) % 12) + 12) % 12];
  const element =
    CHINESE_ELEMENTS[Math.floor(((((year - 4) % 10) + 10) % 10) / 2)];
  return `${element} ${animal}`;
}

export const HOUSE_THEMES = [
  'Self, body and first impressions',
  'Money, possessions and what you value',
  'Siblings, short trips, talk and learning',
  'Home, family and roots',
  'Romance, play, children and creativity',
  'Work, habits and health',
  'Partnerships and marriage',
  'Shared resources, intimacy and loss',
  'Travel, study and belief',
  'Career, reputation and public life',
  'Friends, groups and hopes',
  'Solitude, secrets and the subconscious',
];

const PLANET_MEANINGS = {
  Sun: 'core self and vitality',
  Moon: 'feelings and instincts',
  Mercury: 'mind and speech',
  Venus: 'love and taste',
  Mars: 'drive and temper',
  Jupiter: 'luck and growth',
  Saturn: 'discipline and limits',
  Uranus: 'change and rebellion',
  Neptune: 'dreams and illusions',
  Pluto: 'power and transformation',
};

export const signAt = (longitude) => SIGNS[Math.floor(norm(longitude) / 30)];
export const degreeIn = (longitude) => norm(longitude) % 30;

// ─── The sky at a moment ─────────────────────────────────────────────────

// Days since 2000 Jan 0.0 (Schlyter's epoch), from a UTC Date.
const daysSince2000 = (date) => date.getTime() / 86400000 - 10956;

function kepler(M, e) {
  let E = M + e * deg * sin(M) * (1 + e * cos(M));
  for (let i = 0; i < 10; i++) {
    const dE = (E - e * deg * sin(E) - M) / (1 - e * cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-6) break;
  }
  return E;
}

function sunPosition(d) {
  const w = 282.9404 + 4.70935e-5 * d;
  const e = 0.016709 - 1.151e-9 * d;
  const M = norm(356.047 + 0.9856002585 * d);
  const E = kepler(M, e);
  const xv = cos(E) - e;
  const yv = Math.sqrt(1 - e * e) * sin(E);
  const v = atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const lon = norm(v + w);
  return { lon, r, x: r * cos(lon), y: r * sin(lon), M, w };
}

const ELEMENTS = {
  Mercury: (d) => ({
    N: 48.3313 + 3.24587e-5 * d,
    i: 7.0047 + 5e-8 * d,
    w: 29.1241 + 1.01444e-5 * d,
    a: 0.387098,
    e: 0.205635 + 5.59e-10 * d,
    M: 168.6562 + 4.0923344368 * d,
  }),
  Venus: (d) => ({
    N: 76.6799 + 2.4659e-5 * d,
    i: 3.3946 + 2.75e-8 * d,
    w: 54.891 + 1.38374e-5 * d,
    a: 0.72333,
    e: 0.006773 - 1.302e-9 * d,
    M: 48.0052 + 1.6021302244 * d,
  }),
  Mars: (d) => ({
    N: 49.5574 + 2.11081e-5 * d,
    i: 1.8497 - 1.78e-8 * d,
    w: 286.5016 + 2.92961e-5 * d,
    a: 1.523688,
    e: 0.093405 + 2.516e-9 * d,
    M: 18.6021 + 0.5240207766 * d,
  }),
  Jupiter: (d) => ({
    N: 100.4542 + 2.76854e-5 * d,
    i: 1.303 - 1.557e-7 * d,
    w: 273.8777 + 1.64505e-5 * d,
    a: 5.20256,
    e: 0.048498 + 4.469e-9 * d,
    M: 19.895 + 0.0830853001 * d,
  }),
  Saturn: (d) => ({
    N: 113.6634 + 2.3898e-5 * d,
    i: 2.4886 - 1.081e-7 * d,
    w: 339.3939 + 2.97661e-5 * d,
    a: 9.55475,
    e: 0.055546 - 9.499e-9 * d,
    M: 316.967 + 0.0334442282 * d,
  }),
  Uranus: (d) => ({
    N: 74.0005 + 1.3978e-5 * d,
    i: 0.7733 + 1.9e-8 * d,
    w: 96.6612 + 3.0565e-5 * d,
    a: 19.18171 - 1.55e-8 * d,
    e: 0.047318 + 7.45e-9 * d,
    M: 142.5905 + 0.011725806 * d,
  }),
  Neptune: (d) => ({
    N: 131.7806 + 3.0173e-5 * d,
    i: 1.77 - 2.55e-7 * d,
    w: 272.8461 - 6.027e-6 * d,
    a: 30.05826 + 3.313e-8 * d,
    e: 0.008606 + 2.15e-9 * d,
    M: 260.2471 + 0.005995147 * d,
  }),
};

// Heliocentric ecliptic position from orbital elements.
function heliocentric({ N, i, w, a, e, M }) {
  M = norm(M);
  const E = kepler(M, e);
  const xv = a * (cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sin(E);
  const v = atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const vw = v + w;
  return {
    x: r * (cos(N) * cos(vw) - sin(N) * sin(vw) * cos(i)),
    y: r * (sin(N) * cos(vw) + cos(N) * sin(vw) * cos(i)),
    z: r * sin(vw) * sin(i),
  };
}

function plutoHeliocentric(d) {
  const S = 50.03 + 0.033459652 * d;
  const P = 238.95 + 0.003968789 * d;
  const lon =
    238.9508 +
    0.00400703 * d -
    19.799 * sin(P) +
    19.848 * cos(P) +
    0.897 * sin(2 * P) -
    4.956 * cos(2 * P) +
    0.61 * sin(3 * P) +
    1.211 * cos(3 * P) -
    0.341 * sin(4 * P) -
    0.19 * cos(4 * P) +
    0.128 * sin(5 * P) -
    0.034 * cos(5 * P) -
    0.038 * sin(6 * P) +
    0.031 * cos(6 * P) +
    0.02 * sin(S - P) -
    0.01 * cos(S - P);
  const lat =
    -3.9082 -
    5.453 * sin(P) -
    14.975 * cos(P) +
    3.527 * sin(2 * P) +
    1.673 * cos(2 * P) -
    1.051 * sin(3 * P) +
    0.328 * cos(3 * P) +
    0.179 * sin(4 * P) -
    0.292 * cos(4 * P) +
    0.019 * sin(5 * P) +
    0.1 * cos(5 * P) -
    0.031 * sin(6 * P) -
    0.026 * cos(6 * P) +
    0.011 * cos(S - P);
  const r =
    40.72 +
    6.68 * sin(P) +
    6.9 * cos(P) -
    1.18 * sin(2 * P) -
    0.03 * cos(2 * P) +
    0.15 * sin(3 * P) -
    0.14 * cos(3 * P);
  return {
    x: r * cos(lon) * cos(lat),
    y: r * sin(lon) * cos(lat),
    z: r * sin(lat),
  };
}

function moonLongitude(d, sun) {
  const N = 125.1228 - 0.0529538083 * d;
  const i = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const a = 60.2666;
  const e = 0.0549;
  const M = norm(115.3654 + 13.0649929509 * d);
  const E = kepler(M, e);
  const xv = a * (cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sin(E);
  const v = atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const vw = v + w;
  const xh = r * (cos(N) * cos(vw) - sin(N) * sin(vw) * cos(i));
  const yh = r * (sin(N) * cos(vw) + cos(N) * sin(vw) * cos(i));
  let lon = atan2(yh, xh);
  // The Sun tugs the Moon about; these are the terms that matter for its sign.
  const Ms = sun.M;
  const Mm = M;
  const Ls = norm(Ms + sun.w);
  const Lm = norm(Mm + w + N);
  const D = Lm - Ls;
  const F = Lm - N;
  lon +=
    -1.274 * sin(Mm - 2 * D) +
    0.658 * sin(2 * D) -
    0.186 * sin(Ms) -
    0.059 * sin(2 * Mm - 2 * D) -
    0.057 * sin(Mm - 2 * D + Ms) +
    0.053 * sin(Mm + 2 * D) +
    0.046 * sin(2 * D - Ms) +
    0.041 * sin(Mm - Ms) -
    0.035 * sin(D) -
    0.031 * sin(Mm + Ms) -
    0.015 * sin(2 * F - 2 * D) +
    0.011 * sin(Mm - 4 * D);
  return norm(lon);
}

// Every planet's geocentric ecliptic longitude at a UTC moment.
export function planetLongitudes(date) {
  const d = daysSince2000(date);
  const sun = sunPosition(d);
  const out = { Sun: sun.lon, Moon: moonLongitude(d, sun) };
  for (const [name, elements] of Object.entries(ELEMENTS)) {
    const h = heliocentric(elements(d));
    out[name] = atan2(h.y + sun.y, h.x + sun.x);
  }
  const p = plutoHeliocentric(d);
  out.Pluto = atan2(p.y + sun.y, p.x + sun.x);
  return out;
}

// Greenwich sidereal time in degrees, from a UTC Date.
function gmst(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  return norm(
    280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T,
  );
}

// The Ascendant and Midheaven: where the ecliptic meets the eastern horizon
// and the meridian, for a place and a moment.
export function angles(date, latitude, longitude) {
  const d = daysSince2000(date);
  const obliquity = 23.4393 - 3.563e-7 * d;
  const ramc = norm(gmst(date) + longitude);
  const mc = atan2(sin(ramc), cos(ramc) * cos(obliquity));
  const asc = atan2(
    cos(ramc),
    -(sin(ramc) * cos(obliquity) + Math.tan(latitude * rad) * sin(obliquity)),
  );
  return {
    ascendant: asc,
    midheaven: mc,
    descendant: norm(asc + 180),
    ic: norm(mc + 180),
  };
}

// The whole chart, ready to show.
export function birthChart(date, latitude, longitude) {
  const positions = planetLongitudes(date);
  const { ascendant, midheaven, descendant, ic } = angles(
    date,
    latitude,
    longitude,
  );
  const houseOf = (lon) => (Math.floor(norm(lon - ascendant) / 30) % 12) + 1;
  const place = (name, lon) => ({
    name,
    longitude: lon,
    sign: signAt(lon),
    degree: degreeIn(lon),
    house: houseOf(lon),
    meaning: PLANET_MEANINGS[name] ?? '',
  });
  const planets = Object.entries(positions).map(([name, lon]) =>
    place(name, lon),
  );
  const houses = Array.from({ length: 12 }, (_, i) => {
    const cusp = norm(ascendant + i * 30);
    return {
      number: i + 1,
      cusp,
      sign: signAt(cusp),
      degree: degreeIn(cusp),
      theme: HOUSE_THEMES[i],
      planets: planets.filter((p) => p.house === i + 1).map((p) => p.name),
    };
  });
  return {
    planets,
    houses,
    ascendant: place('Ascendant', ascendant),
    descendant: place('Descendant', descendant),
    midheaven: place('Midheaven', midheaven),
    ic: place('Imum Coeli', ic),
    sun: planets[0],
    moon: planets[1],
  };
}

// A rough time zone from the longitude alone: right to the hour for most of
// the world, and the field is there to correct it where it isn't.
export const guessOffset = (longitude) => Math.round(longitude / 15);

export async function geocode(query, signal) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  // eslint-disable-next-line warp-drive/no-external-request-patterns -- OpenStreetMap's public geocoder
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error('The place lookup did not answer.');
  const [hit] = await response.json();
  if (!hit)
    throw new Error(
      'That place was not found. Try the nearest city and its country.',
    );
  return {
    name: hit.display_name,
    latitude: Number(hit.lat),
    longitude: Number(hit.lon),
  };
}
