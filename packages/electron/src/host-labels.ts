/**
 * Labels for provider addresses in logs (see log-redact.ts): a host of one of the
 * user's sources becomes "[source: <name>]", any other host "[host N]", numbered
 * by first appearance in this app session, so a log reads ("redirected from
 * host 1 to host 2") without saying who the provider is. Public services stay.
 */
import { PUBLIC_HOSTS, type HostLabeller } from './log-redact.js';

export interface SourceAddress { name: string; url?: string; epg_url?: string }

function urlHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const bare = host.startsWith('[') ? host.slice(1, -1) : host;
    return bare || null;
  } catch {
    return null;
  }
}

export class HostLabels {
  private readonly sources = new Map<string, string>();
  private readonly numbered = new Map<string, number>();

  /** The user's sources; call again whenever they change. */
  setSources(sources: readonly SourceAddress[]): void {
    this.sources.clear();
    for (const source of sources) {
      for (const url of [source.url, source.epg_url]) {
        const host = urlHost(url);
        if (host && !PUBLIC_HOSTS.has(host)) this.sources.set(host, source.name);
      }
    }
  }

  private labelFor(host: string): string {
    const name = this.sources.get(host);
    if (name !== undefined) return `[source: ${name}]`;
    let n = this.numbered.get(host);
    if (n === undefined) {
      n = this.numbered.size + 1;
      this.numbered.set(host, n);
    }
    return `[host ${n}]`;
  }

  /**
   * For redactUrls. Everything shown or printed uses labeller(); only the debug log
   * passes the user's "include provider addresses" choice, which keeps hosts.
   */
  labeller(includeAddresses = false): HostLabeller {
    return {
      forUrl: (host) => (includeAddresses || PUBLIC_HOSTS.has(host) ? host : this.labelFor(host)),
      forBare: (token) => {
        if (includeAddresses || PUBLIC_HOSTS.has(token)) return null;
        return this.sources.has(token) || this.numbered.has(token) ? this.labelFor(token) : null;
      },
    };
  }
}
