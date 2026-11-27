import { expect, test } from 'vitest';
import { parseXmltvChunks } from '../src/epg.js';
import { referenceParseXmltvChunks } from './xmltv-reference.js';

async function* chunks(text: string, size: number): AsyncGenerator<string> { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }

// A deterministic, messy guide: entities, both quote styles, cut tags at every chunk size, programmes before and
// after channels, missing titles, bad dates, stray text, and a closing-tag string inside a description.
function corpus(seed: number, programmes: number): string {
  let x = seed;
  const r = (n: number) => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x % n; };
  const stamp = (i: number) => `202609${String(10 + (i % 18)).padStart(2, '0')}${String(i % 24).padStart(2, '0')}${String(i % 60).padStart(2, '0')}00 +0${r(3)}00`;
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="x">\n'];
  const channel = (i: number) => `<channel id="${i % 2 ? `ch${i}.us` : `ch${i}&amp;co`}"><display-name>Ch ${i} &lt;HD&gt;</display-name>${r(2) ? `<display-name lang='en'>Alt ${i}</display-name>` : ''}</channel>\n`;
  for (let i = 0; i < 12; i++) parts.push(channel(i));
  for (let i = 0; i < programmes; i++) {
    const ch = r(14);
    const q = r(2) ? '"' : "'";
    const title = r(25) === 0 ? '' : `<title lang="en">Show ${i} &amp; friends &#233;&#x263A;</title>`;
    const desc = r(3) ? `<desc>About ${i}${r(40) === 0 ? ' and a stray </channel> inside' : ''}</desc>` : '';
    const start = r(30) === 0 ? 'bad' : stamp(i);
    parts.push(`<programme start=${q}${start}${q} stop=${q}${stamp(i + 1)}${q} channel=${q}${ch % 2 ? `ch${ch}.us` : `ch${ch}&amp;co`}${q}>${title}${desc}</programme>\n`);
    if (r(200) === 0) parts.push('  stray text between elements\n');
    if (i === Math.floor(programmes / 2)) parts.push(channel(12), channel(13));
  }
  parts.push('</tv>\n');
  return parts.join('');
}

async function both(text: string, size: number, filter: Set<string> | null) {
  const run = async (f: typeof parseXmltvChunks) => {
    const events: unknown[] = []; const logs: string[] = [];
    const stats = await f(chunks(text, size), filter, (c) => events.push(['c', c]), (p) => events.push(['p', p]), (m) => logs.push(m));
    return { events, logs, stats };
  };
  return { ref: await run(referenceParseXmltvChunks as typeof parseXmltvChunks), now: await run(parseXmltvChunks) };
}

test('the parser matches the reference exactly: every callback in order, counts and logs, at every chunk size', async () => {
  const text = corpus(7, 3000);
  for (const filter of [null, new Set(['ch3.us', 'ch4&co', 'ch13.us'])]) {
    for (const size of [1, 7, 64, 4096, 65_536, 256 * 1024, text.length]) {
      const { ref, now } = await both(text, size, filter);
      expect(now).toEqual(ref);
      expect(ref.events.length).toBeGreaterThan(100);
    }
  }
});

test('the oversized-element rule matches the reference (same warning, same recovery)', async () => {
  const huge = `<tv><channel id="a"><display-name>A</display-name></channel><programme start="20260921120000 +0000" stop="20260921130000 +0000" channel="a"><title>${'x'.repeat(1_500_000)}`;
  const text = huge + '</title></programme><programme start="20260921130000 +0000" stop="20260921140000 +0000" channel="a"><title>After</title></programme></tv>';
  for (const size of [65_536, 256 * 1024]) {
    const { ref, now } = await both(text, size, null);
    expect(now).toEqual(ref);
    expect(ref.logs.some((m) => m.includes('Remainder buffer overflow'))).toBe(true);
  }
});

test('a long programme section parses in linear time (no rescan of the text per element)', { timeout: 30_000 }, async () => {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
  const base = Date.UTC(2026, 8, 21);
  const parts = ['<tv><channel id="a"><display-name>A</display-name></channel>\n'];
  for (let i = 0; i < 200_000; i++) parts.push(`<programme start="${stamp(base + i * 60_000)}" stop="${stamp(base + i * 60_000 + 59_000)}" channel="a"><title>Programme ${i}</title><desc>${'d'.repeat(120)}</desc></programme>\n`);
  const text = parts.join('') + '</tv>';
  const t0 = Date.now();
  let n = 0;
  await parseXmltvChunks(chunks(text, 256 * 1024), null, () => {}, () => { n++; }, () => {});
  const ms = Date.now() - t0;
  expect(n).toBe(200_000);
  expect(ms).toBeLessThan(4000);   // the old rescanning parser: ~9 s on a fast desktop; this one: well under 1 s
});
