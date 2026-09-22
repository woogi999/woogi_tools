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
    version: '1.0.16',
    date: '2026-09-23',
    title: 'A new OSINT section',
    changes: [
      {
        type: 'new',
        text: 'OSINT: a new category for finding things out from public sources. The IP Address Lookup and Domain Lookup have moved into it from Developer.',
      },
      {
        type: 'new',
        text: 'Username Search: see which of nearly 300 sites, from Instagram, TikTok, X and Discord to small forums, have an account under a name, the way Sherlock does it.',
      },
      {
        type: 'new',
        text: 'Breach Check: type an email, a password or both and get one report: every breach the email is in, from XposedOrNot and LeakCheck merged and filled in from Have I Been Pwned, and whether the password has leaked (without it leaving your device).',
      },
      {
        type: 'new',
        text: 'Photo Metadata: the GPS location, camera, owner and every other tag hidden in a photo, read in your browser.',
      },
      {
        type: 'new',
        text: 'Email Header Analyzer: the route an email took, its SPF, DKIM and DMARC results, and warnings for a spoofed sender.',
      },
      {
        type: 'new',
        text: 'Subdomain Finder: every subdomain that has had an HTTPS certificate, from the certificate-transparency logs.',
      },
      {
        type: 'new',
        text: 'Wayback Snapshots: every day the Internet Archive saved a page, laid out by year.',
      },
      {
        type: 'new',
        text: 'Recon Sweep: one domain in, every source above run at once, and the results drawn as a graph you can click through, SpiderFoot- and Maltego-style.',
      },
    ],
  },
  {
    version: '1.0.15',
    date: '2026-09-23',
    title: 'The Stem Extractor gets a real model',
    changes: [
      {
        type: 'improved',
        text: 'Audio Stem Extractor: it now runs UVR\u2019s MDX-Net, an actual source-separation network, on your own graphics card. The old mode compared the left and right channels and hoped the vocal was centred; this one was trained on music and is a different class of result \u2014 roughly 9.5 dB against about 5. The weights are 64 MB, downloaded once from Hugging Face and kept by your browser afterwards, and your music still never leaves the page.',
      },
      {
        type: 'improved',
        text: 'Stem Extractor: there is now a choice of engine rather than one take-it-or-leave-it mode. Instant is the old arithmetic one \u2014 no download, a few seconds, all four parts, and rough. Good is the model. If your browser has no WebGPU the model modes are hidden rather than offered and then failing, and the page says why.',
      },
      {
        type: 'fixed',
        text: 'Stem Extractor: the transform underneath was wrong for window sizes that are not a power of two, which is exactly the size MDX-Net uses (6144). It did not fail \u2014 it quietly produced garbage \u2014 so the code now falls back to Bluestein\u2019s algorithm for those sizes, and there is a node check that compares it against a brute-force transform so it cannot drift back.',
      },
    ],
  },
  {
    version: '1.0.14',
    date: '2026-09-22',
    title:
      'Seven new tools, a File Compressor that means it, and video in the Background Remover',
    changes: [
      {
        type: 'new',
        text: 'File Compressor: the one you wanted when you typed "compressor". Tell it how many MB you need and your photo, song or clip comes back that size \u2014 pictures are re-encoded over and over until one lands just under your number, and video and audio get a bitrate worked out from how long they run. Or skip the number and just pick how hard to squeeze.',
      },
      {
        type: 'new',
        text: 'Timezone Converter: line up as many places as you like, pin a moment or follow the clock, and see it on everyone\u2019s wall at once. The strip along each row is the next 24 hours where they are \u2014 find a column that\u2019s green all the way down and that\u2019s your meeting.',
      },
      {
        type: 'new',
        text: 'SVG Optimizer: icons come out of Figma, Illustrator and Inkscape carrying metadata, wrapper groups and ten decimal places on every coordinate. This takes it out, shows you both versions side by side so you can see nothing broke, and every step is a switch you can turn off.',
      },
      {
        type: 'new',
        text: 'Auto-trace: turn a photo, a logo or a scribble into a real SVG you can blow up as big as you like. It finds the shapes, fits curves to them, and runs the result through the SVG Optimizer before handing it over.',
      },
      {
        type: 'new',
        text: 'Fake Data Generator: rows of realistic-looking nonsense for filling a mockup or a test database, as JSON, CSV, SQL, NDJSON or a Markdown table. The same seed always gives the same rows, so a fixture you generate today you can generate again next year. None of it can reach a real person: the emails, phone numbers, IPs and card numbers all come from the ranges reserved for exactly this.',
      },
      {
        type: 'new',
        text: 'Regex Library: 38 regexes worth copying, each one explained, in six languages, with the cases it quietly misses written down \u2014 because most regex lists hand you a pattern nobody has ever run. Every entry carries samples it should and shouldn\u2019t match and the page runs them as you read, so if one ever stops behaving, it says so rather than lying.',
      },
      {
        type: 'new',
        text: 'Audio Stem Extractor: split a song into vocals, instrumental, drums and bass \u2014 acapellas and karaoke tracks, made on your own machine with no model to download and nothing uploaded. It works by comparing the left and right channels (a lead vocal is almost always panned dead centre) and by telling drum hits from held notes on a spectrogram. It isn\u2019t Demucs: a mono recording or an off-centre vocal won\u2019t separate, and heavy reverb bleeds.',
      },
      {
        type: 'improved',
        text: 'Background Remover: now does video as well. Drop in a clip and it runs the same cutout over every frame, handing back a see-through WebM, an MP4 on a green screen for editors that won\u2019t take an alpha channel, or the frames as PNGs in a zip. Clips are capped at 20 seconds, because it really is the model running once per frame.',
      },
      {
        type: 'improved',
        text: 'The old File Compressor is now the File Archiver, which is what it always actually was: zip and 7z archives, unpacking (rar included), and single files through gzip, brotli or zstd. Nothing about it changed except the name and where it sits \u2014 "compressor" now means the tool that makes your file smaller in MB.',
      },
    ],
  },
  {
    version: '1.0.13',
    date: '2026-09-22',
    title:
      'The Video Editor, and File Share that connects on locked-down networks',
    changes: [
      {
        type: 'new',
        text: 'Video Editor: a motion-graphics editor that runs in the page. Scenes, layers and a real timeline, keyframes with easing you can drag by hand, parenting and mattes, 145 effects, and a render straight out to a video file. Nothing is uploaded; it all happens on your own machine.',
      },
      {
        type: 'fixed',
        text: 'Translator: it said "the translator is busy right now" almost every time. It was asking Google through an endpoint that turns away shared addresses, which is what the site talks from, so the answer was nearly always a refusal. It now uses one that does not, and if that ever fails your browser quietly asks Google itself.',
      },
      {
        type: 'fixed',
        text: 'File Share: it would not connect on a lot of networks. The public relay it fell back on when two devices could not reach each other directly had quietly shut down, so there was nothing behind the fallback at all. When a direct link is not possible the files now pass through this site instead, over an ordinary web connection, which also gets through school, office and hotel networks that block the kind of traffic the old relay needed. Direct is still tried first, and nothing is stored either way.',
      },
    ],
  },
  {
    version: '1.0.12',
    date: '2026-09-19',
    title: 'A dozen more tools, archives in the compressor, and the Darkroom',
    changes: [
      {
        type: 'new',
        text: 'Astrology Profile: sun, moon and rising signs, the planets in their houses, birthstone, flower, colour, Chinese zodiac and more, from your date, time and place of birth.',
      },
      {
        type: 'new',
        text: 'Text to Speech: any text read aloud in a natural voice or the flat robot of the old free TTS sites, and subtitle files read cue by cue, to their timings if you like.',
      },
      {
        type: 'new',
        text: 'Webcam Recorder: record video from your camera, pause and resume, take photos, and save the lot.',
      },
      {
        type: 'new',
        text: 'QR & Barcode Scanner: read QR codes and barcodes with the camera or from a picture.',
      },
      {
        type: 'new',
        text: 'Disposable Emails: a throwaway address at temp.woogi.xyz that lasts an hour, with the inbox on the page.',
      },
      {
        type: 'new',
        text: 'Shoe Size Finder & Converter: your size from a foot measurement, and US, UK and EU sizes converted for men, women and kids.',
      },
      {
        type: 'new',
        text: 'Domain Lookup: who a domain is registered to, when it runs out, and its DNS records.',
      },
      {
        type: 'new',
        text: 'Unlock PDF: take the password or the printing and copying restrictions off a PDF and get the same file back.',
      },
      {
        type: 'new',
        text: 'Calendar: a month view with repeating events, colours, an .ics export, and a link from any event to one of your Quick Notes.',
      },
      {
        type: 'new',
        text: 'Timer & Alarm, and a Stopwatch with laps. Both carry on while you use the rest of the site.',
      },
      {
        type: 'new',
        text: 'Roman Numerals Converter: numbers to numerals and back, with the working shown.',
      },
      {
        type: 'improved',
        text: 'File Compressor: pack several files into a zip or 7z, and open zip, 7z and rar archives. (RAR can only be opened: only WinRAR may write the format.)',
      },
      {
        type: 'improved',
        text: 'Image Editor is now called Image Darkroom.',
      },
    ],
  },
  {
    version: '1.0.11',
    date: '2026-09-19',
    title:
      'Eight new tools, a proper crop box, and pictures in your Word files',
    changes: [
      {
        type: 'new',
        text: 'Colour Blindness Test: nine plates of dots hiding numbers, with a read on your red-green and blue-yellow vision at the end.',
      },
      {
        type: 'new',
        text: 'Palette: roll colours that go together in the harmony you pick, lock the keepers, edit any hex, and save palettes to a collection.',
      },
      {
        type: 'new',
        text: 'Palette Extractor: pull the main colours out of any picture, biggest first, and copy them or save them to your palettes.',
      },
      {
        type: 'new',
        text: 'Audio Recorder: record from the microphone with a live level meter, pause and resume, then play back and save.',
      },
      {
        type: 'new',
        text: 'Compass & Altitude: a compass that turns with your phone, plus your altitude, coordinates and accuracy from its GPS.',
      },
      {
        type: 'new',
        text: 'Reaction Time Test: wait for green, click as fast as you can, five goes to a score, with your best runs kept.',
      },
      {
        type: 'new',
        text: 'Roblox Asset Viewer: paste an asset ID or link to play its audio, see its image, or turn its 3D model around.',
      },
      {
        type: 'new',
        text: 'Baybayin Translator: Tagalog into the old Philippine script and back, with your choice of how to write a final consonant.',
      },
      {
        type: 'improved',
        text: 'Image Cropper: the crop is now a box drawn over the whole picture. Custom lets you pull any side or corner; every preset keeps its shape and lets you scale it from a corner and drag it about.',
      },
      {
        type: 'improved',
        text: 'Aspect Ratio: a link button between width and height, so changing one scales the other and keeps the ratio.',
      },
      {
        type: 'fixed',
        text: 'File Converter: a PDF turned into a Word file (or HTML) now keeps its pictures, in place.',
      },
      {
        type: 'fixed',
        text: 'Home page: a file dropped on the search bar now comes along when you click any tool, not only one in the search results.',
      },
    ],
  },
  {
    version: '1.0.10',
    date: '2026-09-19',
    title: 'A translator, and a front page that stays put',
    changes: [
      {
        type: 'new',
        text: 'Translator: type on the left and the translation appears on the right, in any of more than a hundred languages, with the source language detected for you and a button to hear either side read aloud. The translating is done by Google Translate through this site’s own Worker.',
      },
      {
        type: 'improved',
        text: 'Home page: results appear when you press Enter rather than as you type, the tools below no longer re-deal themselves when you clear a search, the categories stay pinned while you scroll the tools, and picking a small category no longer shortens the page under you.',
      },
      {
        type: 'removed',
        text: 'The chat on the home page is gone, along with its model download.',
      },
    ],
  },
  {
    version: '1.0.9',
    date: '2026-09-19',
    title: 'A new front page and a tidier offline copy',
    changes: [
      {
        type: 'new',
        text: 'Drop a file on the home search bar (or pick one with the paperclip) and you get every tool that can take that sort of file, the best fit first. Typing narrows them down further, and the tool you pick opens with the file already loaded.',
      },
      {
        type: 'improved',
        text: 'The home page opens on the search alone and snaps to the tools when you scroll, with the sidebar logo and search box popping in step; the cards are dealt onto the page as you scroll down to them and slip away as they leave.',
      },
      {
        type: 'fixed',
        text: 'The offline copy no longer piles up old versions: a new build clears every older one, a download that fails part way clears up after itself, and files the build precaches are not kept twice.',
      },
      {
        type: 'fixed',
        text: 'Games: watching a room no longer takes up a seat, so a four-player game with a spectator still fits four players. A spectator can only come back to play while a seat is free.',
      },
    ],
  },
  {
    version: '1.0.8',
    date: '2026-09-18',
    title:
      'Woonopoly, an address lookup, a mannequin poser, and a chat nobody hosts',
    changes: [
      {
        type: 'new',
        text: 'Woonopoly: our take on the property-trading board game, on a 3D city board with your avatars walking round it as the tokens, buildings that grow as you build, and a camera that follows the action or pulls up to a map. Up to eight players, online or against the computer, with auctions, trades, mortgages, houses and hotels, jail, Chance and Treasure Chest cards, and Woobux counted in pesos. The lobby sets the starting money, the GO salary, a turn timer, the win condition (last one standing, a number of rounds, a share of the board, a house count or a cash target) and the house rules: Free Parking jackpot, double salary on GO, a housing shortage, quick start, everything to auction, doubles rules, how jail works (doubles, a fixed sentence, a term, and whether it freezes your rent, auctions and trades) and arson, where you torch the biggest landlord’s property instead of paying rent and go to jail owing them a quarter of its price.',
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
