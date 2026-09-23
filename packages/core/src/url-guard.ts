// Provider URLs come from playlists and panels the user did not write. Unless
// the user opted in to LAN sources, requests to the local machine, private
// networks, link-local (cloud metadata) and files are refused. The renderer's
// fetch proxy in packages/electron/src/main.ts keeps its own copy of this list
// because main cannot import workspace TypeScript at runtime; keep them in step.
const BLOCKED_URL_PATTERNS = [
  /^https?:\/\/localhost(?::\d+)?(?:\/|$)/i,
  /^https?:\/\/127\.\d+\.\d+\.\d+/,
  /^https?:\/\/0\.0\.0\.0/,                     // Alternative localhost
  /^https?:\/\/\[?::1\]?/,                      // IPv6 localhost
  /^https?:\/\/\[?::ffff:127\./,                // IPv4-mapped IPv6 localhost
  /^https?:\/\/10\.\d+\.\d+\.\d+/,              // Private Class A
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,      // Private Class B
  /^https?:\/\/192\.168\./,                     // Private Class C
  /^https?:\/\/169\.254\./,                     // Link-local + cloud metadata
  /^file:/i,                                    // File protocol
];

export function isBlockedUrl(url: string): boolean {
  return BLOCKED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

// Throws when a provider URL must not be fetched. Every hop of a redirect
// chain goes through this too.
export function checkProviderUrl(url: string, allowLan: boolean): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`not a valid URL: ${url}`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`only http and https sources are supported (${parsed.protocol})`);
  if (!allowLan && isBlockedUrl(url)) {
    throw new Error('Blocked: local network access is disabled. Enable "Allow LAN sources" in Settings > System > Security if you trust this source.');
  }
}

// Provider URLs carry credentials in the query string; never log those.
export function redactUrl(url: string): string {
  return url.split('?')[0];
}
