import { useState } from 'react';
import { KnockSendView, useKnockSend } from './useKnockSend';
import { Button, Hint, OptionRow, TextField } from './ui';

/** Sync > Add a computer: their code, the same three words, then they join. Leaving cancels. */
export function AddComputerPanel({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const { state, error, busy, begin, again } = useKnockSend();
  const ready = code.replace(/[\s-]/g, '').length === 8;
  const connect = () => begin(() => window.mailbox!.sendJoin(code), "Couldn't start. Restart sbtlTV and try again.");

  if (state) return <KnockSendView role="join" state={state} confirmLabel="Words match, add" onAgain={again} onDone={onClose} />;

  return (
    <div className="knock-panel">
      <OptionRow title="Their code" help="On the other computer: Sync & transfer › Show my code.">
        <form onSubmit={(e) => { e.preventDefault(); if (!busy && ready) void connect(); }}>
          <TextField autoFocus aria-label="Their code" placeholder="XXXX-XXXX" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
        </form>
      </OptionRow>
      {error && <Hint tone="danger">{error}</Hint>}
      <div className="knock-panel__actions">
        <Button variant="primary" disabled={busy || !ready} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Connect'}</Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
