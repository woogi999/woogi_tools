import { module, test } from 'qunit';
import {
  visit,
  click,
  fillIn,
  waitUntil,
  find,
  findAll,
} from '@ember/test-helpers';
import { getPageTitle } from 'ember-page-title/test-support';
import { setupApplicationTest } from 'woogi-tools/tests/helpers';
import { clearAllToolState } from 'woogi-tools/utils/tool-state';
import { idbGet } from 'woogi-tools/utils/idb-store';
import { compress } from 'woogi-tools/utils/codec';

const byText = (selector, text) =>
  findAll(selector).find((el) => el.textContent.includes(text));

module('Acceptance | smoke', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(async () => {
    localStorage.removeItem('woogi-favourites');
    // Tools remember what you typed into them (app/utils/tool-state.js); a test
    // that starts from a previous run's leftovers isn't testing anything.
    await clearAllToolState();
  });

  test('every tool page renders its starred heading and credits', async function (assert) {
    for (const [url, title, hasLibraries] of [
      ['/color-picker', 'Colour Picker', false],
      ['/data-codec', 'Data Codec', true],
      ['/qr-code', 'QR Code Generator', true],
    ]) {
      await visit(url);
      assert.dom('.hero-title span').hasText(title);
      assert.dom('.hero-title .star-btn').exists();
      // Every tool page explains how it is made; the list of libraries is
      // only there when the tool actually leans on one.
      assert.dom('.made-with').exists();
      if (hasLibraries)
        assert.dom('.made-with .credit-list').exists({ count: 1 });
      else assert.dom('.made-with .credit-list').doesNotExist();
    }
  });

  test('the tab title follows the page', async function (assert) {
    for (const [url, title] of [
      ['/', 'Woogi Tools'],
      ['/color-picker', 'Colour Picker | Woogi Tools'],
      ['/privacy', 'Privacy Policy | Woogi Tools'],
      ['/video-editor', 'Video Editor | Woogi Tools'],
      ['/no-such-page', 'Page not found | Woogi Tools'],
    ]) {
      await visit(url);
      assert.strictEqual(getPageTitle(), title, url);
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
    assert.strictEqual(
      nav.style.getPropertyValue('--hand-y'),
      `${active.offsetTop + active.offsetHeight / 2}px`,
    );
    assert
      .dom('.nav-group-label')
      .doesNotHaveStyle({ textTransform: 'uppercase' });
  });

  // These two mount a whole page from their own constructors, which is where a
  // tracked write during render brought the whole app down once.
  test('the writing tools render and take input', async function (assert) {
    await visit('/grammar-checker');
    assert.dom('.hero-title span').hasText('Grammar Checker');
    assert.dom('.lt-editor .lt-input').exists();
    await fillIn('.lt-input', 'This is a sentence.');
    assert.dom('.lt-input').hasValue('This is a sentence.');

    await visit('/paraphraser');
    assert.dom('.hero-title span').hasText('Paraphraser');
    assert.dom('.lt-editor .lt-input').exists();
    await fillIn('.lt-input', 'It is a very good idea.');
    assert.dom('.lt-input').hasValue('It is a very good idea.');
  });

  test('a tool remembers what you typed into it', async function (assert) {
    await visit('/text-case');
    await fillIn('.textarea', 'remember me');
    // The save is on a timer, so wait for it to land rather than guess.
    for (let tries = 0; tries < 30; tries++) {
      if ((await idbGet('woogi-tool:text-case'))?.text === 'remember me') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await visit('/color-picker');
    await visit('/text-case');
    await waitUntil(() => find('.textarea')?.value === 'remember me', {
      timeout: 3000,
    });
    assert.dom('.textarea').hasValue('remember me');
  });

  test('the newest tools render and work', async function (assert) {
    for (const [url, title] of [
      ['/file-archiver', 'File Archiver'],
      ['/file-compressor', 'File Compressor'],
      ['/timezone-converter', 'Timezone Converter'],
      ['/svg-optimizer', 'SVG Optimizer'],
      ['/auto-trace', 'Auto-trace'],
      ['/fake-data', 'Fake Data Generator'],
      ['/regex-library', 'Regex Library'],
      ['/stem-extractor', 'Audio Stem Extractor'],
      ['/background-remover', 'Background Remover'],
    ]) {
      await visit(url);
      assert.dom('.hero-title span').hasText(title);
      assert.dom('.made-with').exists();
    }
  });

  test('the Stem Extractor offers its engines', async function (assert) {
    await visit('/stem-extractor');
    assert.dom('.hero-title span').hasText('Audio Stem Extractor');
    // One card per engine: the instant arithmetic one and the model one.
    assert.dom('.stem-engine').exists({ count: 2 });
    assert.dom('.stem-picks .math-check').exists();

    // The graphics check is asynchronous and isn't something the test helpers
    // know to wait for, so wait for it to publish what it decided.
    await waitUntil(() => find('.fs')?.dataset.device !== 'checking', {
      timeout: 3000,
    });

    // The invariant worth holding whichever machine this runs on: a model
    // engine is never offered without the WebGPU to run it, because failing
    // half way through a song is worse than not being offered at all.
    if (find('.fs').dataset.device === 'none') {
      assert.dom('.stem-engine.is-blocked').exists();
      assert.dom('.stem-engine.is-selected').hasText(/Rough/);
    } else {
      assert.dom('.stem-engine.is-blocked').doesNotExist();
    }
  });

  test('the SVG Optimizer actually shrinks an SVG', async function (assert) {
    await visit('/svg-optimizer');
    await click('.svgo .btn');
    // The example is deliberately full of things no renderer reads, so the
    // result has to come out meaningfully smaller than it went in.
    const output = findAll('.svgo textarea')[1];
    assert.ok(output, 'the optimised markup is shown');
    assert.ok(
      output.value.length < find('.svgo textarea').value.length,
      'the result is smaller than the source',
    );
    assert.notOk(output.value.includes('sodipodi'), 'editor data is gone');
    assert.notOk(output.value.includes('<metadata'), 'metadata is gone');
  });

  test('the Fake Data Generator is reproducible from its seed', async function (assert) {
    await visit('/fake-data');
    assert.dom('.fake-table tbody tr').exists();
    const first = find('.fake-table tbody tr').textContent;
    await click('.math-swap'); // reroll: a new seed, so different rows
    const rerolled = find('.fake-table tbody tr').textContent;
    assert.notStrictEqual(rerolled, first, 'a new seed gives new rows');
    await visit('/color-picker');
    await visit('/fake-data');
    assert.dom('.fake-table tbody tr').hasText(rerolled, 'the seed is kept');
  });

  test('the Regex Library runs its own examples', async function (assert) {
    await visit('/regex-library');
    assert.dom('.rxl-card').exists({ count: 38 });
    await click('.rxl-head');
    assert.dom('.rxl-card.is-open .rxl-code').exists();
    // Every pattern ships samples it should and shouldn't match; if one ever
    // stops behaving, the card says so instead of quietly lying.
    assert.dom('.rxl-card.is-open .rxl-pass').exists();
  });

  test('the Timezone Converter shows a clock per place', async function (assert) {
    await visit('/timezone-converter');
    assert.dom('.tz-row').exists({ count: 4 });
    assert.dom('.tz-row .tz-time').exists();
    // 24 cells across, one an hour, for finding a slot that suits everyone.
    assert.dom('.tz-row .tz-cell').exists({ count: 96 });
  });

  test('the OSINT tools render', async function (assert) {
    for (const [url, title] of [
      ['/username-search', 'User Profiling'],
      ['/breach-check', 'Breach Check'],
      ['/photo-metadata', 'Photo Metadata'],
      ['/email-header-analyzer', 'Email Header Analyzer'],
      ['/wayback-snapshots', 'Wayback Snapshots'],
      ['/ip-lookup', 'IP Address Lookup'],
      ['/domain-lookup', 'Domain Lookup'],
    ]) {
      await visit(url);
      assert.dom('.hero-title span').hasText(title);
    }
  });

  test('the Email Header Analyzer traces hops and flags a spoof', async function (assert) {
    await visit('/email-header-analyzer');
    await fillIn(
      '.osint-textarea',
      [
        'Received: from mx.example.net (mx.example.net [203.0.113.9]) by mx.google.com with ESMTPS; Tue, 22 Sep 2026 10:00:05 +0000',
        'Received: from laptop (unknown [198.51.100.7]) by mx.example.net with ESMTP; Tue, 22 Sep 2026 10:00:00 +0000',
        'Authentication-Results: mx.google.com; spf=fail smtp.mailfrom=bank.com; dkim=none; dmarc=fail',
        'From: "Your Bank" <security@bank.com>',
        'Reply-To: <collect@evil.example>',
        'Subject: Verify your account',
      ].join('\n'),
    );
    assert.dom('.osint-hops li').exists({ count: 2 });
    assert.dom('.osint-hops li:first-child').includesText('laptop');
    assert.dom('.osint-chip.is-bad').exists();
    assert.dom('.osint-verdict.is-bad').exists();
  });

  test('the newer tools render', async function (assert) {
    for (const [url, title] of [
      ['/spin-the-wheel', 'Spin the Wheel'],
      ['/dice-roll', 'Dice Roll'],
      ['/coin-toss', 'Coin Toss'],
      ['/geometry-calculator', 'Geometry Calculator'],
      ['/image-editor', 'Image Darkroom'],
      ['/image-censor', 'Image Censor'],
      ['/video-censor', 'Video Censor'],
      ['/subtitle-baker', 'Subtitle Baker'],
      ['/barcode-generator', 'Barcode Generator'],
      ['/emoji-picker', 'Emoji Picker'],
      ['/ascii-art', 'ASCII Art'],
      ['/video-player', 'Video Player'],
      ['/mockup-preview', 'Mockup Preview'],
      ['/online-ruler', 'Online Ruler'],
      ['/document-redacter', 'Document Redacter'],
      ['/speed-test', 'Speed Test'],
      ['/typing-speed-test', 'Typing Speed Test'],
      ['/github-repo-checker', 'GitHub Repo Checker'],
    ]) {
      await visit(url);
      assert.dom('.hero-title span').hasText(title);
    }

    await visit('/barcode-generator');
    assert.dom('.bc-preview svg').exists();
    await visit('/ascii-art');
    assert.dom('.ascii-out').exists();
    await visit('/geometry-calculator');
    assert.dom('.geo-result').exists();
    await visit('/emoji-picker');
    assert.dom('.ep-cell').exists();
    await visit('/dice-roll');
    await click('.dice-roll-btn');
    // The dice land in a 3D scene where WebGL will run and as flat faces
    // where it won't, so the roll's total is what both paths agree on.
    await waitUntil(() => find('.math-result .math-big'), { timeout: 8000 });
    assert.dom('.math-result .math-big').exists();
  });

  test('the currency converter renders with its watchlist', async function (assert) {
    await visit('/currency-converter');
    assert.dom('.hero-title span').hasText('Currency Converter');
    assert.dom('.cc-result .cc-big').exists();
    // The default list, minus USD which is what it converts from.
    assert.dom('.cc-watch-row').exists({ count: 4 });
  });

  // The editor lives inside each game now rather than being a tool of its own,
  // so getting to it goes through that game's lobby.
  async function openEditor() {
    await visit('/snake');
    await click('.lobby-editor-btn');
  }

  test('the level editor paints, saves and round-trips a share code', async function (assert) {
    localStorage.removeItem('woogi-levels');
    await openEditor();
    assert.dom('.le-page').exists('the editor opened inside the game');

    // The flat grid is the half of the editor a test can drive; the 3D stage
    // next to it is the same level, built by the game's own island code.
    await click('.le-grid-head .btn');
    assert.dom('.le-cell').exists({ count: 400 }, '20 x 20 by default');

    await click('.le-cell[data-i="0"]');
    assert.dom('.le-cell[data-i="0"]').hasClass('is-rock');
    await fillIn('.le-bar .le-field input[type=text]', 'Test Isle');
    await click('.le-save');
    assert.dom('.le-list-row').exists({ count: 1 });
    assert.dom('.le-list-row strong').hasText('Test Isle');

    // The share code carries it: clear everything, paste it back, get it again.
    const code = find('.le-code').textContent.trim();
    assert.ok(code.startsWith('WOOGI1-'), 'a share code was produced');
    await click('.le-new');
    await fillIn('.le-share-row input[type=text]', code);
    await click('.le-load');
    assert
      .dom('.le-cell[data-i="0"]')
      .hasClass('is-rock', 'the level came back');
    assert.dom('.le-list-row').exists({ count: 2 });

    localStorage.removeItem('woogi-levels');
  });

  test('the level editor builds the level on a real island', async function (assert) {
    await openEditor();
    // A canvas, not a picture of one: the same scene code the game runs.
    assert.dom('.le-stage-canvas').exists();
    assert.dom('.le-view-btns .qr-icon-btn').exists({ count: 5 });
    // Cut-out is offered as a brush, which is what shapes the playing grid.
    assert.dom('.le-brush .le-swatch.is-void').exists();
    await click('.le-close');
    assert.dom('.game-lobby').exists('and it goes back to the lobby');
  });

  test('qr generator renders and switches modes', async function (assert) {
    await visit('/qr-code');
    await waitUntil(() => find('.qr-image svg'));
    assert.dom('.qr-image svg').exists();
    assert.dom('.qr-export').exists({ count: 4 });

    await fillIn('.colour-field .colour-hex', '#FF0000');
    assert.dom('.colour-field input[type=color]').hasValue('#ff0000');

    await click('.qr-tab:nth-child(2)');
    assert
      .dom('.qr-empty')
      .hasText('Enter network details to generate QR code');
    await fillIn('#qr-ssid', 'Home');
    await fillIn('#qr-password', 'secret');
    await waitUntil(() => find('.qr-image svg'));

    await click('.qr-tab:nth-child(3)');
    await fillIn('#qr-first', 'Jo');
    assert.dom('.qr-vcard').includesText('BEGIN:VCARD');

    await click('.qr-tab:nth-child(4)');
    assert.dom('.qr-batch-row').exists({ count: 2 });
  });

  test('the theme toggle flips light and dark', async function (assert) {
    await visit('/');
    const theme = () => document.documentElement.getAttribute('data-theme');
    const was = theme();
    await click('.theme-toggle[aria-label^="Switch to"]');
    assert.notStrictEqual(theme(), was, 'flipped');
    await click('.theme-toggle[aria-label^="Switch to"]');
    assert.strictEqual(theme(), was, 'and back');
  });

  test('decompressed JSON comes out laid out to read', async function (assert) {
    await visit('/data-codec');
    await click(byText('.mode-toggle .btn', 'Decode'));
    const packed = await compress('{"move":"Hollow Purple","cost":5}', 'gzip', 6);
    await fillIn('#codec-input', packed);
    await waitUntil(() => find('#codec-output')?.value.includes('\n'), {
      timeout: 3000,
    });
    assert.dom('#codec-output').hasValue('{\n  "move": "Hollow Purple",\n  "cost": 5\n}');

    await click(byText('.codec-output-tools .math-check', 'Pretty-print').querySelector('input'));
    await waitUntil(() => !find('#codec-output')?.value.includes('\n'), {
      timeout: 3000,
    });
    assert.dom('#codec-output').hasValue('{"move":"Hollow Purple","cost":5}', 'or as it was');
  });
});
