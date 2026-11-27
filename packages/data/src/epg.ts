/**
 * EPG source handling for the data process: download an XMLTV guide to a temp
 * file, inflate it on disk when it is gzip, and stream-parse it with constant
 * memory. Two passes over the file: the first collects the <channel> elements
 * (programme blocks are scanned past and discarded) and matches them against
 * the provider's channels with core's matcher; the second parses only the
 * <programme> blocks of matched channels and skips the rest early.
 */
import { matchChannelsToEpg, redactUrl } from '@sbtltv/core';
import type { Channel, EpgChannelInfo } from '@sbtltv/core';
import type { Log, Platform } from './platform.js';

export const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024;   // 4GB on disk (an Xtream xmltv.php is often plain XML)
export const MAX_DECOMPRESS_BYTES = 4 * 1024 * 1024 * 1024; // 4GB decompressed

export type { Log } from './platform.js';
export interface ProviderChannel { epg_channel_id: string; name: string; stream_id: string }
export interface ParsedProgram { channel_id: string; title: string; description: string; startMs: number; endMs: number }
export interface ParsedGuide { channels: EpgChannelInfo[]; programs: ParsedProgram[] }

// ---- Download ----

// Streams the response to a temp file (no ArrayBuffer size limits) and returns its path. The Net adapter checks every
// hop against the LAN block, follows redirects, enforces the cap and removes the file on failure.
export async function downloadToTempFile(platform: Platform, url: string, tempDir: string, log: Log, allowLan: boolean): Promise<string> {
  const tmpPath = platform.files.join(tempDir, `epg-${platform.uuid()}.tmp`);
  const { status, bytes } = await platform.net.downloadToFile(url, tmpPath, { maxBytes: MAX_DOWNLOAD_BYTES, allowLan, label: 'EPG download' });
  log(`epg-download ${status} ${bytes}B ${redactUrl(url)}`);
  return tmpPath;
}

// ---- Decompress ----

function isGzip(platform: Platform, filePath: string): boolean {
  const header = platform.files.readHead(filePath, 2);
  return header.length === 2 && header[0] === 0x1f && header[1] === 0x8b;
}

// Inflates a gzip file next to itself (by magic bytes, whatever the URL said) and
// deletes the archive. A plain XML file is returned as is.
export async function decompressToFile(platform: Platform, inputPath: string, log: Log): Promise<{ xmlPath: string; sizeMB: number }> {
  const { files } = platform;
  if (!isGzip(platform, inputPath)) {
    const size = files.size(inputPath);
    return { xmlPath: inputPath, sizeMB: Math.round(size / 1024 / 1024) };
  }
  const xmlPath = files.join(files.dirname(inputPath), `epg-xml-${platform.uuid()}.tmp`);
  const compressedSize = files.size(inputPath);
  log(`Streaming decompression of ${Math.round(compressedSize / 1024 / 1024)}MB...`);
  await platform.gunzip.gunzipFile(inputPath, xmlPath, { maxBytes: MAX_DECOMPRESS_BYTES, label: 'EPG decompression' });
  try { await files.removeAsync(inputPath); } catch (e) { log(`Failed to clean up compressed temp file ${inputPath}: ${e instanceof Error ? e.message : e}`); }
  const decompressedSize = files.size(xmlPath);
  log(`Decompressed to ${Math.round(decompressedSize / 1024 / 1024)}MB on disk`);
  return { xmlPath, sizeMB: Math.round(decompressedSize / 1024 / 1024) };
}

// ---- Stream parser ----

function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
}

// XMLTV times look like "20260921120000 +0000"; returns integer ms or null.
export function parseXmltvDate(d: string): number | null {
  const m = d.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/);
  if (!m) return null;
  const [, yr, mo, dy, hr, mn, sc, tz] = m;
  const iso = `${yr}-${mo}-${dy}T${hr}:${mn}:${sc}${tz ? tz.slice(0, 3) + ':' + tz.slice(3) : 'Z'}`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

interface RawProgram { channel_id: string; title: string; description: string; startMs: number; endMs: number }

/**
 * Stream-parse XMLTV text arriving in chunks (a file read piece by piece): accumulates element blocks and emits parsed
 * channel/programme objects. Constant memory.
 */
export async function parseXmltvChunks(
  chunks: AsyncIterable<string>,
  filterChannelIds: Set<string> | null,
  onChannel: (ch: EpgChannelInfo) => void,
  onProgram: (p: RawProgram) => void,
  log: Log,
): Promise<{ channelCount: number; programCount: number; skipped: number }> {
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

        const startMs = parseXmltvDate(startStr);
        const endMs = parseXmltvDate(stopStr);
        if (startMs === null || endMs === null) return;

        const title = decodeEntities(extractChild(block, 'title'));
        if (!title) return;
        const desc = decodeEntities(extractChild(block, 'desc'));

        programCount++;
        onProgram({ channel_id: decodedChannelId, title, description: desc, startMs, endMs });
      }
    }

    for await (const chunk of chunks) {
      remainder += chunk;

      // Process complete elements: find </channel> and </programme> closing tags
      let idx: number;
      while (true) {
        const chClose = remainder.indexOf('</channel>');
        const prClose = remainder.indexOf('</programme>');

        if (chClose === -1 && prClose === -1) break;

        let closeTag: string;
        if (chClose === -1) { closeTag = '</programme>'; idx = prClose; }
        else if (prClose === -1) { closeTag = '</channel>'; idx = chClose; }
        else if (chClose < prClose) { closeTag = '</channel>'; idx = chClose; }
        else { closeTag = '</programme>'; idx = prClose; }

        const endPos = idx + closeTag.length;
        const block = remainder.slice(0, endPos);
        remainder = remainder.slice(endPos);

        const openTag = closeTag === '</channel>' ? '<channel ' : '<programme ';
        const openIdx = block.lastIndexOf(openTag);
        if (openIdx !== -1) {
          processBlock(block.slice(openIdx));
        }
      }

      // Prevent remainder from growing unbounded: if it is huge and has no complete
      // element, keep only the last 64KB (enough for any single element)
      if (remainder.length > 1024 * 1024) {
        log(`WARNING: Remainder buffer overflow (${remainder.length} bytes), truncating to 64KB - possible oversized element`);
        const keepFrom = remainder.length - 64 * 1024;
        remainder = remainder.slice(keepFrom);
      }
    }

    return { channelCount, programCount, skipped };
}

// Which XMLTV channels does any provider channel resolve to? Every automatic
// strategy the guide uses for its links, plus the provider's own id when the
// guide contains it.
function matchedXmltvIds(xmltvChannels: EpgChannelInfo[], providerChannels: ProviderChannel[]): Set<string> {
  const channels: Channel[] = providerChannels.map((c) => ({
    stream_id: c.stream_id, name: c.name, epg_channel_id: c.epg_channel_id,
    stream_icon: '', category_ids: [], direct_url: '', source_id: '',
  }));
  const matched = new Set<string>();
  for (const m of matchChannelsToEpg(channels, xmltvChannels, '', '')) matched.add(m.xmltv_channel_id);
  const known = new Set(xmltvChannels.map((x) => x.id));
  for (const c of providerChannels) if (c.epg_channel_id && known.has(c.epg_channel_id)) matched.add(c.epg_channel_id);
  return matched;
}

/**
 * Parses an XMLTV file. With a provider channel list, phase 1 scans the
 * <channel> elements, matches them, and phase 2 keeps only programmes for the
 * matched channels. Without one, every programme is returned.
 */
export async function parseXmltvFile(platform: Platform, xmlPath: string, providerChannels: ProviderChannel[] | undefined, log: Log): Promise<ParsedGuide> {
  const fileSize = platform.files.size(xmlPath);
  const read = () => platform.files.readText(xmlPath, 256 * 1024);
  log(`Stream-parsing ${Math.round(fileSize / 1024 / 1024)}MB file (${providerChannels?.length ?? 0} provider channels for filtering)...`);
  const t0 = Date.now();

  let filterIds: Set<string> | null = null;
  if (providerChannels && providerChannels.length > 0) {
    log('Phase 1: scanning for channel elements...');
    const xmltvChannels: EpgChannelInfo[] = [];
    await parseXmltvChunks(read(), null, (ch) => xmltvChannels.push(ch), () => {}, log);
    log(`Found ${xmltvChannels.length} EPG channels`);
    filterIds = matchedXmltvIds(xmltvChannels, providerChannels);
    log(`Matched ${filterIds.size}/${providerChannels.length} provider channels - will filter programmes`);
  }

  const channels: EpgChannelInfo[] = [];
  const programs: ParsedProgram[] = [];
  const stats = await parseXmltvChunks(read(), filterIds, (ch) => channels.push(ch), (p) => programs.push(p), log);
  if (stats.skipped > 0) log(`Skipped ${stats.skipped} programmes for non-matching channels`);
  log(`Done: ${channels.length} channels, ${programs.length} programs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { channels, programs };
}
