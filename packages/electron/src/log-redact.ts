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

/** End of the bare IPv6 address starting at text[i] (its run of hex digits and colons, less a trailing "addr:" colon), or i when there is none. */
function runEndOfHexColons(text: string, i: number): number {
  let end = i;
  while (end < text.length && (isHex(text.charCodeAt(end)) || text.charCodeAt(end) === 58)) end++;
  return end;
}

function ipv6RunEnd(text: string, i: number): number {
  const end = runEndOfHexColons(text, i);
  const stop = text[end - 1] === ':' && text[end - 2] !== ':' ? end - 1 : end;
  return isIpv6(text.slice(i, stop)) ? stop : i;
}

/** Hostnames outside URLs, replaced by their label when known or when the text says they are a host. Linear. */
function cutBareHosts(text: string, hosts: HostLabeller): string {
  let notV6Until = 0;
  let out = '';
  let pos = 0;
  let i = 0;
  while (i < text.length) {
    const label = labelLengthAt(text, i);
    if (label > 0) { i += label; continue; }
    if (!isHostChar(text.charCodeAt(i))) { i++; continue; }
    let end = i;
    while (end < text.length && isHostChar(text.charCodeAt(end))) end++;
    // The start of a bare IPv6 address ("2001:db8::1:443"): cutBareIpv6 labels it whole.
    // Only a real one: a hostname of hex letters ("cafe: …") is still a host here.
    if (text[end] === ':' && i >= notV6Until) {
      const v6End = ipv6RunEnd(text, i);
      if (v6End > end) { i = v6End; continue; }
      notV6Until = runEndOfHexColons(text, i);  // checked once per run: linear
    }
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

/** What may follow a URL this module already cut: whitespace, or the end of a value (cutEncodedUrls stops there too). */
const endsCutUrl = (c: string) => isSpace(c) || c === '&' || c === '"' || c === "'";

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
    // Already redacted ("scheme://…", a URL that had a login): keep it as it is.
    if (text.startsWith(ELLIPSIS, sep + 3)) {
      const after = sep + 3 + ELLIPSIS.length;
      if (after === text.length || endsCutUrl(text[after])) {
        out += cutBareHosts(text.slice(pos, start), hosts) + text.slice(start, after);
        pos = after;
        continue;
      }
    }
    // Already redacted ("scheme://<label>" or "scheme://<label>/…" and nothing more): keep it as it is.
    const label = labelLengthAt(text, sep + 3);
    if (label > 0) {
      let after = sep + 3 + label;
      if (text.startsWith(`/${ELLIPSIS}`, after)) after += 2;
      if (after === text.length || endsCutUrl(text[after])) {
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

// Login details outside a full URL: query values ("username=bob"), JSON fields
// ("password":"s3cret") and Xtream paths ("live/bob/s3cret/12345.ts"). Linear
// patterns (no nested repetition). LOGIN_NAMES is mirrored in log_redact.h.
const LOGIN_NAMES = 'username|user|password|pass|passwd|pwd|token|access_token|refresh_token|id_token|auth_token|api_key|apikey|key|secret|client_secret|auth';
const LOGIN_PARAM = new RegExp(`\\b(${LOGIN_NAMES})=[^&\\t\\n\\v\\f\\r '"]+`, 'gi');
// A JSON string value (escapes included: the unrolled form, linear).
const LOGIN_JSON = new RegExp(`"(${LOGIN_NAMES})"(\\s*:\\s*)"[^"\\\\]*(?:\\\\.[^"\\\\]*)*"`, 'gi');
// A login value inside an encoded query ("username%3Dbob%26password%3Ds3cret"): up to the next encoded "&".
const LOGIN_PARAM_ENCODED = new RegExp(`(?:\\b|(?<=%3F)|(?<=%26))(${LOGIN_NAMES})%3D[^&%\\t\\n\\v\\f\\r '"]*(?:%(?!26)[0-9A-Fa-f]{2}[^&%\\t\\n\\v\\f\\r '"]*)*`, 'gi');
const XTREAM_PATH = /\b(live|movie|series|timeshift)\/[^/\t\n\v\f\r '"]+\/[^/\t\n\v\f\r '"]+\//gi;

function decodeLoosely(text: string): string {
  try { return decodeURIComponent(text); } catch { return text.replace(/%40/gi, '@').replace(/%2F/gi, '/').replace(/%3A/gi, ':').replace(/%3F/gi, '?'); }
}

const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isWord = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;

/** A bare IPv6 address (not loopback): groups of up to 4 hex digits, one "::" or all 8 groups. The caller passes only hex digits and colons. */
function isIpv6(token: string): boolean {
  if (token === '::1') return false;
  const double = token.indexOf('::');
  if (double !== token.lastIndexOf('::') || token.includes(':::')) return false;
  // A single colon at either end is not an address ("a:" in "a:b"); "::" at an end is.
  if ((token.startsWith(':') && double !== 0) || (token.endsWith(':') && double !== token.length - 2)) return false;
  const groups = token.split(':');
  const colons = groups.length - 1;
  if (colons < 2 || colons > 7 || (double === -1 && colons !== 7)) return false;
  // "::", "DE::" and "::8080" are separators or prefixes, not addresses: two groups at least.
  return groups.every((g) => g.length <= 4) && groups.filter((g) => g !== '').length >= 2;
}

/** Bare IPv6 addresses outside URLs, labelled. Linear: each maximal run of hex digits and colons is looked at once. */
function cutBareIpv6(text: string, hosts: HostLabeller): string {
  if (!text.includes(':')) return text;
  let out = '';
  let pos = 0;
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (!(isHex(c) || c === 58)) { i++; continue; }
    let end = i;
    while (end < text.length && (isHex(text.charCodeAt(end)) || text.charCodeAt(end) === 58)) end++;
    const bounded = (i === 0 || !isWord(text.charCodeAt(i - 1))) && (end === text.length || !isWord(text.charCodeAt(end)));
    // "addr: message": the colon after an address is not part of it.
    const stop = text[end - 1] === ':' && text[end - 2] !== ':' ? end - 1 : end;
    const token = text.slice(i, stop);
    if (bounded && isIpv6(token)) {
      const label = hosts.forBare(token.toLowerCase(), true);
      if (label !== null) { out += text.slice(pos, i) + label; pos = stop; }
    }
    i = end;
  }
  return out + text.slice(pos);
}

// "://" percent-encoded once or twice (a URL inside a value inside a URL).
const ENCODED_SEPS = ['%3a%2f%2f', '%253a%252f%252f'];
const endsEncodedValue = (c: string) => isSpace(c) || c === '&' || c === '"' || c === "'";

/** text[i..] starts with `lowerAscii`, ignoring ASCII case only (no lowercased copy, so indices never drift). */
function startsWithAsciiCi(text: string, i: number, lowerAscii: string): boolean {
  if (i + lowerAscii.length > text.length) return false;
  for (let k = 0; k < lowerAscii.length; k++) {
    let c = text.charCodeAt(i + k);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== lowerAscii.charCodeAt(k)) return false;
  }
  return true;
}

/** The next encoded "://" at or after `from`: where it is and how long, or null. Each "%" is looked at once. */
function nextEncodedSep(text: string, from: number): { at: number; len: number } | null {
  for (let at = text.indexOf('%', from); at !== -1; at = text.indexOf('%', at + 1)) {
    for (const sep of ENCODED_SEPS) if (startsWithAsciiCi(text, at, sep)) return { at, len: sep.length };
  }
  return null;
}

/** A whole URL percent-encoded inside another value (?url=http%3A%2F%2F…), cut like a plain one, to the end of that value. Linear. */
function cutEncodedUrls(text: string, hosts: HostLabeller): string {
  let found = nextEncodedSep(text, 0);
  if (!found) return text;
  let out = '';
  let pos = 0;
  while (found) {
    const { at, len } = found;
    let start = at;
    while (start > pos && isSchemeChar(text[start - 1])) start--;
    while (start < at && !/[A-Za-z]/.test(text[start])) start++;  // a scheme starts with a letter
    if (start === at) { found = nextEncodedSep(text, at + len); continue; }
    let end = at + len;
    while (end < text.length && !endsEncodedValue(text[end])) end++;
    let rest = decodeLoosely(text.slice(at + len, end));
    if (len > ENCODED_SEPS[0].length) rest = decodeLoosely(rest);  // encoded twice
    out += text.slice(pos, start) + cutUrl(`${text.slice(start, at)}://`, rest, hosts);
    pos = end;
    found = nextEncodedSep(text, end);
  }
  return out + text.slice(pos);
}

/** Text cleaned for a log: URLs cut to scheme://<host label>/…, known bare hosts labelled, login values and Xtream credentials replaced by …. */
export function redactUrls(text: string, hosts: HostLabeller = PLAIN_HOSTS): string {
  // JSON writes "http:\/\/host\/…" (or /): read it as a URL.
  let unescaped = text.includes(':\\/\\/') ? text.split(':\\/\\/').join('://') : text;
  if (/:\\u002f\\u002f/i.test(unescaped)) unescaped = unescaped.replace(/\\u002f/gi, '/');
  // Encoded URLs first: the bare-host pass could otherwise label part of one ("%2F%2Fedge.src…")
  // and hide it from the encoded pass. What it writes ("scheme://<label>/…") cutUrls keeps as it is.
  return cutBareIpv6(cutUrls(cutEncodedUrls(unescaped, hosts), hosts), hosts)
    .replace(LOGIN_JSON, (_m, name: string, colon: string) => `"${name}"${colon}"${ELLIPSIS}"`)
    .replace(LOGIN_PARAM, (_m, name: string) => `${name}=${ELLIPSIS}`)
    .replace(LOGIN_PARAM_ENCODED, (_m, name: string) => `${name}%3D${ELLIPSIS}`)
    .replace(XTREAM_PATH, (_m, kind: string) => `${kind}/${ELLIPSIS}/`);
}
