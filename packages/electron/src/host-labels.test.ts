import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HostLabels } from './host-labels.js';
import { redactUrls } from './log-redact.js';

const sources = [
  { name: 'lemo', url: 'http://Lemo.example:8080', epg_url: 'http://guide.lemo.example/xmltv.php' },
  { name: 'Local playlist', url: '' },
  { name: 'second', url: 'http://second.example' },
];

test('a source host gets its number in the Sources list; other hosts are numbered by first appearance', () => {
  const labels = new HostLabels();
  labels.setSources(sources);
  const l = labels.labeller();
  assert.equal(redactUrls('open http://lemo.example:8080/live/u/p/1.ts', l), 'open http://[source 1]/…');
  assert.equal(redactUrls('guide http://guide.lemo.example/xmltv.php?username=u', l), 'guide http://[source 1]/…');
  assert.equal(redactUrls('open http://second.example/x', l), 'open http://[source 3]/…');
  assert.equal(redactUrls('redirect http://cdn-a.example/x then http://cdn-b.example/y', l), 'redirect http://[host 1]/… then http://[host 2]/…');
  assert.equal(redactUrls('again http://cdn-a.example/z', l), 'again http://[host 1]/…');
});

test('the legend says which source a number is (for Settings > Debug, never written to the log)', () => {
  const labels = new HostLabels();
  labels.setSources(sources);
  assert.deepEqual(labels.legend(), [{ n: 1, name: 'lemo' }, { n: 2, name: 'Local playlist' }, { n: 3, name: 'second' }]);
});

test('bare hostnames are labelled when known (a source host, one seen in a URL, or a subdomain of one)', () => {
  const labels = new HostLabels();
  labels.setSources(sources);
  const l = labels.labeller();
  assert.equal(redactUrls('getaddrinfo ENOTFOUND LEMO.example', l), 'getaddrinfo ENOTFOUND [source 1]');
  assert.equal(redactUrls('connect cdn-a.example:443', l), 'connect cdn-a.example:443');
  redactUrls('http://cdn-a.example/x', l);
  assert.equal(redactUrls('connect cdn-a.example:443', l), 'connect [host 1]:443');
  assert.equal(redactUrls('edge2.lemo.example is slow', l), '[host 2] is slow');
  assert.equal(redactUrls('libavcodec.so.61 v0.13.0', l), 'libavcodec.so.61 v0.13.0');
});

test('a host the app never saw is labelled from what the error says about it', () => {
  const labels = new HostLabels();
  const l = labels.labeller();
  assert.equal(redactUrls('[ffmpeg] tcp: Failed to resolve hostname edge3.cdn.example: Name or service not known', l),
    '[ffmpeg] tcp: Failed to resolve hostname [host 1]: Name or service not known');
  assert.equal(redactUrls('getaddrinfo EAI_AGAIN unseen.example', l), 'getaddrinfo EAI_AGAIN [host 2]');
  assert.equal(redactUrls('connect ECONNREFUSED 203.0.113.5:8080', l), 'connect ECONNREFUSED [host 3]:8080');
  assert.equal(redactUrls('peer 198.51.100.7 closed, local 127.0.0.1 fine', l), 'peer [host 4] closed, local 127.0.0.1 fine');
});

test('public services are never labelled', () => {
  const labels = new HostLabels();
  const l = labels.labeller();
  assert.equal(redactUrls('https://image.tmdb.org/t/p/w500/x.jpg', l), 'https://image.tmdb.org/…');
  assert.equal(redactUrls('getaddrinfo ENOTFOUND files.tmdb.org', l), 'getaddrinfo ENOTFOUND files.tmdb.org');
});

test('with addresses included (debug log, user choice) hosts stay and are still remembered; logins are still removed', () => {
  const labels = new HostLabels();
  labels.setSources(sources);
  assert.equal(redactUrls('open http://lemo.example:8080/live/bob/s3cret/1.ts', labels.labeller(true)), 'open http://lemo.example/…');
  assert.equal(redactUrls('GET http://lemo.example/player_api.php?username=bob&password=x', labels.labeller(true)), 'GET http://lemo.example/…');
  redactUrls('redirect http://only-on.example/x', labels.labeller(true));
  assert.equal(redactUrls('ENOTFOUND only-on.example', labels.labeller()), 'ENOTFOUND [host 1]');
});

test('the error card keeps real hostnames (it is only on the user\'s screen), never logins', () => {
  const labels = new HostLabels();
  labels.setSources(sources);
  const card = labels.cardLabeller();
  assert.equal(redactUrls('Failed to open http://bob:pw@lemo.example:8080/live/bob/s3cret/1.ts', card), 'Failed to open http://…');
  assert.equal(redactUrls('Failed to open http://cdn9.example/live/bob/s3cret/1.ts', card), 'Failed to open http://cdn9.example/…');
  assert.equal(redactUrls('Failed to resolve hostname cdn9.example: x', card), 'Failed to resolve hostname cdn9.example: x');
  assert.equal(redactUrls('ENOTFOUND cdn9.example', labels.labeller()), 'ENOTFOUND [host 1]');
});

test('labels follow the current sources (reordered or removed mid-session)', () => {
  const labels = new HostLabels();
  labels.setSources(sources);
  const l = labels.labeller();
  labels.setSources([{ name: 'second', url: 'http://second.example' }, { name: 'lemo', url: 'http://lemo.example' }]);
  assert.equal(redactUrls('http://lemo.example/x', l), 'http://[source 2]/…');
  labels.setSources([]);
  assert.match(redactUrls('http://lemo.example/x', l), /^http:\/\/\[host \d+\]\/…$/);
});

test('a host behind user:pass@ is remembered too (the URL itself collapses to scheme://…)', () => {
  const labels = new HostLabels();
  const l = labels.labeller();
  assert.equal(redactUrls('open http://bob:pw@hidden-behind-at.example/x', l), 'open http://…');
  assert.equal(redactUrls('ENOTFOUND HIDDEN-BEHIND-AT.example', l), 'ENOTFOUND [host 1]');
});

test('a host announced at load (noteUrl) is labelled when mpv names it bare', () => {
  const labels = new HostLabels();
  const l = labels.labeller();
  labels.noteUrl('http://sbtl-probe.invalid:8080/live/u/p/1.ts');
  assert.equal(redactUrls('ffmpeg: tcp: Failed to resolve hostname sbtl-probe.invalid: Name or service not known', l),
    'ffmpeg: tcp: Failed to resolve hostname [host 1]: Name or service not known');
  labels.noteUrl('not a url');
});

test('redacting text that is already redacted changes nothing (the card text is logged again)', () => {
  const labels = new HostLabels();
  labels.setSources([{ name: 'provider.tv', url: 'http://provider.tv' }]);
  const l = labels.labeller();
  for (const line of ['stream: Failed to open http://cdn.example/live/u/p/1.ts', 'http://provider.tv/x and provider.tv', 'open http://[2001:db8::1]:80/x']) {
    const once = redactUrls(line, l);
    assert.equal(redactUrls(once, l), once);
  }
  assert.equal(redactUrls('Failed to open http://[host]/…'), 'Failed to open http://[host]/…');
});

test('a URL glued to JSON registers its real host, so a later bare mention is labelled', () => {
  const labels = new HostLabels();
  const out = redactUrls('{"url":"http://qq.tv","x":1} later qq.tv', labels.labeller());
  assert.ok(!out.includes('qq.tv'), out);
});

test('a bare host before its URL on the same line is labelled', () => {
  const labels = new HostLabels();
  const out = redactUrls('ENOTFOUND cdn.zzz.tv (http://cdn.zzz.tv/live/a/b/1.ts)', labels.labeller());
  assert.ok(!out.includes('cdn.zzz.tv'), out);
});

test('a removed source keeps its host known (an in-flight error still names it)', () => {
  const labels = new HostLabels();
  const l = labels.labeller();
  labels.setSources([{ name: 'my', url: 'http://my.tv' }]);
  labels.setSources([]);
  assert.equal(redactUrls('getaddrinfo ENOTFOUND my.tv', l), 'getaddrinfo ENOTFOUND [host 1]');
});

test('numbered hosts are capped, and absurdly long hosts are never stored', () => {
  const labels = new HostLabels();
  const l = labels.labeller();
  const long = `${'a'.repeat(260)}.example`;
  assert.equal(redactUrls(`http://${long}/x`, l), 'http://[host]/…');
  for (let i = 0; i < 1100; i++) redactUrls(`http://h${i}.example/x`, l);
  assert.equal(redactUrls('http://h1099.example/x', l), 'http://[host]/…');
  assert.equal(redactUrls('http://h5.example/x', l), 'http://[host 6]/…');
});
