/**
 * The mailbox's knobs. Defaults live here; the deployment overrides them with a JSON file
 * (MAILBOX_CONFIG_FILE, delivered from Infisical as a mounted secret) re-read every 30 s, so they
 * can be turned mid-attack without a restart and without the values being in any repo. Environment
 * variables are the fallback when there's no file. The file wins.
 */
import { readFileSync } from 'node:fs';

export interface Settings {
  /** Proof-of-work level when it's quiet (bits; 20 ≈ 1 s on an average computer) */
  powBits: number;
  /** Oldest app version allowed to send or receive */
  minVersion: string;
  /** Proven writes per hour per address (behind the cluster: everyone together); a backstop */
  writesPerHour: number;
  /** Memory for drops nobody has picked up yet */
  dropMemoryMb: number;
  /** Drops at least this big are "large" */
  largeDropKb: number;
  /** Large drops accepted per hour, everyone together */
  largeDropMbPerHour: number;
  /** Refuse every write / only large drops, as "busy" */
  paused: boolean;
  largeDropsPaused: boolean;
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
  writesPerHour: 100_000,
  dropMemoryMb: 2048,
  largeDropKb: 256,
  largeDropMbPerHour: 200,
  paused: false,
  largeDropsPaused: false,
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
  powBits: int(1, 28),
  minVersion: version,
  writesPerHour: int(1, 100_000_000),
  dropMemoryMb: int(1, 100_000),
  largeDropKb: int(1, 2048),
  largeDropMbPerHour: int(0, 100_000),
  paused: bool,
  largeDropsPaused: bool,
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
  POW_BITS: 'powBits', MIN_APP_VERSION: 'minVersion', WRITES_PER_HOUR: 'writesPerHour', DROP_MEMORY_MB: 'dropMemoryMb',
  LARGE_DROP_KB: 'largeDropKb', LARGE_DROP_MB_PER_HOUR: 'largeDropMbPerHour', MAILBOX_PAUSED: 'paused',
  LARGE_DROPS_PAUSED: 'largeDropsPaused', BUSY_PER_MINUTE: 'busyPerMinute', MAX_EXTRA_BITS: 'maxExtraBits',
  QUIET_PER_MINUTE: 'quietPerMinute', QUIET_MINUTES: 'quietMinutes',
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
      if (text === null) this.fileSettings = {};
      else {
        try { this.fileSettings = parseSettings(JSON.parse(text)); } catch { /* keep the last good file */ }
      }
    }
    return { ...DEFAULTS, ...this.env, ...this.fileSettings };
  }
}

/** The file at `path`, or null when there is none (not configured, or not mounted yet). */
export const fileReader = (path: string | undefined) => (): string | null => {
  if (!path) return null;
  try { return readFileSync(path, 'utf8'); } catch { return null; }
};
