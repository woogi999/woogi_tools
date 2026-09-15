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
    version: '1.4.0',
    date: '2026-09-15',
    title: 'Avatars remade, with clothes',
    changes: [
      { type: 'improved', text: 'Avatars have a new chibi build: a wide, soft-cornered head instead of a round one, and a short straight body with stubby arms and legs.' },
      { type: 'new', text: 'Clothes: T-shirts, tank tops, long sleeves, turtlenecks, hoodies, jackets, sailor tops, dresses and overalls, with stripes, spots, checks or a print, plus trousers, shorts or skirts and three kinds of shoes, all in any colour.' },
      { type: 'new', text: 'New sketchbook-style eyes (empty, tired, lashes, bright, gentle, glossy, serene, shocked), and fewer anime ones.' },
      { type: 'new', text: 'Move your features like a Mii: eye height, spacing, size and tilt, eyebrow and nose height, mouth height and size.' },
      { type: 'improved', text: 'Hairstyles rebuilt: the bowl cut, wolf cut and mullet have their real shapes, the mohawk is a crest over shaved sides, and long hair hangs down your back. New pixie, fluffy, side part and wavy styles.' },
      { type: 'new', text: 'More accessories: bucket hats, berets, straw, top, witch, party and frog hats, bunny and bear ears, a leaf, hair clips, goggles, bow ties, bell collars, necklaces, bandanas, face and fox masks, backpacks, wings, capes and tails, plus a cartilage piercing.' },
      { type: 'improved', text: 'Glasses are big and round now, with new cat-eye, heart, star and swirly frames.' },
      { type: 'improved', text: 'Rosy cheeks are one of the marks, next to new eye bags, tears, whiskers and a star sticker.' },
      { type: 'new', text: 'Customise your games avatar and name from Settings, without opening a game.' },
      { type: 'improved', text: 'Lobby portraits are rendered from the 3D model, so they show everything you wear.' },
      { type: 'removed', text: 'Robot avatars are only for computer players now. Saved robot looks are no longer listed.' },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-09-15',
    title: 'Game layout, nearby play and new avatars',
    changes: [
      { type: 'new', text: 'Games have their own layout: edge to edge with a slim title bar, so the table, board or snake pit gets as much of the screen as possible. Woono’s table is bigger and still 16:9.' },
      { type: 'new', text: 'Play nearby without internet. Everyone on the same Wi-Fi or phone hotspot connects directly by scanning a QR code (or pasting a code) from the host, and replying with one of their own.' },
      { type: 'new', text: 'Public and private rooms. Public rooms show up under Browse public rooms; private ones need the code or link. Either can have a password.' },
      { type: 'new', text: 'Woono: an optional turn timer (10 to 60 seconds). Run out and the game moves for you.' },
      { type: 'new', text: 'Woono: challenge a Wild Draw Four. If the player still had the colour in play, they draw the cards; if not, you draw two extra.' },
      { type: 'new', text: 'Chat works in every game even with no one else there, and the computer players join in with robot and tech puns about what’s happening.' },
      { type: 'improved', text: 'Avatars are redrawn as chibi anime characters with big eyes (13 styles, any eye colour), eyebrows, new mouths, freckles, scars and more.' },
      { type: 'new', text: 'New hairstyles: wolf cut, anime spikes, undercut, curtains, side fringe, mullet, braid and pompadour. The mohawk and other styles look much better.' },
      { type: 'new', text: 'Accessories: hats and ears, horns, crowns, glasses, shades, a monocle, an eyepatch, scarves, ties and chokers, plus ear, eyebrow, nose, septum and lip piercings.' },
      { type: 'new', text: 'Save up to 16 avatar looks and switch between them. Switching between person and robot keeps both, and never changes your name.' },
      { type: 'improved', text: 'Woono name tags use the site’s own sketchy icons instead of emoji.' },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-09-15',
    title: 'Woono in first person, new avatars and JJS Stuff',
    changes: [
      { type: 'new', text: 'JJS Stuff, in Fun: Jujutsu Shenanigans Skill Builder notes from oSam and friends. Every sound ID by item, M1 set and character, emote music, punch, kick and flip directions, run and walk animations, move startups and VFX presets. Search every tab at once and tap an ID to copy it.' },
      { type: 'improved', text: 'Uno is now Woono (search still finds it by “uno”, and old links still work).' },
      { type: 'new', text: 'Woono is played first person from your own seat. Your cards are real 3D cards in front of you: hover or tap to lift one, click or tap again to play it, and tap the deck to draw.' },
      { type: 'new', text: 'Woono: name tags, the Draw button and stacked-draw warnings float in the 3D scene and always face you.' },
      { type: 'new', text: 'Woono effects: sparks and shockwaves when cards land, wilds washing the table in their colour, pop-ups for draws, skips and swaps, a little screen shake on +4s and fireworks for the winner. Reduced motion tones them down.' },
      { type: 'new', text: 'Woono on phones: tilt your phone to look around (iPhones ask first, from the phone button), or drag to look. Turn your phone sideways for the full table.' },
      { type: 'improved', text: 'The Woono table is always 16:9, as big as your window allows.' },
      { type: 'new', text: 'The cards have a new back, with the site’s doodle on it.' },
      { type: 'improved', text: 'Avatars are redone as chibi sketchbook doodles, with 16 hairstyles, half-lidded eyes, noses, a stray strand of hair, headphones, and arms that hang from the shoulders the right way round.' },
      { type: 'new', text: 'Robot avatars, for computer players in every game (and for you, if you like). Every computer player now has its own tech pun of a name.' },
    ],
  },
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
      { type: 'new', text: 'Games in a new Fun category: Chess, Snake and Woono. Play against the computer or challenge a friend peer-to-peer with a room code or invite link, the same way File Share connects.' },
      { type: 'new', text: 'Every game has a proper lobby: open a room, see who joins, add computer players and set the rules before the host starts. Woono seats up to eight, Snake four.' },
      { type: 'new', text: 'Woono is played around a 3D table with doodle avatars you design in the lobby, holding your cards in the same drawn hand as the home page search.' },
      { type: 'new', text: 'Woono house rules: stacking +2 and +4 cards, sevens swap hands, zeros rotate hands, jump-in, draw until you can play, and the Woono penalty.' },
      { type: 'new', text: 'Chess: clocks from bullet to classical (or your own), Chess960 and custom FEN starts, premoves, drag-and-drop, sliding piece animations, takebacks and draw offers.' },
      { type: 'new', text: 'Snake: battles of up to four snakes, three board sizes, more apples and wrap-around edges.' },
      { type: 'new', text: 'A full screen button on every tool.' },
      { type: 'new', text: 'Picture-in-picture for every tool and game. Leave a game mid-match and it keeps running in a small window you can drag, resize, minimise to a pill in the corner or bring back full size. Closing a game you are in asks first, since it disconnects you (or ends the game for everyone if you are hosting).' },
      { type: 'new', text: 'Chat in every game lobby and during games, with a filter for slurs and targeted abuse (ordinary swearing is left alone).' },
      { type: 'new', text: 'Customise your avatar from any game’s lobby.' },
      { type: 'new', text: 'Woono: your hand, buttons and chat now sit inside the 3D table view, and moving the mouse lets you glance around the table. Other players see your avatar turn its head to match.' },
      { type: 'improved', text: 'Woono: type any starting hand size (1–20) and Woono penalty (0–10).' },
      { type: 'improved', text: 'Game lobbies use the full width of the page.' },
      { type: 'improved', text: 'The hand of cards on the home page and in Woono reuses its cards instead of rebuilding them, so typing a search and playing cards stay smooth.' },
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
