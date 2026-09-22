import type { Source, DataSettings } from '@sbtltv/core';

export interface SourceMetaWire {
  source_id: string;
  last_channel_sync?: number | null;
  last_epg_sync?: number | null;
  last_vod_sync?: number | null;
}

// Rules copied from sync.ts isEpgStale/isVodStale and App.tsx: 0 hours means
// never automatic; no timestamp means due; channels/EPG use the EPG refresh
// setting against the last EPG sync (or channel sync if EPG never ran); VOD
// only exists for Xtream sources.
function stale(last: number | null | undefined, hours: number, nowMs: number): boolean {
  if (hours === 0) return false;
  if (last == null) return true;
  return nowMs - last > hours * 3600_000;
}

export function dueSyncs(metas: SourceMetaWire[], sources: Source[], settings: DataSettings, nowMs: number): { sourceId: string; channels: boolean; vod: boolean }[] {
  const byId = new Map(metas.map((m) => [m.source_id, m]));
  return sources.filter((s) => s.enabled).map((s) => {
    const m = byId.get(s.id);
    return {
      sourceId: s.id,
      channels: stale(m?.last_epg_sync ?? m?.last_channel_sync, settings.epgRefreshHours, nowMs),
      vod: s.type === 'xtream' && stale(m?.last_vod_sync, settings.vodRefreshHours, nowMs),
    };
  });
}
