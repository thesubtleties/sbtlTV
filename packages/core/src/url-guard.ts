// Provider URLs come from playlists and panels the user did not write. Unless
// the user opted in to LAN sources, requests to the local machine, private
// networks, link-local (cloud metadata) and files are refused. The check runs
// on the parsed hostname, so userinfo tricks (http://x@10.0.0.1/) and numeric
// or mapped spellings of an address (2130706433, 0x7f000001, ::ffff:7f00:1)
// are seen for what they are: the URL parser normalises them first. A public
// name that resolves to a private address (DNS rebinding) is not caught here.
// The renderer's fetch proxy in packages/electron/src/main.ts keeps its own
// copy of this logic because main cannot import workspace TypeScript at
// runtime; keep them in step.

function ipv4Octets(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127                 // this host, private A, loopback
    || (a === 100 && b >= 64 && b <= 127)                // carrier NAT
    || (a === 169 && b === 254)                          // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)                 // private B
    || (a === 192 && b === 168);                         // private C
}

// hostname as the URL parser gives it: lower-case, IPv4 canonical, IPv6 in brackets.
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = ipv4Octets(host);
  if (v4) return isPrivateIpv4(v4);
  if (host.startsWith('[') && host.endsWith(']')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::1' || v6 === '::') return true;
    const mapped = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ?? v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      const dotted = mapped[2] === undefined ? mapped[1] : (() => { const hi = parseInt(mapped[1], 16); const lo = parseInt(mapped[2], 16); return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`; })();
      const o = ipv4Octets(dotted);
      return o ? isPrivateIpv4(o) : true;
    }
    if (/^fe[89ab]/.test(v6)) return true;               // link-local fe80::/10
    if (/^f[cd]/.test(v6)) return true;                  // unique local fc00::/7
  }
  return false;
}

export function isBlockedUrl(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return true; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  return isPrivateHost(parsed.hostname);
}

// Throws when a provider URL must not be fetched. Every hop of a redirect
// chain goes through this too.
export function checkProviderUrl(url: string, allowLan: boolean): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`not a valid URL: ${redactUrl(url)}`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`only http and https sources are supported (${parsed.protocol})`);
  if (!allowLan && isPrivateHost(parsed.hostname)) {
    throw new Error('Blocked: local network access is disabled. Enable "Allow LAN sources" in Settings > System > Security if you trust this source.');
  }
}

// Provider URLs carry credentials in the query string; never log those.
export function redactUrl(url: string): string {
  return url.split('?')[0];
}
