/**
 * The mailbox's knobs. Defaults live here; the deployment overrides them with a JSON file
 * (MAILBOX_CONFIG_FILE, delivered from Infisical as a mounted secret) re-read every 30 s, so they
 * can be turned mid-attack without a restart and without the values being in any repo. Environment
 * variables are the fallback when there's no file. The file wins.
 */
import { readFileSync } from 'node:fs';
import { MAX_SIZE_BITS } from '../protocol/index.js';

export interface Settings {
  /** Proof-of-work level when it's quiet (bits; 20 ≈ 1 s on an average computer) */
  powBits: number;
  /** Oldest app version allowed to send or receive */
  minVersion: string;
  /** Memory for drops nobody has picked up yet */
  dropMemoryMb: number;
  /** Drops at least this big are "large" */
  largeDropKb: number;
  /** Large drops accepted per hour, everyone together */
  largeDropMbPerHour: number;
  /** Refuse every write / only large drops, as "busy" */
  paused: boolean;
  largeDropsPaused: boolean;
  /** Refuse sync writes as busy */
  syncPaused: boolean;
  /** Refuse only sync writes that would start a new group */
  newGroupsPaused: boolean;
  /** Memory for large sync list replies until each is fully sent (small ones are always served) */
  listMbInFlight: number;
  /** The same for small replies (the usual "anything new?"), each held at most 15 s */
  smallListMbInFlight: number;
  /** Database size above which sync uploads are refused as busy (a full disk would stop sync for everyone) */
  syncMaxDbMb: number;
  /**
   * Full downloads of one version of a box (or one new key) before the relay stops serving it,
   * until the box changes. Normal sync downloads each version about once per computer in the group
   * (10 at most, its own maker included), plus one per computer joining. At least 20.
   */
  maxBoxDownloads: number;
  /** A minute with more proven writes than this raises the level one step */
  busyPerMinute: number;
  /** The most steps above powBits */
  maxExtraBits: number;
  /** This many minutes in a row under quietPerMinute bring it down one step */
  quietPerMinute: number;
  quietMinutes: number;
}

export const DEFAULTS: Settings = {
  powBits: 20,
  minVersion: '0.17.0',
  dropMemoryMb: 2048,
  largeDropKb: 16,
  largeDropMbPerHour: 200,
  paused: false,
  largeDropsPaused: false,
  syncPaused: false,
  newGroupsPaused: false,
  listMbInFlight: 256,
  smallListMbInFlight: 256,
  syncMaxDbMb: 1536,
  maxBoxDownloads: 30,
  busyPerMinute: 100,
  maxExtraBits: 3,
  quietPerMinute: 50,
  quietMinutes: 10,
};

type Rule = (v: unknown) => boolean;
const int = (min: number, max: number): Rule => (v) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const bool: Rule = (v) => typeof v === 'boolean';
const version: Rule = (v) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);

const RULES: Record<keyof Settings, Rule> = {
  powBits: int(1, 23),
  minVersion: version,
  dropMemoryMb: int(1, 100_000),
  largeDropKb: int(1, 2048),
  largeDropMbPerHour: int(0, 100_000),
  paused: bool,
  largeDropsPaused: bool,
  syncPaused: bool,
  newGroupsPaused: bool,
  listMbInFlight: int(1, 100_000),
  smallListMbInFlight: int(1, 100_000),
  syncMaxDbMb: int(1, 1_000_000),
  maxBoxDownloads: int(20, 1_000_000),
  busyPerMinute: int(1, 1_000_000),
  maxExtraBits: int(0, 8),
  quietPerMinute: int(0, 1_000_000),
  quietMinutes: int(1, 1440),
};

/** Known settings with valid values only; anything else is ignored. */
export function parseSettings(raw: unknown): Partial<Settings> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Partial<Record<keyof Settings, unknown>> = {};
  for (const key of Object.keys(RULES) as (keyof Settings)[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (RULES[key](v)) out[key] = v;
  }
  return out as Partial<Settings>;
}

const ENV: Record<string, keyof Settings> = {
  POW_BITS: 'powBits', MIN_APP_VERSION: 'minVersion', DROP_MEMORY_MB: 'dropMemoryMb',
  LARGE_DROP_KB: 'largeDropKb', LARGE_DROP_MB_PER_HOUR: 'largeDropMbPerHour', MAILBOX_PAUSED: 'paused',
  LARGE_DROPS_PAUSED: 'largeDropsPaused', BUSY_PER_MINUTE: 'busyPerMinute', MAX_EXTRA_BITS: 'maxExtraBits',
  QUIET_PER_MINUTE: 'quietPerMinute', QUIET_MINUTES: 'quietMinutes',
  SYNC_PAUSED: 'syncPaused', NEW_GROUPS_PAUSED: 'newGroupsPaused', LIST_MB_IN_FLIGHT: 'listMbInFlight', SMALL_LIST_MB_IN_FLIGHT: 'smallListMbInFlight', SYNC_MAX_DB_MB: 'syncMaxDbMb', MAX_BOX_DOWNLOADS: 'maxBoxDownloads',
};

export function settingsFromEnv(env: Record<string, string | undefined>): Partial<Settings> {
  const raw: Record<string, unknown> = {};
  for (const [name, key] of Object.entries(ENV)) {
    const v = env[name];
    if (v === undefined || v === '') continue;
    raw[key] = RULES[key] === bool ? v === '1' || v === 'true' : RULES[key] === version ? v : Number(v);
  }
  return parseSettings(raw);
}

/**
 * The most work the app will do for one request is 28 bits; the largest send adds MAX_SIZE_BITS.
 * So base + extra steps may not pass 28 - 5 = 23, or nobody could send anything big.
 */
const MAX_LEVEL_BITS = 28 - MAX_SIZE_BITS;

function withinLimits(s: Settings): Settings {
  return s.powBits + s.maxExtraBits > MAX_LEVEL_BITS ? { ...s, maxExtraBits: Math.max(0, MAX_LEVEL_BITS - s.powBits) } : s;
}

/** Defaults ← environment ← file, the file re-read at most every `everyMs`. */
export class LiveSettings {
  private fileSettings: Partial<Settings> = {};
  private lastRead = -Infinity;
  constructor(
    private env: Partial<Settings>,
    private readFile: () => string | null,
    private now: () => number = Date.now,
    private everyMs = 30_000,
  ) {}

  get(): Settings {
    if (this.now() - this.lastRead >= this.everyMs) {
      this.lastRead = this.now();
      const text = this.readFile();
      // No file (not mounted yet, or briefly gone during an update) or a broken one: keep the last
      // good settings, so a pause can't switch itself off
      if (text !== null) {
        try {
          const raw: unknown = JSON.parse(text);
          this.fileSettings = parseSettings(raw);
          this.warnIgnored(raw);
        } catch { /* keep the last good file */ }
      }
    }
    return withinLimits({ ...DEFAULTS, ...this.env, ...this.fileSettings });
  }

  private warned = '';
  /** Names (never values) of settings the file has that were ignored, once per change. */
  private warnIgnored(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return;
    const ignored = Object.keys(raw).filter((k) => !(k in this.fileSettings)).sort().join(', ');
    if (ignored && ignored !== this.warned) console.warn(`relay settings ignored (unknown or out of range): ${ignored}`);
    this.warned = ignored;
  }
}

/** The file at `path`, or null when there is none (not configured, or not mounted yet). */
export const fileReader = (path: string | undefined) => (): string | null => {
  if (!path) return null;
  try { return readFileSync(path, 'utf8'); } catch { return null; }
};
