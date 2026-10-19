/**
 * What each output gets (see log-redact.ts and host-labels.ts):
 * - the debug log: labels, or the provider's addresses while the user has chosen
 *   to include them in Settings > Debug (never saved: every launch starts with labels);
 * - a terminal or the system log: labels, always;
 * - the error card: real hostnames (it is only on the user's own screen).
 * Logins and paths are removed everywhere. Hosts are remembered whichever output
 * met them first, so a later bare mention elsewhere is still labelled.
 */
import { HostLabels, type SourceAddress } from './host-labels.js';
import { redactUrls } from './log-redact.js';

export class LogPolicy {
  private readonly hosts = new HostLabels();
  private includeAddresses = false;

  constructor(sources: readonly SourceAddress[]) {
    this.hosts.setSources(sources);
  }

  get addressesIncluded(): boolean {
    return this.includeAddresses;
  }

  /** The user's choice (IPC input: anything but true is off), and the line to log when it changes. */
  setIncludeAddresses(on: unknown): { included: boolean; logLine: string | null } {
    const next = on === true;
    if (next === this.includeAddresses) return { included: next, logLine: null };
    this.includeAddresses = next;
    return {
      included: next,
      logLine: next
        ? 'Provider addresses are included in this log from here on (turned on in Settings > Debug)'
        : 'Provider addresses are replaced by labels again',
    };
  }

  /** The debug log's header line about addresses. */
  headerLine(): string {
    return `Provider addresses: ${this.includeAddresses ? 'included (turned on in Settings > Debug)' : 'replaced by labels'}`;
  }

  setSources(sources: readonly SourceAddress[]): void {
    this.hosts.setSources(sources);
  }

  legend(): { n: number; name: string }[] {
    return this.hosts.legend();
  }

  noteUrl(url: string): void {
    this.hosts.noteUrl(url);
  }

  forLog(text: string): string {
    return redactUrls(text, this.hosts.labeller(this.includeAddresses));
  }

  forDisplay(text: string): string {
    return redactUrls(text, this.hosts.labeller());
  }

  forCard(text: string): string {
    return redactUrls(text, this.hosts.cardLabeller());
  }
}
