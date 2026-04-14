/**
 * XMLTV Parser - Parses XMLTV format EPG data
 *
 * XMLTV is the standard format for IPTV EPG data.
 * Used by both Xtream and M3U sources.
 */

export interface XmltvProgram {
  channel_id: string;
  title: string;
  description: string;
  start: Date;
  stop: Date;
}

export interface XmltvChannel {
  id: string;
  displayNames: string[];
}

export interface XmltvParseResult {
  channels: XmltvChannel[];
  programs: XmltvProgram[];
}

/**
 * Parse XMLTV format EPG data using indexOf-based scanning.
 * Avoids regex on the full string which fails silently on very large files (500MB+).
 */
export function parseXmltv(xml: string): XmltvProgram[] {
  return parseXmltvFull(xml).programs;
}

/**
 * Parse XMLTV date format: YYYYMMDDHHmmss +0000
 */
function parseXmltvDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/);
  if (!match) return null;

  const [, year, month, day, hour, min, sec, tz] = match;
  const isoStr = `${year}-${month}-${day}T${hour}:${min}:${sec}${tz ? tz.slice(0, 3) + ':' + tz.slice(3) : 'Z'}`;
  return new Date(isoStr);
}

/**
 * Extract an XML attribute value from an opening tag string.
 * e.g. extractAttr('<programme start="2025" channel="abc">', 'channel') → 'abc'
 */
function extractAttr(tag: string, name: string): string | null {
  for (const q of ['"', "'"]) {
    const key = name + '=' + q;
    const i = tag.indexOf(key);
    if (i === -1) continue;
    const start = i + key.length;
    const end = tag.indexOf(q, start);
    if (end === -1) continue;
    return tag.slice(start, end);
  }
  return null;
}

/**
 * Extract the text content of the first occurrence of a child element.
 * Searches within `xml` between `from` and `to` indices.
 * e.g. extractChildText(xml, 0, 500, 'title') → 'Movie Name'
 */
function extractChildText(xml: string, from: number, to: number, tagName: string): string {
  // Find opening tag (may have attributes like lang="en")
  const openSearch = '<' + tagName;
  let pos = xml.indexOf(openSearch, from);
  if (pos === -1 || pos >= to) return '';

  // Find end of opening tag
  const tagEnd = xml.indexOf('>', pos);
  if (tagEnd === -1 || tagEnd >= to) return '';

  // Find closing tag
  const closeTag = '</' + tagName + '>';
  const closePos = xml.indexOf(closeTag, tagEnd + 1);
  if (closePos === -1 || closePos >= to) return '';

  return xml.slice(tagEnd + 1, closePos);
}

/**
 * Parse XMLTV format returning both channel metadata and programs.
 * Uses indexOf-based scanning instead of regex — V8's regex engine silently
 * returns 0 matches on strings exceeding ~500MB with no error.
 */
export function parseXmltvFull(xml: string): XmltvParseResult {
  const channels: XmltvChannel[] = [];
  const programs: XmltvProgram[] = [];

  let pos = 0;
  const len = xml.length;

  // Once indexOf('<channel ', pos) returns -1, stop searching for channels —
  // avoids rescanning the entire remaining string on every iteration.
  // NOTE: assumes channels appear before programmes (XMLTV convention, not spec requirement).
  // Files with interleaved channels/programmes would silently miss late channels.
  let channelsDone = false;

  while (pos < len) {
    const nextChannel = channelsDone ? -1 : xml.indexOf('<channel ', pos);
    const nextProgramme = xml.indexOf('<programme ', pos);
    if (nextChannel === -1) channelsDone = true;

    const chPos = nextChannel === -1 ? Infinity : nextChannel;
    const prPos = nextProgramme === -1 ? Infinity : nextProgramme;

    if (chPos === Infinity && prPos === Infinity) break;

    if (chPos < prPos) {
      // Parse <channel> element
      const tagEnd = xml.indexOf('>', chPos);
      if (tagEnd === -1) break;

      // Check for self-closing
      const isSelfClosing = xml[tagEnd - 1] === '/';
      const openTag = xml.slice(chPos, tagEnd + 1);
      const id = extractAttr(openTag, 'id');

      if (isSelfClosing) {
        if (id) channels.push({ id, displayNames: [] });
        pos = tagEnd + 1;
        continue;
      }

      // Find </channel>
      const closeTag = '</channel>';
      const closePos = xml.indexOf(closeTag, tagEnd + 1);
      if (closePos === -1) { pos = tagEnd + 1; continue; }

      if (id) {
        // Extract all <display-name> children
        const displayNames: string[] = [];
        let dnPos = tagEnd + 1;
        while (dnPos < closePos) {
          const dnStart = xml.indexOf('<display-name', dnPos);
          if (dnStart === -1 || dnStart >= closePos) break;

          const dnTagEnd = xml.indexOf('>', dnStart);
          if (dnTagEnd === -1 || dnTagEnd >= closePos) break;

          const dnCloseTag = '</display-name>';
          const dnClosePos = xml.indexOf(dnCloseTag, dnTagEnd + 1);
          if (dnClosePos === -1 || dnClosePos >= closePos) break;

          const name = decodeXmlEntities(xml.slice(dnTagEnd + 1, dnClosePos)).trim();
          if (name) displayNames.push(name);
          dnPos = dnClosePos + dnCloseTag.length;
        }

        channels.push({ id, displayNames });
      }

      pos = closePos + closeTag.length;
    } else {
      // Parse <programme> element
      const tagEnd = xml.indexOf('>', prPos);
      if (tagEnd === -1) break;

      const openTag = xml.slice(prPos, tagEnd + 1);

      // Find </programme>
      const closeTag = '</programme>';
      const closePos = xml.indexOf(closeTag, tagEnd + 1);
      if (closePos === -1) { pos = tagEnd + 1; continue; }

      const startStr = extractAttr(openTag, 'start');
      const stopStr = extractAttr(openTag, 'stop');
      const channelId = extractAttr(openTag, 'channel');

      if (startStr && stopStr && channelId) {
        const start = parseXmltvDate(startStr);
        const stop = parseXmltvDate(stopStr);

        if (start && stop) {
          const title = decodeXmlEntities(extractChildText(xml, tagEnd + 1, closePos, 'title'));
          if (title) {
            const desc = decodeXmlEntities(extractChildText(xml, tagEnd + 1, closePos, 'desc'));
            programs.push({ channel_id: channelId, title, description: desc, start, stop });
          }
        }
      }

      pos = closePos + closeTag.length;
    }
  }

  return { channels, programs };
}

/**
 * Decode XML entities in a string
 */
function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}
