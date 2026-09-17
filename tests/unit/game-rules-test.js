import { module, test } from 'qunit';
import {
  createGame as createMines,
  dig,
  tick,
  DEATH_MODES,
} from 'woogi-tools/utils/minesweeper';
import { createGame as createSnake } from 'woogi-tools/utils/snake';

// Puts a mine under `id` and sets it off, returning that player.
function blowUp(state, id) {
  tick(state, 2000); // finish the drop
  dig(state, id, 5, 5); // the first dig is what lays the mines
  const at = state.mines.findIndex((mine, i) => mine && state.cells[i] === -1);
  dig(state, id, at % state.width, Math.floor(at / state.width));
  return state.players.find((p) => p.id === id);
}

module('Unit | game rules', function () {
  // Each computer player carries its own difficulty, set per seat in the lobby.
  // The room-wide setting is still the fallback, so a room saved before that
  // existed behaves exactly as it did.
  test('computer players keep their own difficulty', function (assert) {
    const seats = [
      { id: 'a', name: 'You' },
      { id: 'b', name: 'Easy', bot: true, botLevel: 'easy' },
      { id: 'c', name: 'Hard', bot: true, botLevel: 'hard' },
      { id: 'd', name: 'Default', bot: true },
    ];

    const mines = createMines(seats, { botLevel: 'normal' });
    assert.strictEqual(
      mines.players[1].botLevel,
      'easy',
      'mines: per-seat easy',
    );
    assert.strictEqual(
      mines.players[2].botLevel,
      'hard',
      'mines: per-seat hard',
    );
    assert.strictEqual(
      mines.players[3].botLevel,
      null,
      'mines: an untouched seat falls back to the room setting',
    );

    const snake = createSnake(seats, { botLevel: 'normal' });
    assert.strictEqual(
      snake.snakes[1].botLevel,
      'easy',
      'snake: per-seat easy',
    );
    assert.strictEqual(
      snake.snakes[2].botLevel,
      'hard',
      'snake: per-seat hard',
    );
    assert.strictEqual(snake.snakes[3].botLevel, null, 'snake: falls back');

    // A level that isn't one of the real ones is ignored rather than trusted.
    const odd = createMines([
      { id: 'x', name: 'X', bot: true, botLevel: 'impossible' },
    ]);
    assert.strictEqual(odd.players[0].botLevel, null, 'unknown level ignored');
  });

  test('every death mode is offered and does what it says', function (assert) {
    assert.deepEqual(
      DEATH_MODES.map((m) => m.id),
      ['out', 'respawn', 'lives'],
      'the three modes',
    );

    const players = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', bot: true },
    ];

    // Out for good: one mine ends your game.
    const out = createMines(players, { stunOnly: false, deathMode: 'out' });
    assert.true(blowUp(out, 'a').dead, 'out: dead for good');

    // Respawn: you go down, then come back where you started.
    const back = createMines(players, {
      stunOnly: false,
      deathMode: 'respawn',
    });
    const downed = blowUp(back, 'a');
    assert.false(downed.dead, 'respawn: not out for good');
    assert.true(downed.downMs > 0, 'respawn: down for a while');
    tick(back, downed.downMs + 10);
    assert.strictEqual(downed.downMs, 0, 'respawn: back up');
    assert.deepEqual(
      [downed.x, downed.y],
      downed.spawn,
      'respawn: back at its corner',
    );

    // Lives: a set number of mines before you are out for good.
    const lives = createMines(players, {
      stunOnly: false,
      deathMode: 'lives',
      lives: 2,
    });
    const player = blowUp(lives, 'a');
    assert.strictEqual(player.livesLeft, 1, 'lives: one spent');
    assert.false(player.dead, 'lives: still in it');
  });
});
