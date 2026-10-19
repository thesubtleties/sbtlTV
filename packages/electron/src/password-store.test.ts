import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEYRINGS, keyringOfBackend, keyringToKeep, resolvePasswordStore } from './password-store.js';

test('a launch that names a keyring keeps it and leaves the switch as it is', () => {
  assert.deepEqual(resolvePasswordStore('kwallet6', null), { apply: null, remember: 'kwallet6' });
  assert.deepEqual(resolvePasswordStore('kwallet6', 'kwallet6'), { apply: null, remember: null });
  assert.deepEqual(resolvePasswordStore('gnome-libsecret', 'kwallet6'), { apply: null, remember: 'gnome-libsecret' });
  for (const keyring of KEYRINGS) {
    assert.deepEqual(resolvePasswordStore(keyring, null), { apply: null, remember: keyring });
  }
});

test('a launch without one (the updater relaunch, another launcher) gets the kept keyring back', () => {
  assert.deepEqual(resolvePasswordStore('', 'kwallet6'), { apply: 'kwallet6', remember: null });
  assert.deepEqual(resolvePasswordStore('', 'basic'), { apply: 'basic', remember: null });
  assert.deepEqual(resolvePasswordStore('', null), { apply: null, remember: null });
});

test('unknown keyring names are neither kept nor applied, and do not replace the kept one', () => {
  assert.deepEqual(resolvePasswordStore('../../etc', null), { apply: null, remember: null });
  assert.deepEqual(resolvePasswordStore('gnome', 'kwallet6'), { apply: null, remember: null });
  assert.deepEqual(resolvePasswordStore('', 'nonsense'), { apply: null, remember: null });
});

test("Chromium's backend names map to switch values", () => {
  assert.equal(keyringOfBackend('gnome_libsecret'), 'gnome-libsecret');
  assert.equal(keyringOfBackend('kwallet6'), 'kwallet6');
  assert.equal(keyringOfBackend('kwallet5'), 'kwallet5');
  assert.equal(keyringOfBackend('kwallet'), 'kwallet');
  assert.equal(keyringOfBackend('basic_text'), 'basic');
  assert.equal(keyringOfBackend('unknown'), null);
});

test('the first real keyring found is kept; no keyring (basic) is kept only when chosen', () => {
  assert.equal(keyringToKeep(null, 'kwallet6'), 'kwallet6');
  assert.equal(keyringToKeep(null, 'gnome_libsecret'), 'gnome-libsecret');
  assert.equal(keyringToKeep(null, 'basic_text'), null);
  assert.equal(keyringToKeep(null, 'unknown'), null);
  // Already kept: a desktop change does not replace it
  assert.equal(keyringToKeep('kwallet6', 'gnome_libsecret'), null);
  assert.equal(keyringToKeep('basic', 'kwallet6'), null);
  // A broken kept value is replaced by what was found
  assert.equal(keyringToKeep('nonsense', 'kwallet6'), 'kwallet6');
});
