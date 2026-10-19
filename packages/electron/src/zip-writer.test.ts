import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, inflateRawSync } from 'node:zlib';
import { makeZip } from './zip-writer.js';

/** A minimal reader: end record -> central directory -> each entry, inflated. */
function readZip(zip: Buffer): { name: string; data: Buffer; crc: number }[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end > 0, 'end record');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out: { name: string; data: Buffer; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50, 'central header');
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    assert.equal(zip.readUInt32LE(local), 0x04034b50, 'local header');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    out.push({ name, data: inflateRawSync(zip.subarray(start, start + size)), crc });
    at += 46 + nameLen;
  }
  return out;
}

test('files round-trip through the zip: names (UTF-8), contents, crc', () => {
  const files = [
    { name: 'report.json', data: Buffer.from('{"a":1}') },
    { name: 'débug.log', data: Buffer.from('line one\nline two\n') },
    { name: 'empty.log', data: Buffer.alloc(0) },
  ];
  const zip = makeZip(files);
  assert.equal(zip.subarray(0, 4).toString('latin1'), 'PK\x03\x04');
  const read = readZip(zip);
  assert.deepEqual(read.map((e) => e.name), files.map((f) => f.name));
  read.forEach((e, i) => {
    assert.deepEqual(e.data, files[i].data);
    assert.equal(e.crc, crc32(files[i].data) >>> 0);
  });
});

test('a 10 MB log fits and round-trips', () => {
  const big = Buffer.from('2026-10-19T12:00:00.000Z [app] a log line with some text in it\n'.repeat(160_000));
  assert.ok(big.length > 10_000_000);
  const read = readZip(makeZip([{ name: 'debug.log', data: big }]));
  assert.ok(read[0].data.equals(big));
});
