import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactUrls } from './log-redact.js';

test('stream URLs keep only scheme and host (Xtream puts the username and password in the path)', () => {
  assert.equal(
    redactUrls('Failed to open http://provider.example:8080/live/someuser/s3cret/12345.ts.'),
    'Failed to open http://provider.example:8080/…',
  );
  assert.equal(redactUrls('  URL: https://host.example/movie/u/p/99.mkv'), '  URL: https://host.example/…');
});

test('credentials before the host and in the query are dropped too', () => {
  assert.equal(redactUrls('http://user:pass@host.example/x'), 'http://…');
  assert.equal(redactUrls('http://user:p@ss@host.example/x'), 'http://…');
  assert.equal(redactUrls('http://user:pa/ss@host.example/x'), 'http://…');
  assert.equal(redactUrls('http://host.example?username=u&password=p'), 'http://host.example/…');
});

test('text glued in front of a URL does not let it through', () => {
  assert.equal(redactUrls('x1http://provider.example/live/u/p/1.ts'), 'x1http://provider.example/…');
  assert.equal(redactUrls('[http://provider.example/live/u/p/1.ts]'), '[http://provider.example/…');
  assert.equal(redactUrls('://provider.example/live/u/p/1.ts'), '://provider.example/…');
});

test('every URL in a line is redacted; text without one is unchanged', () => {
  assert.equal(redactUrls('a http://a.example/1 b http://b.example/2'), 'a http://a.example/… b http://b.example/…');
  assert.equal(redactUrls('Decoding 1920x1080 hwdec:vaapi'), 'Decoding 1920x1080 hwdec:vaapi');
  assert.equal(redactUrls('Attempting to load: http://host.example'), 'Attempting to load: http://host.example');
});

test('a quote or < in the password does not end the URL early', () => {
  assert.equal(redactUrls(`Opening 'http://host.example/live/u/pa"s'w<rd/1.ts' for reading`), `Opening 'http://host.example/… for reading`);
});
