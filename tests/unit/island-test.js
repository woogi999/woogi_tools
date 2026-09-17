import { module, test } from 'qunit';
import {
  terrainField,
  maskReader,
  SEA_LEVEL,
  MIN_BEACH,
} from 'woogi-tools/lazy/island-world';
import { snakeObstacles, mineLayout } from 'woogi-tools/utils/levels';

// The island is a heightfield worked out from the squares, and the sea reads
// its shoreline from the same field. What matters is checked here directly:
// land under every square you can play on, sea where you cut the board, a
// pond where you dug one, all without a single one of them being eyeballed.
module('Unit | island', function () {
  const centre = (field, x, y) => [
    x + 0.5 - field.width / 2,
    y + 0.5 - field.depth / 2,
  ];

  test('every square of a plain board has dry land under it', function (assert) {
    for (const [width, depth] of [
      [20, 20],
      [12, 30],
      [40, 8],
    ]) {
      for (let seed = 1; seed <= 12; seed++) {
        const field = terrainField({ width, depth, seed });
        for (const [x, y] of [
          [0, 0],
          [width - 1, 0],
          [0, depth - 1],
          [width - 1, depth - 1],
          [Math.floor(width / 2), Math.floor(depth / 2)],
        ]) {
          const h = field.heightAt(...centre(field, x, y));
          assert.ok(
            Math.abs(h) < 1e-4,
            `${width}x${depth} seed ${seed}: square ${x},${y} is at ground level (was ${h})`,
          );
        }
        // Just outside the corner there is still beach, never straight sea.
        const [cx, cz] = centre(field, width - 1, depth - 1);
        const h = field.heightAt(cx + MIN_BEACH * 0.7, cz + MIN_BEACH * 0.7);
        assert.ok(h > SEA_LEVEL, `seed ${seed}: a beach past the corner`);
      }
    }
  });

  test('cutting the board in two leaves sea between the halves', function (assert) {
    const width = 20;
    const depth = 20;
    // Columns 8 to 11 are sea: two islands, ten squares apart is plenty.
    const land = Array.from({ length: width * depth }, (_, i) => {
      const x = i % width;
      return x < 8 || x > 11;
    });
    const field = terrainField({ width, depth, land, seed: 5 });
    const [mx, mz] = centre(field, 10, 10);
    assert.ok(
      field.heightAt(mx - 0.5, mz) < SEA_LEVEL,
      'the channel between them is under water',
    );
    assert.ok(field.shoreAt(mx - 0.5, mz) > 0, 'and the sea knows it is sea');
    for (const x of [7, 12]) {
      const [lx, lz] = centre(field, x, 10);
      assert.ok(
        Math.abs(field.heightAt(lx, lz)) < 1e-4,
        `square ${x} on the bank is still land`,
      );
      assert.ok(field.shoreAt(lx, lz) < 0, 'and the sea knows it is land');
    }
  });

  test('a water square is a pond with sea in it, not a painted tile', function (assert) {
    const width = 12;
    const depth = 12;
    const water = Array(width * depth).fill(false);
    water[6 * width + 6] = true;
    const field = terrainField({ width, depth, water, seed: 2 });
    const [wx, wz] = centre(field, 6, 6);
    assert.ok(
      field.heightAt(wx, wz) < SEA_LEVEL,
      'the middle of the square is below the waterline',
    );
    assert.ok(field.shoreAt(wx, wz) > 0, 'so the sea breaks there');
    for (const [dx, dz] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const h = field.heightAt(wx + dx, wz + dz);
      assert.ok(
        Math.abs(h) < 1e-4,
        `the square next door (${dx},${dz}) is dry`,
      );
    }
  });

  // The Level Editor hands its shapes over as strings, because a string is
  // cheap to compare against the last one. Read as flags rather than as
  // characters, '0' is truthy, which is exactly why cut-out squares used to be
  // painted over as if nothing had been cut out at all.
  test('a shape reads the same whether it arrives as flags or as text', function (assert) {
    const flags = [true, false, true, false];
    const text = '1010';
    for (const read of [maskReader(flags), maskReader(text)]) {
      assert.true(read(0), 'first square is on the board');
      assert.false(read(1), 'second square is cut out');
      assert.true(read(2));
      assert.false(read(3));
    }
    assert.strictEqual(
      maskReader(null),
      null,
      'no shape means nothing to read',
    );
  });

  // Sea, beach and water shape the board. None of them is a rock, and none of
  // them is somewhere to play.
  test('shaping the island keeps the rules straight', function (assert) {
    const snake = {
      game: 'snake',
      name: 'Shapes',
      width: 8,
      height: 8,
      cells: 'r~sw....' + '.'.repeat(56),
    };
    assert.deepEqual(
      snakeObstacles(snake),
      [[0, 0, 'rock']],
      'only the rock is an obstacle; the shapes go through the mask',
    );
    const laid = mineLayout({
      ...snake,
      game: 'mines',
      cells: 'm~sw....' + '.'.repeat(56),
    });
    assert.deepEqual(
      laid.mask.slice(0, 4),
      [true, false, false, false],
      'sea, beach and water are all off the board',
    );
    assert.deepEqual(
      laid.land.slice(0, 4),
      [true, false, true, true],
      'but only the sea has no island',
    );
    assert.deepEqual(
      laid.water.slice(0, 4),
      [false, false, false, true],
      'and only the water is a pond',
    );
  });
});
