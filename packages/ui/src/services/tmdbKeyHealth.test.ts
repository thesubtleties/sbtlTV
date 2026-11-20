import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/debugLog', () => ({ debugLog: vi.fn() }));
const addToast = vi.fn();
vi.mock('../stores/toastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));

import { isKeyRefused, noteTmdbResult, REJECTIONS_TO_STOP, resetTmdbKeyHealth, tmdbKeyStopped, useTmdbKeyHealth } from './tmdbKeyHealth';

const refused = { status_code: 7, status_message: 'Invalid API key', success: false };

describe('tmdbKeyHealth', () => {
  beforeEach(() => { resetTmdbKeyHealth(); addToast.mockClear(); });

  it('counts only TMDB key refusals', () => {
    expect(isKeyRefused(refused)).toBe(true);
    expect(isKeyRefused({ status_code: 10 })).toBe(true); // suspended
    expect(isKeyRefused({ status_code: 25 })).toBe(false); // rate limit
    expect(isKeyRefused({ status_code: 34 })).toBe(false); // not found
    expect(isKeyRefused(new TypeError('Failed to fetch'))).toBe(false);
    expect(isKeyRefused(null)).toBe(false);
  });

  it('stops after REJECTIONS_TO_STOP refusals in a row, with one toast', () => {
    for (let i = 0; i < REJECTIONS_TO_STOP - 1; i++) noteTmdbResult(refused);
    expect(tmdbKeyStopped()).toBe(false);
    noteTmdbResult(refused);
    expect(tmdbKeyStopped()).toBe(true);
    noteTmdbResult(refused);
    expect(addToast).toHaveBeenCalledTimes(1);
  });

  it('a success in between starts the count again; other errors leave it alone', () => {
    for (let i = 0; i < REJECTIONS_TO_STOP - 1; i++) noteTmdbResult(refused);
    noteTmdbResult(undefined);
    expect(useTmdbKeyHealth.getState().rejections).toBe(0);
    for (let i = 0; i < REJECTIONS_TO_STOP - 1; i++) noteTmdbResult(refused);
    noteTmdbResult(new TypeError('offline'));
    noteTmdbResult({ status_code: 25 });
    expect(tmdbKeyStopped()).toBe(false);
  });

  it('reset (new key, passing validation) resumes', () => {
    for (let i = 0; i < REJECTIONS_TO_STOP; i++) noteTmdbResult(refused);
    resetTmdbKeyHealth();
    expect(tmdbKeyStopped()).toBe(false);
  });
});
