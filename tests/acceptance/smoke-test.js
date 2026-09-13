import { module, test } from 'qunit';
import { visit, click, fillIn, waitUntil, find } from '@ember/test-helpers';
import { setupApplicationTest } from 'woogi-tools/tests/helpers';

module('Acceptance | smoke', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(() => localStorage.removeItem('woogi-favourites'));

  test('every tool page renders its starred heading and credits', async function (assert) {
    for (const [url, title] of [
      ['/color-picker', 'Colour Picker'],
      ['/data-codec', 'Data Codec'],
      ['/qr-code', 'QR Code Generator'],
    ]) {
      await visit(url);
      assert.dom('.hero-title span').hasText(title);
      assert.dom('.hero-title .star-btn').exists();
      assert.dom('.made-with .credit-list').exists({ count: url === '/color-picker' ? 1 : 2 });
    }
  });

  test('math tools render', async function (assert) {
    for (const [url, title] of [
      ['/calculator', 'Calculator'],
      ['/graph-calculator', 'Graph Calculator'],
      ['/algebra-calculator', 'Algebra Calculator'],
      ['/date-calculator', 'Time & Date Calculator'],
      ['/age-calculator', 'Age Calculator'],
      ['/winrate-calculator', 'Winrate Calculator'],
    ]) {
      await visit(url);
      assert.dom('.hero-title span').hasText(title);
    }

    await visit('/algebra-calculator');
    await fillIn('.algebra-input', '2x + 3 = 11');
    assert.dom('.algebra-line').hasText('x = 4');
  });

  test('heading star adds the tool to home favourites', async function (assert) {
    await visit('/data-codec');
    await click('.hero-title .star-btn');
    assert.dom('.hero-title .star-btn').hasClass('starred');
    await visit('/');
    assert.dom('.tool-card-link', find('.home-section')).hasText('Data Codec');
    assert.dom('.tool-card .card-star').exists();
  });

  test('sidebar hand tracks the active link', async function (assert) {
    await visit('/qr-code');
    await waitUntil(() => find('.sidebar-nav.has-active'));
    const nav = find('.sidebar-nav');
    const active = find('.nav-link.active');
    assert.strictEqual(nav.style.getPropertyValue('--hand-y'), `${active.offsetTop + active.offsetHeight / 2}px`);
    assert.dom('.nav-group-label').doesNotHaveStyle({ textTransform: 'uppercase' });
  });

  test('qr generator renders and switches modes', async function (assert) {
    await visit('/qr-code');
    await waitUntil(() => find('.qr-image svg'));
    assert.dom('.qr-image svg').exists();
    assert.dom('.qr-export').exists({ count: 3 });

    await fillIn('.colour-field .colour-hex', '#FF0000');
    assert.dom('.colour-field input[type=color]').hasValue('#ff0000');

    await click('.qr-tab:nth-child(2)');
    assert.dom('.qr-empty').hasText('Enter network details to generate QR code');
    await fillIn('#qr-ssid', 'Home');
    await fillIn('#qr-password', 'secret');
    await waitUntil(() => find('.qr-image svg'));

    await click('.qr-tab:nth-child(3)');
    await fillIn('#qr-first', 'Jo');
    assert.dom('.qr-vcard').includesText('BEGIN:VCARD');

    await click('.qr-tab:nth-child(4)');
    assert.dom('.qr-batch-row').exists({ count: 2 });
  });
});
