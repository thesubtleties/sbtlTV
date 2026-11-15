/**
 * The body for Send to a device: the picked parts of this computer's setup (only the picked
 * sources), plus providers and keys typed in just for this send (never saved here). Pure.
 */
import type { SetupBody, SetupPart, SetupSource } from './setup-body.js';

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
