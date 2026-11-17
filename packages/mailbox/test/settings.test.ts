import { describe, expect, it } from 'vitest';
import { DEFAULTS, LiveSettings, parseSettings, settingsFromEnv } from '../src/server/settings';

describe('mailbox settings', () => {
  it('keeps only known settings with sensible values', () => {
    expect(parseSettings({ powBits: 22, paused: true, busyPerMinute: 300, nonsense: 1 })).toEqual({ powBits: 22, paused: true, busyPerMinute: 300 });
    expect(parseSettings({ powBits: 99, writesPerHour: -1, minVersion: 'abc', quietMinutes: 1.5 })).toEqual({});
    expect(parseSettings('not an object')).toEqual({});
  });

  it('the download limit per box version comes from MAX_BOX_DOWNLOADS or the file, and is at least 25', () => {
    expect(settingsFromEnv({ MAX_BOX_DOWNLOADS: '50' })).toEqual({ maxBoxDownloads: 50 });
    expect(parseSettings({ maxBoxDownloads: 40 })).toEqual({ maxBoxDownloads: 40 });
    expect(parseSettings({ maxBoxDownloads: 24 })).toEqual({});
    expect(parseSettings({ maxBoxDownloads: 25 })).toEqual({ maxBoxDownloads: 25 });
    expect(DEFAULTS.maxBoxDownloads).toBe(30);
  });

  it('reads the environment as a fallback', () => {
    expect(settingsFromEnv({ POW_BITS: '21', MAILBOX_PAUSED: '1', LARGE_DROP_MB_PER_HOUR: '50', MIN_APP_VERSION: '0.17.0' }))
      .toEqual({ powBits: 21, paused: true, largeDropMbPerHour: 50, minVersion: '0.17.0' });
  });

  it('environment switches take 1 or true; empty or invalid values are ignored', () => {
    expect(settingsFromEnv({ MAILBOX_PAUSED: 'true', LARGE_DROPS_PAUSED: '', POW_BITS: '', DROP_MEMORY_MB: 'lots' }))
      .toEqual({ paused: true });
    expect(settingsFromEnv({ LARGE_DROPS_PAUSED: '0' })).toEqual({ largeDropsPaused: false });
  });

  it('the file wins over the environment, and changes are picked up without a restart', () => {
    let t = 0;
    let file: string | null = JSON.stringify({ powBits: 22 });
    const live = new LiveSettings({ powBits: 21, paused: false }, () => file, () => t, 30_000);
    expect(live.get().powBits).toBe(22);
    expect(live.get().quietMinutes).toBe(DEFAULTS.quietMinutes);
    file = JSON.stringify({ powBits: 23, paused: true });
    expect(live.get().powBits).toBe(22);          // not re-read before the interval
    t += 30_000;
    expect(live.get()).toMatchObject({ powBits: 23, paused: true });
  });

  it('a broken file keeps the last good settings', () => {
    let t = 0;
    let file: string | null = JSON.stringify({ powBits: 22 });
    const live = new LiveSettings({ powBits: 21 }, () => file, () => t, 1);
    expect(live.get().powBits).toBe(22);
    file = '{ broken';
    t += 1;
    expect(live.get().powBits).toBe(22);
    expect(live.get().powBits).toBe(22);
  });

  it('level settings are kept within what the app will ever do (base + extra + size <= 28)', () => {
    const live = new LiveSettings({}, () => JSON.stringify({ powBits: 22, maxExtraBits: 8 }), () => 0, 1);
    expect(live.get().maxExtraBits).toBe(1);
    expect(parseSettings({ powBits: 24 })).toEqual({});
  });

  it('a config file that disappears keeps its last settings (a pause stays on)', () => {
    let t = 0;
    let file: string | null = JSON.stringify({ paused: true });
    const live = new LiveSettings({}, () => file, () => t, 1);
    expect(live.get().paused).toBe(true);
    file = null;
    t += 1;
    expect(live.get().paused).toBe(true);
  });
});
