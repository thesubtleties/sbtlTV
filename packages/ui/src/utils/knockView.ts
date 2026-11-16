/** One line of copy per knock state (Settings > Sync & transfer). */
/** workUpTo: seconds the proof-of-work may take on this computer (said when it's more than a moment) */
export type KnockState =
  | { step: 'starting'; workUpTo?: number } | { step: 'ringing'; workUpTo?: number }
  | { step: 'code'; code: string; expiresAt: number }
  | { step: 'words'; words: string[] }
  | { step: 'sending'; workUpTo?: number } | { step: 'sent' } | { step: 'received' }
  | { step: 'failed'; reason: string };

export interface KnockLine { text: string; tone: 'info' | 'error' | 'ok'; canRetry: boolean }

const FAIL: Record<string, string> = {
  offline: "Couldn't reach the sbtlTV relay.",
  update: 'Update sbtlTV to send or receive.',
  busy: 'The sbtlTV relay is busy. Try again in a few minutes.',
  unreadable: "It didn't arrive in one piece. Start again.",
  broken: 'Something went wrong. Start again.',
  expired: 'The code ran out. Start again for a new one.',
  'not-found': "That code isn't valid or ran out. Check it, or ask for a new one.",
  mismatch: 'Something got in between. Nothing was sent. Start again.',
  'too-big': 'Too big to send. Use Export to file instead.',
};

function upTo(seconds: number | undefined): string {
  if (!seconds || seconds <= 3) return '';
  return seconds < 60 ? ` This can take up to ${seconds} seconds.` : ` This can take up to ${Math.ceil(seconds / 60)} minutes.`;
}

/** join = the giving side of "Add a computer" (Sync): like send, but what arrives is a computer joining */
export function knockLine(role: 'send' | 'receive' | 'join', s: KnockState): KnockLine {
  const giving = role !== 'receive';
  const info = (text: string): KnockLine => ({ text, tone: 'info', canRetry: false });
  switch (s.step) {
    case 'starting': return info(`Getting a code…${upTo(s.workUpTo)}`);
    case 'ringing': return info(`Connecting…${upTo(s.workUpTo)}`);
    case 'code': return info('Tell this to the person setting you up. Works for 10 minutes.');
    case 'words': return info(giving ? "Same words on their screen? Then it's really them." : 'Same words on their screen? Only then tap Same words.');
    case 'sending': return info(`Sending…${upTo(s.workUpTo)}`);
    case 'sent': return info('Sent. Waiting for it to arrive.');
    case 'received':
      if (role === 'join') return { text: 'Added. It shows under Computers once it has synced.', tone: 'ok', canRetry: false };
      return role === 'send' ? { text: 'They have it. Nothing is left on the sbtlTV relay.', tone: 'ok', canRetry: false } : info('Ready to set up.');
    case 'failed':
      if (s.reason === 'cancelled') return { text: giving ? 'They cancelled.' : 'Cancelled.', tone: 'error', canRetry: true };
      return { text: FAIL[s.reason] ?? FAIL.broken, tone: 'error', canRetry: true };
  }
}
