import { describe, expect, it } from 'vitest';
import { knockLine } from './knockView';

describe('knockLine', () => {
  it('receive steps', () => {
    expect(knockLine('receive', { step: 'starting' }).text).toBe('Getting a code…');
    expect(knockLine('receive', { step: 'code', code: '7KQ4M2XD', expiresAt: 0 }).text).toBe('Tell this to the person setting you up. Works for 10 minutes.');
    expect(knockLine('receive', { step: 'words', words: ['a', 'b', 'c'] }).text).toBe('Same words on their screen? Only then tap Same words.');
    expect(knockLine('receive', { step: 'failed', reason: 'expired' })).toEqual({ text: 'The code ran out. Start again for a new one.', tone: 'error', canRetry: true });
  });
  it('send steps', () => {
    expect(knockLine('send', { step: 'words', words: ['a', 'b', 'c'] }).text).toBe("Same words on their screen? Then it's really them.");
    expect(knockLine('send', { step: 'sent' }).text).toBe('Sent. Waiting for it to arrive.');
    expect(knockLine('send', { step: 'ringing' }).text).toBe('Connecting…');
    expect(knockLine('send', { step: 'failed', reason: 'unreadable' }).text).toBe("It didn't arrive in one piece. Start again.");
    expect(knockLine('send', { step: 'failed', reason: 'busy' }).text).toBe('The sbtlTV relay is busy. Try again in a few minutes.');
    expect(knockLine('send', { step: 'received' })).toEqual({ text: 'They have it. Nothing is left on the sbtlTV relay.', tone: 'ok', canRetry: false });
    expect(knockLine('send', { step: 'failed', reason: 'not-found' }).text).toBe("That code isn't valid or ran out. Check it, or ask for a new one.");
    expect(knockLine('send', { step: 'failed', reason: 'mismatch' }).text).toBe('Something got in between. Nothing was sent. Start again.');
    expect(knockLine('send', { step: 'failed', reason: 'too-big' }).text).toBe('Too big to send. Use Export to file instead.');
  });
  it('shared failures', () => {
    for (const role of ['send', 'receive'] as const) {
      expect(knockLine(role, { step: 'failed', reason: 'offline' }).text).toBe("Couldn't reach the sbtlTV relay.");
      expect(knockLine(role, { step: 'failed', reason: 'update' }).text).toBe('Update sbtlTV to send or receive.');
      expect(knockLine(role, { step: 'failed', reason: 'cancelled' }).text).toBe(role === 'send' ? 'They cancelled.' : 'Cancelled.');
      expect(knockLine(role, { step: 'failed', reason: 'something new' }).text).toBe('Something went wrong. Start again.');
    }
  });

  it('says how long the work may take when it is more than a moment', () => {
    expect(knockLine('send', { step: 'ringing', workUpTo: 12 }).text).toBe('Connecting… This can take up to 12 seconds.');
    expect(knockLine('receive', { step: 'starting', workUpTo: 75 }).text).toBe('Getting a code… This can take up to 2 minutes.');
    expect(knockLine('send', { step: 'sending', workUpTo: 2 }).text).toBe('Sending…');
  });
});
