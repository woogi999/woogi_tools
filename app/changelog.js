// What's changed, newest first. Shown on the Updates page; the first entry's
// version is the site's version everywhere else (Settings, the update toast).
//
// Releasing: add an entry at the top and bump "version" in package.json to
// match. You don't need to touch the service worker: every build gets its
// own build ID from its contents, and visitors pick the new build up the next
// time they're online.
//
// Change types: 'new' | 'improved' | 'fixed' | 'removed'
export const CHANGELOG = [
  {
    version: '1.0.8',
    date: '2026-09-18',
    title:
      'Woonopoly, an address lookup, a mannequin poser, and a chat nobody hosts',
    changes: [
      {
        type: 'new',
        text: 'Woonopoly: our take on the property-trading board game, on a 3D city board with your avatars walking round it as the tokens, buildings that grow as you build, and a camera that follows the action or pulls up to a map. Up to eight players, online or against the computer, with auctions, trades, mortgages, houses and hotels, jail, Chance and Treasure Chest cards, and Woobux counted in pesos. The lobby sets the starting money, the GO salary, a round limit, a turn timer and the usual house rules (Free Parking jackpot, double salary on GO, a housing shortage, quick start).',
      },
      {
        type: 'improved',
        text: 'Screen Recorder saves MP4 everywhere (recorded directly where the browser can, converted in the page where it can’t), mixes your microphone into the screen’s sound properly, and no longer plays the sound it is recording back out of your speakers.',
      },
      {
        type: 'new',
        text: 'Pose Reference: a rigged 3D mannequin to draw from, laid out like the games with the controls over the picture. Drag its limbs into a pose or start from a preset, orbit and light it, choose the lens, and save a picture. Clay, toon, wireframe or x-ray.',
      },
      {
        type: 'improved',
        text: 'Messages uses your name and avatar from the games, so you look the same everywhere; files can be dropped straight onto the conversation or pasted in, messages support markdown, and a chat can be renamed and given a photo from its details panel.',
      },
      {
        type: 'fixed',
        text: 'Messages: you no longer hear your own voice echoed back in a call, and coming back to the page no longer makes a second copy of you in the chat.',
      },
      {
        type: 'new',
        text: 'IP Address Lookup: type an address, a hostname or nothing at all for your own. The map fills the page, with road, satellite, hybrid and terrain views, and the address, its provider, its network and its local time sit over it; everything else is one panel away. The lookup goes straight from your browser to the geolocation service.',
      },
      {
        type: 'new',
        text: 'Messages takes the whole page, the way the games do, and sends files as well: up to half a gigabyte, device to device, with anyone who has a copy able to hand it over.',
      },
      {
        type: 'new',
        text: 'Messages: group chat with voice calls, video calls and screen sharing. Nobody hosts it and nothing is uploaded: every device that was invited keeps the whole conversation, and any two that are online fill in what the other missed, so it works whether or not the person who started the chat is around. Pictures, replies, reactions, editing and taking a message back are all in there.',
      },
    ],
  },
  {
    version: '1.0.7',
    date: '2026-09-17',
    title: 'Sixteen new tools, from a darkroom to a radio',
    changes: [
      {
        type: 'new',
        text: 'Typing Speed Test: word runs, timed runs or a quote, live speed and accuracy, a graph of the run and a record of your last twenty.',
      },
      {
        type: 'new',
        text: 'GitHub Repo Checker: paste a repository link for its stars, commits, contributors, languages, lines of code, size, licence and latest release.',
      },
      {
        type: 'fixed',
        text: 'Home, Settings and Updates sit at the top of the sidebar again.',
      },
      {
        type: 'improved',
        text: "GitHub Repo Checker's exact line count no longer depends on a third-party service: it reads each source file straight from GitHub and counts it in the browser with a JavaScript rewrite of cloc's method.",
      },
      {
        type: 'improved',
        text: "The sidebar search hides itself while the homepage's own search box is on screen, and slides back in once you scroll past it.",
      },
      {
        type: 'fixed',
        text: 'Typing Speed Test no longer lags mid-run (the word display was rebuilding itself on every clock tick) and no longer slightly overstates WPM on timed runs.',
      },
      {
        type: 'new',
        text: 'Image Editor: a Lightroom-style darkroom with light, colour, detail and effects sliders, presets, and the fun stuff (dither, pixelate, posterize, threshold). What you see is what you save.',
      },
      {
        type: 'new',
        text: 'Image Censor and Video Censor: blur, pixelate, black out or fuzz over anything with a box, an oval or a brush. The video one follows the thing as it moves and can find faces where the browser has a face finder.',
      },
      {
        type: 'new',
        text: 'Subtitle Baker burns subtitles into a video for good. Auto Subtitle got a “Bake into the video” button that hands its lines straight over, plus a “Tidy into sentences” option that regroups the chunks into proper sentences and re-cuts them into readable lines.',
      },
      {
        type: 'new',
        text: 'Document Redacter blacks out text in a PDF or Word file so it is really gone: PDFs are flattened to pictures and Word files have the words replaced inside the file. Search a word to catch every copy.',
      },
      {
        type: 'new',
        text: 'World Radio: spin a globe and listen to whatever is on the air under the crosshair, thousands of live stations from the Radio Browser directory.',
      },
      {
        type: 'new',
        text: 'Mockup Preview shows a post the way it will look on Facebook, X, Instagram, YouTube, TikTok, LinkedIn, Reddit and Threads, light or dark, and saves it as a picture.',
      },
      {
        type: 'new',
        text: 'Video Player with a playlist, speed control, frame stepping, an A-B loop, subtitles from a file, snapshots and keyboard shortcuts. Speed Test measures ping, jitter, download and upload with a dial.',
      },
      {
        type: 'new',
        text: 'Barcode Generator (Code 128, EAN-13, UPC-A, EAN-8, Code 39, ITF-14, Codabar), Emoji Picker with search and skin tones, ASCII Art from words or a picture (braille dots for the fine version), Geometry Calculator with sketches, and an Online Ruler you calibrate with a bank card or a coin.',
      },
      {
        type: 'new',
        text: 'Dice Roll (up to a d120, a handful at a time) and Coin Toss joined the chance tools, and Random Picker is now called Spin the Wheel.',
      },
      {
        type: 'fixed',
        text: 'File Share and device-to-device transfer now fall back to a public relay (the Open Relay Project) when a direct link between the two devices can’t be made, which was the “sometimes it just won’t connect” case. Direct is still tried first. A share also keeps the tab awake and unthrottled, reads the first pieces of your files ahead of time so sending starts the instant someone joins, and paces itself off the connection rather than a timer.',
      },
      {
        type: 'new',
        text: 'Subtitle Baker has ten fonts to pick from, or bring your own .ttf or .otf.',
      },
      {
        type: 'improved',
        text: 'The tools are sorted into categories that mean something: Images, Colour & Design, Audio & Video, Files & Documents, Text & Writing, Developer, Calculators & Converters, Everyday and Games.',
      },
      {
        type: 'fixed',
        text: 'Auto Subtitle no longer fails to start the speech model on newer browsers, and the currency converter’s rate chart draws again.',
      },
    ],
  },
  {
    version: '1.0.6',
    date: '2026-09-16',
    title: 'Snake and Minesweeper, now in 3D',
    changes: [
      {
        type: 'new',
        text: 'Snake is a whole new 3D game: your avatar rides the snake around a little island, with a joystick on phones and a boost that costs you a bit of length. Four maps, four snakes, highest score wins.',
      },
      {
        type: 'new',
        text: 'Minesweeper is now multiplayer too. Everyone drops onto the same board, walks around to dig and flag, and the highest score wins. Turn “Bombs only stun” on to get knocked out instead of killed.',
      },
      {
        type: 'improved',
        text: 'Both games got a pass of vfx and sfx: boost trails, screen shake, splash particles, dust when you walk, and smoother animations all round, including how you fall off your snake or get stunned.',
      },
      {
        type: 'new',
        text: 'Chat now lives right inside the game view for every game, which is a proper 16:9 window like Woono’s table.',
      },
      {
        type: 'new',
        text: 'Snake rule: “Longer is” faster, slower, or no change: pick how being long affects your speed.',
      },
      {
        type: 'improved',
        text: 'Snake steering is snappier: turns land the moment you press them instead of waiting for the next square, and there’s a touch of coyote time (shorter the faster you’re going) so a last-second turn can save you from a wall.',
      },
      {
        type: 'new',
        text: 'A controls reminder in the corner of Snake and Minesweeper, that matches how you’re playing: keyboard keys on PC, coloured buttons with a controller plugged in, and nothing at all on phones.',
      },
      {
        type: 'improved',
        text: 'Emoji across every game’s UI were swapped for the site’s own sketchy icons.',
      },
      {
        type: 'fixed',
        text: 'Woono: stacking a +2 on a colour now also lets you stack a +4 or a same-colour Skip/Reverse, not just another +2.',
      },
      {
        type: 'fixed',
        text: 'Woono chat no longer overflows the screen on phones.',
      },
    ],
  },
  {
    version: '1.0.5',
    date: '2026-09-15',
    title: 'Avatar Editor, poses and game sounds',
    changes: [
      {
        type: 'new',
        text: 'A whole new Avatar Editor tool: pose your avatar with presets or joint by joint, pick an expression, and save PNGs of it (full body or headshot, transparent or coloured background).',
      },
      {
        type: 'new',
        text: 'Your pose now shows on your portrait in game lobbies, for everyone else too.',
      },
      {
        type: 'new',
        text: 'Real sound effects everywhere: card shuffles in Woono, wooden taps in Chess, plucks in Snake, and clicks on buttons.',
      },
      {
        type: 'new',
        text: 'A volume button next to light/dark mode, and game lobby rules are now remembered (and saveable by name).',
      },
      {
        type: 'new',
        text: 'Export/import all your site data, or beam it straight to another device with a link.',
      },
      {
        type: 'improved',
        text: 'File Share connects devices directly now instead of through a relay, so it’s much faster (just know the other person can see your IP).',
      },
      {
        type: 'improved',
        text: 'Woono runs smoother on phones, and leaving mid-game now asks you to hold a button first so you don’t leave by accident.',
      },
      {
        type: 'fixed',
        text: 'A couple of Woono bugs around drawing cards, plus portraits no longer flicker in the lobby.',
      },
    ],
  },
  {
    version: '1.0.4',
    date: '2026-09-15',
    title: 'Avatars remade, with clothes',
    changes: [
      {
        type: 'improved',
        text: 'Avatars got a new chibi look: wider soft head, shorter body.',
      },
      {
        type: 'new',
        text: 'Actual clothes now: shirts, hoodies, dresses, trousers, shoes, all in any colour and pattern.',
      },
      {
        type: 'new',
        text: 'New eye styles, and Mii-style sliders to move your features around (eye height, spacing, tilt, and more).',
      },
      {
        type: 'improved',
        text: 'Hairstyles rebuilt to actually look like what they’re named, plus a few new ones.',
      },
      {
        type: 'new',
        text: 'Loads more accessories: hats, ears, piercings, masks, wings, capes, and more.',
      },
      {
        type: 'new',
        text: 'You can set your games avatar and name from Settings now, without opening a game.',
      },
      { type: 'removed', text: 'Robot avatars are computer-player only now.' },
    ],
  },
  {
    version: '1.0.3',
    date: '2026-09-15',
    title: 'Game layout, nearby play and new avatars',
    changes: [
      {
        type: 'new',
        text: 'Games now use the whole screen edge to edge, so the board or table gets as much room as possible.',
      },
      {
        type: 'new',
        text: 'Play with people nearby with no internet, just by scanning a QR code on the same Wi-Fi or hotspot.',
      },
      {
        type: 'new',
        text: 'Public and private rooms, both with an optional password.',
      },
      {
        type: 'new',
        text: 'Woono: an optional turn timer, and the ability to challenge a Wild Draw Four.',
      },
      {
        type: 'new',
        text: 'Chat works in every game even solo, and the computer players will actually talk back.',
      },
      {
        type: 'improved',
        text: 'Another avatar redraw: chibi anime style with big eyes, new hair, and tons of new accessories. Save up to 16 looks.',
      },
    ],
  },
  {
    version: '1.0.2',
    date: '2026-09-15',
    title: 'Woono in first person, new avatars and JJS Stuff',
    changes: [
      {
        type: 'new',
        text: 'JJS Stuff: a searchable reference of Jujutsu Shenanigans info: sound IDs, animations, VFX presets and more.',
      },
      {
        type: 'improved',
        text: 'Uno is now Woono (search still finds it either way).',
      },
      {
        type: 'new',
        text: 'Woono is played first person from your own seat now: hover or tap a card to lift it, tap again to play it.',
      },
      {
        type: 'new',
        text: 'Sparks, shockwaves, wild-colour washes, pop-ups and screen shake when the big cards land, plus fireworks for the winner.',
      },
      {
        type: 'new',
        text: 'On phones you can tilt to look around the table, and the table itself is always a clean 16:9.',
      },
      {
        type: 'improved',
        text: 'Another avatar redo: chibi sketchbook doodles with new hair, half-lidded eyes and better arms.',
      },
      {
        type: 'new',
        text: 'Robot avatars for computer players, each with its own tech-pun name.',
      },
    ],
  },
  {
    version: '1.0.1',
    date: '2026-09-14',
    title: 'Offline mode and a new home page',
    changes: [
      {
        type: 'new',
        text: 'Woogi Tools now works offline after your first visit, and quietly updates itself when you’re back online.',
      },
      { type: 'new', text: 'This Updates page.' },
      {
        type: 'new',
        text: 'A new home page: search opens a hand of cards you can flip through, plus a full grid alongside it.',
      },
      {
        type: 'new',
        text: 'A whole Fun category of games: Chess, Snake and Woono, playable solo, against friends, or with computer players.',
      },
      {
        type: 'new',
        text: 'Every game has a proper lobby, chat, a customisable avatar, and picture-in-picture so you can keep playing in a small window while you browse.',
      },
      { type: 'new', text: 'A full screen button on every tool.' },
      {
        type: 'improved',
        text: 'Game lobbies use the full width of the page, and the search bar’s hand of cards runs a lot smoother.',
      },
      {
        type: 'removed',
        text: 'All-caps labels, and YouTube Downloader (needed a server, which doesn’t work on a static site).',
      },
      {
        type: 'fixed',
        text: 'Offline mode is now actually offline; it didn’t work at all before.',
      },
      {
        type: 'new',
        text: 'Timestamp Converter, with ready-to-paste Discord timestamp codes.',
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-09-14',
    title: 'First release',
    changes: [
      {
        type: 'new',
        text: 'Around forty small tools across Design, Dev, Files, Math, Text and more, with favourites, Quick Notes and a command palette.',
      },
    ],
  },
];

export const APP_VERSION = CHANGELOG[0].version;
