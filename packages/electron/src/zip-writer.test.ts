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

test('local and central headers agree, with UTF-8 flag, deflate, sizes, crc and DOS time; end record is consistent', () => {
  const mtime = new Date(2026, 9, 19, 13, 47, 58); // local time, as zip stores it
  const files = [
    { name: 'report.json', data: Buffer.from('{"a":1}'.repeat(50)), mtime },
    { name: 'débug.log', data: Buffer.from('line\n'.repeat(1000)), mtime },
  ];
  const zip = makeZip(files);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const dirSize = zip.readUInt32LE(end + 12);
  const dirAt = zip.readUInt32LE(end + 16);
  assert.equal(zip.readUInt16LE(end + 8), files.length, 'entries on this disk');
  assert.equal(zip.readUInt16LE(end + 10), files.length, 'entries in total');
  assert.equal(dirAt + dirSize, end, 'central directory ends where the end record starts');
  const time = (13 << 11) | (47 << 5) | 29;
  const date = ((2026 - 1980) << 9) | (10 << 5) | 19;
  let at = dirAt;
  for (const f of files) {
    const nameLen = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const packed = zip.readUInt32LE(at + 20);
    // central: flags, method, time, date, crc, sizes
    assert.equal(zip.readUInt16LE(at + 8), 0x0800, 'central UTF-8 flag');
    assert.equal(zip.readUInt16LE(at + 10), 8, 'central deflate');
    assert.equal(zip.readUInt16LE(at + 12), time, 'central time');
    assert.equal(zip.readUInt16LE(at + 14), date, 'central date');
    assert.equal(zip.readUInt32LE(at + 16), crc32(f.data) >>> 0, 'central crc');
    assert.equal(zip.readUInt32LE(at + 24), f.data.length, 'central uncompressed size');
    assert.ok(packed < f.data.length, 'compressed (repetitive data deflates smaller)');
    // the local header says the same
    assert.equal(zip.readUInt16LE(local + 6), 0x0800, 'local UTF-8 flag');
    assert.equal(zip.readUInt16LE(local + 8), 8, 'local deflate');
    assert.equal(zip.readUInt16LE(local + 10), time, 'local time');
    assert.equal(zip.readUInt16LE(local + 12), date, 'local date');
    assert.equal(zip.readUInt32LE(local + 14), crc32(f.data) >>> 0, 'local crc');
    assert.equal(zip.readUInt32LE(local + 18), packed, 'local compressed size');
    assert.equal(zip.readUInt32LE(local + 22), f.data.length, 'local uncompressed size');
    assert.equal(zip.readUInt16LE(local + 26), nameLen, 'local name length');
    at += 46 + nameLen;
  }
  assert.equal(at, end);
});
