import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decompressToFile, parseXmltvChunks, parseXmltvFile } from '../src/epg.js';
import { nodePlatform } from '../src/node/index.js';

const P = nodePlatform();

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="cbs.us"><display-name>CBS</display-name><display-name>CBS Chicago</display-name></channel>
  <channel id="abc.us"><display-name>ABC</display-name></channel>
  <programme start="20260921120000 +0000" stop="20260921130000 +0000" channel="cbs.us"><title>Noon News</title><desc>Local &amp; national</desc></programme>
  <programme start="20260921130000 +0000" stop="20260921140000 +0000" channel="abc.us"><title>GMA3</title></programme>
</tv>`;

test('decompressToFile inflates a gzip file by magic bytes and reports the size', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'epg-'));
  const gz = path.join(dir, 'guide.xml.gz');
  writeFileSync(gz, gzipSync(Buffer.from(XML)));
  const { xmlPath, sizeMB } = await decompressToFile(P, gz, () => {});
  assert.ok(sizeMB >= 0);
  assert.notEqual(xmlPath, gz);
  const programs: unknown[] = [];
  const parsed = await parseXmltvFile(P, xmlPath, undefined, () => {}, (p) => programs.push(p));
  assert.equal(parsed.channels.length, 2);
  assert.equal(programs.length, 2);
  assert.equal(parsed.programCount, 2);
});

test('decompressToFile leaves a plain XML file where it is', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'epg-'));
  const xml = path.join(dir, 'guide.xml');
  writeFileSync(xml, XML);
  const { xmlPath } = await decompressToFile(P, xml, () => {});
  assert.equal(xmlPath, xml);
});

test('parseXmltvFile keeps only programmes for channels the provider has when a channel list is given', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'epg-'));
  const xml = path.join(dir, 'guide.xml');
  writeFileSync(xml, XML);
  const programs: { channel_id: string; title: string; description: string; startMs: number; endMs: number }[] = [];
  const parsed = await parseXmltvFile(P, xml, [{ epg_channel_id: 'cbs.us', name: 'CBS', stream_id: 's1_10' }], () => {}, (p) => programs.push(p));
  assert.deepEqual(parsed.channels.map((c) => c.id), ['cbs.us', 'abc.us']);
  assert.deepEqual(programs.map((p) => [p.channel_id, p.title, p.description]), [['cbs.us', 'Noon News', 'Local & national']]);
  assert.equal(programs[0].startMs, Date.UTC(2026, 8, 21, 12));
  assert.equal(programs[0].endMs, Date.UTC(2026, 8, 21, 13));
});

import { createServer } from 'node:http';
import { downloadToTempFile } from '../src/epg.js';
import { readFileSync } from 'node:fs';

function serve(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

test('downloadToTempFile follows a redirect, then refuses one that leads to the local network when LAN is off', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'epg-'));
  const { url, close } = await serve((req, res) => {
    if (req.url === '/hop') { res.writeHead(302, { Location: '/guide.xml' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/xml' }); res.end(XML);
  });
  try {
    // A loopback server is itself a LAN address, so this only works with LAN allowed.
    const saved = await downloadToTempFile(P, `${url}/hop`, dir, () => {}, true);
    assert.equal(readFileSync(saved, 'utf8'), XML);
    await assert.rejects(downloadToTempFile(P, `${url}/hop`, dir, () => {}, false), /local network/);
  } finally {
    close();
  }
});

test('downloadToTempFile rejects a non-2xx and gives up after too many redirects', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'epg-'));
  const { url, close } = await serve((req, res) => {
    if (req.url?.startsWith('/loop')) { res.writeHead(302, { Location: '/loop' }); res.end(); return; }
    res.writeHead(404); res.end('nope');
  });
  try {
    await assert.rejects(downloadToTempFile(P, `${url}/missing`, dir, () => {}, true), /HTTP 404/);
    await assert.rejects(downloadToTempFile(P, `${url}/loop`, dir, () => {}, true), /redirect/);
  } finally {
    close();
  }
});

async function* chunks(text: string, size: number) { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }

test('the parser gives the same result whether a tag is cut across chunks or not', async () => {
  const run = async (size: number) => { const ch: unknown[] = []; const pr: unknown[] = []; const st = await parseXmltvChunks(chunks(XML, size), null, (c) => ch.push(c), (p) => pr.push(p), () => {}); return { ch, pr, st }; };
  const whole = await run(XML.length);
  for (const size of [1, 7, 16, 64]) expect(await run(size)).toEqual(whole);
  expect(whole.ch).toEqual([{ id: 'cbs.us', displayNames: ['CBS', 'CBS Chicago'] }, { id: 'abc.us', displayNames: ['ABC'] }]);
  expect(whole.pr).toHaveLength(2);
});

test('decompressToFile takes its own cap, label and temp-file prefix', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'epg-'));
  const gz = path.join(dir, 'titles.gz');
  writeFileSync(gz, gzipSync(Buffer.from('x'.repeat(5000))));
  await expect(decompressToFile(P, gz, () => {}, { prefix: 'tmdb-ndjson', maxBytes: 100, label: 'TMDB decompression' }))
    .rejects.toThrow('TMDB decompression exceeds');
  writeFileSync(gz, gzipSync(Buffer.from('{"i":1}\n')));
  const { xmlPath } = await decompressToFile(P, gz, () => {}, { prefix: 'tmdb-ndjson', maxBytes: 1000, label: 'TMDB decompression' });
  expect(path.basename(xmlPath).startsWith('tmdb-ndjson-')).toBe(true);
});
