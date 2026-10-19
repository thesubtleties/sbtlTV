/**
 * Labels for provider addresses in logs (see log-redact.ts): a host of one of the
 * user's sources becomes "[source N]" (its place in the Sources list), any other
 * host "[host N]", numbered by first appearance in this app session, so a log
 * reads ("redirected from host 1 to host 2") without saying who the provider is.
 * Source names are not written to the log (they are often the provider's name);
 * legend() tells the user which number is which, in Settings. Public services stay.
 */
import { PUBLIC_HOSTS, type HostLabeller } from './log-redact.js';

const MAX_NUMBERED = 1024;
/** The longest a hostname can be (DNS): anything longer is labelled but never stored. */
const MAX_HOST = 253;

export interface SourceAddress { id?: string; name: string; url?: string; epg_url?: string }

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
  /** host -> the source's number in the Sources list */
  private readonly sources = new Map<string, number>();
  private names: { n: number; name: string }[] = [];
  /** source id -> its number: data-process lines name a source by id */
  private ids: [string, number][] = [];
  private readonly numbered = new Map<string, number>();

  /** The user's sources, in list order; call again whenever they change. */
  setSources(sources: readonly SourceAddress[]): void {
    const previous = [...this.sources.keys()];
    this.sources.clear();
    this.names = sources.map((source, i) => ({ n: i + 1, name: source.name }));
    // Long ids only (UUIDs): a short one could match ordinary text.
    this.ids = sources.flatMap((source, i): [string, number][] => (source.id && source.id.length >= 8 ? [[source.id, i + 1]] : []));
    sources.forEach((source, i) => {
      for (const url of [source.url, source.epg_url]) {
        const host = urlHost(url);
        if (host && !PUBLIC_HOSTS.has(host)) this.sources.set(host, i + 1);
      }
    });
    // A removed source's host stays known (numbered), so an error still in flight is labelled.
    for (const host of previous) if (!this.sources.has(host)) this.labelFor(host);
  }

  /** Known source ids in `text` as their "[source N]". Linear in the text per source (a handful). */
  labelSourceIds(text: string): string {
    let out = text;
    for (const [id, n] of this.ids) if (out.includes(id)) out = out.split(id).join(`[source ${n}]`);
    return out;
  }

  /** Which source each "[source N]" is, for Settings > Debug (never written to the log). */
  legend(): { n: number; name: string }[] {
    return this.names.map((entry) => ({ ...entry }));
  }

  /** A URL the app is about to open: its host is known from now on, so mpv naming it bare ("Failed to resolve hostname …") is labelled too. */
  noteUrl(url: string): void {
    const host = urlHost(url);
    if (host && !PUBLIC_HOSTS.has(host)) this.labelFor(host);
  }

  private labelFor(host: string): string {
    if (host.length > MAX_HOST) return '[host]';
    const source = this.sources.get(host);
    if (source !== undefined) return `[source ${source}]`;
    let n = this.numbered.get(host);
    if (n === undefined) {
      if (this.numbered.size >= MAX_NUMBERED) return '[host]';  // a flood of URLs cannot grow this without bound
      n = this.numbered.size + 1;
      this.numbered.set(host, n);
    }
    return `[host ${n}]`;
  }

  /** The token is a known host, or a subdomain of one (edge2.provider.tv when provider.tv is known). */
  private isKnown(token: string): boolean {
    if (token.length > MAX_HOST) return false;  // also bounds the suffix walk below
    let suffix = token;
    for (;;) {
      if (this.sources.has(suffix) || this.numbered.has(suffix)) return true;
      const dot = suffix.indexOf('.');
      if (dot === -1) return false;
      suffix = suffix.slice(dot + 1);
    }
  }

  /**
   * For redactUrls. Everything printed (terminal, system log) uses labeller(); the debug
   * log passes the user's "include provider addresses" choice. Hosts are remembered
   * either way, so a later bare mention elsewhere is still labelled.
   */
  labeller(includeAddresses = false): HostLabeller {
    return {
      forUrl: (host) => {
        if (PUBLIC_HOSTS.has(host)) return host;
        const label = this.labelFor(host);
        return includeAddresses ? host : label;
      },
      forBare: (token, certain) => {
        if (PUBLIC_HOSTS.has(token) || !(certain || this.isKnown(token))) return null;
        const label = this.labelFor(token);
        return includeAddresses ? null : label;
      },
    };
  }

  /** For the error card: only on the user's own screen, so real hostnames stay (logins never). Hosts are remembered. */
  cardLabeller(): HostLabeller {
    return this.labeller(true);
  }
}
