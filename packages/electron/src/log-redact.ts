// Logs are cleaned before they are written or shown (the debug log, the error
// card, what the app prints to a terminal or the system log): provider login
// details are removed, and provider addresses are replaced by labels
// (HostLabeller); public services in PUBLIC_HOSTS stay readable. IPTV links carry the username and password in the path (Xtream:
// /live/<user>/<pass>/<id>.ts), in the query, or before the host. Pure, so it
// runs under node:test. The native player's copy is
// packages/mpv-texture/src/native/log_redact.h; keep the two in step.
//
// One pass over the text, no backtracking: it runs on the main thread for every
// log line, so a long line must never stall it.

const ELLIPSIS = '…';
const isSchemeChar = (c: string) => /[A-Za-z0-9+.-]/.test(c);
const isSpace = (c: string) => /\s/.test(c);

/** Public services, the same for every user: left readable in logs. Mirrored in log_redact.h. */
export const PUBLIC_HOSTS: ReadonlySet<string> = new Set([
  'api.themoviedb.org',
  'image.tmdb.org',
  'api.ratingposterdb.com',
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'a.espncdn.com',
  'am.i.mullvad.net',
]);

/** What replaces a provider address in a log line. */
export interface HostLabeller {
  /** Replacement for a URL's host (lowercased, no port or brackets, never empty). */
  forUrl(host: string): string;
  /** Replacement for a bare hostname in text (lowercased), or null to leave the token as it is. */
  forBare(token: string): string | null;
}

/** Without source names: public hosts kept, every other host `[host]`, bare words untouched. */
export const PLAIN_HOSTS: HostLabeller = {
  forUrl: (host) => (PUBLIC_HOSTS.has(host) ? host : '[host]'),
  forBare: () => null,
};

/** The host of "host:port" or "[v6]:port", lowercased, without port or brackets. */
export function hostOf(hostPort: string): string {
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    return (close === -1 ? hostPort.slice(1) : hostPort.slice(1, close)).toLowerCase();
  }
  const colon = hostPort.indexOf(':');
  return (colon === -1 ? hostPort : hostPort.slice(0, colon)).toLowerCase();
}

const isHostChar = (code: number) =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45 || code === 46;

/** Known hostnames outside URLs, replaced by their label. One pass: each character is looked at once. */
function cutBareHosts(text: string, hosts: HostLabeller): string {
  if (!text.includes('.')) return text;
  let out = '';
  let pos = 0;
  let i = 0;
  while (i < text.length) {
    if (!isHostChar(text.charCodeAt(i))) { i++; continue; }
    let end = i;
    while (end < text.length && isHostChar(text.charCodeAt(end))) end++;
    let a = i;
    let b = end;
    while (a < b && (text[a] === '.' || text[a] === '-')) a++;
    while (b > a && (text[b - 1] === '.' || text[b - 1] === '-')) b--;
    const token = text.slice(a, b);
    if (token.includes('.')) {
      const label = hosts.forBare(token.toLowerCase());
      if (label !== null) {
        out += text.slice(pos, a) + label;
        pos = b;
      }
    }
    i = end;
  }
  return out + text.slice(pos);
}

/** One URL token: scheme://<label>/… (scheme://… when it holds an @ anywhere: credentials may sit before the host). */
function cutUrl(scheme: string, rest: string, hosts: HostLabeller): string {
  if (rest.includes('@')) return `${scheme}${ELLIPSIS}`;
  const hostEnd = rest.search(/[/?#]/);
  const hostPort = hostEnd === -1 ? rest : rest.slice(0, hostEnd);
  const host = hostOf(hostPort);
  if (!host) return scheme + rest;
  const label = hosts.forUrl(host);
  return hostEnd === -1 ? scheme + label : `${scheme}${label}/${ELLIPSIS}`;
}

/** Every URL cut to a host label; known bare hosts between URLs labelled too. Labels are never scanned again. */
function cutUrls(text: string, hosts: HostLabeller): string {
  if (!text.includes('://')) return cutBareHosts(text, hosts);
  let out = '';
  let pos = 0;
  while (pos < text.length) {
    const sep = text.indexOf('://', pos);
    if (sep === -1) {
      out += cutBareHosts(text.slice(pos), hosts);
      break;
    }
    let start = sep;
    while (start > pos && isSchemeChar(text[start - 1])) start--;
    let end = sep + 3;
    while (end < text.length && !isSpace(text[end])) end++;
    out += cutBareHosts(text.slice(pos, start), hosts) + cutUrl(text.slice(start, sep + 3), text.slice(sep + 3, end), hosts);
    pos = end;
  }
  return out;
}

// Login details outside a full URL: query values ("username=bob") and Xtream
// paths ("live/bob/s3cret/12345.ts"). Linear patterns (no nested repetition).
const LOGIN_PARAM = /\b(username|user|password|pass|passwd|token|api_key|apikey|key)=[^&\s'"]+/gi;
const XTREAM_PATH = /\b(live|movie|series|timeshift)\/[^/\s'"]+\/[^/\s'"]+\//gi;

/** Text cleaned for a log: URLs cut to scheme://<host label>/…, known bare hosts labelled, login values and Xtream credentials replaced by …. */
export function redactUrls(text: string, hosts: HostLabeller = PLAIN_HOSTS): string {
  return cutUrls(text, hosts)
    .replace(LOGIN_PARAM, (_m, name: string) => `${name}=${ELLIPSIS}`)
    .replace(XTREAM_PATH, (_m, kind: string) => `${kind}/${ELLIPSIS}/`);
}
