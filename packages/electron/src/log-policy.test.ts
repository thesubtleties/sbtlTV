import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LogPolicy } from './log-policy.js';

const sources = [{ name: 'lemo', url: 'http://lemo.example:8080' }];
const line = 'Failed to open http://lemo.example:8080/live/bob/s3cret/1.ts via http://cdn9.example/x';

test('a new policy (every launch) writes labels: addresses are off and never saved', () => {
  const policy = new LogPolicy(sources);
  assert.equal(policy.addressesIncluded, false);
  assert.equal(policy.forLog(line), 'Failed to open http://[source 1]/… via http://[host 1]/…');
  assert.equal(policy.headerLine(), 'Provider addresses: replaced by labels');
});

test('including addresses changes the debug log only; the terminal keeps labels; logins never', () => {
  const policy = new LogPolicy(sources);
  const change = policy.setIncludeAddresses(true);
  assert.equal(change.included, true);
  assert.match(change.logLine ?? '', /included in this log from here on/);
  assert.equal(policy.forLog(line), 'Failed to open http://lemo.example/… via http://cdn9.example/…');
  assert.equal(policy.forDisplay(line), 'Failed to open http://[source 1]/… via http://[host 1]/…');
  assert.equal(policy.headerLine(), 'Provider addresses: included (turned on in Settings > Debug)');
  assert.equal(policy.setIncludeAddresses(true).logLine, null);
  assert.match(policy.setIncludeAddresses(false).logLine ?? '', /replaced by labels again/);
});

test('anything but true turns addresses off (IPC input)', () => {
  const policy = new LogPolicy(sources);
  policy.setIncludeAddresses(true);
  for (const value of ['true', 1, {}, null, undefined]) {
    policy.setIncludeAddresses(true);
    assert.equal(policy.setIncludeAddresses(value).included, false);
  }
});

test('the error card shows real hostnames (user\'s screen only), never logins or paths', () => {
  const policy = new LogPolicy(sources);
  assert.equal(policy.forCard(line), 'Failed to open http://lemo.example/… via http://cdn9.example/…');
  assert.equal(policy.forCard('tcp: Failed to resolve hostname edge.cdn.example: x'), 'tcp: Failed to resolve hostname edge.cdn.example: x');
});

test('hosts met while addresses were included are still labelled in the terminal later', () => {
  const policy = new LogPolicy(sources);
  policy.setIncludeAddresses(true);
  policy.forLog('redirect http://only-on.example/x');
  policy.setIncludeAddresses(false);
  assert.equal(policy.forDisplay('ENOTFOUND only-on.example'), 'ENOTFOUND [host 1]');
});

test('loads announce their host; sources and the legend follow changes', () => {
  const policy = new LogPolicy([]);
  policy.noteUrl('http://loaded.example/live/a/b/1.ts');
  assert.equal(policy.forDisplay('Failed to resolve hostname loaded.example: x'), 'Failed to resolve hostname [host 1]: x');
  policy.setSources([{ name: 'a', url: 'http://a.example' }, { name: 'b', url: 'http://b.example' }]);
  assert.deepEqual(policy.legend(), [{ n: 1, name: 'a' }, { n: 2, name: 'b' }]);
  assert.equal(policy.forDisplay('http://b.example/x'), 'http://[source 2]/…');
});

test("a source's id in a log line reads as its [source N], matching the Debug tab legend", () => {
  const policy = new LogPolicy([{ id: '3f2a9c1e-77b0-4d2e-9a51-0c4b8e6d1f20', name: 'lemo', url: 'http://lemo.example:8080' }]);
  assert.equal(policy.forLog('Source 3f2a9c1e-77b0-4d2e-9a51-0c4b8e6d1f20 is stale, syncing...'), 'Source [source 1] is stale, syncing...');
  assert.equal(policy.forDisplay('Sync FAILED for source 3f2a9c1e-77b0-4d2e-9a51-0c4b8e6d1f20: x'), 'Sync FAILED for source [source 1]: x');
  // Unknown ids stay as they are (random, they say nothing)
  assert.equal(policy.forLog('Source 00000000-0000-0000-0000-000000000000 is stale'), 'Source 00000000-0000-0000-0000-000000000000 is stale');
});

test("an encoded URL on a known source's subdomain is cut whole, logins and all, and stays the same when redacted again", () => {
  const policy = new LogPolicy([{ name: 'S', url: 'http://src.example' }]);
  const once = policy.forLog('u=http%3A%2F%2Fedge.src.example%2Flive%2Fbob%2Fs3cret%2F1.ts');
  assert.equal(once.includes('s3cret') || once.includes('bob'), false, once);
  assert.match(once, /^u=http:\/\/\[(source|host) \d+\]\/…$/);
  const bare = policy.forLog('resolving enc2.example for url=http%3A%2F%2Fenc2.example%2Fx');
  assert.equal(bare.includes('enc2.example'), false, bare);
  assert.equal(policy.forLog(bare), bare);
});
