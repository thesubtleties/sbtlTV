import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePasswordStore } from './password-store.js';

test('a launch that names a keyring remembers it and leaves the switch as it is', () => {
  assert.deepEqual(resolvePasswordStore(['/app/sbtlTV', '--password-store=kwallet6'], null), { apply: null, remember: 'kwallet6' });
  assert.deepEqual(resolvePasswordStore(['/app/sbtlTV', '--password-store=kwallet6'], 'kwallet6'), { apply: null, remember: null });
  assert.deepEqual(resolvePasswordStore(['/app/sbtlTV', '--password-store=gnome-libsecret'], 'kwallet6'), { apply: null, remember: 'gnome-libsecret' });
});

test('a launch without one (the updater relaunch) gets the remembered keyring back', () => {
  assert.deepEqual(resolvePasswordStore(['/app/sbtlTV'], 'kwallet6'), { apply: 'kwallet6', remember: null });
  assert.deepEqual(resolvePasswordStore(['/app/sbtlTV'], null), { apply: null, remember: null });
});

test('unknown keyring names are neither remembered nor applied', () => {
  assert.deepEqual(resolvePasswordStore(['/app/sbtlTV', '--password-store=../../etc'], null), { apply: null, remember: null });
  assert.deepEqual(resolvePasswordStore(['/app/sbtlTV'], 'nonsense'), { apply: null, remember: null });
});
