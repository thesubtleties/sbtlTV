import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HostLabels } from './host-labels.js';
import { redactUrls } from './log-redact.js';

const sources = [
  { name: 'lemo', url: 'http://Lemo.example:8080', epg_url: 'http://guide.lemo.example/xmltv.php' },
  { name: 'Local playlist', url: '' },
];

test('a source host gets the source name; other hosts are numbered by first appearance', () => {
  const labels = new HostLabels();
  labels.setSources(sources);
  const l = labels.labeller();
  assert.equal(redactUrls('open http://lemo.example:8080/live/u/p/1.ts', l), 'open http://[source: lemo]/…');
  assert.equal(redactUrls('guide http://guide.lemo.example/xmltv.php?username=u', l), 'guide http://[source: lemo]/…');
  assert.equal(redactUrls('redirect http://cdn-a.example/x then http://cdn-b.example/y', l), 'redirect http://[host 1]/… then http://[host 2]/…');
  assert.equal(redactUrls('again http://cdn-a.example/z', l), 'again http://[host 1]/…');
});

test('bare hostnames are labelled only when known (a source host, or seen in a URL)', () => {
  const labels = new HostLabels();
  labels.setSources(sources);
  const l = labels.labeller();
  assert.equal(redactUrls('getaddrinfo ENOTFOUND lemo.example', l), 'getaddrinfo ENOTFOUND [source: lemo]');
  assert.equal(redactUrls('connect cdn-a.example:443', l), 'connect cdn-a.example:443');
  redactUrls('http://cdn-a.example/x', l);
  assert.equal(redactUrls('connect cdn-a.example:443', l), 'connect [host 1]:443');
  assert.equal(redactUrls('libavcodec.so.61 v0.13.0', l), 'libavcodec.so.61 v0.13.0');
});

test('public services are never labelled', () => {
  const labels = new HostLabels();
  const l = labels.labeller();
  assert.equal(redactUrls('https://image.tmdb.org/t/p/w500/x.jpg', l), 'https://image.tmdb.org/…');
});

test('with addresses included (debug log, user choice) hosts stay; logins are still removed', () => {
  const labels = new HostLabels();
  labels.setSources(sources);
  assert.equal(redactUrls('open http://lemo.example:8080/live/bob/s3cret/1.ts', labels.labeller(true)), 'open http://lemo.example/…');
  assert.equal(redactUrls('GET http://lemo.example/player_api.php?username=bob&password=x', labels.labeller(true)), 'GET http://lemo.example/…');
  assert.equal(redactUrls('open http://lemo.example:8080/live/bob/s3cret/1.ts', labels.labeller()), 'open http://[source: lemo]/…');
});

test('labels follow the current sources (renamed or removed mid-session)', () => {
  const labels = new HostLabels();
  labels.setSources(sources);
  const l = labels.labeller();
  labels.setSources([{ name: 'lemo 2', url: 'http://lemo.example' }]);
  assert.equal(redactUrls('http://lemo.example/x', l), 'http://[source: lemo 2]/…');
  labels.setSources([]);
  assert.equal(redactUrls('http://lemo.example/x', l), 'http://[host 1]/…');
});

test('a source named like a host is not relabelled', () => {
  const labels = new HostLabels();
  labels.setSources([{ name: 'provider.tv', url: 'http://provider.tv' }]);
  assert.equal(redactUrls('http://provider.tv/x and provider.tv', labels.labeller()), 'http://[source: provider.tv]/… and [source: provider.tv]');
});
