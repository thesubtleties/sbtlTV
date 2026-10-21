// Downloaded subtitles on disk: userData/subtitles/<title>/<page>__<file>.<ext>.
// The only place subtitle paths for mpv come from. A few KB each; capped,
// least recently used first out.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SubdlTitle } from './subdl-client.js';

const ID = /^[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_-]{1,64})?$/;
const EXT = ['srt', 'vtt', 'ass'];
/** The file name for an id: a hash, so two ids never share a name (and ids don't show on disk) */
const fileName = (nId: string) => createHash('sha256').update(nId).digest('hex').slice(0, 32);

export function titleKey(t: SubdlTitle): string {
  return t.type === 'tv' ? `tv_${t.tmdbId}_s${t.season ?? 0}e${t.episode ?? 0}` : `movie_${t.tmdbId}`;
}

export class SubtitleCache {
  constructor(private readonly dir: string, private readonly maxBytes = 50 * 1024 * 1024) {}

  private folder(t: SubdlTitle): string {
    if (!Number.isInteger(t.tmdbId) || t.tmdbId <= 0) throw new Error('bad title');
    return path.join(this.dir, titleKey(t));
  }

  find(t: SubdlTitle, nId: string): string | null {
    if (!ID.test(nId)) return null;
    for (const ext of EXT) {
      const p = path.join(this.folder(t), `${fileName(nId)}.${ext}`);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  write(t: SubdlTitle, nId: string, ext: string, text: string): string {
    if (!ID.test(nId) || !EXT.includes(ext)) throw new Error('bad subtitle name');
    const folder = this.folder(t);
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, `${fileName(nId)}.${ext}`);
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, text, 'utf8');
    fs.renameSync(temp, target);
    return target;
  }

  /** A file this cache wrote (inside its folder, still there). */
  owns(p: string): boolean {
    const rel = path.relative(this.dir, path.resolve(p));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(p);
  }

  /** Every cached subtitle gone (the key was removed, or secrets forgotten). */
  clear(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  evict(): void {
    if (!fs.existsSync(this.dir)) return;
    const files = fs.readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => fs.readdirSync(path.join(this.dir, d.name)).filter((f) => !f.endsWith('.tmp')).map((f) => path.join(this.dir, d.name, f)))
      .map((p) => ({ p, s: fs.statSync(p) }))
      .sort((a, b) => a.s.mtimeMs - b.s.mtimeMs);
    let total = files.reduce((n, f) => n + f.s.size, 0);
    for (const f of files) {
      if (total <= this.maxBytes) break;
      fs.rmSync(f.p, { force: true });
      total -= f.s.size;
    }
  }
}
