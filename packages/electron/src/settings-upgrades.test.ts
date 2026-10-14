import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settleTeamLogosDefault } from './settings-upgrades.js';

test('team logos: an existing install that never chose keeps them on', () => {
  assert.deepEqual(settleTeamLogosDefault({}, true), { sportsMatchupEnabled: true, sportsDefaultSettled: true });
});

test('team logos: a new install starts off', () => {
  assert.deepEqual(settleTeamLogosDefault({}, false), { sportsDefaultSettled: true });
});

test('team logos: a saved choice is kept, on or off', () => {
  assert.deepEqual(settleTeamLogosDefault({ sportsMatchupEnabled: false }, true), { sportsDefaultSettled: true });
  assert.deepEqual(settleTeamLogosDefault({ sportsMatchupEnabled: true }, true), { sportsDefaultSettled: true });
});

test('team logos: it runs once (a later choice to turn them off stays off)', () => {
  assert.equal(settleTeamLogosDefault({ sportsDefaultSettled: true }, true), null);
  assert.equal(settleTeamLogosDefault({ sportsMatchupEnabled: false, sportsDefaultSettled: true }, true), null);
});
