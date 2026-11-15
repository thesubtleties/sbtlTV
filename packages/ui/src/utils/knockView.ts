/** One line of copy per knock state (Settings > Sync & transfer). */
export type KnockState =
  | { step: 'starting' } | { step: 'ringing' }
  | { step: 'code'; code: string; expiresAt: number }
  | { step: 'words'; words: string[] }
  | { step: 'sending' } | { step: 'sent' } | { step: 'received' }
  | { step: 'failed'; reason: string };

export interface KnockLine { text: string; tone: 'info' | 'error' | 'ok'; canRetry: boolean }

const FAIL: Record<string, string> = {
  offline: "Couldn't reach the sbtlTV mailbox.",
  update: 'Update sbtlTV to send or receive.',
  busy: 'The mailbox is busy. Try again in a minute.',
  broken: 'Something went wrong. Start again.',
  expired: 'The code ran out. Start again for a new one.',
  'not-found': "That code isn't valid or ran out. Check it, or ask for a new one.",
  mismatch: 'Something got in between. Nothing was sent. Start again.',
  'too-big': 'Too big to send. Use Export to file instead.',
};

export function knockLine(role: 'send' | 'receive', s: KnockState): KnockLine {
  const info = (text: string): KnockLine => ({ text, tone: 'info', canRetry: false });
  switch (s.step) {
    case 'starting': return info('Getting a code…');
    case 'ringing': return info('Knocking…');
    case 'code': return info('Tell this to the person setting you up. Works for 10 minutes.');
    case 'words': return info(role === 'send' ? "Same words on their screen? Then it's really them." : 'Same words on their screen? Only then tap Same words.');
    case 'sending': return info('Sending…');
    case 'sent': return info('Sent. Waiting for them to accept.');
    case 'received': return role === 'send' ? { text: 'They have it. Nothing is left on our server.', tone: 'ok', canRetry: false } : info('Ready to set up.');
    case 'failed':
      if (s.reason === 'cancelled') return { text: role === 'send' ? 'They cancelled.' : 'Cancelled.', tone: 'error', canRetry: true };
      return { text: FAIL[s.reason] ?? FAIL.broken, tone: 'error', canRetry: true };
  }
}
