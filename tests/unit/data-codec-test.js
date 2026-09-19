import { module, test } from 'qunit';
import { FORMATS, compress, decompress } from 'woogi-tools/utils/codec';
import { searchTools } from 'woogi-tools/tools';

module('Unit | data codec', function () {
  test('round-trips unicode text in every format at min and max level', async function (assert) {
    const text = 'héllo wörld 👋 '.repeat(20);
    for (const f of FORMATS) {
      for (const level of [f.min, f.max]) {
        assert.strictEqual(await decompress(await compress(text, f.id, level), f.id), text, `${f.id} @ ${level}`);
      }
    }
  });

  test('rejects garbage input', async function (assert) {
    for (const f of FORMATS) {
      await assert.rejects(decompress('bm90IGNvbXByZXNzZWQ=', f.id), f.id);
    }
  });
});

module('Unit | tool search', function () {
  test('matches keywords and fuzzy typos-by-omission', function (assert) {
    const top = (q) => searchTools(q)[0]?.route;
    assert.strictEqual(top('zstd'), 'data-codec');
    assert.strictEqual(top('hex'), 'color-picker');
    assert.strictEqual(top('qrgen'), 'qr-code');
    assert.strictEqual(top('clr pckr'), 'color-picker');
    assert.strictEqual(top('zodiac'), 'astrology-profile');
    assert.strictEqual(top('sign'), 'astrology-profile');
    assert.strictEqual(top('scorpio'), 'astrology-profile');
    assert.deepEqual(searchTools('xyzzy'), []);
  });
});
