import type { Platform } from './platform.js';

// Lines of a UTF-8 text file, read in chunks (constant memory). The partial line at the end of a chunk is carried into
// the next one; characters arrive whole per the readText contract.
export async function* readLines(platform: Platform, path: string, chunkBytes: number): AsyncGenerator<string> {
  let carry = '';
  for await (const chunk of platform.files.readText(path, chunkBytes)) {
    const text = carry + chunk;
    let start = 0;
    for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', start)) {
      yield trimCr(text.slice(start, nl));
      start = nl + 1;
    }
    carry = text.slice(start);
  }
  if (carry) yield trimCr(carry);
}

const trimCr = (s: string) => (s.endsWith('\r') ? s.slice(0, -1) : s);
