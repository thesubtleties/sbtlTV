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
  // The host is the leading run of hostname characters: a port, or text glued on ('qq.tv","x":1}'), is not part of it.
  let end = 0;
  while (end < hostPort.length && isHostChar(hostPort.charCodeAt(end))) end++;
  return hostPort.slice(0, end).toLowerCase();
}

/** The host a URL's text after "://" names (after any user:pass@), or '' when there is none. */
function urlHostOf(rest: string): string {
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  return hostOf(authority.slice(authority.lastIndexOf('@') + 1));
}

const MAX_SOURCE_LABEL = 100;

/**
 * Length of a label this module writes at text[i] ("[host]", "[host 3]", "[source: <name>]"), or 0.
 * Only those exact shapes count, so text that merely starts like one ("[host]evil.example/…")
 * is redacted like anything else. Lets text redacted twice stay the same.
 */
function labelLengthAt(text: string, i: number): number {
  if (text.startsWith('[host]', i)) return 6;
  if (text.startsWith('[host ', i)) {
    let j = i + 6;
    while (j < text.length && text.charCodeAt(j) >= 48 && text.charCodeAt(j) <= 57) j++;
    return j > i + 6 && text[j] === ']' ? j + 1 - i : 0;
  }
  if (text.startsWith('[source: ', i)) {
    const limit = Math.min(text.length, i + 9 + MAX_SOURCE_LABEL);
    for (let j = i + 9; j < limit; j++) {
      if (text[j] === ']') return j + 1 - i;
      if (text[j] === '[' || text[j] === '\n') return 0;
    }
  }
  return 0;
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
    const label = labelLengthAt(text, i);
    if (label > 0) { i += label; continue; }
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
  if (!host) return rest ? `${scheme}/${ELLIPSIS}` : scheme;  // no host (file:///home/…): the path still goes
  const label = hosts.forUrl(host);
  return hostEnd === -1 ? scheme + label : `${scheme}${label}/${ELLIPSIS}`;
}

/** Every URL cut to a host label; known bare hosts between URLs labelled too. Labels are never scanned again. */
function cutUrls(text: string, hosts: HostLabeller): string {
  if (!text.includes('://')) return cutBareHosts(text, hosts);
  // Every URL host on the line is made known first, so a bare mention before its URL is labelled too.
  for (let at = text.indexOf('://'); at !== -1; at = text.indexOf('://', at + 3)) {
    if (labelLengthAt(text, at + 3) > 0) continue;
    let end = at + 3;
    while (end < text.length && !isSpace(text[end])) end++;
    const host = urlHostOf(text.slice(at + 3, end));
    if (host) hosts.forUrl(host);
  }
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
    // Already redacted ("scheme://<label>" or "scheme://<label>/…" and nothing more): keep it as it is.
    const label = labelLengthAt(text, sep + 3);
    if (label > 0) {
      let after = sep + 3 + label;
      if (text.startsWith(`/${ELLIPSIS}`, after)) after += 2;
      if (after === text.length || isSpace(text[after])) {
        out += cutBareHosts(text.slice(pos, start), hosts) + text.slice(start, after);
        pos = after;
        continue;
      }
    }
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
