import { useEffect, useState, type ReactNode } from 'react';
import type { Source } from '../types/electron';
import { useUIStore } from '../stores/uiStore';
import { saveSettings } from '../utils/saveSettings';
import { afterReceive, isOptional, nextStep, prevStep, STEPS, type StepId } from '../utils/firstRun';
import { Logo } from './Logo';
import { Button, Hint } from './settings/ui';
import { SourceForm } from './settings/SourceForm';
import { AppearanceOptions } from './settings/AppearanceTab';
import { TmdbKeySection } from './settings/TmdbTab';
import { SubdlKeySection } from './settings/SubtitlesTab';
import { ReceiveSection } from './settings/ReceiveSection';
import { useSetupImport } from './settings/useSetupImport';
import './FirstRun.css';

const SOURCE_FORM_ID = 'first-run-source';

/** The panel: logo, step dots and the Settings note on top; Back, Skip and Continue below. */
export function FirstRunFrame({ step, receiving, onBack, onNext, onSkip, onLetMeIn, nextLabel, nextDisabled, nextFormId, children }: {
  step: StepId;
  /** Showing the receive panel: Back only */
  receiving?: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onLetMeIn: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  /** Continue submits this form instead of calling onNext */
  nextFormId?: string;
  children?: ReactNode;
}) {
  const i = STEPS.indexOf(step);
  const first = i === 0 && !receiving;
  return (
    <div className="first-run" role="dialog" aria-modal="true" aria-label="Set up sbtlTV">
      <div className="first-run__dim" />
      <div className="first-run__panel">
        <header className="first-run__top">
          <Logo className="first-run__logo" height={26} />
          <div className="first-run__dots" aria-hidden="true">
            {STEPS.map((s, j) => <span key={s} className={`first-run__dot${j === i ? ' first-run__dot--on' : j < i ? ' first-run__dot--done' : ''}`} />)}
          </div>
          <span className="first-run__note">{first ? '' : 'Change any of this later in Settings'}</span>
        </header>
        <div className="first-run__body">{children}</div>
        <footer className="first-run__foot">
          {first
            ? <button type="button" className="first-run__link" onClick={onLetMeIn}>I know what I'm doing, just let me in</button>
            : <Button onClick={onBack}>Back</Button>}
          <span className="first-run__spacer" />
          {!receiving && isOptional(step) && <button type="button" className="first-run__link" onClick={onSkip}>Skip</button>}
          {!first && !receiving && (
            nextFormId
              ? <Button type="submit" form={nextFormId} variant="primary" disabled={nextDisabled}>{nextLabel}</Button>
              : <Button variant="primary" onClick={onNext} disabled={nextDisabled}>{nextLabel}</Button>
          )}
        </footer>
      </div>
    </div>
  );
}

function StepHead({ title, lede }: { title: string; lede?: string }) {
  return (
    <>
      <h2 className="first-run__title">{title}</h2>
      {lede && <p className="first-run__lede">{lede}</p>}
    </>
  );
}

function Choice({ title, text, main, onClick }: { title: string; text: string; main?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`first-run__choice${main ? ' first-run__choice--main' : ''}`} onClick={onClick}>
      <b>{title}</b>
      <span>{text}</span>
    </button>
  );
}

/** Marks the setup finished for good on this computer (and What's new as seen for this version). */
async function markDone(): Promise<void> {
  const version = await window.platform?.getVersion().catch(() => undefined);
  const done = { firstRun: 'done' as const, ...(version ? { lastSeenVersion: version } : {}) };
  useUIStore.getState().updateSettings(done);
  await saveSettings(done);
}

async function reloadSources(): Promise<void> {
  const r = await window.storage?.getSources();
  if (r?.data) useUIStore.getState().hydrateSources(r.data);
}

/** The step-by-step setup on a computer with no sources. */
export function FirstRun({ onFinish }: { onFinish: (to: 'guide' | 'none') => void }) {
  const [step, setStep] = useState<StepId>('welcome');
  // The receive panel, opened from Welcome or from the sync step
  const [receiveFrom, setReceiveFrom] = useState<StepId | null>(null);
  const [joined, setJoined] = useState(false);
  const [savedSource, setSavedSource] = useState<Source | null>(null);
  const [editingSaved, setEditingSaved] = useState(false);
  const [encryption, setEncryption] = useState(true);
  const [tmdbKey, setTmdbKey] = useState('');
  const [tmdbValid, setTmdbValid] = useState<boolean | null>(null);
  const [subdlKey, setSubdlKey] = useState('');
  const [subdlValid, setSubdlValid] = useState<boolean | null>(null);

  useEffect(() => { void window.storage?.isEncryptionAvailable().then((r) => { if (r.data !== undefined) setEncryption(r.data); }); }, []);

  const im = useSetupImport(() => {
    // Joined a sync: no restart, and Sync brings no sources
    const from = receiveFrom;
    setReceiveFrom(null);
    setJoined(true);
    const to = afterReceive('join');
    setStep(from === 'sync' || savedSource ? 'done' : (to as StepId));
  });

  const finish = (to: 'guide' | 'none') => { void markDone().then(() => onFinish(to)); };
  const closeReceive = () => {
    if (im.imp.step === 'join') im.declineJoin();
    else if (im.imp.step !== 'idle' && im.imp.step !== 'applying') im.setImp({ step: 'idle' });
    void window.mailbox?.cancel();
    setReceiveFrom(null);
  };

  const keyUnsaved = (key: string, valid: boolean | null) => key.trim() !== '' && valid !== true;
  const showForm = step === 'source' && (!savedSource || editingSaved);

  let body: ReactNode;
  if (receiveFrom) {
    body = (
      <ReceiveSection
        im={im}
        receiving
        onReceiving={(open) => { if (!open && im.imp.step === 'idle') setReceiveFrom(null); }}
        title={receiveFrom === 'sync' ? 'Join its sync' : 'Receive a setup'}
        description={receiveFrom === 'sync'
          ? 'On the other computer, open Settings › Sync & transfer › Add a computer… and type this code.'
          : 'Tell this code to the person sending, or type it on your other computer.'}
        onApplying={() => saveSettings({ firstRun: 'offer-sync' })}
        actions={<Button onClick={() => void im.pick()} disabled={im.imp.step === 'applying'}>Import file…</Button>}
      />
    );
  } else if (step === 'welcome') {
    body = (
      <>
        <StepHead title="Welcome to sbtlTV" lede="Let's get you set up. It takes a minute or two." />
        <div className="first-run__choices">
          <Choice main title="Set up sbtlTV" text="Add your TV source and pick a look." onClick={() => setStep('source')} />
          <Choice title="Receive a setup" text="Someone sends you theirs with a short code, or bring it from your other computer." onClick={() => setReceiveFrom('welcome')} />
        </div>
      </>
    );
  } else if (step === 'source') {
    body = (
      <>
        <StepHead title="Your TV source" lede="Your provider's login, or a playlist link." />
        {joined && <Hint tone="ok">Joined. Sync doesn't bring sources: add yours here.</Hint>}
        {showForm
          ? (
            <SourceForm
              editing={editingSaved ? savedSource : null}
              layout="inline"
              formId={SOURCE_FORM_ID}
              isEncryptionAvailable={encryption}
              onDone={(saved) => {
                if (!saved) return;
                setSavedSource(saved);
                setEditingSaved(false);
                void reloadSources();
                setStep('look');
              }}
            />
          )
          : (
            <div className="first-run__saved">
              <span><b>{savedSource!.name}</b> added. Channels and movies are loading.</span>
              <Button onClick={() => setEditingSaved(true)}>Edit</Button>
            </div>
          )}
      </>
    );
  } else if (step === 'look') {
    body = (<><StepHead title="Pick a look" lede="Changes as you pick." /><AppearanceOptions /></>);
  } else if (step === 'tmdb') {
    body = (
      <>
        <StepHead title="Posters and details" lede="Optional. A free TMDB key adds posters, ratings, trailers and More like this." />
        <TmdbKeySection tmdbApiKey={tmdbKey} tmdbKeyValid={tmdbValid} onApiKeyChange={setTmdbKey} onApiKeyValidChange={setTmdbValid} />
      </>
    );
  } else if (step === 'subtitles') {
    body = (
      <>
        <StepHead title="Subtitles" lede="Optional. A free SubDL key finds subtitles for movies and series." />
        <SubdlKeySection subdlApiKey={subdlKey} subdlKeyValid={subdlValid} onSubdlKeyChange={setSubdlKey} onSubdlKeyValidChange={setSubdlValid} />
      </>
    );
  } else if (step === 'sync') {
    body = (
      <>
        <StepHead title="Have sbtlTV on another computer?" lede="Optional. Keep your watchlist and progress the same on both. End-to-end encrypted." />
        {joined
          ? <Hint tone="ok">This computer is in your sync.</Hint>
          : (
            <div className="first-run__choices">
              <Choice title="Join its sync" text="Shows a code to type in on the other computer, under Add a computer." onClick={() => setReceiveFrom('sync')} />
            </div>
          )}
        <Hint>Its look comes too only if you turn on Settings in Sync.</Hint>
      </>
    );
  } else {
    body = <StepHead title="You're set" lede="Channels are loading. Everything here can be changed anytime in Settings." />;
  }

  const unsaved = (step === 'tmdb' && keyUnsaved(tmdbKey, tmdbValid)) || (step === 'subtitles' && keyUnsaved(subdlKey, subdlValid));

  return (
    <FirstRunFrame
      step={step}
      receiving={!!receiveFrom}
      onBack={() => { if (receiveFrom) closeReceive(); else { setEditingSaved(false); setStep(prevStep(step)); } }}
      onNext={() => { if (step === 'done') finish('guide'); else setStep(nextStep(step)); }}
      onSkip={() => setStep(nextStep(step))}
      onLetMeIn={() => finish('none')}
      nextLabel={step === 'done' ? 'Start watching' : 'Continue'}
      nextDisabled={unsaved}
      nextFormId={showForm ? SOURCE_FORM_ID : undefined}
    >
      {body}
      {unsaved && <p className="first-run__unsaved">Save the key first, or Skip.</p>}
    </FirstRunFrame>
  );
}

/** After a setup received from the walkthrough (the app restarted): offer, once, to join the sender's sync. */
export function OfferSyncFrame({ onJoin, onNotNow, children }: { onJoin: () => void; onNotNow: () => void; children?: ReactNode }) {
  return (
    <div className="first-run" role="dialog" aria-modal="true" aria-label="Keep your lists in sync">
      <div className="first-run__dim" />
      <div className="first-run__panel first-run__panel--short">
        <header className="first-run__top">
          <Logo className="first-run__logo" height={26} />
        </header>
        <div className="first-run__body">
          {children ?? (
            <>
              <StepHead title="Also keep your lists in sync with the computer that sent this?" lede="Your watchlist and progress stay the same on both. End-to-end encrypted." />
              <div className="first-run__choices">
                <Choice main title="Join its sync" text="Shows a code. On the other computer: Settings › Sync & transfer › Add a computer…" onClick={onJoin} />
              </div>
            </>
          )}
        </div>
        <footer className="first-run__foot">
          <span className="first-run__spacer" />
          <Button onClick={onNotNow}>{children ? 'Cancel' : 'Not now'}</Button>
        </footer>
      </div>
    </div>
  );
}

export function OfferSync({ onFinish }: { onFinish: () => void }) {
  const [joining, setJoining] = useState(false);
  const done = () => { void markDone().then(onFinish); };
  const im = useSetupImport(done);
  const cancel = () => {
    if (!joining) { done(); return; }
    if (im.imp.step === 'join') im.declineJoin();
    void window.mailbox?.cancel();
    setJoining(false);
  };
  return (
    <OfferSyncFrame onJoin={() => setJoining(true)} onNotNow={cancel}>
      {joining
        ? (
          <ReceiveSection
            im={im}
            receiving
            onReceiving={(open) => { if (!open && im.imp.step === 'idle') setJoining(false); }}
            title="Join its sync"
            description="On the other computer, open Settings › Sync & transfer › Add a computer… and type this code."
            actions={<></>}
          />
        )
        : undefined}
    </OfferSyncFrame>
  );
}
