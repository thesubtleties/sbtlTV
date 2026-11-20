import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveOnWindowClose } from './window-close.js';

const base = { alreadySaved: false, quitting: false, installingUpdate: false, recovering: false };

test('closing the window with X saves first (playback position, sync)', () => {
  assert.equal(saveOnWindowClose(base), true);
});

test('a quit already saved: the window closes at once, so the quit is not cancelled (macOS stayed running with no data process)', () => {
  assert.equal(saveOnWindowClose({ ...base, quitting: true }), false);
});

test('no second save, and none while an update installs or the player recovers', () => {
  assert.equal(saveOnWindowClose({ ...base, alreadySaved: true }), false);
  assert.equal(saveOnWindowClose({ ...base, installingUpdate: true }), false);
  assert.equal(saveOnWindowClose({ ...base, recovering: true }), false);
});
