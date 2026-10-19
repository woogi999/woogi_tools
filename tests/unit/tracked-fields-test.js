import { module, test } from 'qunit';
import { countRuns } from './tracked-fields.svelte.js';
import { prop } from '../../app/core/helpers.js';

module('Unit | tracked fields', function () {
  // lib/tracked-fields-plugin.mjs: a class field tells its readers about every
  // assignment, as Ember's @tracked did. If a Svelte update changes how class
  // fields compile, this fails instead of the site quietly changing behaviour.
  test('a class field notifies on an assignment of the same value', function (assert) {
    assert.deepEqual(countRuns(), [1, 1, 2]);
  });

  test('prop() puts the bound value back over what was typed', function (assert) {
    const input = document.createElement('input');
    input.type = 'number';
    const attach = prop('value', () => 36);
    attach(input);
    assert.strictEqual(input.value, '36');
    input.value = '42';
    attach(input);
    assert.strictEqual(input.value, '36');
  });
});
