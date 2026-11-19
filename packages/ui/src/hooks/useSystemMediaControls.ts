import { useEffect, useRef } from 'react';
import type { MediaSessionInfo } from '../utils/mediaSessionInfo';

export interface SystemMediaControlsInput {
  /** Settings › Privacy: show what's playing in the system's media controls */
  enabled: boolean;
  /** What's playing (null: nothing) */
  info: MediaSessionInfo | null;
  playing: boolean;
  /** Movies and episodes: seeking and a timeline. Live: neither */
  seekable: boolean;
  duration: number;
  getPosition: () => number;
  actions: { play: () => void; pause: () => void; stop: () => void; seek: (seconds: number) => void };
}

const SEEK_STEP = 10;
const ACTIONS = ['play', 'pause', 'stop', 'seekto', 'seekbackward', 'seekforward'] as const;

/** One second of silence (8 kHz mono WAV), made once. */
let silenceUrl: string | null = null;
function silence(): string {
  if (silenceUrl) return silenceUrl;
  const rate = 8000; const n = rate; const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  silenceUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silenceUrl;
}

/**
 * sbtlTV in the system's media controls (Windows media panel and lock screen, macOS Now Playing, Linux MPRIS),
 * through Chromium's Media Session. The video is mpv's, not a <video>, and Chromium only lists a page whose media
 * plays: a silent looping clip stands in, playing and pausing with the player. Off (the Privacy switch, or nothing
 * playing): no clip, no details, no buttons. Previous / next are left off on purpose.
 */
export function useSystemMediaControls({ enabled, info, playing, seekable, duration, getPosition, actions }: SystemMediaControlsInput) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const live = useRef({ actions, getPosition });
  live.current = { actions, getPosition };
  const active = enabled && info !== null;
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;

  // The clip, the details, the state
  useEffect(() => {
    if (!ms) return;
    if (!active || !info) {
      audioRef.current?.pause();
      ms.metadata = null;
      ms.playbackState = 'none';
      return;
    }
    if (!audioRef.current) { const a = new Audio(silence()); a.loop = true; audioRef.current = a; }
    const a = audioRef.current;
    if (playing) void a.play().catch(() => {}); else a.pause();
    ms.metadata = new MediaMetadata(info);
    ms.playbackState = playing ? 'playing' : 'paused';
  }, [ms, active, info, playing]);

  // The buttons (seeking only where there's a timeline)
  useEffect(() => {
    if (!ms) return;
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h); } catch { /* not supported here */ } };
    if (!active) { for (const a of ACTIONS) set(a, null); return; }
    set('play', () => live.current.actions.play());
    set('pause', () => live.current.actions.pause());
    set('stop', () => live.current.actions.stop());
    if (seekable) {
      set('seekto', (d) => { if (d.seekTime != null) live.current.actions.seek(d.seekTime); });
      set('seekbackward', (d) => live.current.actions.seek(Math.max(0, live.current.getPosition() - (d.seekOffset ?? SEEK_STEP))));
      set('seekforward', (d) => live.current.actions.seek(live.current.getPosition() + (d.seekOffset ?? SEEK_STEP)));
    } else {
      for (const a of ['seekto', 'seekbackward', 'seekforward'] as const) set(a, null);
    }
    return () => { for (const a of ACTIONS) set(a, null); };
  }, [ms, active, seekable]);

  // The timeline: on changes, and every few seconds while playing (the OS extrapolates in between)
  useEffect(() => {
    if (!ms?.setPositionState) return;
    const clear = () => { try { ms.setPositionState(); } catch { /* ignore */ } };
    if (!active || !seekable || !(duration > 0)) { clear(); return; }
    const report = () => {
      const position = Math.min(Math.max(0, live.current.getPosition()), duration);
      try { ms.setPositionState({ duration, position, playbackRate: 1 }); } catch { /* ignore */ }
    };
    report();
    if (!playing) return;
    const t = window.setInterval(report, 5000);
    return () => window.clearInterval(t);
  }, [ms, active, seekable, duration, playing]);

  // Leaving: let go of the clip
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);
}
