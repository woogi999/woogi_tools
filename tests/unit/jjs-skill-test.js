import { module, test } from 'qunit';
import {
  buildSkill,
  decodeSkill,
  encodeSkill,
  parseIds,
} from 'woogi-tools/utils/jjs-skill';
import { lz4Block, textureIdFrom } from 'woogi-tools/utils/rbxm';
import { imageIdOf, uploadDecal } from 'woogi-tools/utils/roblox';
import { idbDelete, idbSet } from 'woogi-tools/utils/idb-store';

// A three-step bar skill exported from JJS's own Skill Builder, with every
// texture left at 99.
const FROM_JJS =
  'KLUv/WDmChUUAIbaUiYAjVgH1pIFHMxV4yg4tQoD4t1+t+zuZElNYdcV8LeQQOz////DC0QARwBHAN0IBChn5nfr9m73Lnj5faEsFPpuCQjuLUHd9+XuL7/49rtDMzNqbX5jMNwnktIJwQqQt1tT4+4y8uobVWFRuMf4fkEIUD7guzHzwTJ+NEvcqInK5ODeUrIReQNifMwDg2WyGu92UQnrg7Y+EMmrUca2QiTvjaP3xb0jKgu6mAes7zbel3a9n3dEn/RyYgux1rztzC/bWyMbeRmK7pW5TlYtY22xeK6lFrLmMG/GMmUwbpQNZOPekzzhg2yclFrI6oMsYq+DSWnmR+VzMHHDNI3jBAlX414lNlJr4duv63GeZHGldCWuUYM1VQuVCqWRoXQ4JH0RnlKUscpJIYU1QRRVdRsolWWCqHi874PYJNqBBqChk4wtE8o7IyuoE798qNGlMWQ00iSVTGMwAkIUKio7EsA0HQhSihIBQYyIBDIiNROUlBSlqBkDqDcOSI9ztYujyhpjAZfcrd7YAx2z0WTKHhDXtzZvXvV4GP3YFjahQS+CVtloDZx2QFZ4umMohzXoUM90WryjQoR8xFmav9FdSIX+GWURXikFF5zHUAVk4Kl2DcTfLd99sURhJ57wOk5PDPyixQUqcKyXd8KQKz1r5+K0TymubpSQSfBgwvlc4keGeSJly3dQGX+cG9TCT67GDHJgPYg300eo/wZ8kGFGG1ynCfZDOHVJNIkOW58lf7FWb87bgft3ds1kOcvM0RjrSNNEFfI1oUC6DgjiYHhUwGtBPS+GP9UpTYFWwIkMnwyDjBa7BrFO8Mc5iAprKcmG4p5a8G6KM0H/t6LokxyDGg==';

// The same bar with Safety Rails, a regen skill and the two debug skills,
// as its author built it in JJS.
const WITH_RAILS =
  'KLUv/WABGEUeAAZkbicQr+YBEFJxf2Au/2LG9FDtYYtUrbwAVroZB4E31moOE4gCAAAAwAFhAF0AZQDtai6VxON/RLKpg0UmTWAugbajU/4GPX5ngJW/0/D4L8YS+ZtDw+O/uNTxdx4/RQSmshz8HX7ctiVuz2M5mVKcM+JmYPCY4hBuHCOE1AcIN7YqBz/2SEtul2NtHktSc6ch7xForepiLNEjxVbqEuqVyckkRTEwcgolpiBhbYd1Tg9rD2uPnNC2ndQ9fiupGWlmY7M2MADRGWfEz5pr8D9+iDkDrMzG5n+nlF1wy9+ex0+xMOppugRjnBGTHfEHEoW2/M1JZsRpgCR1A3r42+VwNfj5LezJQKdddqIodSshk5NFj2RHzMauWFUG4nKxOCJPSHD+5hqP38IHs7VjbKpCieQSrMxKhzHaWNW0yWRoxZLBVBWch6U9MYo0HfyN4AF4HgcOBQIXuhiZiksdq1SavQkOxJX4ulxjcoq5E5eydjE/nqBlcU7Lja92TQlBJi0pW6ectFfKImNN/K1dEOQcQIHAdZdjbZ4HcpvqWgoI1tVobjzQXCwVZRmbK1FVhOdxziv/QyJ/RBAVO4DMqBEeMiQkIpKUJCksB0ACQowZK+sGEuixKAtxJIWBCEKECIghBBmDDBEJhEQkKlGpDrxq9Wd/X7Rf9TaCRRwCAt2w1VKdw9i5BQ3vs7CVx0W4U/YEuLR5NcQEdECuy+zBEAnikjnYsZMlPimlqIMmI7ZYvIlJXRAoH7cCOTzbuoGFA+QVtfGK+wrulWMELF5KEnQy83I7AGZU8n0+U6W2GM2WKv12RRX0qrQtzZgPF6Hwo13YJt++tnG+eJgqrMRmaMbBzpadI37Q+SwXjgTqtP1Evu9/2A74o4EkZoFhIFyhPYkj3TA7D8LlYe9YsmmUEz7DWvTfT530VI/B5KZPauKgI2TVhzzP9xAwNpIoqxHW89r842xA78rcDDDg0nCwyBWphvKPysqHbrJHvCIaTJsTaxAz5iYpAew566gmd3Py4YrETK2zz4s0pA8x6JEDBtc78PSWQS3bTgYjoItb8njxPjlMJi9mAgb3d9t6rGqZrPPeIDQj295YmdGUapIuy41zDJDIQzuS1VjUYRVxRPCOSzAcOEcWOgyIjdgnx50MBIA6DGYDN+3V6KQLwQCReJ2Dqwbx0q+dFk2fc3xYwp/k0/irFYbIYmcIkAl94LThPc0NTIKAty66bH/cxDxwRjjWhsSls/7Z7GZoF3m2xzf5dY6QAYw6wNABt3lNfTqpJedWJX410c0/';

const program = (skill) => JSON.parse(skill[0].DATA);

// A skill with its program parsed, for comparing.
const opened = ({ DATA, ...fields }) => ({ ...fields, DATA: JSON.parse(DATA) });

module('Unit | JJS skill export', function () {
  test('builds exactly the skill JJS itself exports', async function (assert) {
    const theirs = await decodeSkill(FROM_JJS);
    // That export used JJS's shorter timings; the defaults here are longer.
    // It had no rails or helpers, so this one is made without them too.
    const ours = buildSkill({
      textures: [99, 99, 99],
      showFor: 0.06,
      waitFor: 0.05,
      rails: false,
      regen: null,
    });
    const { DATA: theirData, ...theirFields } = theirs[0];
    const { DATA: ourData, ...ourFields } = ours[0];
    assert.deepEqual(ourFields, theirFields, 'name, key, cooldown and flags');
    assert.deepEqual(JSON.parse(ourData), JSON.parse(theirData), 'the program');
    assert.true(ourData.includes('"TIME":1e38'), 'with "for ever" written as JJS writes it');
  });

  test('builds Safety Rails, regen and the debug skills exactly as JJS has them', async function (assert) {
    const theirs = (await decodeSkill(WITH_RAILS)).map(opened);
    // Its author gave the step branches the old 0.06s/0.05s timings and the
    // rails the newer 0.12s/0.1s; this builder uses one timing for all.
    for (const step of ['0', '1', '2']) {
      const [shown, waiting] = theirs[0].DATA.Branch[step].Line;
      shown.TIME = 0.12;
      waiting.TIME = 0.1;
    }
    const ours = buildSkill({ textures: [99, 99, 99] }).map(opened);
    assert.strictEqual(ours.length, 4, 'the bar, its regen and two debug skills');
    assert.deepEqual(ours[0], theirs[0], 'the bar, with its rails');
    assert.deepEqual(ours[1], theirs[1], 'Bar Regen');
    assert.deepEqual(ours[2], theirs[2], 'Debug: Add Bar, on key 1');
    assert.deepEqual(ours[3], theirs[3], 'Debug: Remove Bar, on key 2');
  });

  test('rails clamp to the ends with the pictures of those ends', function (assert) {
    const data = program(buildSkill({ textures: ['10', '11', '12', '13'], tag: 'CE' }));
    const dispatch = data.Branch['-'].Line.map((l) => l.VALUE ?? l.BRANCH);
    assert.deepEqual(
      dispatch,
      ['3', '2', '1', '0', '>Safety Rails', '<0', '>3', '-'],
      'exact steps, a comment, then the out-of-range checks',
    );
    const lesser = data.Branch.SafetyLesser.Line;
    const greater = data.Branch.SafetyGreater.Line;
    assert.strictEqual(lesser[0].TEXTURE, 10, 'below 0 shows the empty picture');
    assert.strictEqual(greater[0].TEXTURE, 13, 'above the top shows the full one');
    assert.deepEqual([lesser[1].VALUE, lesser[2].VALUE], ['0', '0']);
    assert.deepEqual([greater[1].VALUE, greater[2].VALUE], ['3', '3']);
    assert.true(lesser.every((l) => !l.TAG || l.TAG === 'CE'));

    const bare = buildSkill({ textures: ['10', '11'], rails: false, regen: null });
    assert.strictEqual(bare.length, 3, 'no regen: the bar and the debug skills');
    assert.false('SafetyLesser' in program(bare).Branch, 'and no rails when off');
    const regen = JSON.parse(
      buildSkill({ textures: ['10', '11'], regen: { amount: 2, every: 0.5 } })[1].DATA,
    ).Branch['-'].Line;
    assert.deepEqual([regen[0].VALUE, regen[1].TIME], ['2', 0.5], 'regen amount and pace');
  });

  test('grows to any number of steps, each with its own picture', async function (assert) {
    const textures = Array.from({ length: 21 }, (_, i) => String(1000 + i));
    const skill = buildSkill({ textures, name: 'Cursed energy', tag: 'CE' });
    const data = program(skill);
    assert.strictEqual(skill[0].NAME, 'Cursed energy');
    assert.strictEqual(skill[0].KEY, 99, 'always 99, so it runs passively');
    const step = data.Branch['3'].Line;
    assert.strictEqual(step[0].TIME, 0.12, 'billboard shown for 0.12s by default');
    assert.strictEqual(step[1].TIME, 0.1, 'and a 0.1s wait');
    const slower = program(buildSkill({ textures, showFor: 0.3, waitFor: 0.25 })).Branch['0'].Line;
    assert.deepEqual([slower[0].TIME, slower[1].TIME], [0.3, 0.25], 'both can be changed');
    assert.strictEqual(
      Object.keys(data.Branch).length,
      24,
      'the dispatcher, 21 steps and the two rails',
    );
    const checks = data.Branch['-'].Line.filter((l) => l.CHECK && /^\d+$/.test(l.VALUE));
    assert.deepEqual(
      checks.map((l) => l.VALUE),
      textures.map((_, i) => String(20 - i)),
      'checked from the top down',
    );
    assert.true(checks.every((l) => l.TAG === 'CE'));
    assert.deepEqual(
      textures.map((_, i) => data.Branch[String(i)].Line[0].TEXTURE),
      textures.map(Number),
      'step N shows picture N',
    );
    assert.strictEqual(data.Line[0].VALUE, '20', 'starts full');
    assert.strictEqual(
      program(buildSkill({ textures, start: 'empty' })).Line[0].VALUE,
      '0',
      'or empty',
    );

    const code = await encodeSkill(skill);
    assert.deepEqual(await decodeSkill(code), skill, 'the code decodes back to it');
  });

  test('IDs are read however they are typed', function (assert) {
    assert.deepEqual(parseIds('123, 456\n 789 abc 10'), ['123', '456', '789', '10']);
    assert.deepEqual(parseIds(''), []);
  });
});

module('Unit | reading a decal back to its picture', function () {
  const bytes = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));

  // A binary model: the 32-byte header, then chunks, then END.
  function model(chunks) {
    const parts = [bytes('<roblox!\x89\xff\x0d\x0a\x1a\x0a\x00\x00'), new Uint8Array(16)];
    for (const { name, data, packed } of chunks) {
      const head = new Uint8Array(16);
      head.set(bytes(name));
      const view = new DataView(head.buffer);
      view.setUint32(4, packed ? data.length : 0, true);
      view.setUint32(8, packed ?? data.length, true);
      parts.push(head, data);
    }
    const end = new Uint8Array(16);
    end.set(bytes('END\0'));
    parts.push(end);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  test('from an XML model', async function (assert) {
    const xml = `<roblox><Item class="Decal"><Properties><Content name="Texture"><url>http://www.roblox.com/asset/?id=17771234</url></Content></Properties></Item></roblox>`;
    assert.strictEqual(await textureIdFrom(bytes(xml)), '17771234');
  });

  test('from a binary model, plain or LZ4-packed', async function (assert) {
    const plain = model([
      { name: 'INST', data: bytes('\x00Decal') },
      { name: 'PROP', data: bytes('\x00\x00\x00\x00Texture\x1drbxassetid://99887766') },
    ]);
    assert.strictEqual(await textureIdFrom(plain), '99887766');

    // "rbxassetid://5555555": literals, then a match copying five 5s.
    const text = 'rbxassetid://5555555';
    const packed = new Uint8Array([
      (15 << 4) | 1, 0, ...bytes('rbxassetid://55'), 1, 0, 0,
    ]);
    assert.strictEqual(new TextDecoder().decode(lz4Block(packed, text.length)), text);
    const squeezed = model([{ name: 'PROP', data: packed, packed: text.length }]);
    assert.strictEqual(await textureIdFrom(squeezed), '5555555');
  });

  test('nothing to find is null, not a guess', async function (assert) {
    assert.strictEqual(await textureIdFrom(bytes('<roblox></roblox>')), null);
  });
});

module('Unit | uploading to Roblox', function (hooks) {
  let realFetch;
  let calls;
  hooks.beforeEach(async function () {
    calls = [];
    realFetch = window.fetch;
    // A signed-in session that hasn't run out, so nothing asks Roblox for tokens.
    await idbSet('auth:roblox', {
      access: 'token-1',
      refresh: 'refresh-1',
      expiresAt: Date.now() + 600000,
      user: { id: '42', name: 'gojo' },
    });
  });
  hooks.afterEach(async function () {
    window.fetch = realFetch;
    await idbDelete('auth:roblox');
  });

  test('uploads a decal, waits for it, and finds the picture behind it', async function (assert) {
    let polls = 0;
    window.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      if (url === 'https://apis.roblox.com/assets/v1/assets') return json({ path: 'operations/op-1', done: false });
      if (url === 'https://apis.roblox.com/assets/v1/operations/op-1')
        return json(
          ++polls < 2
            ? { path: 'operations/op-1', done: false }
            : { done: true, response: { assetId: '555', moderationResult: { moderationState: 'MODERATION_STATE_APPROVED' } } },
        );
      if (url === 'https://apis.roblox.com/asset-delivery-api/v1/assetId/555')
        return json({ location: 'https://c1.rbxcdn.com/decal-555' });
      if (url === 'https://c1.rbxcdn.com/decal-555')
        return new Response('<roblox><Item class="Decal"><Content name="Texture"><url>rbxassetid://777</url></Content></Item></roblox>');
      return new Response('{}', { status: 404 });
    };

    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const { decalId, moderation } = await uploadDecal(png, {
      name: 'Health 3/20',
      description: 'Step 3',
      userId: '42',
    });
    assert.strictEqual(decalId, '555');
    assert.strictEqual(moderation, 'MODERATION_STATE_APPROVED');

    const upload = calls[0];
    assert.strictEqual(upload.init.method, 'POST');
    assert.strictEqual(upload.init.headers.Authorization, 'Bearer token-1');
    const request = JSON.parse(upload.init.body.get('request'));
    assert.deepEqual(request, {
      assetType: 'Decal',
      displayName: 'Health 3/20',
      description: 'Step 3',
      creationContext: { creator: { userId: '42' } },
    });
    assert.strictEqual(upload.init.body.get('fileContent').type, 'image/png');
    assert.strictEqual(polls, 2, 'polled until the operation was done');

    assert.strictEqual(await imageIdOf('555'), '777', 'the image, not the decal');
  });
});
