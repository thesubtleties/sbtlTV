import type { Platform } from './platform.js';

// Lines of a UTF-8 text file, read in chunks (constant memory). The partial line at the end of a chunk is carried into
// the next one; characters arrive whole per the readText contract. A line longer than `maxLineChars` throws: the carried
// text would otherwise be copied again for every chunk (time and memory growing with the square of the line).
export async function* readLines(platform: Platform, path: string, chunkBytes: number, maxLineChars = Infinity): AsyncGenerator<string> {
  let carry = '';
  for await (const chunk of platform.files.readText(path, chunkBytes)) {
    const text = carry + chunk;
    let start = 0;
    for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', start)) {
      yield trimCr(text.slice(start, nl));
      start = nl + 1;
    }
    carry = text.slice(start);
    if (carry.length > maxLineChars) throw new Error(`line longer than ${maxLineChars} characters`);
  }
  if (carry) yield trimCr(carry);
}

const trimCr = (s: string) => (s.endsWith('\r') ? s.slice(0, -1) : s);
