import { module, test } from 'qunit';
import {
  wifiPayload,
  vcardPayload,
  utf8Binary,
  isValidUrl,
} from 'woogi-tools/utils/qr';

module('Unit | qr payloads', function () {
  test('wifi escapes specials and handles open/hidden networks', function (assert) {
    assert.strictEqual(
      wifiPayload({
        ssid: 'Café;Net',
        password: 'p:w"d',
        securityType: 'WPA',
        isHidden: true,
      }),
      'WIFI:T:WPA;S:Café\\;Net;P:p\\:w\\"d;H:true;;',
    );
    assert.strictEqual(
      wifiPayload({
        ssid: 'Open',
        password: 'ignored',
        securityType: 'nopass',
        isHidden: false,
      }),
      'WIFI:T:nopass;S:Open;;',
    );
    assert.strictEqual(
      wifiPayload({
        ssid: 'Locked',
        password: '',
        securityType: 'WPA',
        isHidden: false,
      }),
      '',
    );
  });

  test('vcard needs a name and escapes values', function (assert) {
    const blank = {
      firstName: '',
      lastName: '',
      organization: '',
      title: '',
      email: '',
      phone: '',
      website: '',
      address: '',
    };
    assert.strictEqual(vcardPayload(blank), '');
    const card = vcardPayload({
      ...blank,
      firstName: 'Jo',
      lastName: 'Doe',
      organization: 'A, B; C',
    });
    assert.true(card.includes('N:Doe;Jo;;;'));
    assert.true(card.includes('ORG:A\\, B\\; C'));
    assert.false(card.includes('EMAIL'));
  });

  test('utf8Binary emits one char per UTF-8 byte', function (assert) {
    assert.deepEqual(
      [...utf8Binary('é👋')].map((c) => c.charCodeAt(0)),
      [0xc3, 0xa9, 0xf0, 0x9f, 0x91, 0x8b],
    );
  });

  test('url validation', function (assert) {
    assert.true(isValidUrl('https://example.com/a?b=1'));
    assert.true(isValidUrl('www.example.com'));
    assert.false(isValidUrl('https://nodot'));
    assert.false(isValidUrl('http://exa mple.com'));
  });
});
