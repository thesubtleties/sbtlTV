/**
 * EPG Parse Worker Thread (Node.js Worker Thread in main process)
 *
 * Uses a worker thread (not web worker) because gzipped EPG files need native
 * fs/zlib for streaming decompression — unavailable in browser web workers.
 *
 * Stream-parses XMLTV from a file — constant memory, handles any file size.
 * Two-phase parsing: Phase 1 scans only <channel> elements to build a matched
 * ID set, Phase 2 uses that set to skip ~90% of <programme> data.
 */
import { parentPort, workerData } from 'worker_threads';
import { createReadStream, statSync } from 'fs';

interface EpgChannel { id: string; displayNames: string[]; }
interface EpgProgram { channel_id: string; title: string; description: string; start: string; stop: string; }
interface ProviderChannel { epg_channel_id: string; name: string; stream_id: string; }

function workerLog(msg: string) {
  parentPort?.postMessage({ type: 'log', message: msg });
}

// ---- Matching helpers (duplicated from epg-matcher.ts) ----
// Worker thread runs in Node.js main process and can't import from the
// renderer-side UI package. Keep these in sync with epg-matcher.ts manually.

function normalize(name: string): string {
  let s = name;
  s = s.replace(/^(USA?|UK|CA|AU|NZ|FR|DE|ES|IT|PT|NL|BE|AT|CH|IE|IN)\s*[:\-|]?\s*/i, '');
  s = s.replace(/([\s*]*(L?HD|UHD|FHD|SD|4K|East|West|\+1|\*))+\s*$/i, '');
  s = s.toLowerCase();
  s = s.replace(/&/g, 'and').replace(/\+/g, 'plus');
  return s.replace(/[^a-z0-9]/g, '');
}

function normalizeLooser(name: string): string {
  let s = normalize(name);
  s = s.replace(/^the/, '');
  s = s.replace(/(channel|network|television)$/, '');
  // Only strip trailing "tv" if preceded by 3+ chars (avoid mangling acronyms like MTV, CTV, ATV)
  s = s.replace(/(?<=.{3})tv$/, '');
  return s;
}

function extractCodes(epgId: string): string[] {
  const matches = epgId.match(/\(([^)]+)\)/g);
  if (!matches) return [];
  return matches.map(m => m.slice(1, -1).toLowerCase());
}

function slugify(id: string): string {
  return id.replace(/\.\w{2,3}$/, '').replace(/\([^)]*\)/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripTld(id: string): string {
  return id.replace(/\.\w{2,3}$/, '').toLowerCase();
}

function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
}

function parseDate(d: string): string | null {
  const m = d.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/);
  if (!m) return null;
  const [, yr, mo, dy, hr, mn, sc, tz] = m;
  return `${yr}-${mo}-${dy}T${hr}:${mn}:${sc}${tz ? tz.slice(0, 3) + ':' + tz.slice(3) : 'Z'}`;
}

// ---- Matching logic ----

function buildMatchedXmltvIds(xmltvChannels: EpgChannel[], providerChannels: ProviderChannel[]): Set<string> {
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
      // US/CA local stations use DT (digital television) suffix in XMLTV (e.g. "wabcdt"),
      // but providers use bare call signs ("wabc"). Map base call to catch these.
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

  const providerMatched = new Set<string>();
  const callsignSkip = new Set(['USA', 'UHD', 'WEST', 'EAST', 'COZI', 'CBSN', 'CSPAN', 'CNBC', 'CMT', 'CNN', 'CBS', 'CMA', 'CITY', 'CRIME', 'WORLD', 'CGTN', 'WWE', 'NBC', 'ABC', 'FOX', 'PBS', 'CW']);

  for (const ch of providerChannels) {
    if (providerMatched.has(ch.stream_id)) continue;
    const norm = normalize(ch.name);
    const loose = normalizeLooser(ch.name);

    if (ch.epg_channel_id) {
      const ex = exactMap.get(ch.epg_channel_id);
      if (ex) { matched.add(ex); providerMatched.add(ch.stream_id); continue; }
      const base = stripTld(ch.epg_channel_id);
      if (base) { const cm = codeMap.get(base); if (cm) { matched.add(cm); providerMatched.add(ch.stream_id); continue; } }
    }
    if (norm) { const dm = displayNameMap.get(norm); if (dm) { matched.add(dm); providerMatched.add(ch.stream_id); continue; } }
    if (norm) { const cm2 = codeMap.get(norm); if (cm2) { matched.add(cm2); providerMatched.add(ch.stream_id); continue; } }
    if (ch.epg_channel_id) {
      const slug = slugify(ch.epg_channel_id);
      if (slug) { const sm = slugMap.get(slug); if (sm) { matched.add(sm); providerMatched.add(ch.stream_id); continue; } }
    }
    if (ch.epg_channel_id) {
      const base = stripTld(ch.epg_channel_id);
      if (base) { const dm2 = displayNameMap.get(base); if (dm2) { matched.add(dm2); providerMatched.add(ch.stream_id); continue; } }
    }
    if (loose) { const lm = looseNameMap.get(loose); if (lm) { matched.add(lm); providerMatched.add(ch.stream_id); continue; } }
    if (loose) { const lc = codeMap.get(loose); if (lc) { matched.add(lc); providerMatched.add(ch.stream_id); continue; } }
    if (ch.epg_channel_id) {
      const baseLo = normalizeLooser(stripTld(ch.epg_channel_id));
      if (baseLo) {
        const bl = looseNameMap.get(baseLo); if (bl) { matched.add(bl); providerMatched.add(ch.stream_id); continue; }
        const bls = looseSlugMap.get(baseLo); if (bls) { matched.add(bls); providerMatched.add(ch.stream_id); continue; }
      }
    }
    if (loose) { const ls = looseSlugMap.get(loose); if (ls) { matched.add(ls); providerMatched.add(ch.stream_id); continue; } }

    // Strategy 11: Extract call signs from channel name
    {
      const parenMatches = ch.name.match(/\(([A-Z][A-Z0-9\-]{2,8})\)/g) || [];
      const parenSigns = parenMatches.map(s => s.slice(1, -1).replace(/-/g, ''));
      const textSigns = ch.name.match(/\b([KWCX][A-Z]{2,4}(?:-?DT\d?)?)\b/g) || [];
      const allSigns = [...parenSigns, ...textSigns.map(s => s.replace(/-/g, ''))];

      for (const sign of allSigns) {
        if (callsignSkip.has(sign) || sign.length < 3) continue;
        const code = sign.toLowerCase();
        const cm = codeMap.get(code)
          || codeMap.get(code + 'dt')
          || (code.match(/dt\d?$/) ? codeMap.get(code.replace(/dt\d?$/, '')) : null);
        if (cm) { matched.add(cm); providerMatched.add(ch.stream_id); break; }
      }
      if (providerMatched.has(ch.stream_id)) continue;
    }
  }

  // Strategy 12: Lightweight fuzzy fallback — word overlap + substring matching
  {
    const wordIndex = new Map<string, Set<string>>();
    for (const xch of xmltvChannels) {
      for (const dn of xch.displayNames) {
        const words = normalize(dn).match(/[a-z]{3,}/g) || [];
        for (const w of words) {
          if (!wordIndex.has(w)) wordIndex.set(w, new Set());
          wordIndex.get(w)!.add(xch.id);
        }
      }
    }

    const epgNormById = new Map<string, string>();
    for (const xch of xmltvChannels) {
      if (xch.displayNames.length > 0) {
        epgNormById.set(xch.id, normalize(xch.displayNames[0]));
      }
    }

    let fuzzyMatched = 0;
    for (const ch of providerChannels) {
      if (providerMatched.has(ch.stream_id)) continue;
      const norm = normalize(ch.name);
      if (!norm || norm.length < 4) continue;
      const words = norm.match(/[a-z]{3,}/g) || [];
      if (words.length === 0) continue;

      const candidates = new Map<string, number>();
      for (const w of words) {
        const ids = wordIndex.get(w);
        if (ids) {
          for (const id of ids) candidates.set(id, (candidates.get(id) || 0) + 1);
        }
      }

      let bestId: string | null = null;
      let bestScore = 0;
      for (const [id, wordOverlap] of candidates) {
        if (wordOverlap < Math.max(1, words.length * 0.4)) continue;
        const epgNorm = epgNormById.get(id);
        if (!epgNorm) continue;
        const shorter = norm.length < epgNorm.length ? norm : epgNorm;
        const longer = norm.length >= epgNorm.length ? norm : epgNorm;
        if (longer.includes(shorter) || shorter.includes(longer)) {
          const score = shorter.length / longer.length;
          if (score > bestScore && score >= 0.6) { bestScore = score; bestId = id; }
        }
      }

      if (bestId) {
        matched.add(bestId);
        providerMatched.add(ch.stream_id);
        fuzzyMatched++;
      }
    }
    if (fuzzyMatched > 0) {
      workerLog(`[epg-worker] Fuzzy fallback matched ${fuzzyMatched} additional channels`);
    }
  }

  return matched;
}

// ---- Stream parser ----

/**
 * Stream-parse an XMLTV file. Reads the file line by line, accumulates element blocks,
 * and emits parsed channel/programme objects. Constant memory — handles any file size.
 */
function streamParseXmltv(
  filePath: string,
  filterChannelIds: Set<string> | null,
  onChannel: (ch: EpgChannel) => void,
  onProgram: (p: EpgProgram) => void,
): Promise<{ channelCount: number; programCount: number; skipped: number }> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 256 * 1024 });

    let remainder = '';
    let channelCount = 0;
    let programCount = 0;
    let skipped = 0;

    function extractAttr(tag: string, name: string): string | null {
      for (const q of ['"', "'"]) {
        const key = name + '=' + q;
        const i = tag.indexOf(key);
        if (i === -1) continue;
        const s = i + key.length;
        const e = tag.indexOf(q, s);
        if (e === -1) continue;
        return tag.slice(s, e);
      }
      return null;
    }

    function extractChild(block: string, tagName: string): string {
      const open = '<' + tagName;
      const p = block.indexOf(open);
      if (p === -1) return '';
      const te = block.indexOf('>', p);
      if (te === -1) return '';
      const close = '</' + tagName + '>';
      const cp = block.indexOf(close, te + 1);
      if (cp === -1) return '';
      return block.slice(te + 1, cp);
    }

    function processBlock(block: string) {
      // Detect element type from opening tag
      const trimmed = block.trimStart();

      if (trimmed.startsWith('<channel ')) {
        const tagEnd = block.indexOf('>');
        if (tagEnd === -1) return;
        const id = extractAttr(block.slice(0, tagEnd + 1), 'id');
        if (!id) return;

        const decodedId = decodeEntities(id);
        const displayNames: string[] = [];
        let pos = tagEnd + 1;
        while (true) {
          const ds = block.indexOf('<display-name', pos);
          if (ds === -1) break;
          const dte = block.indexOf('>', ds);
          if (dte === -1) break;
          const dcp = block.indexOf('</display-name>', dte + 1);
          if (dcp === -1) break;
          const nm = decodeEntities(block.slice(dte + 1, dcp)).trim();
          if (nm) displayNames.push(nm);
          pos = dcp + 15;
        }

        channelCount++;
        onChannel({ id: decodedId, displayNames });
      } else if (trimmed.startsWith('<programme ')) {
        const tagEnd = block.indexOf('>');
        if (tagEnd === -1) return;
        const openTag = block.slice(0, tagEnd + 1);

        const channelId = extractAttr(openTag, 'channel');
        if (!channelId) return;

        // Fast skip if channel not in filter
        const decodedChannelId = decodeEntities(channelId);
        if (filterChannelIds && !filterChannelIds.has(decodedChannelId)) {
          skipped++;
          return;
        }

        const startStr = extractAttr(openTag, 'start');
        const stopStr = extractAttr(openTag, 'stop');
        if (!startStr || !stopStr) return;

        const start = parseDate(startStr);
        const stop = parseDate(stopStr);
        if (!start || !stop) return;

        const title = decodeEntities(extractChild(block, 'title'));
        if (!title) return;
        const desc = decodeEntities(extractChild(block, 'desc'));

        programCount++;
        onProgram({ channel_id: decodedChannelId, title, description: desc, start, stop });
      }
    }

    stream.on('data', (chunk) => {
      remainder += chunk;

      // Process complete elements: find </channel> and </programme> closing tags
      let idx: number;
      while (true) {
        // Find the next closing tag
        const chClose = remainder.indexOf('</channel>');
        const prClose = remainder.indexOf('</programme>');

        if (chClose === -1 && prClose === -1) break;

        // Pick whichever comes first
        let closeTag: string;
        if (chClose === -1) { closeTag = '</programme>'; idx = prClose; }
        else if (prClose === -1) { closeTag = '</channel>'; idx = chClose; }
        else if (chClose < prClose) { closeTag = '</channel>'; idx = chClose; }
        else { closeTag = '</programme>'; idx = prClose; }

        const endPos = idx + closeTag.length;
        const block = remainder.slice(0, endPos);
        remainder = remainder.slice(endPos);

        // Find the matching opening tag within this block
        const openTag = closeTag === '</channel>' ? '<channel ' : '<programme ';
        const openIdx = block.lastIndexOf(openTag);
        if (openIdx !== -1) {
          processBlock(block.slice(openIdx));
        }
      }

      // Prevent remainder from growing unbounded — if it's huge and has no complete elements,
      // keep only the last 64KB (enough for any single element)
      if (remainder.length > 1024 * 1024) {
        workerLog(`[epg-worker] WARNING: Remainder buffer overflow (${remainder.length} bytes), truncating to 64KB — possible oversized element`);
        const keepFrom = remainder.length - 64 * 1024;
        remainder = remainder.slice(keepFrom);
      }
    });

    stream.on('end', () => {
      resolve({ channelCount, programCount, skipped });
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

// ---- Entry point ----
if (!parentPort) throw new Error('epg-parse-worker must be run as a worker thread');

try {
  const { filePath, providerChannels } = workerData as {
    filePath: string;
    providerChannels?: ProviderChannel[];
  };

  const fileSize = statSync(filePath).size;
  workerLog(`[epg-worker] Stream-parsing ${Math.round(fileSize / 1024 / 1024)}MB file (${providerChannels?.length ?? 0} provider channels for filtering)...`);
  const t0 = Date.now();

  let filterIds: Set<string> | null = null;

  if (providerChannels && providerChannels.length > 0) {
    // Phase 1: Quick stream scan for <channel> elements only
    workerLog(`[epg-worker] Phase 1: scanning for channel elements...`);
    const xmltvChannels: EpgChannel[] = [];

    await streamParseXmltv(filePath, null,
      (ch) => xmltvChannels.push(ch),
      () => {}, // skip all programmes in phase 1
    );
    workerLog(`[epg-worker] Found ${xmltvChannels.length} EPG channels`);

    // Run matching
    filterIds = buildMatchedXmltvIds(xmltvChannels, providerChannels);
    workerLog(`[epg-worker] Matched ${filterIds.size}/${providerChannels.length} provider channels — will filter programmes`);
  }

  // Phase 2: Full parse with filter
  const channels: EpgChannel[] = [];
  const programs: EpgProgram[] = [];

  const stats = await streamParseXmltv(filePath, filterIds,
    (ch) => channels.push(ch),
    (p) => programs.push(p),
  );

  if (stats.skipped > 0) {
    workerLog(`[epg-worker] Skipped ${stats.skipped} programmes for non-matching channels`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  workerLog(`[epg-worker] Done: ${channels.length} channels, ${programs.length} programs in ${elapsed}s`);

  parentPort.postMessage({ channels, programs });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  workerLog(`[epg-worker] ERROR: Fatal error: ${msg}`);
  parentPort.postMessage({ error: msg });
}
