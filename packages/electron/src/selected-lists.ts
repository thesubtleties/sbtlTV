// Selected lists (Movies/Series home rows) from sbtltv.com. Pure: signature, validation, cache
// and date logic, so it runs under node:test; main.ts makes the requests and writes the file.
// The file is data only: TMDB ids matched to the user's own library, plus short plain text.
import { createPublicKey, verify } from 'node:crypto';

export const LISTS_URL = 'https://sbtltv.com/lists/v1.json';
export const LISTS_SIG_URL = 'https://sbtltv.com/lists/v1.json.sig';
/** Ed25519 keys allowed to sign the lists (thesubtleties/sbtltv.com lists/public-key.pem). More than one only during a key change. */
export const LISTS_PUBLIC_KEYS: string[] = [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAzrKwgccGkpB0TXOg2Cz4nf5GzcAUoCKNlyplxAP+cNA=
-----END PUBLIC KEY-----
`,
];
export const MAX_LISTS_BYTES = 256 * 1024;
export const MAX_SIG_BYTES = 1024;
export const REFRESH_MS = 24 * 3600 * 1000;
const MAX_LISTS = 50;
const MAX_ITEMS = 100;

export interface SelectedList { id: string; name: string; blurb: string; items: number[]; from?: string; until?: string }
export interface SelectedLists { movies: SelectedList[]; series: SelectedList[] }
export interface ListsCache { etag: string | null; fetchedAt: number; body: string; sig: string }

const ID = /^[a-z0-9-]{1,48}$/;
const LINK = /https?:|www\.|\b[a-z0-9-]+\.(com|net|org|tv|io|me|gg|xyz|ru|cc|co|info|app|dev|link|ly)\b/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const validDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const okText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max && !LINK.test(v);

/** True when any allowed key signed exactly these bytes. */
export function verifyListsSignature(body: Buffer, sig: string, keys: string[] = LISTS_PUBLIC_KEYS): boolean {
  const s = sig.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false;
  const raw = Buffer.from(s, 'base64');
  if (raw.length !== 64) return false;
  return keys.some((pem) => {
    try { return verify(null, body, createPublicKey(pem), raw); } catch { return false; }
  });
}

function parseList(l: unknown, seen: Set<string>): SelectedList | null {
  if (!isObj(l) || typeof l.id !== 'string' || !ID.test(l.id) || seen.has(l.id)) return null;
  if (!okText(l.name, 40) || !okText(l.blurb, 140)) return null;
  const items = l.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) return null;
  if (!items.every((n) => Number.isInteger(n) && (n as number) > 0) || new Set(items).size !== items.length) return null;
  if (l.from !== undefined && !validDate(l.from)) return null;
  if (l.until !== undefined && !validDate(l.until)) return null;
  if (validDate(l.from) && validDate(l.until) && l.until <= l.from) return null;
  seen.add(l.id);
  const out: SelectedList = { id: l.id, name: l.name, blurb: l.blurb, items: items as number[] };
  if (validDate(l.from)) out.from = l.from;
  if (validDate(l.until)) out.until = l.until;
  return out;
}

/** The whole file or nothing: one bad list means something is wrong with this copy. */
export function parseListsFile(text: string): SelectedLists | null {
  if (text.length > MAX_LISTS_BYTES) return null;
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (!isObj(data) || data.v !== 1 || !validDate(data.updated)) return null;
  const seen = new Set<string>();
  const out: SelectedLists = { movies: [], series: [] };
  for (const key of ['movies', 'series'] as const) {
    const arr = data[key];
    if (!Array.isArray(arr) || arr.length > MAX_LISTS) return null;
    for (const l of arr) {
      const parsed = parseList(l, seen);
      if (!parsed) return null;
      out[key].push(parsed);
    }
  }
  return out;
}

/** Lists shown today (local YYYY-MM-DD): from inclusive, until exclusive. */
export function listsInWindow(lists: SelectedLists, today: string): SelectedLists {
  const shown = (l: SelectedList) => (!l.from || l.from <= today) && (!l.until || today < l.until);
  return { movies: lists.movies.filter(shown), series: lists.series.filter(shown) };
}

export const isStale = (fetchedAt: number | undefined, now: number): boolean => fetchedAt === undefined || now - fetchedAt >= REFRESH_MS;

/** A cache file is trusted only if it still verifies with the current keys and still validates. */
export function readCache(raw: unknown, keys: string[] = LISTS_PUBLIC_KEYS): { cache: ListsCache; lists: SelectedLists } | null {
  if (!isObj(raw) || typeof raw.body !== 'string' || typeof raw.sig !== 'string' || typeof raw.fetchedAt !== 'number') return null;
  if (raw.etag !== null && typeof raw.etag !== 'string') return null;
  if (!verifyListsSignature(Buffer.from(raw.body, 'utf8'), raw.sig, keys)) return null;
  const lists = parseListsFile(raw.body);
  if (!lists) return null;
  return { cache: { etag: raw.etag as string | null, fetchedAt: raw.fetchedAt, body: raw.body, sig: raw.sig }, lists };
}
