// Logs are cleaned of provider login details before they are written or shown:
// the debug log, the error card, and what the app prints to a terminal or the
// system log. IPTV links carry the username and password in the path (Xtream:
// /live/<user>/<pass>/<id>.ts), in the query, or before the host. Pure, so it
// runs under node:test. The native player's copy is
// packages/mpv-texture/src/native/log_redact.h; keep the two in step.
//
// One pass over the text, no backtracking: it runs on the main thread for every
// log line, so a long line must never stall it.

const ELLIPSIS = '…';
const isSchemeChar = (c: string) => /[A-Za-z0-9+.-]/.test(c);
const isSpace = (c: string) => /\s/.test(c);

/** One URL token: scheme://host/… (scheme://… when it holds an @ anywhere: credentials may sit before the host). */
function cutUrl(scheme: string, rest: string): string {
  if (rest.includes('@')) return `${scheme}${ELLIPSIS}`;
  const hostEnd = rest.search(/[/?#]/);
  return hostEnd === -1 ? scheme + rest : `${scheme}${rest.slice(0, hostEnd)}/${ELLIPSIS}`;
}

/** Every URL cut to its host. Every :// starts a URL, whatever is glued in front; a URL runs to the next whitespace. */
function cutUrls(text: string): string {
  if (!text.includes('://')) return text;
  let out = '';
  let pos = 0;
  while (pos < text.length) {
    const sep = text.indexOf('://', pos);
    if (sep === -1) {
      out += text.slice(pos);
      break;
    }
    let start = sep;
    while (start > pos && isSchemeChar(text[start - 1])) start--;
    let end = sep + 3;
    while (end < text.length && !isSpace(text[end])) end++;
    out += text.slice(pos, start) + cutUrl(text.slice(start, sep + 3), text.slice(sep + 3, end));
    pos = end;
  }
  return out;
}

// Login details outside a full URL: query values ("username=bob") and Xtream
// paths ("live/bob/s3cret/12345.ts"). Linear patterns (no nested repetition).
const LOGIN_PARAM = /\b(username|user|password|pass|passwd|token|api_key|apikey|key)=[^&\s'"]+/gi;
const XTREAM_PATH = /\b(live|movie|series|timeshift)\/[^/\s'"]+\/[^/\s'"]+\//gi;

/** Text cleaned of provider login details: URLs cut to scheme://host/…, login values and Xtream credentials replaced by …. */
export function redactUrls(text: string): string {
  return cutUrls(text)
    .replace(LOGIN_PARAM, (_m, name: string) => `${name}=${ELLIPSIS}`)
    .replace(XTREAM_PATH, (_m, kind: string) => `${kind}/${ELLIPSIS}/`);
}
