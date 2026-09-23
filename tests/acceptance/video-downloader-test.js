import { module, test } from 'qunit';
import { visit, click, fillIn, waitUntil, find } from '@ember/test-helpers';
import { setupApplicationTest } from 'woogi-tools/tests/helpers';

// The test build is served as static files, so there is no Worker behind
// /api/video: fetch is stood in for with what the Worker answers.
const RESULT = {
  platform: 'x',
  platformName: 'X (Twitter)',
  url: 'https://x.com/someone/status/1600649710662213632',
  title: 'A post with a video',
  author: 'Someone (@someone)',
  thumbnail: null,
  duration: 113,
  items: [
    {
      label: null,
      formats: [
        {
          id: '2176000',
          label: '720p',
          width: 720,
          height: 1280,
          kind: 'video',
          ext: 'mp4',
          bitrate: 2176000,
          via: 'direct',
          url: 'https://video.twimg.com/test/720x1280/a.mp4',
          filename: 'A post with a video - 1600649710662213632-1.mp4',
        },
      ],
    },
  ],
  backend: null,
  notes: [],
};

module('Acceptance | video downloader', function (hooks) {
  setupApplicationTest(hooks);

  let realFetch;
  let requests;
  hooks.beforeEach(function () {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('woogi-tool:')) localStorage.removeItem(key);
    requests = [];
    realFetch = window.fetch;
    window.fetch = async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, method: init.method ?? 'GET', body: init.body });
      const json = (body, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (url === '/api/video' && init.method === 'POST') return json(RESULT);
      if (url === '/api/video') return json({ backend: false });
      if (url.startsWith('https://video.twimg.com/'))
        return new Response(new Uint8Array(4096), {
          headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4096' },
        });
      return realFetch(input, init);
    };
  });
  hooks.afterEach(function () {
    window.fetch = realFetch;
  });

  test('says what works before anything is pasted', async function (assert) {
    await visit('/video-downloader');
    assert.dom('.hero-title span').hasText('Video Downloader');
    await waitUntil(() => find('.vd-site-list li.is-ok'));
    assert
      .dom('.vd-site-list li.is-ok')
      .exists({ count: 5 }, 'five sites save without the backend');
  });

  test('names the site as you type, and stops bad links before sending', async function (assert) {
    await visit('/video-downloader');
    await fillIn('.dl-form input', 'https://youtu.be/jNQXAC9IVRw');
    assert.dom('.vd-detect strong').hasText('YouTube');
    assert.dom('.vd-detect').includesText('Title and thumbnail only');

    await fillIn('.dl-form input', 'http://169.254.169.254/latest');
    assert.dom('.vd-detect').includesText('isn’t one the downloader supports');
    await click('.dl-form button');
    assert.dom('.tool-error').includesText('isn’t one the downloader supports');
    assert.false(
      requests.some((r) => r.method === 'POST'),
      'nothing was sent for a link the page already knew was wrong',
    );
  });

  test('shows the video and saves a format with measured progress', async function (assert) {
    await visit('/video-downloader');
    await fillIn(
      '.dl-form input',
      'https://twitter.com/someone/status/1600649710662213632',
    );
    await click('.dl-form button');
    await waitUntil(() => find('.vd-result'));
    assert.dom('.vd-title').hasText('A post with a video');
    assert.dom('.vd-sub').includesText('1:53');
    assert.dom('.vd-format-label').hasText('720p');
    assert.dom('.vd-format-meta').includesText('720×1280');

    const sent = requests.find((r) => r.method === 'POST');
    assert.deepEqual(JSON.parse(sent.body), {
      url: 'https://twitter.com/someone/status/1600649710662213632',
    });

    await click('.vd-format .btn');
    await waitUntil(() =>
      find('.vd-format-status')?.textContent.includes('Saved'),
    );
    assert.dom('.vd-format-status').hasText('Saved 4.0 KB');
    assert.dom('.vd-format .btn').includesText('Save again');
  });
});
