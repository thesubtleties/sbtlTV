export type MatchStrategy =
  | 'exact_id' | 'code_match' | 'display_name' | 'name_code'
  | 'slug_match' | 'base_display' | 'loose_name' | 'loose_code'
  | 'base_loose' | 'base_looseslug' | 'loose_looseslug'
  | 'callsign' | 'fuzzy' | 'manual';

// EPG channel mapping (external EPG -> provider channels)
export interface EpgMapping {
  id: string;                  // `${source_id}::${epg_source}::${stream_id}`
  source_id: string;
  epg_channel_id: string;      // provider's epg_channel_id
  xmltv_channel_id: string;    // matched XMLTV channel id
  epg_source: string;          // EPG URL this mapping applies to
  stream_id: string;
  confidence: 'exact' | 'high' | 'medium' | 'manual';
  strategy: MatchStrategy;
}

export interface EpgChannelInfo { id: string; displayNames: string[] }
export interface EpgProgramInfo { channel_id: string; title: string; description: string; start: Date; stop: Date }
