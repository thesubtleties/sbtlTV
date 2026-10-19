import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { redactUrls, hostOf, cleanErrorText, PUBLIC_HOSTS, type HostLabeller } from './log-redact.js';

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
    forUrl: (host) => { seen.push(host); return host === 'provider.tv' ? '[source 1]' : '[host 1]'; },
    forBare: (token) => (token === 'provider.tv' ? '[source 1]' : null),
  };
  assert.equal(
    redactUrls('open http://PROVIDER.tv:80/live/u/p/1.ts then getaddrinfo ENOTFOUND provider.tv.', hosts),
    'open http://[source 1]/… then getaddrinfo ENOTFOUND [source 1].',
  );
  assert.deepEqual([...new Set(seen)], ['provider.tv']);  // the host as the labeller gets it (lowercased, no port)
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
  const started = performance.now();
  assert.equal(redactUrls(line), line);
  assert.equal(redactUrls(line, hosts), line);
  assert.equal(redactUrls('a.'.repeat(100_000), hosts), 'a.'.repeat(100_000));
  assert.ok(performance.now() - started < 2000, `took ${Math.round(performance.now() - started)}ms`);
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
    'http://[source: x http://bob:s3cret@real.example/live/u/p/1.ts y]',
    'see [source: a real.example b] ok',
    'http://[source 1x]real.example/live/bob/s3cret/1.ts',
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
  assert.equal(redactUrls('ok [source 1] and [host 2] stay', hosts), 'ok [source 1] and [host 2] stay');
});

test('a URL without a host still loses its path (file:// paths name the user)', () => {
  assert.equal(redactUrls('at file:///home/steven/secret/file.ts:10'), 'at file:///…');
  assert.equal(redactUrls('x:///home/steven/a.ts'), 'x:///…');
  assert.equal(redactUrls('http://:8080/home/steven/a.ts'), 'http:///…');
});

test('a long line of :// without spaces stays fast (the host pre-pass jumps like the main loop)', () => {
  const hosts: HostLabeller = { forUrl: () => '[host 1]', forBare: () => null };
  const line = 'a://'.repeat(100_000);
  const started = performance.now();
  redactUrls(line, hosts);
  redactUrls(line);
  assert.ok(performance.now() - started < 2000, `took ${Math.round(performance.now() - started)}ms`);
});

test('the readable public hosts are exactly these (mirrored in log_redact.h)', () => {
  assert.deepEqual([...PUBLIC_HOSTS].sort(), [
    'a.espncdn.com', 'am.i.mullvad.net', 'api.ratingposterdb.com', 'api.themoviedb.org', 'files.tmdb.org', 'github.com',
    'image.tmdb.org', 'objects.githubusercontent.com', 'raw.githubusercontent.com', 'release-assets.githubusercontent.com',
  ]);
});

test('only ASCII whitespace ends a URL (a non-breaking space must not leave the path behind)', () => {
  assert.equal(redactUrls('http://a.tv/x\u00a0/bob/s3cret/1.ts'), 'http://[host]/…');
  assert.equal(redactUrls('http://\u3000provider.tv/live/u/p/1.ts'), 'http:///…');
  assert.equal(redactUrls('a http://a.tv/x\tb'), 'a http://[host]/…\tb');
});

test('without source names, what an error says is a host is still labelled', () => {
  assert.equal(redactUrls('[ffmpeg] tcp: Failed to resolve hostname edge3.cdn.example: x'), '[ffmpeg] tcp: Failed to resolve hostname [host]: x');
  assert.equal(redactUrls('connect ECONNREFUSED 203.0.113.5:8080'), 'connect ECONNREFUSED [host]:8080');
  assert.equal(redactUrls('getaddrinfo ENOTFOUND api.themoviedb.org'), 'getaddrinfo ENOTFOUND api.themoviedb.org');
  assert.equal(redactUrls('listening on 127.0.0.1:9222'), 'listening on 127.0.0.1:9222');
});

test('more login names in queries: pwd, tokens of every kind, secrets', () => {
  assert.equal(redactUrls('pwd=hunter2&x=1'), 'pwd=…&x=1');
  assert.equal(redactUrls('access_token=abc refresh_token=def id_token=ghi auth_token=jkl'), 'access_token=… refresh_token=… id_token=… auth_token=…');
  assert.equal(redactUrls('client_secret=s3 secret=s4 auth=s5'), 'client_secret=… secret=… auth=…');
  // A longer word that merely ends like one is left alone
  assert.equal(redactUrls('monkey=1 bypass=2'), 'monkey=1 bypass=2');
});

test('logins in JSON fields are replaced, whatever the spacing', () => {
  assert.equal(redactUrls('{"username":"bob","password":"s3cret","ok":true}'), '{"username":"…","password":"…","ok":true}');
  assert.equal(redactUrls('{ "Password" : "a b" , "access_token":"x" }'), '{ "Password" : "…" , "access_token":"…" }');
  assert.equal(redactUrls('{"user_info":{"username":"bob","auth":1}}'), '{"user_info":{"username":"…","auth":1}}');
  assert.equal(redactUrls('{"passwordless":"yes"}'), '{"passwordless":"yes"}');
});

test('percent-encoded URLs are cut like plain ones', () => {
  assert.equal(redactUrls('url=http%3A%2F%2Fprovider.example%3A8080%2Flive%2Fu%2Fp%2F1.ts next'), 'url=http://[host]/… next');
  assert.equal(redactUrls('HTTPS%3a%2f%2fprovider.example'), 'HTTPS://[host]');
  assert.equal(redactUrls('u=http%3A%2F%2Fbob%3As3cret%40provider.example%2Fx'), 'u=http://…');
});

test('slash-escaped URLs (JSON) are cut like plain ones', () => {
  assert.equal(redactUrls('{"url":"http:\\/\\/provider.example\\/live\\/u\\/p\\/1.ts"}'), '{"url":"http://[host]/…');
  assert.equal(redactUrls('"stream":"https:\\/\\/user:pw@provider.example\\/x"'), '"stream":"https://…');
});

test('bare IPv6 addresses are labelled; times, MAC-like and loopback are not mistaken for hosts', () => {
  assert.equal(redactUrls('connect to 2001:db8:85a3::8a2e:370:7334 failed'), 'connect to [host] failed');
  assert.equal(redactUrls('peer fe80::1%eth0 and 2a00:1450:4001:82a::200e'), 'peer [host]%eth0 and [host]');
  assert.equal(redactUrls('at 12:34:56 and 00:00:01.500'), 'at 12:34:56 and 00:00:01.500');
  assert.equal(redactUrls('loopback ::1 stays'), 'loopback ::1 stays');
});

test('the new passes stay linear on hostile lines', () => {
  const lines = [
    '%3A%2F%2F'.repeat(20_000), ':\\/\\/'.repeat(30_000), '"password":'.repeat(20_000), 'a:'.repeat(100_000), '::'.repeat(100_000), 'access_token='.repeat(15_000),
  ];
  for (const line of lines) {
    const t = performance.now();
    redactUrls(line);
    assert.ok(performance.now() - t < 200, `${line.slice(0, 12)}… took too long`);
  }
});

test('an encoded URL after characters that change length when lowercased is still cut (no index drift)', () => {
  const line = 'İİİİ url=http%3A%2F%2Fprovider.example%2Flive%2Fu%2Fp%2F1.ts end';
  const out = redactUrls(line);
  assert.equal(out, 'İİİİ url=http://[host]/… end');
});

test('logins inside an encoded query are cut, and double-encoded or \\u-escaped URLs too', () => {
  assert.equal(redactUrls('next=%2Fget.php%3Fusername%3Dbob%26password%3Ds3cret%26type%3Dm3u'), 'next=%2Fget.php%3Fusername%3D…%26password%3D…%26type%3Dm3u');
  assert.equal(redactUrls('u=http%253A%252F%252Fprovider.example%252Fx'), 'u=http://[host]/…');
  assert.equal(redactUrls('{"u":"http:\\u002f\\u002fprovider.example\\u002flive"}'), '{"u":"http://[host]/…');
});

test('every login name is cut in all three shapes, and the native twin has exactly the same list', () => {
  const names = ['username', 'user', 'password', 'pass', 'passwd', 'pwd', 'token', 'access_token', 'refresh_token', 'id_token', 'auth_token', 'api_key', 'apikey', 'key', 'secret', 'client_secret', 'auth'];
  assert.equal(redactUrls(names.map((n) => `${n}=v`).join(' ')), names.map((n) => `${n}=…`).join(' '));
  assert.equal(redactUrls(names.map((n) => `"${n}":"v"`).join(',')), names.map((n) => `"${n}":"…"`).join(','));
  assert.equal(redactUrls(names.map((n) => `%26${n}%3Dv`).join('')), names.map((n) => `%26${n}%3D…`).join(''));
  const header = readFileSync(fileURLToPath(new URL('../../mpv-texture/src/native/log_redact.h', import.meta.url)), 'utf8');
  const kNames = /kNames\[\] = \{([^}]*)\}/.exec(header)![1].match(/"[^"]+"/g)!.map((q) => q.slice(1, -1));
  assert.deepEqual([...kNames].sort(), [...names].sort());
});

test('encoded, escaped and JSON login shapes the first tests did not pin', () => {
  // An encoded query at the start of a value (not after %3F or %26)
  assert.equal(redactUrls('q=username%3Dbob%26password%3Ds3cret'), 'q=username%3D…%26password%3D…');
  // Lower-case percent-encoding
  assert.equal(redactUrls('next=%2fget.php%3fusername%3dbob%26password%3ds3cret'), 'next=%2fget.php%3fusername%3D…%26password%3D…');
  // An escaped quote inside a JSON login does not end it
  assert.equal(redactUrls('{"password":"a\\"b s3cret","ok":1}'), '{"password":"…","ok":1}');
  // / with upper-case hex
  assert.equal(redactUrls('{"u":"http:\\u002F\\u002Fprovider.example\\u002Flive\\u002Fbob"}'), '{"u":"http://[host]/…');
  // Malformed percent-encoding: the loose decoder still sees the login before the host, and the path
  assert.equal(redactUrls('u=http%3A%2F%2Fbob%3As3cret%40provider.example%2Flive%2F100%'), 'u=http://…');
  assert.equal(redactUrls('u=http%3A%2F%2Fprovider.example%2Flive%2F100%'), 'u=http://[host]/…');
  // An encoded URL ends with its value
  assert.equal(redactUrls(`u=http%3A%2F%2Fh.example%2Fx&type=m3u {"u":"http%3A%2F%2Fh.example%2Fx","ok":1} 'http%3A%2F%2Fh.example%2Fx'!`),
    `u=http://[host]/…&type=m3u {"u":"http://[host]/…","ok":1} 'http://[host]/…'!`);
});

test('IPv6: only whole, well-formed addresses; lowercased; a URL host is the URL pass\'s', () => {
  for (const s of ['surface::bead and cafe::bead_x', 'ratio 1::2::3', 'x :1::2', 'deadbeef::1', '1:2:3:4:5:6:7:8::9']) assert.equal(redactUrls(s), s);
  const seen: string[] = [];
  redactUrls('FE80::1', { forUrl: (h) => h, forBare: (t) => { seen.push(t); return '[host]'; } });
  assert.deepEqual(seen, ['fe80::1']);
  const urlHosts: string[] = [];
  const numbered: HostLabeller = { forUrl: (h) => { urlHosts.push(h); return '[host 1]'; }, forBare: () => '[host 2]' };
  assert.equal(redactUrls('http://[2001:db8::1]:8080/x', numbered), 'http://[host 1]/…');
  assert.deepEqual([...new Set(urlHosts)], ['2001:db8::1']);
});

test("IPv6 in Node's connection errors is labelled whole (after ECONNREFUSED/hostname, with a port, before a colon)", () => {
  assert.equal(redactUrls('connect ECONNREFUSED 2001:db8::1:443'), 'connect ECONNREFUSED [host]');
  assert.equal(redactUrls('connect ETIMEDOUT 2606:4700::6810:84e5:443'), 'connect ETIMEDOUT [host]');
  assert.equal(redactUrls('Failed to resolve hostname 2001:db8::1: Name or service not known'), 'Failed to resolve hostname [host]: Name or service not known');
  assert.equal(redactUrls('connect to 2001:db8::1: Connection refused'), 'connect to [host]: Connection refused');
  assert.equal(redactUrls('x 1:2:3:4:5:6:7:8: err'), 'x [host]: err');
});

test('"::" separators and A-F prefixes are not addresses', () => {
  for (const line of ['handleLoadStream: DE:: ARD HD (12345)', 'CA :: CBC', 'sync :: done', 'bare :: and ::8080']) {
    assert.equal(redactUrls(line), line);
  }
  assert.equal(redactUrls('peer fe80::1 and 2001:db8:: up'), 'peer [host] and [host] up');
});

test('a hostname made of hex letters before a colon is still a host (only a real IPv6 run is left to the IPv6 pass)', () => {
  assert.equal(redactUrls('getaddrinfo ENOTFOUND cafe: lookup failed'), 'getaddrinfo ENOTFOUND [host]: lookup failed');
  assert.equal(redactUrls('connect ECONNREFUSED feed:8080'), 'connect ECONNREFUSED [host]:8080');
  assert.equal(redactUrls('connect ECONNREFUSED 2001:db8::1:443'), 'connect ECONNREFUSED [host]');
});

test('an encoded "://" without a scheme is cut like a plain one', () => {
  assert.equal(redactUrls('next=%3A%2F%2Fprovider.example%2Flive%2Fbob%2Fs3cret%2F1.ts'), 'next=://[host]/…');
});

test('an empty JSON login stays empty (it says the login is missing)', () => {
  assert.equal(redactUrls('{"username":"","password":""}'), '{"username":"","password":""}');
});

test('error text for the screen keeps the host, never a login', () => {
  const shown = cleanErrorText('Request cannot be constructed from a URL that includes credentials: http://bob:s3cret@provider.example:8080/series/bob/s3cret/1.mkv?token=t');
  assert.equal(shown.includes('s3cret') || shown.includes('bob') || shown.includes('token=t'), false, shown);
  assert.equal(cleanErrorText('fetch failed: http://provider.example:8080/get.php?username=u&password=p'), 'fetch failed: http://provider.example/…');
});
