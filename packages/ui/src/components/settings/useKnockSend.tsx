import { useEffect, useRef, useState } from 'react';
import { knockLine, type KnockState } from '../../utils/knockView';
import { KnockWords } from './KnockWords';
import { Button, Hint } from './ui';

/**
 * The giving side of a knock (Send a setup, Add a computer): polls main for the knock's state,
 * and cancels on leaving only a knock this panel started (the Receive panel may own the mailbox).
 */
export function useKnockSend() {
  const [state, setState] = useState<KnockState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped on every action: a poll answered after it describes the old knock and is dropped
  const gen = useRef(0);
  const started = useRef(false);

  useEffect(() => {
    const id = window.setInterval(async () => {
      const asked = gen.current;
      const r = await window.mailbox?.state();
      if (asked !== gen.current) return;
      if (r?.data.role === 'send' && r.data.state) setState(r.data.state);
    }, 500);
    return () => { window.clearInterval(id); if (started.current) void window.mailbox?.cancel(); };
  }, []);

  /** Starts a knock with `start` (it rings their code); errors show under the form. */
  async function begin(start: () => Promise<{ error?: string } | undefined>, failMessage: string) {
    if (!window.mailbox || busy) return;
    gen.current++;
    started.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await start();
      if (r?.error) setError(r.error); else setState({ step: 'ringing' });
    } catch {
      setError(failMessage);
    } finally {
      setBusy(false);
    }
  }

  // Keeps the typed code after "isn't valid" so it can be checked and fixed
  const again = () => { gen.current++; void window.mailbox?.cancel(); setState(null); };

  return { state, error, busy, begin, again };
}

/** After Connect: the words, the status line and the buttons. */
export function KnockSendView({ role, state, confirmLabel, onAgain, onDone }: {
  role: 'send' | 'join'; state: KnockState; confirmLabel: string; onAgain: () => void; onDone: () => void;
}) {
  const line = knockLine(role, state);
  return (
    <div className="knock-panel">
      <div className="knock-panel__show">
        {state.step === 'words' && <KnockWords words={state.words} />}
        <div aria-live="polite"><Hint tone={line.tone === 'error' ? 'danger' : line.tone === 'ok' ? 'ok' : undefined}>{line.text}</Hint></div>
      </div>
      <div className="knock-panel__actions">
        {state.step === 'words' && <Button variant="primary" onClick={() => void window.mailbox?.confirm()}>{confirmLabel}</Button>}
        {(state.step === 'ringing' || state.step === 'words' || state.step === 'sending' || state.step === 'sent') && <Button onClick={onAgain}>Cancel</Button>}
        {line.canRetry && <Button onClick={onAgain}>Start again</Button>}
        {state.step === 'received' && <Button onClick={onDone}>Done</Button>}
      </div>
    </div>
  );
}
