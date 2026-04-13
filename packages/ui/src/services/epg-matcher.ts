/**
 * EPG Channel Matcher - matches provider channels to external EPG channels
 *
 * Strategies (in priority order, first match wins per channel):
 * 1. Exact ID match
 * 2. Code extraction from EPG ID pattern Name(CODE).tld
 * 3. Display name match (normalized)
 * 4. Provider name → EPG code
 * 5. Slug match (normalized IDs)
 * 6. Provider base → EPG display names
 * 7-10. Loose variants (strip "the", "channel", "network", "tv")
 */

import type { XmltvChannel } from '@sbtltv/local-adapter';
import type { Channel } from '@sbtltv/core';
import type { EpgMapping } from '../db/index';

/**
 * Normalize a channel name for fuzzy matching:
 * - Strip country prefixes (USA, US:, UK:, etc.)
 * - Strip quality suffixes (HD, UHD, FHD, SD, East, West, *)
 * - Lowercase, remove non-alphanumeric
 */
function normalize(name: string): string {
  let s = name;
  s = s.replace(/^(USA?|UK|CA|AU|NZ|FR|DE|ES|IT|PT|NL|BE|AT|CH|IE|IN)\s*[:\-|]?\s*/i, '');
  while (/[\s*]*(L?HD|UHD|FHD|SD|4K|East|West|\+1|\*)\s*$/i.test(s)) {
    s = s.replace(/[\s*]*(L?HD|UHD|FHD|SD|4K|East|West|\+1|\*)\s*$/i, '');
  }
  s = s.toLowerCase();
  s = s.replace(/&/g, 'and').replace(/\+/g, 'plus');
  return s.replace(/[^a-z0-9]/g, '');
}

function normalizeLooser(name: string): string {
  let s = normalize(name);
  s = s.replace(/^the/, '');
  s = s.replace(/(channel|network|television|tv)$/, '');
  return s;
}

function extractCodes(epgId: string): string[] {
  const matches = epgId.match(/\(([^)]+)\)/g);
  if (!matches) return [];
  return matches.map(m => m.slice(1, -1).toLowerCase());
}

function slugify(id: string): string {
  return id.replace(/\.\w{2,3}$/, '').replace(/\([^)]*\)/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripTld(id: string): string {
  return id.replace(/\.\w{2,3}$/, '').toLowerCase();
}

/**
 * Match provider channels to XMLTV EPG channels.
 * Returns mappings for all matched channels.
 * All lookups are Map-based → O(N+M) total.
 */
export function matchChannelsToEpg(
  channels: Channel[],
  xmltvChannels: XmltvChannel[],
  sourceId: string,
  epgSource: string,
): EpgMapping[] {
  const mappings: EpgMapping[] = [];
  const matched = new Set<string>();

  const exactMap = new Map<string, string>();
  const codeMap = new Map<string, string>();
  const displayNameMap = new Map<string, string>();
  const slugMap = new Map<string, string>();
  const looseNameMap = new Map<string, string>();
  const looseSlugMap = new Map<string, string>();

  for (const xch of xmltvChannels) {
    exactMap.set(xch.id, xch.id);
    for (const code of extractCodes(xch.id)) {
      codeMap.set(code, xch.id);
      const dtMatch = code.match(/^(.+?)dt(\d?)$/);
      if (dtMatch) {
        const baseCall = dtMatch[1];
        const dtNum = dtMatch[2];
        if (!dtNum || !codeMap.has(baseCall)) {
          codeMap.set(baseCall, xch.id);
        }
      }
    }
    for (const dn of xch.displayNames) {
      const norm = normalize(dn);
      if (norm) displayNameMap.set(norm, xch.id);
      const loose = normalizeLooser(dn);
      if (loose) looseNameMap.set(loose, xch.id);
    }
    const slug = slugify(xch.id);
    if (slug) {
      slugMap.set(slug, xch.id);
      const looseSlug = slug.replace(/(channel|network|television|tv)$/, '');
      if (looseSlug) looseSlugMap.set(looseSlug, xch.id);
    }
  }

  function addMapping(ch: Channel, xmltvId: string, confidence: 'exact' | 'high' | 'medium', strategy: string) {
    if (matched.has(ch.stream_id)) return;
    matched.add(ch.stream_id);
    mappings.push({
      id: `${sourceId}::${epgSource}::${ch.epg_channel_id}`,
      source_id: sourceId,
      epg_channel_id: ch.epg_channel_id,
      xmltv_channel_id: xmltvId,
      epg_source: epgSource,
      stream_id: ch.stream_id,
      confidence,
      strategy,
    });
  }

  for (const ch of channels) {
    if (matched.has(ch.stream_id)) continue;
    const norm = normalize(ch.name);
    const loose = normalizeLooser(ch.name);

    // Strategy 1: Exact ID
    if (ch.epg_channel_id) {
      const ex = exactMap.get(ch.epg_channel_id);
      if (ex) { addMapping(ch, ex, 'exact', 'exact_id'); continue; }
      // Strategy 2: Provider base → EPG code
      const base = stripTld(ch.epg_channel_id);
      if (base) { const cm = codeMap.get(base); if (cm) { addMapping(ch, cm, 'high', 'code_match'); continue; } }
    }
    // Strategy 3: Display name
    if (norm) { const dm = displayNameMap.get(norm); if (dm) { addMapping(ch, dm, 'high', 'display_name'); continue; } }
    // Strategy 4: Name → code
    if (norm) { const cm2 = codeMap.get(norm); if (cm2) { addMapping(ch, cm2, 'high', 'name_code'); continue; } }
    // Strategy 5: Slug match
    if (ch.epg_channel_id) {
      const slug = slugify(ch.epg_channel_id);
      if (slug) { const sm = slugMap.get(slug); if (sm) { addMapping(ch, sm, 'high', 'slug_match'); continue; } }
    }
    // Strategy 6: Provider base → EPG display names
    if (ch.epg_channel_id) {
      const base = stripTld(ch.epg_channel_id);
      if (base) { const dm2 = displayNameMap.get(base); if (dm2) { addMapping(ch, dm2, 'high', 'base_display'); continue; } }
    }
    // Strategy 7: Loose name match
    if (loose) { const lm = looseNameMap.get(loose); if (lm) { addMapping(ch, lm, 'medium', 'loose_name'); continue; } }
    // Strategy 8: Loose name → code
    if (loose) { const lc = codeMap.get(loose); if (lc) { addMapping(ch, lc, 'medium', 'loose_code'); continue; } }
    // Strategy 9: Provider base (loose) → EPG loose names/slugs
    if (ch.epg_channel_id) {
      const baseLo = normalizeLooser(stripTld(ch.epg_channel_id));
      if (baseLo) {
        const bl = looseNameMap.get(baseLo); if (bl) { addMapping(ch, bl, 'medium', 'base_loose'); continue; }
        const bls = looseSlugMap.get(baseLo); if (bls) { addMapping(ch, bls, 'medium', 'base_looseslug'); continue; }
      }
    }
    // Strategy 10: Loose name → loose slug
    if (loose) { const ls = looseSlugMap.get(loose); if (ls) { addMapping(ch, ls, 'medium', 'loose_looseslug'); continue; } }
    // Strategy 11: Extract call signs from channel name
    {
      const skip = new Set(['USA', 'UHD', 'WEST', 'EAST', 'COZI', 'CBSN', 'CSPAN', 'CNBC', 'CMT', 'CNN', 'CBS', 'CMA', 'CITY', 'CRIME', 'WORLD', 'CGTN', 'WWE', 'NBC', 'ABC', 'FOX', 'PBS', 'CW']);
      const parenMatches = ch.name.match(/\(([A-Z][A-Z0-9\-]{2,8})\)/g) || [];
      const parenSigns = parenMatches.map(s => s.slice(1, -1).replace(/-/g, ''));
      const textSigns = ch.name.match(/\b([KWCX][A-Z]{2,4}(?:-?DT\d?)?)\b/g) || [];
      const allSigns = [...parenSigns, ...textSigns.map(s => s.replace(/-/g, ''))];

      for (const sign of allSigns) {
        if (skip.has(sign) || sign.length < 3) continue;
        const code = sign.toLowerCase();
        const cm = codeMap.get(code)
          || codeMap.get(code + 'dt')
          || (code.match(/dt\d?$/) ? codeMap.get(code.replace(/dt\d?$/, '')) : null);
        if (cm) { addMapping(ch, cm, 'medium', 'callsign'); break; }
      }
      if (matched.has(ch.stream_id)) continue;
    }
  }

  return mappings;
}
