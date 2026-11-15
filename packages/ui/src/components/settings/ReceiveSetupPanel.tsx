import { useEffect, useRef, useState } from 'react';
import type { SetupPreview } from '../../types/electron';
import { knockLine, type KnockState } from '../../utils/knockView';
import { KnockWords } from './KnockWords';
import { Button, Hint } from './ui';

/**
 * Show my code → same words? → the received setup goes to the Import preview (onReceived), where
 * the existing Back up first and Replace and import apply it. Leaving the panel cancels the knock.
 */
export function ReceiveSetupPanel({ onReceived, onClose }: {
  onReceived: (token: string, preview: SetupPreview) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<KnockState>({ step: 'starting' });
  const [confirmed, setConfirmed] = useState(false);
  const handed = useRef<string | null>(null);

  const start = () => { setConfirmed(false); setState({ step: 'starting' }); void window.mailbox?.receive(); };

  useEffect(() => {
    start();
    const id = window.setInterval(async () => {
      const r = await window.mailbox?.state();
      if (!r || r.data.role !== 'receive' || !r.data.state) return;
      setState(r.data.state);
      const staged = r.data.staged;
      if (r.data.state.step === 'received' && staged && handed.current !== staged.token) {
        handed.current = staged.token;
        onReceived(staged.token, staged.preview);
      }
    }, 500);
    return () => { window.clearInterval(id); void window.mailbox?.cancel(); };
    // Starts once per mount (the panel is shown when someone asks for a code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const line = knockLine('receive', state);
  return (
    <div className="knock-panel">
      {state.step === 'code' && <KnockWords code={state.code} />}
      {state.step === 'words' && <KnockWords words={state.words} />}
      {state.step !== 'received' && <Hint tone={line.tone === 'error' ? 'danger' : undefined}>{confirmed && state.step === 'words' ? 'Waiting for them to send…' : line.text}</Hint>}
      <div className="knock-panel__actions">
        {state.step === 'words' && !confirmed && (
          <>
            <Button variant="primary" onClick={() => { setConfirmed(true); void window.mailbox?.sameWords(); }}>Same words</Button>
            <Button onClick={() => { void window.mailbox?.cancel(); setState({ step: 'failed', reason: 'cancelled' }); }}>Not the same</Button>
          </>
        )}
        {line.canRetry && <Button onClick={start}>Start again</Button>}
        {state.step !== 'received' && <Button onClick={onClose}>Close</Button>}
      </div>
    </div>
  );
}
