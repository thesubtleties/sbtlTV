// SubDL subtitles for the stream main is playing: find, download, check and
// hand to mpv. Every outside effect is injected (client, cache, mpv, the
// stream's generation), so the whole flow runs under node:test.
//
// Every download costs one of the user's daily SubDL downloads (a failed one
// too), so only ids from a search are fetched, at most twice per automatic
// attempt, and a file already in the cache is never fetched again.

import fs from 'node:fs';
import { SubdlError, type SubdlClient, type SubdlErrorKind, type SubdlResult, type SubdlTitle, type SubdlUsage } from './subdl-client.js';
import { decodeSubtitle, isSoundCue, parseCues, sniffFormat, SUBTITLE_EXT, timingCheck, type Cue, type TimingStatus } from './subtitle-files.js';
import { rankResults } from './subtitle-pick.js';
import { subdlCode } from './subtitle-languages.js';
import type { SubtitleCache } from './subtitle-cache.js';
import type { SubtitleTrack } from './subtitle-mpv.js';

export interface SubdlServiceIo {
  client: Pick<SubdlClient, 'search' | 'download' | 'usage'>;
  cache: SubtitleCache;
  /** sub-add the file (not selected) and return its track once mpv lists it; null if it never shows */
  addSubtitle(path: string): Promise<SubtitleTrack | null>;
  isCurrent(generation: number): boolean;
  log(message: string): void;
}
export interface LoadRequest { generation: number; title: SubdlTitle; nId: string; language: string; preferSdh: boolean; duration: number }
export interface LoadResult { trackId: number; nId: string; ai: boolean; timing: TimingStatus }
export type ServiceError = { error: SubdlErrorKind | 'stale' | 'no-file' };

const MAX_AUTO_DOWNLOADS = 2;
class NoFile extends Error {}

export class SubdlService {
  /** A rejected key: no more requests until it changes */
  private authFailed = false;
  /** Cues of the file loaded for a stream, for the sync panel */
  private loaded: { generation: number; cues: Cue[] } | null = null;

  constructor(private readonly io: SubdlServiceIo) {}

  keyChanged(): void {
    this.authFailed = false;
  }

  private fail(e: unknown): ServiceError {
    if (e instanceof NoFile) {
      this.io.log('subdl: download was not a usable subtitle');
      return { error: 'no-file' };
    }
    const kind: SubdlErrorKind = e instanceof SubdlError ? e.kind : 'network';
    if (kind === 'auth') this.authFailed = true;
    this.io.log(`subdl: request failed (${kind})`);
    return { error: kind };
  }

  async find(title: SubdlTitle, language: string, preferSdh: boolean): Promise<{ results: SubdlResult[] } | ServiceError> {
    if (this.authFailed) return { error: 'auth' };
    try {
      const results = rankResults(await this.io.client.search(title, language), { language, preferSdh, season: title.season, episode: title.episode });
      this.io.log(`subdl: search found ${results.length} files`);
      return { results };
    } catch (e) {
      return this.fail(e);
    }
  }

  /** Bytes -> UTF-8 text in a known format with at least one spoken line. */
  private prepare(bytes: Uint8Array, language: string): { text: string; ext: string; cues: Cue[] } {
    const text = decodeSubtitle(bytes, language);
    const format = sniffFormat(text);
    if (!format) throw new NoFile();
    const cues = parseCues(text, format);
    if (!cues.some((c) => !isSoundCue(c.text))) throw new NoFile();
    return { text, ext: SUBTITLE_EXT[format], cues };
  }

  private async fileFor(title: SubdlTitle, nId: string, language: string): Promise<{ path: string; cues: Cue[] }> {
    const cached = this.io.cache.find(title, nId);
    if (cached) {
      const now = new Date();
      fs.utimesSync(cached, now, now);  // recently used: last to be evicted
      const text = fs.readFileSync(cached, 'utf8');
      return { path: cached, cues: parseCues(text, sniffFormat(text) ?? 'srt') };
    }
    const prepared = this.prepare(await this.io.client.download(nId), language);
    const path = this.io.cache.write(title, nId, prepared.ext, prepared.text);
    this.io.cache.evict();
    return { path, cues: prepared.cues };
  }

  /** nId 'auto': search and take the best; otherwise that file (from the cache when it is there). */
  async load(req: LoadRequest): Promise<LoadResult | ServiceError> {
    let candidates: Array<{ nId: string; ai: boolean }>;
    if (req.nId === 'auto') {
      // A language SubDL does not list: an unfiltered search would download another language
      if (!subdlCode(req.language)) return { error: 'not-found' };
      const found = await this.find(req.title, req.language, req.preferSdh);
      if ('error' in found) return found;
      if (found.results.length === 0) return { error: 'not-found' };
      candidates = found.results.slice(0, MAX_AUTO_DOWNLOADS).map((r) => ({ nId: r.nId, ai: r.ai }));
    } else {
      if (this.authFailed && !this.io.cache.find(req.title, req.nId)) return { error: 'auth' };
      candidates = [{ nId: req.nId, ai: false }];
    }
    let last: ServiceError = { error: 'no-file' };
    for (const c of candidates) {
      if (!this.io.isCurrent(req.generation)) return { error: 'stale' };
      let file: { path: string; cues: Cue[] };
      try {
        file = await this.fileFor(req.title, c.nId, req.language);
      } catch (e) {
        last = this.fail(e);
        if (last.error === 'no-file' || last.error === 'not-found' || last.error === 'bad-response') continue;
        return last;  // quota, auth, network: the next file would fail the same way
      }
      if (!this.io.isCurrent(req.generation)) return { error: 'stale' };
      const track = await this.io.addSubtitle(file.path);
      if (!track) return { error: 'no-file' };
      this.loaded = { generation: req.generation, cues: file.cues };
      return { trackId: track.id, nId: c.nId, ai: c.ai, timing: timingCheck(file.cues, req.duration) };
    }
    return last;
  }

  /** Spoken lines of this stream's downloaded subtitle within span seconds of the video time `around`. */
  cues(generation: number, around: number, delay: number, speed: number, span = 60): Array<{ start: number; text: string }> {
    if (!this.loaded || this.loaded.generation !== generation) return [];
    const subTime = (around - delay) / speed;
    return this.loaded.cues
      .filter((c) => !isSoundCue(c.text) && c.start >= subTime - span && c.start <= subTime + span)
      .map((c) => ({ start: c.start, text: c.text }));
  }

  async usage(): Promise<SubdlUsage | ServiceError> {
    try {
      return await this.io.client.usage();
    } catch (e) {
      return this.fail(e);
    }
  }
}
