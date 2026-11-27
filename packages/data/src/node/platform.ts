import { DatabaseSync } from 'node:sqlite';
import { closeSync, createReadStream, createWriteStream, existsSync, openSync, promises as fsp, readSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkProviderUrl, redactUrl } from '@sbtltv/core';
import type { Db, Platform } from '../platform.js';

function sizeGuard(limit: number, what: string): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > limit) cb(new Error(`${what} exceeds ${Math.round(limit / 1024 / 1024)}MB limit`));
      else cb(null, chunk);
    },
  });
}

const MAX_REDIRECTS = 5;
// Every hop, including redirect targets, is checked against the LAN block.
function get(url: string, allowLan: boolean, redirects = 0): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    try { checkProviderUrl(url, allowLan); } catch (e) { reject(e); return; }
    const mod = url.startsWith('https:') ? https : http;
    // Ask for the bytes as stored: with gzip accepted, some servers inflate a .gz
    // in flight and hand over the raw multi-GB XML instead of the archive.
    const req = mod.get(url, { headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) { reject(new Error(`too many redirects (${MAX_REDIRECTS}) fetching ${redactUrl(url)}`)); return; }
        resolve(get(new URL(res.headers.location, url).toString(), allowLan, redirects + 1));
        return;
      }
      if (status < 200 || status >= 300) { res.resume(); reject(new Error(`HTTP ${status}${res.statusMessage ? `: ${res.statusMessage}` : ''}`)); return; }
      resolve(res);
    });
    req.on('error', reject);
  });
}

export function nodePlatform(): Platform {
  return {
    openDb: (p, o): Db => new DatabaseSync(p, { readOnly: o.readOnly, timeout: o.busyTimeoutMs }),
    uuid: () => randomUUID(),
    files: {
      join: (...parts) => path.join(...parts),
      dirname: (p) => path.dirname(p),
      basename: (p) => path.basename(p),
      exists: (p) => existsSync(p),
      list: (d) => readdirSync(d),
      remove: (p) => rmSync(p, { force: true }),
      removeAsync: (p) => fsp.unlink(p),
      size: (p) => statSync(p).size,
      readHead: (p, n) => { const fd = openSync(p, 'r'); try { const b = Buffer.alloc(n); const got = readSync(fd, b, 0, n, 0); return new Uint8Array(b.subarray(0, got)); } finally { closeSync(fd); } },
      readText: (p, chunkBytes) => createReadStream(p, { encoding: 'utf-8', highWaterMark: chunkBytes }) as AsyncIterable<string>,
    },
    net: {
      async downloadToFile(url, dest, { maxBytes, allowLan, label }) {
        const res = await get(url, allowLan);
        let bytes = 0;
        const counter = new Transform({ transform(chunk: Buffer, _e, cb) { bytes += chunk.length; cb(null, chunk); } });
        try {
          await pipeline(res, counter, sizeGuard(maxBytes, label), createWriteStream(dest));
        } catch (err) {
          await fsp.unlink(dest).catch(() => {});
          throw err;
        }
        return { status: res.statusCode ?? 0, bytes };
      },
    },
    gunzip: {
      async gunzipFile(src, dest, { maxBytes, label }) {
        try {
          await pipeline(createReadStream(src), createGunzip(), sizeGuard(maxBytes, label), createWriteStream(dest));
        } catch (err) {
          await fsp.unlink(dest).catch(() => {});
          throw err;
        }
      },
    },
  };
}
