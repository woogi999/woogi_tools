import { module, test } from 'qunit';
import {
  visit,
  click,
  fillIn,
  waitUntil,
  find,
  findAll,
} from '../helpers/index.js';
import { setupApplicationTest } from '../helpers/index.js';
import { clearAllToolState } from '../../app/utils/tool-state.js';

// The test build is served as static files, so there is no Worker behind
// /api/bunkr and no download backend: fetch is stood in for with what they
// answer.
const FILES = 'https://woogi-downloads.onrender.com/file?t=';
const ALBUM = {
  kind: 'album',
  title: 'Holiday',
  url: 'https://bunkr.cr/a/AbCd1234',
  files: [
    { name: 'beach.jpg', size: 2048, type: 'photo', url: `${FILES}one` },
    { name: 'waves.mp4', size: 4096, type: 'video', url: `${FILES}two` },
  ],
};

module('Acceptance | bunkr downloader', function (hooks) {
  setupApplicationTest(hooks);

  let realFetch;
  let requests;
  let backend;
  hooks.beforeEach(async function () {
    await clearAllToolState();
    requests = [];
    backend = true;
    realFetch = window.fetch;
    window.fetch = async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, method: init.method ?? 'GET', body: init.body });
      const json = (body, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (url === '/api/bunkr' && init.method === 'POST') return json(ALBUM);
      if (url === '/api/bunkr') return json({ backend });
      if (url.startsWith(FILES)) {
        const size = url.endsWith('one') ? 2048 : 4096;
        return new Response(new Uint8Array(size), {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(size),
          },
        });
      }
      return realFetch(input, init);
    };
  });
  hooks.afterEach(function () {
    window.fetch = realFetch;
  });

  test('names the link as you type, and stops bad ones before sending', async function (assert) {
    await visit('/bunkr-downloader');
    assert.dom('.hero-title span').hasText('Bunkr Downloader');
    await fillIn('.dl-form input', 'https://bunkr.cr/a/AbCd1234');
    assert.dom('.vd-detect').hasText('A Bunkr album');

    await fillIn('.dl-form input', 'https://example.com/a/AbCd1234');
    assert.dom('.vd-detect').includesText('isn’t a Bunkr link');
    await click('.dl-form button');
    assert.dom('.tool-error').includesText('isn’t a Bunkr link');
    assert.false(
      requests.some((r) => r.method === 'POST'),
      'nothing was sent for a link the page already knew was wrong',
    );
  });

  test('says so when the download backend isn’t set up', async function (assert) {
    backend = false;
    await visit('/bunkr-downloader');
    await waitUntil(() => find('.vd-sites .tool-error'));
    assert.dom('.vd-sites .tool-error').includesText('isn’t set up');
  });

  test('lists an album and saves its files, one or all', async function (assert) {
    await visit('/bunkr-downloader');
    await fillIn('.dl-form input', 'bunkr.cr/a/AbCd1234');
    await click('.dl-form button');
    await waitUntil(() => find('.vd-result'));
    assert.dom('.vd-title').hasText('Holiday');
    assert.dom('.vd-sub').includesText('2 files, 6.0 KB');
    assert.deepEqual(
      findAll('.vd-format-label').map((e) => e.textContent.trim()),
      ['beach.jpg', 'waves.mp4'],
    );

    const row = (n) => findAll('.vd-format')[n];
    await click(row(0).querySelector('.btn'));
    await waitUntil(() =>
      row(0).querySelector('.vd-format-status')?.textContent.includes('Saved'),
    );
    assert
      .dom(row(0).querySelector('.vd-format-status'))
      .hasText('Saved 2.0 KB');
    assert.dom(row(1).querySelector('.vd-format-status')).doesNotExist();

    await click('.dl-all .btn');
    await waitUntil(() =>
      row(1).querySelector('.vd-format-status')?.textContent.includes('Saved'),
    );
    assert
      .dom(row(1).querySelector('.vd-format-status'))
      .hasText('Saved 4.0 KB');
    assert.strictEqual(
      requests.filter((r) => r.url.endsWith('one')).length,
      1,
      'Save all skips what was already saved',
    );
  });
});
