import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactUrls, hostOf, PUBLIC_HOSTS, type HostLabeller } from './log-redact.js';

test('stream URLs keep only the scheme and a host label (Xtream puts the username and password in the path)', () => {
  assert.equal(
    redactUrls('Failed to open http://provider.example:8080/live/someuser/s3cret/12345.ts.'),
    'Failed to open http://[host]/…',
  );
  assert.equal(redactUrls('  URL: https://host.example/movie/u/p/99.mkv'), '  URL: https://[host]/…');
});

test('credentials before the host and in the query are dropped too', () => {
  assert.equal(redactUrls('http://user:pass@host.example/x'), 'http://…');
  assert.equal(redactUrls('http://user:p@ss@host.example/x'), 'http://…');
  assert.equal(redactUrls('http://user:pa/ss@host.example/x'), 'http://…');
  assert.equal(redactUrls('http://host.example?username=u&password=p'), 'http://[host]/…');
});

test('text glued in front of a URL does not let it through', () => {
  assert.equal(redactUrls('x1http://provider.example/live/u/p/1.ts'), 'x1http://[host]/…');
  assert.equal(redactUrls('[http://provider.example/live/u/p/1.ts]'), '[http://[host]/…');
  assert.equal(redactUrls('://provider.example/live/u/p/1.ts'), '://[host]/…');
});

test('every URL in a line is redacted; text without one is unchanged', () => {
  assert.equal(redactUrls('a http://a.example/1 b http://b.example/2'), 'a http://[host]/… b http://[host]/…');
  assert.equal(redactUrls('Decoding 1920x1080 hwdec:vaapi'), 'Decoding 1920x1080 hwdec:vaapi');
  assert.equal(redactUrls('Attempting to load: http://host.example'), 'Attempting to load: http://[host]');
});

test('public services stay readable', () => {
  assert.equal(redactUrls('GET https://api.themoviedb.org/3/movie/1?api_key=abc'), 'GET https://api.themoviedb.org/…');
  assert.equal(redactUrls('logo https://a.espncdn.com/i/teamlogos/nfl/500/den.png'), 'logo https://a.espncdn.com/…');
  assert.equal(PUBLIC_HOSTS.has('am.i.mullvad.net'), true);
});

test('host forms: case, port, IPv6, empty host', () => {
  assert.equal(hostOf('Provider.Example:8080'), 'provider.example');
  assert.equal(hostOf('[2001:DB8::1]:8080'), '2001:db8::1');
  assert.equal(hostOf('host.example'), 'host.example');
  assert.equal(redactUrls('http://[2001:db8::1]:8080/live/u/p/1.ts'), 'http://[host]/…');
  assert.equal(redactUrls('a x:// b'), 'a x:// b');
});

test('a labeller decides URL hosts and known bare hosts; labels are never re-scanned', () => {
  const seen: string[] = [];
  const hosts: HostLabeller = {
    forUrl: (host) => { seen.push(host); return host === 'provider.tv' ? '[source: provider.tv]' : '[host 1]'; },
    forBare: (token) => (token === 'provider.tv' ? '[source: provider.tv]' : null),
  };
  assert.equal(
    redactUrls('open http://PROVIDER.tv:80/live/u/p/1.ts then getaddrinfo ENOTFOUND provider.tv.', hosts),
    'open http://[source: provider.tv]/… then getaddrinfo ENOTFOUND [source: provider.tv].',
  );
  assert.deepEqual(seen, ['provider.tv']);
});

test('dotted words that are not known hosts are left alone', () => {
  const hosts: HostLabeller = { forUrl: () => '[host 1]', forBare: (t) => (t === 'cdn.example' ? '[host 1]' : null) };
  const line = 'libavcodec.so.61 v0.13.0 1920x1080 stream.ts hwdec:vaapi';
  assert.equal(redactUrls(line, hosts), line);
  assert.equal(redactUrls('redirect to cdn.example:443 failed', hosts), 'redirect to [host 1]:443 failed');
});

test('a quote or < in the password does not end the URL early', () => {
  assert.equal(redactUrls(`Opening 'http://host.example/live/u/pa"s'w<rd/1.ts' for reading`), `Opening 'http://[host]/… for reading`);
});

test('a long line is handled quickly (no backtracking), with and without dots', () => {
  const line = 'a'.repeat(200_000) + ' b.c-d+e'.repeat(20_000);
  const hosts: HostLabeller = { forUrl: () => '[host 1]', forBare: () => null };
  const started = Date.now();
  assert.equal(redactUrls(line), line);
  assert.equal(redactUrls(line, hosts), line);
  assert.equal(redactUrls('a.'.repeat(100_000), hosts), 'a.'.repeat(100_000));
  assert.ok(Date.now() - started < 200, `took ${Date.now() - started}ms`);
});

test('login details outside a URL are cleaned too', () => {
  assert.equal(redactUrls('GET player_api.php?username=bob&password=s3cret&action=x'), 'GET player_api.php?username=…&password=…&action=x');
  assert.equal(redactUrls("Opening 'live/bob/s3cret/12345.ts'"), "Opening 'live/…/12345.ts'");
  assert.equal(redactUrls('Location: /movie/bob/s3cret/99.mkv'), 'Location: /movie/…/99.mkv');
  assert.equal(redactUrls('token=abc123 and api_key=xyz'), 'token=… and api_key=…');
});

test('text that only looks like a label does not slip past redaction', () => {
  const hosts: HostLabeller = { forUrl: () => '[host 1]', forBare: (t) => (t === 'real.example' ? '[host 1]' : null) };
  for (const line of [
    'http://[host]/live/bob/s3cret/1.ts?password=s3cret',
    'http://[host]evil.example/live/bob/s3cret/1.ts',
    'http://[source:x]real.example/live/bob/s3cret/1.ts',
    'a http://[host 1 then http://real.example/live/bob/s3cret/1.ts ]',
    'see [host then real.example/live/bob/s3cret/2.ts ok]',
  ]) {
    const out = redactUrls(line, hosts);
    assert.ok(!out.includes('s3cret') && !out.includes('bob') && !out.includes('real.example') && !out.includes('evil.example'), `${line} -> ${out}`);
  }
  assert.equal(redactUrls('Failed to open http://[host 1]/…', hosts), 'Failed to open http://[host 1]/…');
  assert.equal(redactUrls('ok [source: lemo] and [host 2] stay', hosts), 'ok [source: lemo] and [host 2] stay');
});
