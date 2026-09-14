// What's changed, newest first. Shown on the Updates page; the first entry's
// version is the site's version everywhere else (Settings, the update toast).
//
// Releasing: add an entry at the top and bump "version" in package.json to
// match. You don't need to touch the service worker — every build gets its
// own build ID from its contents, and visitors pick the new build up the next
// time they're online.
//
// Change types: 'new' | 'improved' | 'fixed' | 'removed'
export const CHANGELOG = [
  {
    version: '1.1.0',
    date: '2026-09-14',
    title: 'Offline mode and a new home page',
    changes: [
      { type: 'new', text: 'Woogi Tools now works offline after your first visit. The site saves itself in your browser and quietly updates to the newest version whenever you are back online.' },
      { type: 'new', text: 'This Updates page, so you can see what changed and which version you are running.' },
      { type: 'new', text: 'Offline mode status, version and cache size in Settings → Your data, with buttons to check for updates or remove the offline copy.' },
      { type: 'new', text: 'The home page opens on a search bar. Results appear as you type: every match dealt as a hand of playing cards, held by a drawn hand (black in light mode, white in dark) that stays pinned in view as you scroll, plus the full card grid alongside it.' },
      { type: 'new', text: 'Hover a card in the hand or the grid to lift and preview it; click anywhere on its slice of the fan to open it. Works with touch and keyboard too.' },
      { type: 'new', text: 'Search filters for categories, favourites, name-only matching and A–Z sorting, plus an “I’m Feeling Lucky” button that opens a random tool.' },
      { type: 'new', text: 'Category buttons above Favourites on the home page, to browse one category at a time.' },
      { type: 'new', text: 'A Settings switch to turn the hand of cards off and keep just the grid.' },
      { type: 'improved', text: 'Settings sections and the Updates page are plain sections split by lines instead of boxed cards.' },
      { type: 'new', text: 'Timestamp Converter: a date and time picker, plus ready-to-paste Discord timestamp codes.' },
      { type: 'improved', text: 'Every tool page header shows the tool’s icon.' },
      { type: 'removed', text: 'YouTube Downloader. It needed a local server, which can’t work on a static site.' },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-09-14',
    title: 'First release',
    changes: [{ type: 'new', text: 'Around forty small tools across Design, Dev, Files, Math, Text and more, with favourites, Quick Notes and a command palette.' }],
  },
];

export const APP_VERSION = CHANGELOG[0].version;
