// Subtitles of the stream main is playing: its tracks, the selected one, and
// the live caption check. No electron imports (mpv and the renderer are
// reached through CaptionSessionIo), so it runs under node:test.

import { CaptionCheck } from './caption-check.js';
import type { CaptionLanguage } from './subtitle-settings.js';
import { loadResetOptions, type SubtitleTrack } from './subtitle-mpv.js';

export type CcState = 'checking' | 'ok' | 'other-language' | 'unreadable';

export interface CaptionSessionIo {
  /** Set mpv options on whichever player is running; failures are logged there */
  setOptions(options: Array<[string, string]>, why: string): void;
  /** The subtitle line on screen now ('' for none) */
  readSubText(): Promise<string>;
  sendTracks(update: { generation: number; tracks: SubtitleTrack[]; duration: number }): void;
  sendCcState(update: { generation: number; state: CcState; language: CaptionLanguage | null }): void;
  log(message: string): void;
  /** The caption language wanted now (Settings, auto: the system language); null: any */
  preferredLanguage(): CaptionLanguage | null;
  /** The load now playing (StreamSession.generation) */
  currentGeneration(): number;
}

// Live captions (EIA-608): ffmpeg's decoder picks a caption field on its own and
// on most channels it is a coin flip whether it lands on the captions or the
// station data (XDS) or other-language captions beside them. While a CC track
// is selected, read the first lines (hidden) and restart the decoder on junk or
// on the language not wanted, up to CC_MAX_RETRIES restarts (refilled once when
// junk runs it out after other-language lines; see CaptionCheck). After
// CC_LANGUAGE_WAIT_MS any real captions do. Captions are only shown once
// confirmed. The check ends at its verdict; while nothing comes through (an ad
// break) it reads every CC_CHECK_SLOW_INTERVAL_MS after CC_CHECK_FAST_MS
// instead of showing captions unchecked.
const CC_CHECK_INTERVAL_MS = 400;
const CC_CHECK_SLOW_INTERVAL_MS = 2000;
const CC_CHECK_FAST_MS = 60_000;
/** The wanted caption language is looked for this long; then what comes through is shown (a Spanish-only channel, English wanted). */
const CC_LANGUAGE_WAIT_MS = 30_000;
export const CC_MAX_RETRIES = 8;

interface CcCheckRun { generation: number; trackId: number; check: CaptionCheck; timer: ReturnType<typeof setInterval>; startedAt: number; lastRead: number; languageWaitOver: boolean }

export class CaptionSession {
  /** Tracks of the current load, as last reported */
  tracks: SubtitleTrack[] = [];
  private visibleWanted = true;
  private run: CcCheckRun | null = null;
  private checkedKey: string | null = null;  // `${generation}:${trackId}` checked (or being checked) and still selected: selecting it again only applies visibility
  private unreadable = false;  // that check gave up: keep the junk off screen for this load
  private selected: { generation: number; trackId: number } | null = null;  // the live CC track selected for the current load

  constructor(private readonly io: CaptionSessionIo) {}

  /** A load starts: mpv keeps sid, sub-delay and sub-visibility across loadfile, so it starts with no subtitle, no offset, shown. */
  beginLoad(): void {
    this.end();
    this.visibleWanted = true;
    this.io.setOptions(loadResetOptions(), 'load');
    this.setTracks([]);
  }

  /** Playback stopped or the player is going away: nothing of this load's subtitles is kept. */
  end(): void {
    this.leaveCc();
    this.tracks = [];
    this.unreadable = false;
  }

  /** Off the live CC track: its check stops, and selecting it again checks it again (a fresh decoder start). */
  private leaveCc(): void {
    this.stopCheck();
    this.selected = null;
    this.checkedKey = null;
  }

  /** Tracks of the current load, tagged with its generation and (when known) the file's duration. */
  setTracks(tracks: SubtitleTrack[], duration = 0): void {
    this.tracks = tracks;
    this.io.sendTracks({ generation: this.io.currentGeneration(), tracks, duration: duration > 0 ? duration : 0 });
  }

  /** The renderer picked a track (null: none) for the current load. */
  selectTrack(id: number | null, visible: boolean): void {
    const generation = this.io.currentGeneration();
    this.visibleWanted = visible;
    const track = id === null ? undefined : this.tracks.find((t) => t.id === id);
    if (!track) {
      this.leaveCc();
      this.io.setOptions([['sid', 'no']], 'set track');
      return;
    }
    if (!track.isCc) {
      this.leaveCc();
      this.io.setOptions([['sub-visibility', visible ? 'yes' : 'no'], ['sid', String(track.id)]], 'set track');
      return;
    }
    this.selected = { generation, trackId: track.id };
    const key = `${generation}:${track.id}`;
    if (this.checkedKey === key) {
      // Already checked (or being checked) for this load: just apply the wanted visibility.
      if (!this.run && !this.unreadable) this.io.setOptions([['sub-visibility', visible ? 'yes' : 'no'], ['sid', String(track.id)]], 'set track');
      return;
    }
    this.checkedKey = key;
    this.unreadable = false;
    this.startCheck(generation, track.id);
  }

  setVisible(visible: boolean): void {
    this.visibleWanted = visible;
    // While live captions are being checked they stay hidden; the check applies this when it ends.
    if (!this.run) this.io.setOptions([['sub-visibility', visible ? 'yes' : 'no']], 'set visible');
  }

  /** The caption language setting changed: check the selected live CC track again for the new language (the stream keeps playing). */
  recheckLanguage(): void {
    const selected = this.selected;
    if (!selected || selected.generation !== this.io.currentGeneration()) return;
    this.io.log('captions: language setting changed, checking the captions again');
    this.unreadable = false;
    this.checkedKey = `${selected.generation}:${selected.trackId}`;
    this.startCheck(selected.generation, selected.trackId);
  }

  private stopCheck(): void {
    if (this.run) clearInterval(this.run.timer);
    this.run = null;
  }

  private startCheck(generation: number, trackId: number): void {
    this.stopCheck();
    const io = this.io;
    io.setOptions([['sub-visibility', 'no'], ['sid', String(trackId)]], 'cc check start');
    io.sendCcState({ generation, state: 'checking', language: null });
    let busy = false;
    const run: CcCheckRun = {
      generation, trackId, startedAt: Date.now(), lastRead: 0, languageWaitOver: false,
      // With a language preferred, lines in another language restart the decoder to land on the other caption field.
      check: new CaptionCheck(CC_MAX_RETRIES, io.preferredLanguage()),
      timer: setInterval(() => {
        const now = Date.now();
        const interval = now - run.startedAt > CC_CHECK_FAST_MS ? CC_CHECK_SLOW_INTERVAL_MS : CC_CHECK_INTERVAL_MS;
        if (busy || now - run.lastRead < interval) return;
        if (!run.languageWaitOver && now - run.startedAt > CC_LANGUAGE_WAIT_MS) {
          run.languageWaitOver = true;
          run.check.stopWaitingForLanguage();
        }
        busy = true;
        run.lastRead = now;
        void io.readSubText().then((text) => {
          if (this.run !== run || generation !== io.currentGeneration()) return;
          const action = run.check.observe(text.trim());
          const sample = JSON.stringify(text.trim().replace(/\s+/g, ' ').slice(0, 40));
          const shown = (): Array<[string, string]> => [['sub-visibility', this.visibleWanted ? 'yes' : 'no']];
          if (action === 'retry') {
            io.log(`captions: station data or the other language, restarting the decoder (${run.check.retries}/${CC_MAX_RETRIES}): ${sample}`);
            io.setOptions([['sid', 'no'], ['sid', String(trackId)]], 'cc retry');
          } else if (action === 'ok') {
            io.log(`captions: readable after ${run.check.retries} restart(s): ${sample}`);
            this.stopCheck();
            io.setOptions(shown(), 'cc ok');
            io.sendCcState({ generation, state: 'ok', language: null });
          } else if (action === 'other-language') {
            io.log(`captions: only ${run.check.language} came through after ${run.check.retries} restart(s); showing them`);
            this.stopCheck();
            io.setOptions(shown(), 'cc other language');
            io.sendCcState({ generation, state: 'other-language', language: run.check.language });
          } else if (action === 'unreadable') {
            io.log(`captions: still station data after ${CC_MAX_RETRIES} restarts; turning them off for this channel`);
            this.stopCheck();
            this.unreadable = true;
            io.setOptions([['sid', 'no']], 'cc unreadable');
            io.sendCcState({ generation, state: 'unreadable', language: null });
          }
        }).catch((err: unknown) => {
          io.log(`captions: reading the caption line failed: ${err instanceof Error ? err.message : err}`);
        }).finally(() => { busy = false; });
      }, CC_CHECK_INTERVAL_MS),
    };
    this.run = run;
  }
}
