import { module, test } from 'qunit';
import {
  detectVideo,
  sameSiteRedirect,
} from 'woogi-tools/utils/video-platforms';

module('Unit | video platforms', function () {
  test('recognises each site and rebuilds a clean address', function (assert) {
    for (const [pasted, platform, id, url] of [
      [
        'https://youtu.be/jNQXAC9IVRw?t=3',
        'youtube',
        'jNQXAC9IVRw',
        'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      ],
      [
        'm.youtube.com/shorts/jNQXAC9IVRw',
        'youtube',
        'jNQXAC9IVRw',
        'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      ],
      [
        'https://twitter.com/jack/status/20?s=46',
        'x',
        '20',
        'https://x.com/jack/status/20',
      ],
      [
        'https://x.com/i/web/status/910031516746514432',
        'x',
        '910031516746514432',
        'https://x.com/i/status/910031516746514432',
      ],
      [
        'https://www.tiktok.com/@hank/video/7047596209028074758?lang=en',
        'tiktok',
        '7047596209028074758',
        'https://www.tiktok.com/@hank/video/7047596209028074758',
      ],
      [
        'https://vm.tiktok.com/ZMabc123/',
        'tiktok',
        'short:vm.tiktok.com/ZMabc123',
        'https://vm.tiktok.com/ZMabc123/',
      ],
      [
        'https://www.instagram.com/reels/Chunk8-jurw/',
        'instagram',
        'Chunk8-jurw',
        'https://www.instagram.com/reel/Chunk8-jurw/',
      ],
      [
        'https://www.facebook.com/somepage/videos/a-title/3676516585958356/',
        'facebook',
        '3676516585958356',
        'https://www.facebook.com/watch/?v=3676516585958356',
      ],
      [
        'https://fb.watch/abcDEF123/',
        'facebook',
        'short:fb.watch/abcDEF123',
        'https://fb.watch/abcDEF123/',
      ],
      [
        'https://old.reddit.com/r/videos/comments/6rrwyj/that_small_heart_attack/',
        'reddit',
        '6rrwyj',
        'https://www.reddit.com/comments/6rrwyj/',
      ],
      [
        'https://v.redd.it/zv89llsvexdz',
        'reddit',
        'media:zv89llsvexdz',
        'https://v.redd.it/zv89llsvexdz',
      ],
      [
        'https://streamable.com/e/dnd1',
        'streamable',
        'dnd1',
        'https://streamable.com/dnd1',
      ],
      [
        'https://player.vimeo.com/video/33951933',
        'vimeo',
        '33951933',
        'https://vimeo.com/33951933',
      ],
      [
        'https://dai.ly/x5kesuj',
        'dailymotion',
        'x5kesuj',
        'https://www.dailymotion.com/video/x5kesuj',
      ],
    ]) {
      const found = detectVideo(pasted);
      assert.deepEqual(
        [found.platform, found.id, found.url],
        [platform, id, url],
        pasted,
      );
    }
  });

  test('refuses anything that is not a supported site', function (assert) {
    for (const pasted of [
      'http://169.254.169.254/latest/meta-data',
      'http://localhost/admin',
      'http://127.0.0.1:8080/',
      'https://[::1]/',
      'https://youtube.com.evil.example/watch?v=jNQXAC9IVRw',
      'https://evilyoutube.com/watch?v=jNQXAC9IVRw',
      'https://www.youtube.com@evil.example/watch?v=jNQXAC9IVRw',
      'https://x.com:8443/a/status/1',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,hi',
      `https://youtu.be/${'a'.repeat(3000)}`,
    ])
      assert.ok(detectVideo(pasted)?.error, pasted);
  });

  test('knows a site but not a video on it', function (assert) {
    const found = detectVideo('https://www.youtube.com/playlist?list=PL1');
    assert.strictEqual(found.platform, 'youtube');
    assert.ok(found.error);
    assert.strictEqual(detectVideo('   '), null);
  });

  test('share links may only lead back to the same site', function (assert) {
    assert.strictEqual(
      sameSiteRedirect(
        'tiktok',
        'https://www.tiktok.com/@a/video/7047596209028074758?_r=1',
      ).id,
      '7047596209028074758',
    );
    assert.strictEqual(
      sameSiteRedirect('tiktok', 'https://evil.example/@a/video/1'),
      null,
    );
    assert.strictEqual(
      sameSiteRedirect('facebook', 'https://www.tiktok.com/@a/video/1'),
      null,
    );
  });
});
