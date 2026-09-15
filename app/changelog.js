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
    version: '1.0.6',
    date: '2026-09-16',
    title: 'Snake and Minesweeper, now in 3D',
    changes: [
      { type: 'new', text: 'Snake is a whole new 3D game: your avatar rides the snake around a little island, with a joystick on phones and a boost that costs you a bit of length. Four maps, four snakes, highest score wins.' },
      { type: 'new', text: 'Minesweeper is now multiplayer too. Everyone drops onto the same board, walks around to dig and flag, and the highest score wins. Turn “Bombs only stun” on to get knocked out instead of killed.' },
      { type: 'improved', text: 'Both games got a pass of vfx and sfx: boost trails, screen shake, splash particles, dust when you walk, and smoother animations all round — including how you fall off your snake or get stunned.' },
      { type: 'new', text: 'Chat now lives right inside the game view for every game, which is a proper 16:9 window like Woono’s table.' },
      { type: 'new', text: 'Snake rule: “Longer is” faster, slower, or no change — pick how being long affects your speed.' },
      { type: 'improved', text: 'Snake steering is snappier: turns land the moment you press them instead of waiting for the next square, and there’s a touch of coyote time (shorter the faster you’re going) so a last-second turn can save you from a wall.' },
      { type: 'new', text: 'A controls reminder in the corner of Snake and Minesweeper, that matches how you’re playing: keyboard keys on PC, coloured buttons with a controller plugged in, and nothing at all on phones.' },
      { type: 'improved', text: 'Emoji across every game’s UI were swapped for the site’s own sketchy icons.' },
      { type: 'fixed', text: 'Woono: stacking a +2 on a colour now also lets you stack a +4 or a same-colour Skip/Reverse, not just another +2.' },
      { type: 'fixed', text: 'Woono chat no longer overflows the screen on phones.' },
    ],
  },
  {
    version: '1.0.5',
    date: '2026-09-15',
    title: 'Avatar Editor, poses and game sounds',
    changes: [
      { type: 'new', text: 'A whole new Avatar Editor tool: pose your avatar with presets or joint by joint, pick an expression, and save PNGs of it (full body or headshot, transparent or coloured background).' },
      { type: 'new', text: 'Your pose now shows on your portrait in game lobbies, for everyone else too.' },
      { type: 'new', text: 'Real sound effects everywhere: card shuffles in Woono, wooden taps in Chess, plucks in Snake, and clicks on buttons.' },
      { type: 'new', text: 'A volume button next to light/dark mode, and game lobby rules are now remembered (and saveable by name).' },
      { type: 'new', text: 'Export/import all your site data, or beam it straight to another device with a link.' },
      { type: 'improved', text: 'File Share connects devices directly now instead of through a relay, so it’s much faster (just know the other person can see your IP).' },
      { type: 'improved', text: 'Woono runs smoother on phones, and leaving mid-game now asks you to hold a button first so you don’t leave by accident.' },
      { type: 'fixed', text: 'A couple of Woono bugs around drawing cards, plus portraits no longer flicker in the lobby.' },
    ],
  },
  {
    version: '1.0.4',
    date: '2026-09-15',
    title: 'Avatars remade, with clothes',
    changes: [
      { type: 'improved', text: 'Avatars got a new chibi look: wider soft head, shorter body.' },
      { type: 'new', text: 'Actual clothes now — shirts, hoodies, dresses, trousers, shoes, all in any colour and pattern.' },
      { type: 'new', text: 'New eye styles, and Mii-style sliders to move your features around (eye height, spacing, tilt, and more).' },
      { type: 'improved', text: 'Hairstyles rebuilt to actually look like what they’re named, plus a few new ones.' },
      { type: 'new', text: 'Loads more accessories: hats, ears, piercings, masks, wings, capes, and more.' },
      { type: 'new', text: 'You can set your games avatar and name from Settings now, without opening a game.' },
      { type: 'removed', text: 'Robot avatars are computer-player only now.' },
    ],
  },
  {
    version: '1.0.3',
    date: '2026-09-15',
    title: 'Game layout, nearby play and new avatars',
    changes: [
      { type: 'new', text: 'Games now use the whole screen edge to edge, so the board or table gets as much room as possible.' },
      { type: 'new', text: 'Play with people nearby with no internet, just by scanning a QR code on the same Wi-Fi or hotspot.' },
      { type: 'new', text: 'Public and private rooms, both with an optional password.' },
      { type: 'new', text: 'Woono: an optional turn timer, and the ability to challenge a Wild Draw Four.' },
      { type: 'new', text: 'Chat works in every game even solo — the computer players will actually talk back.' },
      { type: 'improved', text: 'Another avatar redraw: chibi anime style with big eyes, new hair, and tons of new accessories. Save up to 16 looks.' },
    ],
  },
  {
    version: '1.0.2',
    date: '2026-09-15',
    title: 'Woono in first person, new avatars and JJS Stuff',
    changes: [
      { type: 'new', text: 'JJS Stuff: a searchable reference of Jujutsu Shenanigans info — sound IDs, animations, VFX presets and more.' },
      { type: 'improved', text: 'Uno is now Woono (search still finds it either way).' },
      { type: 'new', text: 'Woono is played first person from your own seat now: hover or tap a card to lift it, tap again to play it.' },
      { type: 'new', text: 'Sparks, shockwaves, wild-colour washes, pop-ups and screen shake when the big cards land, plus fireworks for the winner.' },
      { type: 'new', text: 'On phones you can tilt to look around the table, and the table itself is always a clean 16:9.' },
      { type: 'improved', text: 'Another avatar redo: chibi sketchbook doodles with new hair, half-lidded eyes and better arms.' },
      { type: 'new', text: 'Robot avatars for computer players, each with its own tech-pun name.' },
    ],
  },
  {
    version: '1.0.1',
    date: '2026-09-14',
    title: 'Offline mode and a new home page',
    changes: [
      { type: 'new', text: 'Woogi Tools now works offline after your first visit, and quietly updates itself when you’re back online.' },
      { type: 'new', text: 'This Updates page.' },
      { type: 'new', text: 'A new home page: search opens a hand of cards you can flip through, plus a full grid alongside it.' },
      { type: 'new', text: 'A whole Fun category of games: Chess, Snake and Woono, playable solo, against friends, or with computer players.' },
      { type: 'new', text: 'Every game has a proper lobby, chat, a customisable avatar, and picture-in-picture so you can keep playing in a small window while you browse.' },
      { type: 'new', text: 'A full screen button on every tool.' },
      { type: 'improved', text: 'Game lobbies use the full width of the page, and the search bar’s hand of cards runs a lot smoother.' },
      { type: 'removed', text: 'All-caps labels, and YouTube Downloader (needed a server, which doesn’t work on a static site).' },
      { type: 'fixed', text: 'Offline mode is now actually offline — it didn’t work at all before.' },
      { type: 'new', text: 'Timestamp Converter, with ready-to-paste Discord timestamp codes.' },
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
