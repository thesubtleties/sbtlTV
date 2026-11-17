import { useEffect, useRef, useState } from 'react';
import type { SetupPreview } from '../../types/electron';
import { knockLine, type KnockState } from '../../utils/knockView';
import { KnockWords } from './KnockWords';
import { Button, Hint } from './ui';

/**
 * Show my code → same words? → the received setup goes to the Import preview (onReceived), where
 * the existing Back up first and Replace and import apply it. Leaving the panel cancels the knock.
 */
export function ReceiveSetupPanel({ onReceived, onJoin, onClose }: {
  onReceived: (token: string, preview: SetupPreview) => void;
  /** The drop was a join to someone's sync (names of its computers): the tab asks Join / Decline */
  onJoin: (computers: string[]) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<KnockState>({ step: 'starting' });
  const [confirmed, setConfirmed] = useState(false);
  const handed = useRef<string | null>(null);
  // Bumped on every action: a poll answered after it describes the old knock and is dropped
  const gen = useRef(0);

  const start = () => { gen.current++; setConfirmed(false); setState({ step: 'starting' }); void window.mailbox?.receive(); };

  useEffect(() => {
    start();
    const id = window.setInterval(async () => {
      const asked = gen.current;
      const r = await window.mailbox?.state();
      if (asked !== gen.current) return;
      if (!r || r.data.role !== 'receive' || !r.data.state) return;
      setState(r.data.state);
      const staged = r.data.staged;
      if (r.data.state.step === 'received' && staged && handed.current !== staged.token) {
        handed.current = staged.token;
        onReceived(staged.token, staged.preview);
      }
      const join = r.data.join;
      if (r.data.state.step === 'received' && join && handed.current !== 'join') {
        handed.current = 'join';
        onJoin(join.computers);
      }
    }, 500);
    // A join handed over waits in main for Join or Decline: leaving the panel doesn't drop it
    return () => { window.clearInterval(id); if (handed.current !== 'join') void window.mailbox?.cancel(); };
    // Starts once per mount (the panel is shown when someone asks for a code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const line = knockLine('receive', state);
  return (
    <div className="knock-panel">
      <div className="knock-panel__show">
        {state.step === 'code' && <KnockWords code={state.code} />}
        {state.step === 'words' && <KnockWords words={state.words} />}
        <div aria-live="polite">
          {state.step !== 'received' && <Hint tone={line.tone === 'error' ? 'danger' : undefined}>{confirmed && state.step === 'words' ? 'Waiting for them to send…' : line.text}</Hint>}
        </div>
      </div>
      <div className="knock-panel__actions">
        {state.step === 'words' && !confirmed && (
          <>
            <Button variant="primary" onClick={() => { setConfirmed(true); void window.mailbox?.sameWords(); }}>Same words</Button>
            <Button onClick={() => { gen.current++; void window.mailbox?.cancel(); setState({ step: 'failed', reason: 'cancelled' }); }}>Not the same</Button>
          </>
        )}
        {line.canRetry && <Button onClick={start}>Start again</Button>}
        {state.step !== 'received' && <Button onClick={onClose}>Close</Button>}
      </div>
    </div>
  );
}
