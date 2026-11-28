// Streaming UTF-8 decoder (Hermes has no streaming TextDecoder): a character split across chunks is carried into the
// next call; invalid sequences become U+FFFD, matching TextDecoder's replacement behaviour.
export class Utf8Stream {
  private carry = new Uint8Array(0);
  decode(input: Uint8Array): string {
    const bytes = this.carry.length ? concat(this.carry, input) : input;
    let end = bytes.length;
    // Hold back an incomplete sequence at the end (at most 3 bytes).
    for (let back = 1; back <= 3 && back <= bytes.length; back++) {
      const b = bytes[bytes.length - back];
      if ((b & 0xc0) === 0x80) continue;           // continuation byte: keep looking for the lead
      const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
      if (need > back) end = bytes.length - back;  // lead byte whose sequence is not complete yet
      break;
    }
    this.carry = bytes.slice(end);
    return decodeComplete(bytes.subarray(0, end));
  }
  end(): string { const rest = this.carry; this.carry = new Uint8Array(0); return rest.length ? decodeComplete(rest) : ''; }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }

// WHATWG UTF-8 decode with replacement: a valid sequence becomes its code point; otherwise the "maximal subpart" (the
// lead byte plus the continuation bytes that were valid so far) becomes one U+FFFD, as TextDecoder does.
function decodeComplete(b: Uint8Array): string {
  let out = ''; const codes: number[] = [];
  const flush = () => { out += String.fromCharCode.apply(null, codes); codes.length = 0; };
  for (let i = 0; i < b.length;) {
    const x = b[i];
    if (x < 0x80) { codes.push(x); i++; }
    else {
      const need = x >= 0xc2 && x <= 0xdf ? 1 : x >= 0xe0 && x <= 0xef ? 2 : x >= 0xf0 && x <= 0xf4 ? 3 : 0;
      if (need === 0) { codes.push(0xfffd); i++; }
      else {
        const lo = x === 0xe0 ? 0xa0 : x === 0xf0 ? 0x90 : 0x80;
        const hi = x === 0xed ? 0x9f : x === 0xf4 ? 0x8f : 0xbf;
        let cp = need === 1 ? x & 0x1f : need === 2 ? x & 0x0f : x & 0x07;
        let k = 0;
        while (k < need && i + 1 + k < b.length) {
          const c = b[i + 1 + k];
          if (k === 0 ? c < lo || c > hi : (c & 0xc0) !== 0x80) break;
          cp = (cp << 6) | (c & 0x3f); k++;
        }
        if (k === need) {
          if (cp > 0xffff) { cp -= 0x10000; codes.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); } else codes.push(cp);
        } else codes.push(0xfffd);
        i += 1 + k;
      }
    }
    if (codes.length > 8000) flush();
  }
  flush();
  return out;
}
