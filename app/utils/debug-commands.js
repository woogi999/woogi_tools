// Debug (operator) mode for the games, run from chat.
//
// The host types /debug to switch it on; the whole room is told. After that the host,
// and anyone the host gives access with /op, can run commands. Every command runs
// on the host, which owns the real game. What a command shows (a hand, the deck)
// goes only to whoever ran it; anything that changes the game is announced to everyone.
//
// Games add their own commands with room.setDebugTools({ commands, snapshot, restore, describe }):
//   commands: { name: { usage, help, run(args, ctx) -> reply text | void, changes: true if it changes the game } }
//   snapshot(): a copy of the game, restore(copy): puts it back (for /undo)
//   describe(): a short line about the game, for /status
//
// ctx: { reply(text), announce(text), player(ref) -> index (throws if unknown), players(), from, fromName, room, record(label) }

const HISTORY = 80;

export class CommandError extends Error {}

// Splits "give bob "red 5" x2" into words, keeping quoted parts together.
export function tokenize(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(text))) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}

export class DebugConsole {
  enabled = false;
  ops = new Set();
  history = []; // [{ id, label, at, snap }]
  seq = 0;
  tools = null;

  constructor(room) {
    this.room = room;
  }

  // A snapshot of the game after something happened, for /undo. Skipped when nothing's registered.
  record(label) {
    // Only kept while debug mode is on, so ordinary games don't hold dozens of copies.
    if (!this.enabled || !this.tools?.snapshot) return;
    const snap = this.tools.snapshot();
    if (snap === null || snap === undefined) return;
    this.history.push({ id: ++this.seq, label: String(label ?? 'Change').slice(0, 80), at: Date.now(), snap });
    if (this.history.length > HISTORY) this.history.shift();
  }

  clearHistory() {
    this.history = [];
  }

  builtins() {
    return {
      help: { usage: '/help [command]', help: 'Lists every command, or explains one.', run: (args, ctx) => this.help(args, ctx) },
      debug: { usage: '/debug [on|off]', help: 'Host only: turns debug mode on or off for the room.', run: () => '' },
      status: { usage: '/status', help: 'Debug mode, who has access, and the game at a glance.', run: (args, ctx) => this.status(ctx) },
      op: {
        usage: '/op <player>',
        help: 'Host only: lets a player use debug commands too.',
        hostOnly: true,
        run: (args, ctx) => {
          const member = this.member(args.join(' '));
          if (member.isHost) return `${member.name} is the host and already has access.`;
          this.ops.add(member.id);
          this.room.syncDebug();
          ctx.announce(`${ctx.fromName} gave ${member.name} debug access.`);
          this.room.whisper(member.id, 'You have debug access now. Type /help to see what you can do.');
          return '';
        },
      },
      deop: {
        usage: '/deop <player>',
        help: 'Host only: takes a player’s debug access away.',
        hostOnly: true,
        run: (args, ctx) => {
          const member = this.member(args.join(' '));
          if (!this.ops.delete(member.id)) return `${member.name} didn’t have debug access.`;
          this.room.syncDebug();
          ctx.announce(`${ctx.fromName} took debug access away from ${member.name}.`);
          return '';
        },
      },
      ops: { usage: '/ops', help: 'Who can use debug commands.', run: () => this.opsText() },
      history: {
        usage: '/history [count]',
        help: 'The saved game states you can go back to, newest last.',
        run: (args) => {
          if (!this.tools?.snapshot) return 'This game doesn’t keep states to go back to.';
          const count = Math.max(1, Math.min(40, Number(args[0]) || 12));
          if (!this.history.length) return 'Nothing saved yet.';
          const now = Date.now();
          return this.history
            .slice(-count)
            .map((h) => `#${h.id}  ${h.label}  (${Math.round((now - h.at) / 1000)}s ago)`)
            .join('\n');
        },
      },
      undo: {
        usage: '/undo [steps | #id]',
        help: 'Puts the game back a number of steps (1 by default), or to a state from /history.',
        run: (args, ctx) => {
          if (!this.tools?.restore) return 'This game can’t be undone.';
          if (this.history.length < 2) return 'Nothing to undo yet.';
          let index;
          const arg = args[0];
          if (arg?.startsWith('#')) {
            index = this.history.findIndex((h) => h.id === Number(arg.slice(1)));
            if (index < 0) throw new CommandError(`No saved state ${arg}. See /history.`);
          } else {
            const steps = Math.max(1, Number(arg) || 1);
            index = Math.max(0, this.history.length - 1 - steps);
          }
          const target = this.history[index];
          this.history = this.history.slice(0, index + 1);
          this.tools.restore(structuredClone(target.snap));
          ctx.announce(`${ctx.fromName} rewound the game to #${target.id}: ${target.label}.`);
          return '';
        },
      },
    };
  }

  commands() {
    return { ...this.builtins(), ...(this.tools?.commands ?? {}) };
  }

  help(args, ctx) {
    const all = this.commands();
    if (args[0]) {
      const name = args[0].replace(/^\//, '').toLowerCase();
      const command = all[name];
      if (!command) throw new CommandError(`No command called /${name}.`);
      return `${command.usage}\n${command.help}`;
    }
    const lines = Object.entries(all)
      .filter(([, c]) => !c.hostOnly || ctx.isHost)
      .map(([, c]) => `${c.usage}  ${c.help}`);
    return `Debug commands (players are a seat number, a name, or "me"):\n${lines.join('\n')}`;
  }

  status(ctx) {
    const lines = [`Debug mode is ${this.enabled ? 'on' : 'off'}.`, this.opsText()];
    const game = this.tools?.describe?.();
    if (game) lines.push(game);
    if (ctx.isHost && this.history.length) lines.push(`${this.history.length} saved states (see /history).`);
    return lines.join('\n');
  }

  opsText() {
    const names = this.room.members.filter((m) => m.isHost || this.ops.has(m.id)).map((m) => (m.isHost ? `${m.name} (host)` : m.name));
    return `Debug access: ${names.join(', ')}.`;
  }

  // A room member from a name (or the start of one) or a lobby number.
  member(ref) {
    const members = this.room.members;
    const text = String(ref ?? '').trim().toLowerCase();
    if (!text) throw new CommandError('Say which player.');
    const n = Number(text);
    if (Number.isInteger(n) && members[n - 1]) return members[n - 1];
    const exact = members.find((m) => m.name.toLowerCase() === text);
    const partial = members.filter((m) => m.name.toLowerCase().startsWith(text));
    if (exact) return exact;
    if (partial.length === 1) return partial[0];
    throw new CommandError(partial.length ? `More than one player starts with “${ref}”.` : `No one in the room called “${ref}”.`);
  }

  // Runs a command typed by `from`. Returns nothing; replies go to them, announcements to all.
  run(text, from) {
    const room = this.room;
    const words = tokenize(text.trim().replace(/^\//, ''));
    const name = (words.shift() ?? '').toLowerCase();
    const isHost = from === room.selfId;
    const fromName = room.members.find((m) => m.id === from)?.name ?? 'Someone';
    const reply = (message) => message && room.whisper(from, message);
    const announce = (message) => room.postChat({ system: true, debug: true, text: `🛠 ${message}` });

    if (name === 'debug') {
      if (!isHost) return reply('Only the host can switch debug mode on or off.');
      const want = words[0] ? !/^(off|0|false|no)$/i.test(words[0]) : !this.enabled;
      if (want === this.enabled) return reply(`Debug mode is already ${want ? 'on' : 'off'}.`);
      this.enabled = want;
      if (!want) this.ops.clear();
      else if (!this.history.length) this.record('Debug mode switched on');
      room.syncDebug();
      announce(want ? `${fromName} switched on debug mode. Type /help to see the commands.` : `${fromName} switched off debug mode.`);
      return;
    }
    if (!this.enabled) return reply(isHost ? 'Debug mode is off. Type /debug to switch it on.' : 'Debug mode is off. Only the host can switch it on.');
    if (!isHost && !this.ops.has(from)) return reply('You don’t have debug access. The host can give it with /op.');

    const command = this.commands()[name];
    if (!command) return reply(`Unknown command /${name}. Try /help.`);
    if (command.hostOnly && !isHost) return reply(`Only the host can use /${name}.`);

    const ctx = {
      room,
      from,
      fromName,
      isHost,
      reply,
      announce,
      record: (label) => this.record(label),
      player: (ref) => {
        const players = this.tools?.players?.() ?? [];
        const text = String(ref ?? '').trim().toLowerCase();
        if (!text) throw new CommandError('Say which player (a seat number, a name, or "me").');
        if (text === 'me') {
          const mine = players.findIndex((p) => p.id === from);
          if (mine < 0) throw new CommandError('You’re not playing in this game.');
          return mine;
        }
        const n = Number(text);
        if (Number.isInteger(n) && players[n - 1]) return n - 1;
        const exact = players.findIndex((p) => p.name.toLowerCase() === text);
        if (exact >= 0) return exact;
        const partial = players.map((p, i) => [p, i]).filter(([p]) => p.name.toLowerCase().startsWith(text));
        if (partial.length === 1) return partial[0][1];
        throw new CommandError(partial.length ? `More than one player starts with “${ref}”.` : `No player called “${ref}”. Seats: ${players.map((p, i) => `${i + 1} ${p.name}`).join(', ')}.`);
      },
    };

    reply(`> /${[name, ...words].join(' ')}`);
    try {
      const result = command.run(words, ctx);
      if (typeof result === 'string') reply(result);
    } catch (error) {
      if (error instanceof CommandError) reply(error.message);
      else {
        console.error(error);
        reply(`That didn’t work: ${error.message}`);
      }
    }
  }
}
