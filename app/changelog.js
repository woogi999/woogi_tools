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
      { type: 'new', text: 'Games in a new Fun category: Chess, Snake and Uno. Play against the computer or challenge a friend peer-to-peer with a room code or invite link, the same way File Share connects.' },
      { type: 'new', text: 'Every game has a proper lobby: open a room, see who joins, add computer players and set the rules before the host starts. Uno seats up to eight, Snake four.' },
      { type: 'new', text: 'Uno is played around a 3D table with doodle avatars you design in the lobby, holding your cards in the same drawn hand as the home page search.' },
      { type: 'new', text: 'Uno house rules: stacking +2 and +4 cards, sevens swap hands, zeros rotate hands, jump-in, draw until you can play, and the UNO penalty.' },
      { type: 'new', text: 'Chess: clocks from bullet to classical (or your own), Chess960 and custom FEN starts, premoves, drag-and-drop, sliding piece animations, takebacks and draw offers.' },
      { type: 'new', text: 'Snake: battles of up to four snakes, three board sizes, more apples and wrap-around edges.' },
      { type: 'new', text: 'A full screen button on every tool.' },
      { type: 'new', text: 'Picture-in-picture for every tool and game. Leave a game mid-match and it keeps running in a small window you can drag, resize, minimise to a pill in the corner or bring back full size. Closing a game you are in asks first, since it disconnects you (or ends the game for everyone if you are hosting).' },
      { type: 'new', text: 'Chat in every game lobby and during games, with a filter for slurs and targeted abuse (ordinary swearing is left alone).' },
      { type: 'new', text: 'Customise your avatar from any game’s lobby.' },
      { type: 'new', text: 'Uno: your hand, buttons and chat now sit inside the 3D table view, and moving the mouse lets you glance around the table. Other players see your avatar turn its head to match.' },
      { type: 'improved', text: 'Uno: type any starting hand size (1–20) and Uno penalty (0–10).' },
      { type: 'improved', text: 'Game lobbies use the full width of the page.' },
      { type: 'improved', text: 'The hand of cards on the home page and in Uno reuses its cards instead of rebuilding them, so typing a search and playing cards stay smooth.' },
      { type: 'removed', text: 'All-caps labels.' },
      { type: 'fixed', text: 'Offline mode never actually switched on, and the saved copy of the page could not be opened without a connection. Both are fixed.' },
      { type: 'improved', text: 'On phones, drag across the hand to flip through the cards, then tap the raised card again to open it.' },
      { type: 'improved', text: 'The hand runs much smoother with lots of results: cards tucked deep in the fan only draw their full details once you lift them.' },
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
