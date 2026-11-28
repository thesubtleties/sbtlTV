import { Directory, File } from 'expo-file-system';
import type { Files } from '@sbtltv/data';
import { Utf8Stream } from './utf8';

const uri = (p: string) => (p.startsWith('file://') ? p : `file://${p}`);

export function rnFiles(): Files {
  return {
    join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
    dirname: (p) => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); },
    basename: (p) => p.slice(p.lastIndexOf('/') + 1),
    exists: (p) => new File(uri(p)).exists || new Directory(uri(p)).exists,
    list: (dir) => new Directory(uri(dir)).list().map((e) => e.name),
    remove: (p) => { const f = new File(uri(p)); if (f.exists) f.delete(); },
    // Rejects for a missing file, as the contract says (the guide cleanup logs a failed delete).
    removeAsync: async (p) => { new File(uri(p)).delete(); },
    size: (p) => new File(uri(p)).size ?? 0,
    // A new handle's offset is not 0 on Android (readBytesSync read nothing until set): always start at the beginning.
    readHead: (p, bytes) => { const h = new File(uri(p)).open(); try { h.offset = 0; return h.readBytesSync(bytes); } finally { h.close(); } },
    // Whole UTF-8 characters per chunk (a streaming decoder carries a split one over); readBytes is async, so every
    // chunk comes back on a later turn of the JS thread and the UI gets to run in between.
    async *readText(p, chunkBytes) {
      const h = new File(uri(p)).open(); h.offset = 0; const dec = new Utf8Stream();
      try {
        for (;;) {
          const bytes = await h.readBytes(chunkBytes);
          if (bytes.length === 0) break;
          const text = dec.decode(bytes);
          if (text) yield text;
        }
        const rest = dec.end(); if (rest) yield rest;
      } finally { h.close(); }
    },
  };
}
