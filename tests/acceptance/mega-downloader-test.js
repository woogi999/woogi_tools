import { module, test } from 'qunit';
import { visit, click, fillIn } from '../helpers/index.js';
import { setupApplicationTest } from '../helpers/index.js';
import { clearAllToolState } from '../../app/utils/tool-state.js';

// Looking a link up talks to MEGA itself, which a test shouldn't; what is
// checked here is everything the page decides before that.
module('Acceptance | mega downloader', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async function () {
    await clearAllToolState();
  });

  test('names the link as you type, and explains a missing key', async function (assert) {
    await visit('/mega-downloader');
    assert.dom('.hero-title span').hasText('Mega Downloader');

    await fillIn(
      '.dl-form input',
      `https://mega.nz/folder/AbCd1234#${'b'.repeat(22)}`,
    );
    assert.dom('.vd-detect').hasText('A MEGA folder');
    await fillIn(
      '.dl-form input',
      `https://mega.nz/file/AbCd1234#${'a'.repeat(43)}`,
    );
    assert.dom('.vd-detect').hasText('A MEGA file');

    await fillIn('.dl-form input', 'https://mega.nz/file/AbCd1234');
    assert.dom('.vd-detect').includesText('missing its key');
    await click('.dl-form button');
    assert.dom('.tool-error').includesText('missing its key');
    assert.dom('.vd-result').doesNotExist();
  });
});
