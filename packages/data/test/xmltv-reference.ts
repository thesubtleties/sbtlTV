// The XMLTV chunk parser as it was before the cursor rewrite (PR #215), kept only as the reference the rewrite must
// match exactly. Delete it (and the comparison tests) when processBlock or entity decoding next changes: from then on
// the frozen corpus hash in xmltv-parser.test.ts is the guard.
import type { EpgChannelInfo } from '@sbtltv/core';
import type { Log } from '../src/platform.js';
import { parseXmltvDate } from '../src/epg.js';

interface RawProgram { channel_id: string; title: string; description: string; startMs: number; endMs: number }

function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
}


export async function referenceParseXmltvChunks(
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
