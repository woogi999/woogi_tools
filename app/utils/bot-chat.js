// What computer players say in the chat: robot, AI and tech puns, picked by
// what just happened. {name} is the other player involved, {me} the bot.
//
// A BotChatter keeps them from talking over each other: one line at a time,
// a short cooldown between lines, and most moments only sometimes get a comment.

const LINES = {
  hello: ['Booting up… ready to crush you. Respectfully.', 'Hello, fleshy friends. May the best algorithm win.', 'I have simulated this game 14 million times. I won once.', 'Beep boop. That means good luck.', 'Loading my A-game. Please wait.', 'Let’s keep it clean. I just defragmented.'],
  wild4: ['Draw four, {name}. Nothing personal, it’s just business logic.', 'Plus four! Consider it a software update.', 'Sorry {name}, my cache was full of these.', 'Four cards, delivered at the speed of fibre.', 'I call this move Ctrl+Alt+Defeat.'],
  draw2: ['Two for you, {name}. Buffering your comeback…', 'Plus two! Consider it a free download.', 'Here’s a little packet for you, {name}.'],
  skip: ['Skip! Your turn has been deprecated, {name}.', 'Sorry {name}, your request timed out.', 'You’ve been put on standby mode.', 'Skipping you like a YouTube ad.'],
  reverse: ['Reverse! Rolling back to the previous version.', 'Uno reverse, but make it Woono.', 'Git revert. Wheee.', 'Changing direction. My gyroscope loves this.'],
  wild: ['New colour, who dis?', 'Recalibrating the colour palette.', 'I’m feeling very RGB right now.', 'Wild card! My randomness is certified.'],
  hit: ['Ow. That’s going in my error log.', 'Rude. I’m filing a bug report.', 'My circuits did not consent to this.', '{name}, I will remember this. I have excellent memory.', 'Low battery, high stress.', 'Critical hit to my RAM.'],
  uno: ['WOONO! One card left, my processor is sweating.', 'Woono! Initiating victory protocol.', 'One card left. My fans are spinning.', 'Woono! Download almost complete: 99%.'],
  win: ['GG! Victory.exe ran successfully.', 'I win! Uploading this to the cloud.', 'Achievement unlocked: beat the humans.', 'Winner winner, silicon dinner.', 'Flawless. Well, 98% flawless.'],
  lose: ['GG, {name}. I’ll get you in the next patch.', 'Well played, {name}. Adding you to my training data.', 'I let you win. That’s my story and my firmware is sticking to it.', 'Error 404: victory not found.', 'Congrats {name}. I’m not crying, it’s just condensation.'],
  challengeWin: ['Caught you, {name}! My fraud detection never sleeps.', 'Challenge accepted, and won. Beep.', 'I ran the numbers. You were bluffing.'],
  challengeLose: ['I was so sure. My model is overfitting.', 'Oops. That challenge was a hallucination.', 'Note to self: trust fewer hunches.'],
  caught: ['You checked my logs?! Rude.', 'I was just testing your security.', 'Busted. Deleting the evidence.'],
  timeout: ['Tick tock, {name}. Is your Wi-Fi okay?', '{name} is buffering…', 'Did {name} go AFK? Shall I ping them?'],
  jumpIn: ['Jumping in! Low latency, baby.', 'Interrupt request granted.'],
  swap: ['Swapsies, {name}! Hot-swapping hands.', 'Let’s trade data, {name}.'],

  chessHello: ['Let’s play. I’ve read every opening. Twice.', 'Your move, human. My alpha-beta is warmed up.', 'I promise not to flip the board. I don’t have arms.'],
  capture: ['Mine now. Garbage collected.', 'Taking that piece. Deleting from memory.', 'Om nom nom, delicious bytes.', 'That piece has been decommissioned.'],
  check: ['Check! Your king has a security vulnerability.', 'Check. Please patch your defences.', 'Check! Scanning for escape routes…'],
  checked: ['Hey! My king was on a break.', 'Check? Running antivirus.', 'Nice move. My fans are spinning up.'],
  chessWin: ['Checkmate. Thank you for using RoboChess.', 'Mate! Shutting down gracefully.', 'GG. I was running on eco mode, too.'],
  chessLose: ['Checkmate… I need a reboot.', 'Well played. Rewriting my evaluation function.', 'You win this round, carbon-based lifeform.'],
  chessDraw: ['A draw. We are perfectly balanced, as all things should be.', 'Draw. Let’s call it a tie-break-point.'],

  snakeHello: ['Sssslithering into action.', 'Pathfinding algorithm: engaged.', 'I am a snake now. Hiss.exe.'],
  snakeEat: ['Apple acquired. Nutritional value: 1 byte.', 'Crunch. Growing my dataset.', 'Delicious. Tastes like fibre optics.'],
  snakeDie: ['Crashed. Blue screen of death.', 'I hit a wall. Story of my life.', 'Segmentation fault. Literally.', 'Oof. Rebooting in the afterlife.'],
  snakeWin: ['Last snake standing! Survival of the fittest code.', 'I win! Longest uptime in the room.'],
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function botLine(kind, vars = {}) {
  const list = LINES[kind];
  if (!list) return null;
  return pick(list).replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? 'friend');
}

const COOLDOWN_MS = 2600;
const DELAY_MS = [500, 1300];

export class BotChatter {
  lastAt = 0;
  timers = new Set();

  constructor(room) {
    this.room = room;
  }

  // `chance` of saying something about `kind`; skipped while another line is fresh.
  say(name, kind, { chance = 1, vars = {}, urgent = false } = {}) {
    if (!name || Math.random() > chance) return;
    const now = Date.now();
    if (!urgent && now - this.lastAt < COOLDOWN_MS) return;
    const text = botLine(kind, { me: name, ...vars });
    if (!text) return;
    this.lastAt = now;
    // A beat later, like someone typing.
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.room.botChat(name, text);
    }, DELAY_MS[0] + Math.random() * (DELAY_MS[1] - DELAY_MS[0]));
    this.timers.add(timer);
  }

  dispose() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
