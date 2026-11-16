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

/** A join to someone's sync, carried by the knock instead of a setup: their group key and computer names. */
export interface JoinPayload { key: string; computers: { id: string; name: string }[] }

export function packJoin(j: JoinPayload): Buffer {
  return gzipSync(Buffer.from(JSON.stringify({ sbtlSync: 1, key: j.key, computers: j.computers })));
}

function validateJoin(o: Record<string, unknown>): JoinPayload {
  const key = o.key;
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32) throw new Error('invalid: join key');
  if (!Array.isArray(o.computers) || o.computers.length < 1 || o.computers.length > 10) throw new Error('invalid: join computers');
  const computers = o.computers.map((c: unknown) => {
    const x = c as Record<string, unknown> | null;
    if (!x || typeof x.id !== 'string' || !/^[0-9a-f]{32}$/.test(x.id) || typeof x.name !== 'string' || !x.name || x.name.length > 60) throw new Error('invalid: join computer');
    return { id: x.id, name: x.name };
  });
  return { key, computers };
}

export function unpackDrop(payload: Buffer): { kind: 'setup'; body: SetupBody } | { kind: 'join'; join: JoinPayload } {
  const v: unknown = JSON.parse(gunzipSync(payload, { maxOutputLength: MAX_RECEIVED_BYTES }).toString('utf8'));
  if (v && typeof v === 'object' && (v as Record<string, unknown>).sbtlSync === 1) return { kind: 'join', join: validateJoin(v as Record<string, unknown>) };
  return { kind: 'setup', body: validateSetupBody(v) };
}

export function unpackSetup(payload: Buffer): SetupBody {
  const d = unpackDrop(payload);
  if (d.kind !== 'setup') throw new Error('invalid: not a setup');
  return d.body;
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
