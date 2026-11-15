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
  const extraSources: SetupSource[] = sel.extras.sources.map((s) => ({ ...s, id: newId(), enabled: true }));
  if (picked.length || extraSources.length) {
    out.sources = [...picked, ...extraSources];
    includes.add('sources');
    if (extraSources.some((s) => s.password)) includes.add('logins');
  } else {
    delete out.sources;
    includes.delete('sources');
  }
  const typed = Object.fromEntries(Object.entries(sel.extras.apiKeys).filter(([, v]) => v));
  const keys = { ...(base.apiKeys ?? {}), ...typed };
  if (Object.keys(keys).length) { out.apiKeys = keys; includes.add('apiKeys'); }
  out.includes = [...includes];
  return out;
}
