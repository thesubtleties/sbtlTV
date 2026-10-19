// Logs are cleaned before they are written or shown (the debug log, the error
// card, what the app prints to a terminal or the system log): provider login
// details are removed, and provider addresses are replaced by labels
// (HostLabeller); public services in PUBLIC_HOSTS stay readable. IPTV links
// carry the username and password in the path (Xtream: /live/<user>/<pass>/<id>.ts),
// in the query, or before the host. Pure, so it runs under node:test. The native
// player's copy is packages/mpv-texture/src/native/log_redact.h; keep the two in
// step, including: only ASCII whitespace ends a URL, and the label shapes.
//
// A few linear passes, no backtracking: it runs on the main thread for every log
// line, so a long line must never stall it.

const ELLIPSIS = '…';
const isSchemeChar = (c: string) => /[A-Za-z0-9+.-]/.test(c);
/** ASCII whitespace only (as C's isspace): a non-breaking space inside a URL does not end it. */
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\v' || c === '\f';

/** Public services, the same for every user: left readable in logs. Mirrored in log_redact.h. */
export const PUBLIC_HOSTS: ReadonlySet<string> = new Set([
  'api.themoviedb.org',
  'image.tmdb.org',
  'files.tmdb.org',
  'api.ratingposterdb.com',
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'a.espncdn.com',
  'am.i.mullvad.net',
]);

/** What replaces a provider address in a log line. */
export interface HostLabeller {
  /** Replacement for a URL's host (lowercased, no port or brackets, never empty). */
  forUrl(host: string): string;
  /**
   * Replacement for a bare hostname in text (lowercased), or null to leave the token as it is.
   * `certain`: the text says it is a host (an IPv4 address, or after "resolve hostname",
   * ENOTFOUND, ECONNREFUSED…), so it is labelled even if never seen before.
   */
  forBare(token: string, certain: boolean): string | null;
}

/** Without source names: public hosts kept, every other host `[host]`; bare words only when the text says they are a host. */
export const PLAIN_HOSTS: HostLabeller = {
  forUrl: (host) => (PUBLIC_HOSTS.has(host) ? host : '[host]'),
  forBare: (token, certain) => (certain && !PUBLIC_HOSTS.has(token) ? '[host]' : null),
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

/** Length of "<prefix><digits>]" at text[i], or 0. */
function numberedLabelAt(text: string, i: number, prefix: string): number {
  if (!text.startsWith(prefix, i)) return 0;
  let j = i + prefix.length;
  while (j < text.length && text.charCodeAt(j) >= 48 && text.charCodeAt(j) <= 57) j++;
  return j > i + prefix.length && text[j] === ']' ? j + 1 - i : 0;
}

/**
 * Length of a label this module writes at text[i] ("[host]", "[host 3]", "[source 2]"), or 0.
 * Only those exact shapes count, so text that merely starts like one ("[host]evil.example/…")
 * is redacted like anything else. Lets text redacted twice stay the same.
 */
function labelLengthAt(text: string, i: number): number {
  if (text.startsWith('[host]', i)) return 6;
  return numberedLabelAt(text, i, '[host ') || numberedLabelAt(text, i, '[source ');
}

/** Words after which the next token is a host, whatever it looks like (ffmpeg, getaddrinfo, Node's net errors). */
const HOST_CONTEXT = new Set(['hostname', 'enotfound', 'eai_again', 'eai_noname', 'econnrefused', 'econnreset', 'etimedout', 'ehostunreach', 'enetunreach']);

/** The text just before text[a] (skipping a few spaces) is one of HOST_CONTEXT. Looks back a bounded distance. */
function afterHostContext(text: string, a: number): boolean {
  let j = a;
  while (j > 0 && a - j < 4 && text[j - 1] === ' ') j--;
  let w = j;
  while (w > 0 && j - w < 16 && /[A-Za-z_]/.test(text[w - 1])) w--;
  return w < j && HOST_CONTEXT.has(text.slice(w, j).toLowerCase());
}

/** A dotted IPv4 address other than loopback. */
function isIpv4(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 4 && parts.every((p) => /^[0-9]{1,3}$/.test(p) && Number(p) <= 255) && parts[0] !== '127';
}

const isHostChar = (code: number) =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45 || code === 46;

/** Hostnames outside URLs, replaced by their label when known or when the text says they are a host. Linear. */
function cutBareHosts(text: string, hosts: HostLabeller): string {
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
    const certain = a < b && (afterHostContext(text, a) || isIpv4(token));
    if (certain || token.includes('.')) {
      const label = hosts.forBare(token.toLowerCase(), certain);
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
  // A URL runs to the next whitespace, as in the loop below; the next search starts there (linear time).
  for (let at = text.indexOf('://'); at !== -1;) {
    let end = at + 3;
    while (end < text.length && !isSpace(text[end])) end++;
    if (labelLengthAt(text, at + 3) === 0) {
      const host = urlHostOf(text.slice(at + 3, end));
      if (host) hosts.forUrl(host);
    }
    at = text.indexOf('://', end);
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
const LOGIN_PARAM = /\b(username|user|password|pass|passwd|token|api_key|apikey|key)=[^&\t\n\v\f\r '"]+/gi;
const XTREAM_PATH = /\b(live|movie|series|timeshift)\/[^/\t\n\v\f\r '"]+\/[^/\t\n\v\f\r '"]+\//gi;

/** Text cleaned for a log: URLs cut to scheme://<host label>/…, known bare hosts labelled, login values and Xtream credentials replaced by …. */
export function redactUrls(text: string, hosts: HostLabeller = PLAIN_HOSTS): string {
  return cutUrls(text, hosts)
    .replace(LOGIN_PARAM, (_m, name: string) => `${name}=${ELLIPSIS}`)
    .replace(XTREAM_PATH, (_m, kind: string) => `${kind}/${ELLIPSIS}/`);
}
