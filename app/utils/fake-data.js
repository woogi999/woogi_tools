// Believable-looking nonsense, for filling a mockup or a test database.
//
// Everything here is made up. The names are common ones recombined at random
// so no row is a real person; the emails all land on example.com, which the
// IANA reserves precisely so nobody's inbox gets test mail; the card numbers
// are the published test numbers that every payment processor rejects; and
// the phone numbers use the ranges set aside for drama and documentation.
// That last part matters: a generator that hands you a working phone number
// eventually has someone's phone ringing at three in the morning.

const FIRST = [
  'Amara',
  'Aiden',
  'Ana',
  'Arjun',
  'Beatriz',
  'Bilal',
  'Cai',
  'Camille',
  'Chidi',
  'Daniela',
  'Dmitri',
  'Elena',
  'Emeka',
  'Esme',
  'Farah',
  'Felix',
  'Gabriel',
  'Grace',
  'Hana',
  'Hugo',
  'Imani',
  'Ines',
  'Ivan',
  'Jae',
  'Jasmine',
  'Joaquin',
  'Kaito',
  'Kofi',
  'Lars',
  'Leila',
  'Linh',
  'Lucia',
  'Magnus',
  'Maya',
  'Mei',
  'Miguel',
  'Nadia',
  'Niall',
  'Nour',
  'Oscar',
  'Priya',
  'Rafael',
  'Rania',
  'Rosa',
  'Sami',
  'Sofia',
  'Tariq',
  'Thandi',
  'Tomas',
  'Yara',
  'Yuki',
  'Zainab',
  'Zeke',
];

const LAST = [
  'Abara',
  'Almeida',
  'Andersen',
  'Bakker',
  'Bennett',
  'Cardoso',
  'Chen',
  'Costa',
  'Dahl',
  'Diallo',
  'Dubois',
  'Eriksen',
  'Fernandez',
  'Fitzgerald',
  'Gruber',
  'Haddad',
  'Hansen',
  'Ibrahim',
  'Iyer',
  'Jansen',
  'Kaur',
  'Kimura',
  'Kowalski',
  'Lindqvist',
  'Lopez',
  'Mbeki',
  'Mensah',
  'Moreau',
  'Nakamura',
  'Nguyen',
  'Novak',
  'Okafor',
  'Oliveira',
  'Petrov',
  'Quinn',
  'Rahman',
  'Reyes',
  'Rossi',
  'Sharma',
  'Silva',
  'Sorensen',
  'Takahashi',
  'Tanaka',
  'Vargas',
  'Wagner',
  'Walsh',
  'Yilmaz',
  'Zhang',
];

const STREETS = [
  'Acacia',
  'Alder',
  'Beech',
  'Birch',
  'Bridge',
  'Cedar',
  'Chapel',
  'Cherry',
  'Church',
  'Elm',
  'Garden',
  'Harbour',
  'Hazel',
  'Hill',
  'Juniper',
  'Kingfisher',
  'Laurel',
  'Linden',
  'Maple',
  'Market',
  'Mill',
  'Oak',
  'Orchard',
  'Poplar',
  'Quarry',
  'River',
  'Rowan',
  'Station',
  'Sycamore',
  'Willow',
];
const STREET_KIND = [
  'Street',
  'Road',
  'Lane',
  'Avenue',
  'Close',
  'Way',
  'Drive',
  'Terrace',
];

const CITIES = [
  ['Springfield', 'Oregon', 'US'],
  ['Riverton', 'Utah', 'US'],
  ['Fairview', 'Texas', 'US'],
  ['Ashford', 'Kent', 'GB'],
  ['Northwood', 'London', 'GB'],
  ['Kirkby', 'Merseyside', 'GB'],
  ['Brookvale', 'New South Wales', 'AU'],
  ['Glenhaven', 'Victoria', 'AU'],
  ['Saint-Clair', 'Occitanie', 'FR'],
  ['Neustadt', 'Bavaria', 'DE'],
  ['Vila Nova', 'Porto', 'PT'],
  ['Alta Vista', 'Ontario', 'CA'],
];

const COMPANY_A = [
  'Bright',
  'North',
  'Blue',
  'Iron',
  'Quiet',
  'Open',
  'Amber',
  'Orchard',
  'Copper',
  'Harbour',
  'Summit',
  'Pine',
  'Loom',
  'Ember',
  'Atlas',
];
const COMPANY_B = [
  'Field',
  'Gate',
  'Works',
  'Harbor',
  'Stone',
  'Line',
  'Cloud',
  'Forge',
  'Path',
  'Craft',
  'Point',
  'Ridge',
  'Labs',
  'Studio',
  'Group',
];
const COMPANY_SUFFIX = [
  'Ltd',
  'Inc',
  'GmbH',
  'Co',
  'Collective',
  'Partners',
  'Studio',
  'Holdings',
];

const JOBS = [
  'Accessibility Specialist',
  'Account Manager',
  'Archivist',
  'Baker',
  'Biologist',
  'Bookbinder',
  'Carpenter',
  'Cartographer',
  'Chef',
  'Data Analyst',
  'Dentist',
  'Electrician',
  'Florist',
  'Game Designer',
  'Illustrator',
  'Interpreter',
  'Landscape Architect',
  'Librarian',
  'Marine Engineer',
  'Midwife',
  'Paramedic',
  'Pharmacist',
  'Photographer',
  'Physiotherapist',
  'Product Manager',
  'Quantity Surveyor',
  'Radiographer',
  'Software Engineer',
  'Sound Engineer',
  'Statistician',
  'Teacher',
  'Technical Writer',
  'Translator',
  'Urban Planner',
  'Veterinarian',
];

const PRODUCTS = [
  'Desk Lamp',
  'Wool Blanket',
  'Cast Iron Pan',
  'Field Notebook',
  'Ceramic Mug',
  'Canvas Tote',
  'Linen Apron',
  'Brass Compass',
  'Leather Wallet',
  'Bamboo Cutlery',
  'Glass Carafe',
  'Cotton Throw',
  'Walnut Board',
  'Enamel Kettle',
  'Marble Coaster',
  'Copper Planter',
  'Felt Slippers',
  'Oak Stool',
  'Steel Bottle',
  'Cork Mat',
];

const DEPARTMENTS = [
  'Kitchen',
  'Outdoors',
  'Stationery',
  'Home',
  'Lighting',
  'Textiles',
  'Tools',
  'Garden',
];

const WORDS =
  'a about above across after again against all almost alone along already also although always among an and another any anybody anyone anything anywhere are area around as ask asked at away back be became because become been before began behind being best better between both but by came can cannot case certain change come could course day days did different do does done down during each early either else end enough even ever every example far few find first for form found four from full further gave general get give given go going good got great group had half hand has have he head held help her here high him himself his hold home house how however i if important in interest into is it its itself just keep kind knew know known large last later least left less let life light like likely line little long look made make man many may me mean might mind more most move much must my near need never new next night no not nothing now number of off often old on once one only open or order other our out over own part people perhaps place plan point possible present problem put rather really right room said same saw say school second see seem seen set several shall she should show side since small so some something sometimes soon state still such take taken than that the their them then there these they thing think this those though thought three through time to today together too took toward turn two under until up upon us use used very want was water way we well went were what when where whether which while who whole why will with within without work world would year years yet you young your'.split(
    ' ',
  );

const DOMAINS = ['example.com', 'example.org', 'example.net'];

// Numbers every payment processor recognises as test data and declines.
const TEST_CARDS = [
  ['Visa', '4242424242424242'],
  ['Visa (debit)', '4000056655665556'],
  ['Mastercard', '5555555555554444'],
  ['Mastercard (2-series)', '2223003122003222'],
  ['American Express', '378282246310005'],
  ['Discover', '6011111111111117'],
  ['JCB', '3566002020360505'],
];

// A small mulberry32: the same seed gives the same rows, which is what makes
// a generated fixture worth committing. Math.random can't do that.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text) {
  let h = 2166136261;
  for (const char of String(text)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const slug = (text) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// Every field a row can have. Each one gets the row built so far, so an email
// can be made from the name that was already drawn rather than a second one.
export const FIELDS = [
  { id: 'id', label: 'ID (sequential)', make: (r, _pick, i) => i + 1 },
  { id: 'uuid', label: 'UUID v4', make: () => crypto.randomUUID() },
  { id: 'firstName', label: 'First name', make: (r, pick) => pick(FIRST) },
  { id: 'lastName', label: 'Surname', make: (r, pick) => pick(LAST) },
  {
    id: 'fullName',
    label: 'Full name',
    make: (r, pick) =>
      `${r.firstName ?? pick(FIRST)} ${r.lastName ?? pick(LAST)}`,
  },
  {
    id: 'username',
    label: 'Username',
    make: (r, pick, i, rand) =>
      `${slug(r.firstName ?? pick(FIRST))}${Math.floor(rand() * 900 + 100)}`,
  },
  {
    id: 'email',
    label: 'Email (always example.com)',
    make: (r, pick, i, rand) => {
      const first = slug(r.firstName ?? pick(FIRST));
      const last = slug(r.lastName ?? pick(LAST));
      const styles = [
        `${first}.${last}`,
        `${first}${last}`,
        `${first[0]}${last}`,
        `${first}${Math.floor(rand() * 90 + 10)}`,
      ];
      return `${pick(styles)}@${pick(DOMAINS)}`;
    },
  },
  {
    id: 'phone',
    label: 'Phone (reserved range)',
    // +1 555 01xx is the North American range set aside for fiction, and
    // 07700 900xxx is Ofcom's equivalent for the UK. Neither can ring.
    make: (r, pick, i, rand) =>
      rand() < 0.5
        ? `+1 555 01${String(Math.floor(rand() * 100)).padStart(2, '0')}`
        : `+44 7700 900${String(Math.floor(rand() * 1000)).padStart(3, '0')}`,
  },
  {
    id: 'street',
    label: 'Street address',
    make: (r, pick, i, rand) =>
      `${Math.floor(rand() * 200) + 1} ${pick(STREETS)} ${pick(STREET_KIND)}`,
  },
  { id: 'city', label: 'City', make: (r, pick) => pick(CITIES)[0] },
  {
    id: 'region',
    label: 'Region / state',
    make: (r, pick) => pick(CITIES)[1],
  },
  { id: 'country', label: 'Country code', make: (r, pick) => pick(CITIES)[2] },
  {
    id: 'postcode',
    label: 'Postcode',
    make: (r, pick, i, rand) =>
      `${String.fromCharCode(65 + Math.floor(rand() * 26))}${String.fromCharCode(65 + Math.floor(rand() * 26))}${Math.floor(rand() * 9) + 1} ${Math.floor(rand() * 9)}${String.fromCharCode(65 + Math.floor(rand() * 26))}${String.fromCharCode(65 + Math.floor(rand() * 26))}`,
  },
  {
    id: 'company',
    label: 'Company',
    make: (r, pick) =>
      `${pick(COMPANY_A)}${pick(COMPANY_B)} ${pick(COMPANY_SUFFIX)}`,
  },
  { id: 'jobTitle', label: 'Job title', make: (r, pick) => pick(JOBS) },
  {
    id: 'department',
    label: 'Department',
    make: (r, pick) => pick(DEPARTMENTS),
  },
  {
    id: 'product',
    label: 'Product name',
    make: (r, pick) => `${pick(COMPANY_A)} ${pick(PRODUCTS)}`,
  },
  {
    id: 'price',
    label: 'Price',
    // Prices in the wild sit just under a round number far more often than
    // chance would put them there, and a mockup looks wrong without that.
    make: (r, pick, i, rand) =>
      Number(
        (Math.floor(rand() * 200) + (rand() < 0.7 ? 0.99 : 0.5)).toFixed(2),
      ),
  },
  {
    id: 'quantity',
    label: 'Quantity',
    make: (r, pick, i, rand) => Math.floor(rand() * 20) + 1,
  },
  {
    id: 'rating',
    label: 'Rating (1–5)',
    make: (r, pick, i, rand) => Number((rand() * 4 + 1).toFixed(1)),
  },
  {
    id: 'boolean',
    label: 'True / false',
    make: (r, pick, i, rand) => rand() < 0.5,
  },
  {
    id: 'date',
    label: 'Date (last two years)',
    make: (r, pick, i, rand) =>
      new Date(Date.now() - rand() * 63072000000).toISOString().slice(0, 10),
  },
  {
    id: 'datetime',
    label: 'Timestamp (ISO)',
    make: (r, pick, i, rand) =>
      new Date(Date.now() - rand() * 63072000000).toISOString(),
  },
  {
    id: 'sentence',
    label: 'Sentence',
    make: (r, pick, i, rand) => sentence(pick, rand),
  },
  {
    id: 'paragraph',
    label: 'Paragraph',
    make: (r, pick, i, rand) =>
      Array.from({ length: Math.floor(rand() * 3) + 2 }, () =>
        sentence(pick, rand),
      ).join(' '),
  },
  {
    id: 'colour',
    label: 'Colour (hex)',
    make: (r, pick, i, rand) =>
      `#${Math.floor(rand() * 0xffffff)
        .toString(16)
        .padStart(6, '0')}`,
  },
  {
    id: 'avatar',
    label: 'Avatar URL (placeholder)',
    make: (r, pick) =>
      `https://placehold.co/128x128?text=${encodeURIComponent((r.firstName ?? pick(FIRST))[0])}`,
  },
  {
    id: 'url',
    label: 'Website',
    make: (r, pick) =>
      `https://${slug(r.company ?? `${pick(COMPANY_A)}${pick(COMPANY_B)}`)}.example.com`,
  },
  {
    id: 'ipv4',
    label: 'IP address (documentation range)',
    // 203.0.113.0/24 is reserved for documentation, so it can never be a
    // machine someone is running something on.
    make: (r, pick, i, rand) => `203.0.113.${Math.floor(rand() * 254) + 1}`,
  },
  {
    id: 'cardNumber',
    label: 'Card number (test number)',
    make: (r, pick) => pick(TEST_CARDS)[1],
  },
  {
    id: 'cardBrand',
    label: 'Card brand',
    make: (r, pick) => pick(TEST_CARDS)[0],
  },
  {
    id: 'status',
    label: 'Status',
    make: (r, pick) =>
      pick(['active', 'pending', 'archived', 'suspended', 'trial']),
  },
];

function sentence(pick, rand) {
  const length = Math.floor(rand() * 10) + 6;
  const words = Array.from({ length }, () => pick(WORDS));
  words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return `${words.join(' ')}.`;
}

export const FIELD_IDS = FIELDS.map((f) => f.id);

/** Build `count` rows with the chosen fields, deterministically from `seed`. */
export function generate({ fields, count, seed }) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const chosen = fields
    .map((id) => FIELDS.find((f) => f.id === id))
    .filter(Boolean);
  return Array.from({ length: count }, (_, i) => {
    const row = {};
    for (const field of chosen) row[field.id] = field.make(row, pick, i, rand);
    return row;
  });
}

// The output formats. Each takes the rows and the field order and returns text.
export const FORMATS = [
  {
    id: 'json',
    label: 'JSON',
    ext: 'json',
    mime: 'application/json',
    render: (rows) => JSON.stringify(rows, null, 2),
  },
  {
    id: 'ndjson',
    label: 'NDJSON',
    ext: 'ndjson',
    mime: 'application/x-ndjson',
    render: (rows) => rows.map((r) => JSON.stringify(r)).join('\n'),
  },
  {
    id: 'csv',
    label: 'CSV',
    ext: 'csv',
    mime: 'text/csv',
    render: (rows, fields) =>
      [
        fields.join(','),
        ...rows.map((r) => fields.map((f) => csvCell(r[f])).join(',')),
      ].join('\n'),
  },
  {
    id: 'sql',
    label: 'SQL inserts',
    ext: 'sql',
    mime: 'text/plain',
    render: (rows, fields) =>
      rows
        .map(
          (r) =>
            `INSERT INTO people (${fields.join(', ')}) VALUES (${fields
              .map((f) => sqlValue(r[f]))
              .join(', ')});`,
        )
        .join('\n'),
  },
  {
    id: 'markdown',
    label: 'Markdown table',
    ext: 'md',
    mime: 'text/markdown',
    render: (rows, fields) =>
      [
        `| ${fields.join(' | ')} |`,
        `| ${fields.map(() => '---').join(' | ')} |`,
        ...rows.map(
          (r) =>
            `| ${fields.map((f) => String(r[f]).replaceAll('|', '\\|')).join(' | ')} |`,
        ),
      ].join('\n'),
  },
];

function csvCell(value) {
  const text = String(value ?? '');
  // A field containing a comma, a quote or a newline has to be quoted, and a
  // quote inside it doubled. Getting this wrong is how CSVs end up shifted.
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replaceAll("'", "''")}'`;
}
