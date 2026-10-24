import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isKeyringSealed } from './secret-fallback.js';

test('a secret stored without encryption is not keyring-sealed', () => {
  assert.equal(isKeyringSealed(Buffer.from('hunter2').toString('base64')), false);
});

test("Chromium's encrypted values (v10/v11) are recognised, so they are never exported as garbage", () => {
  for (const prefix of ['v10', 'v11']) {
    assert.equal(isKeyringSealed(Buffer.concat([Buffer.from(prefix), Buffer.from([0x8f, 0x01, 0xff])]).toString('base64')), true);
  }
});
