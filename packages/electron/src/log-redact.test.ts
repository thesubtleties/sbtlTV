import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactUrls } from './log-redact.js';

test('stream URLs keep only scheme and host (Xtream puts the username and password in the path)', () => {
  assert.equal(
    redactUrls('Failed to open http://kytv.xyz:8080/live/someuser/s3cret/12345.ts.'),
    'Failed to open http://kytv.xyz:8080/…',
  );
  assert.equal(redactUrls('  URL: https://host.example/movie/u/p/99.mkv'), '  URL: https://host.example/…');
});

test('credentials before the host and in the query are dropped too', () => {
  assert.equal(redactUrls('http://user:pass@host.example/x'), 'http://host.example/…');
  assert.equal(redactUrls('http://host.example?username=u&password=p'), 'http://host.example/…');
});

test('every URL in a line is redacted; text without one is unchanged', () => {
  assert.equal(redactUrls('a http://a.example/1 b "http://b.example/2"'), 'a http://a.example/… b "http://b.example/…"');
  assert.equal(redactUrls('Decoding 1920x1080 hwdec:vaapi'), 'Decoding 1920x1080 hwdec:vaapi');
  assert.equal(redactUrls('Attempting to load: http://host.example'), 'Attempting to load: http://host.example');
});
