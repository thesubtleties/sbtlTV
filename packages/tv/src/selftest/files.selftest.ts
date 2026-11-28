import { File, Paths } from 'expo-file-system';
import { rnFiles } from '../platform/files';
import { assertEq, type SelfTestSuite } from './runner';

const files = rnFiles();
const dir = () => { const d = `${Paths.cache.uri.replace(/^file:\/\//, '').replace(/\/$/, '')}/selftest-files-${Date.now()}-${Math.random().toString(16).slice(2)}`; new File(`file://${d}/.keep`).create({ intermediates: true }); return d; };
// expo-file-system's write can return before the bytes are readable (a read right after it sometimes saw 0 bytes):
// wait a moment. The data path only reads files the native module finished writing.
const write = async (p: string, text: string) => { const f = new File(`file://${p}`); f.create({ overwrite: true }); f.write(text); await new Promise((r) => setTimeout(r, 50)); };

export const filesSuite: SelfTestSuite = { name: 'files', tests: [
  { name: 'readHead returns the first bytes', run: async () => {
    const d = dir(); await write(`${d}/t.txt`, 'é'.repeat(3000));
    assertEq(Array.from(files.readHead(`${d}/t.txt`, 2)), [0xc3, 0xa9], 'head');
  } },
  { name: 'readText keeps split characters whole at odd chunk sizes', run: async () => {
    const d = dir(); const mixed = 'aé€😀'.repeat(500); await write(`${d}/m.txt`, mixed);
    for (const size of [1, 3, 5, 7, 1021]) {
      const chunks: string[] = []; for await (const c of files.readText(`${d}/m.txt`, size)) chunks.push(c);
      assertEq(chunks.some((c) => c.includes('�')), false, `no U+FFFD at ${size}`);
      assertEq(chunks.join('') === mixed, true, `text at ${size}`);
    }
  } },
  { name: 'remove of a missing file is fine; removeAsync of a missing file rejects', run: async () => {
    const d = dir(); files.remove(`${d}/missing`);
    let rejected = false; try { await files.removeAsync(`${d}/missing`); } catch { rejected = true; }
    assertEq(rejected, true, 'removeAsync rejects');
  } },
  { name: 'list, size, exists, join/dirname/basename', run: async () => {
    const d = dir(); await write(`${d}/a.txt`, 'abc');
    assertEq(files.list(d).includes('a.txt'), true, 'list'); assertEq(files.size(`${d}/a.txt`), 3, 'size');
    assertEq([files.exists(`${d}/a.txt`), files.exists(`${d}/nope`)], [true, false], 'exists');
    assertEq([files.join('/a', 'b', 'c.txt'), files.dirname('/a/b/c.txt'), files.basename('/a/b/c.txt')], ['/a/b/c.txt', '/a/b', 'c.txt'], 'paths');
  } },
] };
