import { module, test } from 'qunit';
import {
  visit,
  click,
  fillIn,
  waitUntil,
  find,
  findAll,
} from '@ember/test-helpers';
import { setupApplicationTest } from 'woogi-tools/tests/helpers';
import { clearAllToolState } from 'woogi-tools/utils/tool-state';

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

// A YouTube video, which only the download backend can fetch.
const BACKEND_FILE = 'https://woogi-downloads.onrender.com/file?t=signed';
const YOUTUBE = {
  platform: 'youtube',
  platformName: 'YouTube',
  url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  title: 'Me at the zoo',
  author: 'jawed',
  thumbnail: null,
  duration: 19,
  items: [],
  backend: [
    { id: '720', label: 'Up to 720p', kind: 'video' },
    { id: 'audio', label: 'Sound only', kind: 'audio' },
  ],
  notes: [],
};

module('Acceptance | video downloader', function (hooks) {
  setupApplicationTest(hooks);

  let realFetch;
  let requests;
  let backend;
  hooks.beforeEach(async function () {
    await clearAllToolState();
    requests = [];
    backend = false;
    realFetch = window.fetch;
    window.fetch = async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, method: init.method ?? 'GET', body: init.body });
      const json = (body, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (url === '/api/video' && init.method === 'POST')
        return json(backend ? YOUTUBE : RESULT);
      if (url === '/api/video') return json({ backend });
      if (url === '/api/video/resolve')
        return json({
          files: [{ url: BACKEND_FILE, filename: null, type: 'video' }],
        });
      if (url === BACKEND_FILE)
        return new Response(new Uint8Array(8192), {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': '8192',
            'Content-Disposition':
              'attachment; filename="Me at the zoo - jNQXAC9IVRw.mp4"; filename*=UTF-8\'\'Me%20at%20the%20zoo%20-%20jNQXAC9IVRw.mp4',
          },
        });
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

  test('saves a YouTube video through the download backend', async function (assert) {
    backend = true;
    const saved = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) saved.push(this.download);
      else realClick.call(this);
    };
    try {
      await visit('/video-downloader');
      await waitUntil(() => findAll('.vd-site-list li.is-ok').length > 5);
      await fillIn('.dl-form input', 'https://youtu.be/jNQXAC9IVRw');
      assert.dom('.vd-detect').includesText('through the backend');
      await click('.dl-form button');
      await waitUntil(() => find('.vd-result'));
      assert.dom('.vd-title').hasText('Me at the zoo');
      assert.deepEqual(
        findAll('.vd-format-label').map((e) => e.textContent.trim()),
        ['Up to 720p', 'Sound only'],
      );

      await click('.vd-format .btn');
      await waitUntil(() =>
        find('.vd-format-status')?.textContent.includes('Saved'),
      );
      assert.dom('.vd-format-status').hasText('Saved 8.0 KB');
      const asked = requests.find((r) => r.url === '/api/video/resolve');
      assert.deepEqual(JSON.parse(asked.body), {
        url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        format: '720',
      });
      assert.deepEqual(
        saved,
        ['Me at the zoo - jNQXAC9IVRw.mp4'],
        'named by the backend',
      );
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });
});
