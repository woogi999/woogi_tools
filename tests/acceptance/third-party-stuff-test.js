import { module, test } from 'qunit';
import { visit, click, find, findAll, currentURL } from '../helpers/index.js';
import { setupApplicationTest } from '../helpers/index.js';
import { TOOLS, searchTools } from '../../app/tools.js';

module('Acceptance | third party stuff', function (hooks) {
  setupApplicationTest(hooks);

  test('is a Magnum Opus page, in orange, that lists Arayashiki', async function (assert) {
    await visit('/');
    const card = findAll('.tool-card').find((c) =>
      c
        .querySelector('.tool-card-link')
        ?.textContent.includes('Third Party Stuff'),
    );
    assert.dom(card).hasClass('is-opus');
    const link = findAll('.sidebar-nav .nav-link').find((a) =>
      a.textContent.includes('Third Party Stuff'),
    );
    assert.dom(link).hasClass('is-opus');

    await click(link);
    assert.strictEqual(currentURL(), '/third-party-stuff');
    assert.dom('.hero-title').includesText('Third Party Stuff');
    assert.dom('#arayashiki .tp-name').hasText('Arayashiki');
    assert.dom('.tp-moved').doesNotExist('no note unless an old link sent you');
    const hrefs = findAll('#arayashiki .tp-links a').map((a) => a.href);
    assert.deepEqual(hrefs, [
      'https://github.com/woogi999/arayashiki/releases/latest/download/Arayashiki-Setup.exe',
      'https://github.com/woogi999/arayashiki',
    ]);
  });

  test('old JJS links land here and say the project moved', async function (assert) {
    await visit('/jjs-stuff');
    assert.strictEqual(currentURL(), '/third-party-stuff?from=jjs-stuff');
    assert.dom('.tp-moved').includesText('JJS Stuff has moved');
    assert.dom('.tp-moved').includesText('Arayashiki');

    await click('.tp-moved .qr-icon-btn');
    assert.dom('.tp-moved').doesNotExist('dismissed');
    assert.strictEqual(currentURL(), '/third-party-stuff');

    await visit('/jjs-progress-bar-maker');
    assert.strictEqual(
      currentURL(),
      '/third-party-stuff?from=jjs-progress-bar-maker',
    );
    assert
      .dom('.tp-moved')
      .includesText('The JJS Progress Bar Maker has moved');

    await visit('/qr-code');
    await visit('/third-party-stuff');
    assert.dom('.tp-moved').doesNotExist('the note is for that one visit');
    assert.ok(find('#arayashiki'));
  });

  test('the JJS tools are gone, and a search for them finds this page', function (assert) {
    assert.deepEqual(
      TOOLS.filter((t) => /jjs/i.test(`${t.label} ${t.route}`)),
      [],
    );
    assert.strictEqual(searchTools('jjs')[0].route, 'third-party-stuff');
  });
});
