/**
 * The body for Send to a device: the picked parts of this computer's setup (only the picked
 * sources), plus providers and keys typed in just for this send (never saved here). Pure.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { validateSetupBody, type SetupBody, type SetupPart, type SetupSource } from './setup-body.js';

/** A received setup may unpack to at most this (the sealed drop is at most 2 MB; this stops a zip bomb). */
export const MAX_RECEIVED_BYTES = 64 * 1024 * 1024;

/** The mailbox's drop limit (@sbtltv/mailbox MAX_DROP_BYTES, 2 MB sealed) minus what sealing adds (nonce 12 + tag 16). */
const DROP_LIMIT_BYTES = 2 * 1024 * 1024;
const SEAL_OVERHEAD = 28;

/** Checked before ringing, so nobody reads out a code and matches words for a send that can't go. */
export function fitsInDrop(packed: Buffer): boolean {
  return packed.length + SEAL_OVERHEAD <= DROP_LIMIT_BYTES;
}

export function packSetup(body: SetupBody): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(body)));
}

/** Throws on anything that isn't a valid setup within the size limit. */
export function unpackSetup(payload: Buffer): SetupBody {
  return validateSetupBody(JSON.parse(gunzipSync(payload, { maxOutputLength: MAX_RECEIVED_BYTES }).toString('utf8')));
}

export interface SendExtras {
  sources: Omit<SetupSource, 'id' | 'enabled'>[];
  apiKeys: { tmdb?: string; posterDb?: string; subdl?: string };
}
export interface SendSelection { parts: SetupPart[]; sourceIds: string[] | null; extras: SendExtras }

export function sendBody(base: SetupBody, sel: SendSelection, newId: () => string): SetupBody {
  const includes = new Set<SetupPart>(base.includes);
  const out: SetupBody = { ...base };
  const picked = (base.sources ?? []).filter((s) => sel.sourceIds === null || sel.sourceIds.includes(s.id));
  const extraSources: SetupSource[] = sel.extras.sources.map((s) => tidyExtra(s, newId()));
  if (picked.length || extraSources.length) {
    out.sources = [...picked, ...extraSources];
    includes.add('sources');
    if (extraSources.some((s) => s.password)) includes.add('logins');
  } else {
    delete out.sources;
    includes.delete('sources');
  }
  const typed = Object.fromEntries(Object.entries(sel.extras.apiKeys).map(([k, v]) => [k, v?.trim()]).filter(([, v]) => v));
  const keys = { ...(base.apiKeys ?? {}), ...typed };
  if (Object.keys(keys).length) { out.apiKeys = keys; includes.add('apiKeys'); }
  out.includes = [...includes];
  return out;
}

/**
 * A provider typed in just for this send, as it should arrive: trimmed (a pasted password with a
 * trailing space would never log in), an M3U without leftover login fields, an Xtream with both.
 */
function tidyExtra(s: SendExtras['sources'][number], id: string): SetupSource {
  const name = s.name.trim(), url = s.url.trim();
  if (s.type !== 'xtream') return { ...(s.epg_url && { epg_url: s.epg_url.trim() }), id, name, type: s.type, url, enabled: true };
  const username = s.username?.trim() ?? '', password = s.password?.trim() ?? '';
  if (!username || !password) throw new Error(`invalid: extra source login (${name})`);
  return { id, name, type: 'xtream', url, username, password, enabled: true };
}

/** What a received setup changes on the receiver; everything else (and favorites, watchlist, progress) stays. */
export function receivedChanges(body: SetupBody): { sources: boolean; settings: boolean; apiKeys: ('tmdb' | 'posterDb' | 'subdl')[] } {
  return {
    sources: body.includes.includes('sources') && body.sources !== undefined,
    settings: body.includes.includes('settings') && body.settings !== undefined,
    apiKeys: (['tmdb', 'posterDb', 'subdl'] as const).filter((k) => !!body.apiKeys?.[k]),
  };
}
