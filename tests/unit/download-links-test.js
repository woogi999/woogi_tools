import { module, test } from 'qunit';
import { detectBunkr } from 'woogi-tools/utils/bunkr-link';
import { detectMega } from 'woogi-tools/utils/mega-link';
import { typeOfName } from 'woogi-tools/utils/download-jobs';

const FILE_KEY = 'a'.repeat(43);
const FOLDER_KEY = 'b'.repeat(22);

module('Unit | download links', function () {
  test('Bunkr: albums and files, on any of its domains', function (assert) {
    assert.deepEqual(detectBunkr('https://bunkr.cr/a/Lktg9Keq'), {
      kind: 'album',
      host: 'bunkr.cr',
      url: 'https://bunkr.cr/a/Lktg9Keq',
    });
    assert.deepEqual(
      detectBunkr('bunkrr.su/v/some-clip-AbC123.mp4?x=1#frag'),
      {
        kind: 'file',
        host: 'bunkrr.su',
        url: 'https://bunkrr.su/v/some-clip-AbC123.mp4',
      },
      'rebuilt from the checked parts only',
    );
    assert.strictEqual(detectBunkr('https://www.bunkr.si/f/x').kind, 'file');
    assert.strictEqual(detectBunkr(''), null);
  });

  test('Bunkr: other sites and other pages are turned away', function (assert) {
    for (const link of [
      'https://example.com/a/abc',
      'https://bunkr.cr.evil.com/a/abc',
      'https://notbunkr.cr/a/abc',
      'https://bunkr.cr@evil.com/a/abc',
      'https://bunkr.cr:8443/a/abc',
      'http://169.254.169.254/a/abc',
    ])
      assert.ok(detectBunkr(link).error, link);
    assert.ok(detectBunkr('https://bunkr.cr/').error, 'the home page');
    assert.ok(detectBunkr('https://bunkr.cr/search/x').error);
  });

  test('MEGA: files and folders, in the new form and the old', function (assert) {
    assert.deepEqual(detectMega(`https://mega.nz/file/AbCd1234#${FILE_KEY}`), {
      kind: 'file',
      url: `https://mega.nz/file/AbCd1234#${FILE_KEY}`,
    });
    assert.deepEqual(detectMega(`mega.nz/folder/AbCd1234#${FOLDER_KEY}`), {
      kind: 'folder',
      url: `https://mega.nz/folder/AbCd1234#${FOLDER_KEY}`,
    });
    assert.deepEqual(detectMega(`https://mega.nz/#!AbCd1234!${FILE_KEY}`), {
      kind: 'file',
      url: `https://mega.nz/file/AbCd1234#${FILE_KEY}`,
    });
    assert.deepEqual(
      detectMega(`https://mega.co.nz/#F!AbCd1234!${FOLDER_KEY}`),
      { kind: 'folder', url: `https://mega.nz/folder/AbCd1234#${FOLDER_KEY}` },
    );
    assert.strictEqual(
      detectMega(`https://mega.nz/folder/AbCd1234#${FOLDER_KEY}/file/ZyXw9876`)
        .url,
      `https://mega.nz/folder/AbCd1234#${FOLDER_KEY}/file/ZyXw9876`,
      'one thing inside a folder',
    );
  });

  test('MEGA: a link without its key says so', function (assert) {
    assert.true(
      detectMega('https://mega.nz/file/AbCd1234').error.includes('missing'),
    );
    assert.ok(detectMega('https://mega.nz/file/AbCd1234#short').error);
    assert.ok(detectMega('https://mega.nz/').error);
    assert.ok(
      detectMega(`https://example.com/file/AbCd1234#${FILE_KEY}`).error,
    );
  });

  test('files are sorted into kinds by name', function (assert) {
    assert.strictEqual(typeOfName('clip.MP4'), 'video');
    assert.strictEqual(typeOfName('song.flac'), 'audio');
    assert.strictEqual(typeOfName('photo.jpeg'), 'photo');
    assert.strictEqual(typeOfName('notes.pdf'), 'file');
  });
});
