// Names for computer players in every game: robot, AI and tech puns.
// Picked from a seed the host keeps in the room's settings, so everyone in a
// lobby sees the same names, and no two bots at one table share a name.

export const BOT_NAMES = [
  'Al Gorithm',
  'Sir Byte-a-Lot',
  'Wi-Fiona',
  'Ctrl-Alt-Elite',
  'Dee Bugger',
  'Cy Borg',
  'Mega Byte',
  'Anna Log',
  'Rusty Bolts',
  'Sprocket Science',
  'Cache Money',
  'Pixel Pete',
  'Captcha Jack',
  'Boolean Bill',
  'Glitch Witch',
  'Ping Pong',
  'Nate Found 404',
  'Kilobyte Kyle',
  'Overclocked Olga',
  'Beep Boop Betty',
  'Motherboard Mary',
  'Upload Lloyd',
  'Ram Rodriguez',
  'Tin Can Stan',
  'Cookie Monitor',
  'Hard Drive Harriet',
  'Dot Matrix',
  'Lagatha',
  'Syntax Sam',
  'Bluetooth Ruth',
  'Chip Chatwell',
  'Neural Norma',
  'Webb Crawler',
  'Terra Flops',
  'Firmware Fred',
  'Emoji Bot-ton',
  'Beta Tessa',
  'Cloud Clawdia',
  'Patch Adams-Bot',
  'Lord Voltemort',
  'Robo Coppola',
  'Bitsy Buffer',
  'Servo Serena',
  'Ohm Sweet Ohm',
  'Artie Ficial',
  'Nano Nanette',
  'Dial-Up Dan',
  'Captain Crashcode',
];

// A small, fast PRNG (mulberry32), so a seed always gives the same sequence.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newBotSeed = () => Math.floor(Math.random() * 0xffffffff);

// `count` different names, the same ones for the same seed.
export function botNames(seed, count) {
  const random = seededRandom(Number(seed) || 1);
  const pool = [...BOT_NAMES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
}
