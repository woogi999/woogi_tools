// A shelf of regexes worth copying, with the reasoning attached.
//
// Most "regex library" lists on the web are a trap: they hand you a 400
// character monster for email addresses that rejects real ones, or a phone
// pattern that only works in one country. Everything here says what it
// actually matches and, where it matters, what it deliberately doesn't, so
// you can tell whether it's the right tool before you paste it into
// production. Each one comes with samples that should and shouldn't match,
// which the page runs live: if a pattern here ever breaks, the page says so.

export const CATEGORIES = [
  'Everyday',
  'Web & network',
  'Dates & numbers',
  'Code & text',
  'Money & payments',
  'Validation',
];

export const PATTERNS = [
  // ---------------------------------------------------------------- Everyday
  {
    id: 'email',
    name: 'Email address',
    category: 'Everyday',
    pattern: String.raw`[^\s@]+@[^\s@.]+\.[^\s@]+`,
    flags: 'g',
    what: 'Something@something.something, with no spaces.',
    note: 'Deliberately loose. The full grammar for a valid email address runs to pages and still cannot tell you whether the address exists, so the only real check is sending a message to it. This catches typos and finds addresses in a block of text; it is not a gatekeeper.',
    good: ['ana@example.com', 'first.last+tag@sub.example.co.uk'],
    bad: ['no-at-sign.com', 'two@@example.com', 'trailing@dot.'],
  },
  {
    id: 'url',
    name: 'URL',
    category: 'Everyday',
    pattern: String.raw`https?:\/\/[^\s<>"'\)]+`,
    flags: 'gi',
    what: 'An http or https link, stopping at whitespace or a closing bracket.',
    note: 'Stops at a bracket so a link inside (parentheses) or a Markdown [label](link) does not swallow the punctuation around it. For validating a URL rather than finding one, use new URL() and catch the error: the browser has a parser and it is correct.',
    good: ['https://example.com/a/b?c=d#e', 'http://localhost:3000'],
    bad: ['example.com', 'ftp://files.example.com'],
  },
  {
    id: 'phone-intl',
    name: 'Phone number (loose, international)',
    category: 'Everyday',
    pattern: String.raw`\+?[\d][\d\s().-]{6,}\d`,
    flags: 'g',
    what: 'A run of digits with the usual spacing, brackets and dashes, optionally starting with +.',
    note: 'Phone formats vary so wildly between countries that a strict pattern is always wrong somewhere. This finds candidates; strip the non-digits and check the length against the country you expect.',
    good: ['+44 7700 900123', '(555) 010-1234', '+1-555-010-9999'],
    bad: ['12345', 'call me'],
  },
  {
    id: 'whitespace-squash',
    name: 'Runs of whitespace',
    category: 'Everyday',
    pattern: String.raw`\s+`,
    flags: 'g',
    what: 'Two or more spaces, tabs or newlines in a row.',
    note: 'Replace with a single space to tidy up text pasted out of a PDF or a Word document.',
    good: ['a    b', 'line\n\nline'],
    bad: [],
  },
  {
    id: 'trim',
    name: 'Leading and trailing whitespace',
    category: 'Everyday',
    pattern: String.raw`^\s+|\s+$`,
    flags: 'gm',
    what: 'Whitespace at the start or end of each line.',
    note: 'With the m flag this trims every line, not just the whole string. For a single string, .trim() is shorter and faster.',
    good: ['  padded  '],
    bad: ['tight'],
  },
  {
    id: 'emoji',
    name: 'Emoji',
    category: 'Everyday',
    pattern: String.raw`\p{Extended_Pictographic}`,
    flags: 'gu',
    what: 'Any pictographic character.',
    note: 'Needs the u flag for the \\p{…} property to work at all. Note that a family emoji is several code points joined together, so this matches its pieces rather than the whole thing; add \\p{Emoji_Modifier}? and a ZWJ sequence if that matters.',
    good: ['hello 👋', '🎉🎉'],
    bad: ['plain text'],
  },

  // ----------------------------------------------------------- Web & network
  {
    id: 'ipv4',
    name: 'IPv4 address',
    category: 'Web & network',
    pattern: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b`,
    flags: 'g',
    what: 'Four numbers, each 0–255, separated by dots.',
    note: 'The long alternation is what enforces the 0–255 range: \\d{1,3} would happily accept 999.999.999.999.',
    good: ['192.168.1.1', '8.8.8.8', '255.255.255.255'],
    bad: ['256.1.1.1', '1.2.3', '999.1.1.1'],
  },
  {
    id: 'ipv6',
    name: 'IPv6 address',
    category: 'Web & network',
    pattern: String.raw`(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}|(?:[A-F0-9]{1,4}:){1,7}:|::(?:[A-F0-9]{1,4}:){0,6}[A-F0-9]{1,4}`,
    flags: 'gi',
    what: 'A full IPv6 address, or one shortened with a :: in it.',
    note: 'Covers the common shapes rather than every legal one; IPv6 has an embedded-IPv4 form and a zone index that this leaves out.',
    good: ['2001:0db8:85a3:0000:0000:8a2e:0370:7334', '::1', 'fe80::1'],
    bad: ['192.168.1.1', 'not an address'],
  },
  {
    id: 'mac',
    name: 'MAC address',
    category: 'Web & network',
    pattern: String.raw`\b[A-F0-9]{2}(?:[:-][A-F0-9]{2}){5}\b`,
    flags: 'gi',
    what: 'Six pairs of hex digits joined by colons or dashes.',
    good: ['00:1B:44:11:3A:B7', '00-1b-44-11-3a-b7'],
    bad: ['00:1B:44:11:3A', 'GG:1B:44:11:3A:B7'],
  },
  {
    id: 'domain',
    name: 'Domain name',
    category: 'Web & network',
    pattern: String.raw`\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b`,
    flags: 'gi',
    what: 'One or more labels and a letters-only top level domain.',
    note: 'Labels may not start or end with a hyphen, which is what the inner group enforces. Does not handle internationalised names in their unicode form; convert those to punycode first.',
    good: ['example.com', 'a-b.sub.example.co.uk'],
    bad: ['nodot', 'example.', 'localhost'],
  },
  {
    id: 'slug',
    name: 'URL slug',
    category: 'Web & network',
    pattern: String.raw`^[a-z0-9]+(?:-[a-z0-9]+)*$`,
    flags: '',
    what: 'Lowercase words joined by single hyphens, with none at either end.',
    good: ['my-first-post', 'about'],
    bad: ['My-Post', 'double--hyphen', '-leading'],
  },
  {
    id: 'query-param',
    name: 'Query string parameter',
    category: 'Web & network',
    pattern: String.raw`[?&]([^=&#]+)=([^&#]*)`,
    flags: 'g',
    what: 'Each key and value in a query string, as two capture groups.',
    note: 'Fine for a quick look at a URL you can see. For anything you will act on, URLSearchParams handles the encoding and the repeated-key case properly.',
    good: ['?a=1&b=two'],
    bad: ['plain/path'],
  },
  {
    id: 'html-tag',
    name: 'HTML tag',
    category: 'Web & network',
    pattern: String.raw`<\/?([a-z][a-z0-9-]*)\b[^>]*>`,
    flags: 'gi',
    what: 'An opening or closing tag, capturing its name.',
    note: 'For stripping tags out of a string you control, or highlighting markup. HTML is not a regular language, so never use this to parse a document or to sanitise untrusted input: use DOMParser, and a real sanitiser.',
    good: ['<p>', '</div>', '<img src="a.png" />'],
    bad: ['< not a tag', 'a < b'],
  },

  // -------------------------------------------------------- Dates & numbers
  {
    id: 'iso-date',
    name: 'ISO date (YYYY-MM-DD)',
    category: 'Dates & numbers',
    pattern: String.raw`\b\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b`,
    flags: 'g',
    what: 'A four digit year, a month 01–12 and a day 01–31.',
    note: 'Checks the shape, not the calendar: 2025-02-31 passes. Parse it with Date and check the result if the day has to be real.',
    good: ['2026-09-22', '1999-12-31'],
    bad: ['2026-13-01', '26-09-22', '2026-9-2'],
  },
  {
    id: 'iso-datetime',
    name: 'ISO timestamp',
    category: 'Dates & numbers',
    pattern: String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?`,
    flags: 'g',
    what: 'A date and time, with optional seconds, fractions and time zone.',
    good: [
      '2026-09-22T14:30:00Z',
      '2026-09-22 14:30',
      '2026-09-22T14:30:00.123+02:00',
    ],
    bad: ['22/09/2026'],
  },
  {
    id: 'time-24',
    name: '24-hour time',
    category: 'Dates & numbers',
    pattern: String.raw`\b(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b`,
    flags: 'g',
    what: '00:00 through 23:59, with optional seconds.',
    good: ['09:30', '23:59:59'],
    bad: ['24:00', '9:30'],
  },
  {
    id: 'number',
    name: 'Number (including decimals and signs)',
    category: 'Dates & numbers',
    pattern: String.raw`-?\d+(?:\.\d+)?`,
    flags: 'g',
    what: 'A whole number or a decimal, optionally negative.',
    note: 'Add (?:[eE][+-]?\\d+)? on the end if you need scientific notation.',
    good: ['42', '-3.14', '0'],
    bad: ['no digits at all', 'one two three'],
  },
  {
    id: 'thousands',
    name: 'Thousands separator positions',
    category: 'Dates & numbers',
    pattern: String.raw`\B(?=(\d{3})+(?!\d))`,
    flags: 'g',
    what: 'The empty positions where a comma belongs in a long number.',
    note: 'Replace with "," to format 1234567 as 1,234,567. It matches nothing at all, only positions, which is why the replacement inserts rather than overwrites. Intl.NumberFormat does this properly, and in the right style for the reader\'s country.',
    good: ['1234567'],
    bad: [],
  },
  {
    id: 'hex-colour',
    name: 'Hex colour',
    category: 'Dates & numbers',
    pattern: String.raw`#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b`,
    flags: 'gi',
    what: '#rgb, #rgba, #rrggbb or #rrggbbaa.',
    good: ['#fff', '#1a2b3c', '#11223344'],
    bad: ['#12345', '#gggggg'],
  },

  // ----------------------------------------------------------- Code & text
  {
    id: 'uuid',
    name: 'UUID',
    category: 'Code & text',
    pattern: String.raw`\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b`,
    flags: 'gi',
    what: 'A canonical UUID of any version from 1 to 8, with the right variant bits.',
    note: 'The [1-8] and [89ab] are the version and variant nibbles. Drop them to \\w if you also want the nil UUID and non-standard ones.',
    good: ['123e4567-e89b-12d3-a456-426614174000'],
    bad: [
      '123e4567e89b12d3a456426614174000',
      '00000000-0000-0000-0000-000000000000',
    ],
  },
  {
    id: 'hashtag',
    name: 'Hashtag',
    category: 'Code & text',
    pattern: String.raw`(?:^|\s)#([\p{L}\p{N}_]+)`,
    flags: 'gu',
    what: 'A hashtag, capturing the word without the hash.',
    note: 'The \\p{L} class means tags in any alphabet work, not just English. The leading whitespace stops it matching the # in a colour or a URL fragment.',
    good: ['love #coffee', '#日本語'],
    bad: ['no tags here', 'a#b is not one'],
  },
  {
    id: 'mention',
    name: '@mention',
    category: 'Code & text',
    pattern: String.raw`(?:^|\s)@([a-z0-9_]{1,30})\b`,
    flags: 'gi',
    what: 'A username mention, capturing the name.',
    good: ['thanks @ana', '@user_123'],
    bad: ['email@example.com'],
  },
  {
    id: 'duplicate-word',
    name: 'Repeated word',
    category: 'Code & text',
    pattern: String.raw`\b(\w+)\s+\1\b`,
    flags: 'gi',
    what: 'The same word twice in a row.',
    note: 'The \\1 is a backreference: it matches whatever group 1 captured. This is the classic way to catch "the the" in a draft.',
    good: ['and and then', 'The the cat'],
    bad: ['and then'],
  },
  {
    id: 'camel-boundary',
    name: 'camelCase word boundary',
    category: 'Code & text',
    pattern: String.raw`([a-z0-9])([A-Z])`,
    flags: 'g',
    what: 'The seam between two words in a camelCase name.',
    note: 'Replace with "$1-$2" and lowercase the result to get kebab-case, or "$1_$2" for snake_case.',
    good: ['backgroundColor', 'parseHTMLString'],
    bad: ['lowercase'],
  },
  {
    id: 'blank-lines',
    name: 'Blank lines',
    category: 'Code & text',
    pattern: String.raw`^\s*$\n?`,
    flags: 'gm',
    what: 'A line with nothing but whitespace on it.',
    note: 'Replace with nothing to strip blank lines out of a list.',
    good: ['a\n\nb'],
    bad: ['a\nb'],
  },
  {
    id: 'comment-line',
    name: 'Line comment (// or #)',
    category: 'Code & text',
    pattern: String.raw`(?:^|\s)(?:\/\/|#).*$`,
    flags: 'gm',
    what: 'From a // or # to the end of the line.',
    note: 'Will also match a // inside a string literal or a URL, because telling those apart needs a parser rather than a pattern.',
    good: ['let a = 1; // set it', '# a shell comment'],
    bad: ['let a = 1;'],
  },
  {
    id: 'block-comment',
    name: 'Block comment (/* … */)',
    category: 'Code & text',
    pattern: String.raw`\/\*[\s\S]*?\*\/`,
    flags: 'g',
    what: 'A C-style block comment, across as many lines as it takes.',
    note: 'The [\\s\\S] is the portable way to say "any character including a newline"; the lazy *? stops the first comment from running all the way to the last */ in the file.',
    good: ['/* one line */', '/* several\nlines */'],
    bad: ['// not a block'],
  },
  {
    id: 'quoted-string',
    name: 'Quoted string (with escapes)',
    category: 'Code & text',
    pattern: String.raw`"(?:[^"\\]|\\.)*"`,
    flags: 'g',
    what: 'A double-quoted string, letting \\" appear inside it.',
    note: 'The alternation is the standard trick: either an ordinary character, or a backslash and whatever follows it. Without it, a string containing an escaped quote ends early.',
    good: ['"hello"', '"she said \\"hi\\""'],
    bad: ["'single quotes'"],
  },
  {
    id: 'markdown-link',
    name: 'Markdown link',
    category: 'Code & text',
    pattern: String.raw`\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)`,
    flags: 'g',
    what: 'The label, the target and the optional title, as three groups.',
    good: ['[a link](https://example.com)', '[x](/y "title")'],
    bad: ['[not a link]'],
  },
  {
    id: 'semver',
    name: 'Semantic version',
    category: 'Code & text',
    pattern: String.raw`\b(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?\b`,
    flags: 'g',
    what: 'Major, minor and patch, with optional prerelease and build parts.',
    good: ['1.0.13', '2.0.0-rc.1', '1.2.3+build.5'],
    bad: ['v1.0', '1.0'],
  },

  // ------------------------------------------------------ Money & payments
  {
    id: 'currency',
    name: 'Money amount',
    category: 'Money & payments',
    pattern: String.raw`[$£€¥]\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:USD|EUR|GBP|JPY)`,
    flags: 'g',
    what: 'A symbol and an amount, or an amount and a currency code.',
    good: ['$1,234.56', '£99', '250.00 EUR'],
    bad: ['1234'],
  },
  {
    id: 'card-number',
    name: 'Card number (shape only)',
    category: 'Money & payments',
    pattern: String.raw`\b(?:\d{4}[ -]?){3}\d{1,4}\b`,
    flags: 'g',
    what: 'Thirteen to sixteen digits in groups of four, with optional spaces or dashes.',
    note: 'The shape only. A real check runs the Luhn algorithm over the digits, which no regex can do. Never log or store what this matches: that is exactly the data PCI rules exist about.',
    good: ['4242 4242 4242 4242', '4242-4242-4242-4242'],
    bad: ['1234'],
  },
  {
    id: 'iban',
    name: 'IBAN',
    category: 'Money & payments',
    pattern: String.raw`\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b`,
    flags: 'g',
    what: 'A country code, two check digits and the account part.',
    note: 'Shape only again: the check digits are a mod-97 calculation over the rearranged number, which needs code.',
    good: ['GB82WEST12345698765432', 'DE89370400440532013000'],
    bad: ['12345678'],
  },

  // ------------------------------------------------------------- Validation
  {
    id: 'password-strength',
    name: 'Password rules',
    category: 'Validation',
    pattern: String.raw`^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{12,}$`,
    flags: '',
    what: 'At least twelve characters, with a lowercase letter, an uppercase one, a digit and a symbol.',
    note: 'Each (?=…) is a lookahead: it checks the whole string from the start without consuming anything, which is how several independent rules stack up in one pattern. Worth saying that current NIST guidance prefers length alone over composition rules like these — a long passphrase beats a short one with a ! on the end.',
    good: ['Correct-Horse-42!'],
    bad: ['short1!A', 'alllowercase12345!'],
  },
  {
    id: 'postcode-uk',
    name: 'UK postcode',
    category: 'Validation',
    pattern: String.raw`\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b`,
    flags: 'gi',
    what: 'The outward and inward parts, with the space optional.',
    good: ['SW1A 1AA', 'M11AE', 'CR2 6XH'],
    bad: ['12345'],
  },
  {
    id: 'zip-us',
    name: 'US ZIP code',
    category: 'Validation',
    pattern: String.raw`\b\d{5}(?:-\d{4})?\b`,
    flags: 'g',
    what: 'Five digits, optionally followed by the four digit extension.',
    good: ['90210', '12345-6789'],
    bad: ['1234'],
  },
  {
    id: 'no-leading-zero',
    name: 'Whole number, no leading zeros',
    category: 'Validation',
    pattern: String.raw`^(?:0|[1-9]\d*)$`,
    flags: '',
    what: 'Zero, or a number that does not start with one.',
    good: ['0', '42', '1000'],
    bad: ['007', '', '1.5'],
  },
  {
    id: 'html-attribute',
    name: 'Contains only safe filename characters',
    category: 'Validation',
    pattern: String.raw`^[\w.-]+$`,
    flags: '',
    what: 'Letters, digits, underscore, dot and hyphen, and nothing else.',
    note: 'A good gate before using a name in a file path: it rules out slashes, "..", spaces and everything else that turns a filename into somewhere else on disk.',
    good: ['report-2026.pdf', 'a_file.txt'],
    bad: ['../etc/passwd', 'my file.txt'],
  },
];

// The same pattern written for the languages people paste into. JavaScript
// and PHP wrap it in delimiters; Python, Java and Go take it as a string, and
// the flags move into an argument.
export function snippets({ pattern, flags }) {
  const jsFlags = flags || '';
  const pyFlags = [
    flags.includes('i') && 're.IGNORECASE',
    flags.includes('m') && 're.MULTILINE',
    flags.includes('s') && 're.DOTALL',
  ].filter(Boolean);
  const inline = [
    flags.includes('i') && 'i',
    flags.includes('m') && 'm',
    flags.includes('s') && 's',
  ]
    .filter(Boolean)
    .join('');
  return [
    {
      language: 'JavaScript',
      code: `/${pattern.replaceAll('/', '\\/')}/${jsFlags}`,
    },
    {
      language: 'Python',
      code: `re.compile(r"${pattern.replaceAll('"', '\\"')}"${pyFlags.length ? `, ${pyFlags.join(' | ')}` : ''})`,
    },
    {
      language: 'Java',
      code: `Pattern.compile("${pattern.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"${
        flags.includes('i') ? ', Pattern.CASE_INSENSITIVE' : ''
      })`,
    },
    {
      language: 'Go',
      code: `regexp.MustCompile(\`${inline ? `(?${inline})` : ''}${pattern}\`)`,
    },
    { language: 'PHP', code: `'/${pattern.replaceAll('/', '\\/')}/${inline}'` },
    {
      language: 'grep -P',
      code: `grep -P${flags.includes('i') ? 'i' : ''} '${pattern}'`,
    },
  ];
}

/** Run a pattern's own samples, so the page can show whether it still holds. */
export function selfTest(entry) {
  let re;
  try {
    re = new RegExp(entry.pattern, entry.flags.replace('g', ''));
  } catch (error) {
    return { ok: false, error: error.message, results: [] };
  }
  const results = [
    ...entry.good.map((sample) => ({
      sample,
      expected: true,
      actual: re.test(sample),
    })),
    ...entry.bad.map((sample) => ({
      sample,
      expected: false,
      actual: re.test(sample),
    })),
  ];
  return {
    ok: results.every((r) => r.expected === r.actual),
    error: null,
    results,
  };
}
