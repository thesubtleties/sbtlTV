import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Source } from '../types/electron';
import { useUIStore } from '../stores/uiStore';
import { saveSettings } from '../utils/saveSettings';
import { isOptional, keyUnsaved, nextStep, prevStep, receiveViewCloses, stepAfterJoin, STEPS, type StepId } from '../utils/firstRun';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Logo } from './Logo';
import { Button, Hint } from './settings/ui';
import { SourceForm } from './settings/SourceForm';
import { AppearanceOptions } from './settings/AppearanceTab';
import { TmdbKeySection } from './settings/TmdbTab';
import { SubdlKeySection } from './settings/SubtitlesTab';
import { ReceiveSection } from './settings/ReceiveSection';
import { useSetupImport, type SetupImport } from './settings/useSetupImport';
import './FirstRun.css';

const SOURCE_FORM_ID = 'first-run-source';

/** The panel: logo, step dots and the Settings note on top; Back, Skip and Continue below. */
export function FirstRunFrame({ step, receiving, backDisabled, onBack, onNext, onSkip, onLetMeIn, nextLabel, nextDisabled, nextFormId, focusKey, children }: {
  step: StepId;
  /** Showing the receive panel: Back only */
  receiving?: boolean;
  /** A join or an apply is running: no going back */
  backDisabled?: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onLetMeIn: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  /** Continue submits this form instead of calling onNext */
  nextFormId?: string;
  /** Changes when the content changes in place (a setup arriving), so focus moves to it */
  focusKey?: string;
  children?: ReactNode;
}) {
  const i = STEPS.indexOf(step);
  const first = i === 0 && !receiving;
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, `${step}-${receiving ? 'r' : ''}-${focusKey ?? ''}`);
  return (
    <div className="first-run" role="dialog" aria-modal="true" aria-label="Set up sbtlTV">
      <div className="first-run__dim" />
      <div className="first-run__panel" ref={panel} tabIndex={-1}>
        <header className="first-run__top">
          <Logo className="first-run__logo" height={26} aria-hidden="true" />
          <div className="first-run__dots" aria-hidden="true">
            {STEPS.map((s, j) => <span key={s} className={`first-run__dot${j === i ? ' first-run__dot--on' : j < i ? ' first-run__dot--done' : ''}`} />)}
          </div>
          <span className="first-run__note">{first ? '' : 'Change any of this later in Settings'}</span>
        </header>
        <div className="first-run__body">
          <span className="first-run__sr">Step {i + 1} of {STEPS.length}</span>
          {children}
        </div>
        <footer className="first-run__foot">
          {first
            ? <button type="button" className="first-run__link" onClick={onLetMeIn}>I know what I'm doing, just let me in</button>
            : <Button onClick={onBack} disabled={backDisabled}>Back</Button>}
          <span className="first-run__spacer" />
          {!receiving && isOptional(step) && <button type="button" className="first-run__link" onClick={onSkip}>Skip</button>}
          {!first && !receiving && (
            nextFormId
              ? <Button type="submit" form={nextFormId} variant="primary" disabled={nextDisabled} aria-describedby={nextDisabled ? 'first-run-unsaved' : undefined}>{nextLabel}</Button>
              : <Button variant="primary" onClick={onNext} disabled={nextDisabled} aria-describedby={nextDisabled ? 'first-run-unsaved' : undefined}>{nextLabel}</Button>
          )}
        </footer>
      </div>
    </div>
  );
}

function StepHead({ title, lede }: { title: string; lede?: string }) {
  return (
    <>
      {/* Focus lands here on each step, so a screen reader reads the new step's title */}
      <h2 className="first-run__title" tabIndex={-1} data-autofocus>{title}</h2>
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
  // One write with both, so a quit right after can't keep one without the other
  const version = await window.platform?.getVersion().catch(() => undefined);
  const done = { firstRun: 'done' as const, ...(version ? { lastSeenVersion: version } : {}) };
  useUIStore.getState().updateSettings(done);
  await saveSettings(done);
}

async function reloadSources(): Promise<void> {
  const r = await window.storage?.getSources();
  if (r?.data) useUIStore.getState().hydrateSources(r.data);
}

/**
 * Whether this computer can receive setups and join a sync: not the portable build (Settings hides
 * Sync & transfer there), and Sync needs a real keyring. null while asking.
 */
function useSyncSupport(): { receive: boolean; sync: boolean | null } {
  const portable = !!window.platform?.isPortable;
  const [available, setAvailable] = useState<boolean | null>(portable ? false : null);
  useEffect(() => {
    if (portable) return;
    void (window.sync?.available() ?? Promise.resolve(false)).then(setAvailable, () => setAvailable(false));
  }, [portable]);
  return { receive: !portable, sync: available };
}

/** Why Sync can't be offered here, in one line. */
function noSyncLine(): string {
  return window.platform?.isPortable
    ? "Sync isn't in the portable version. Install sbtlTV to use it."
    : 'Sync needs a keyring on this computer (gnome-keyring or KWallet). Then: Settings › Sync & transfer.';
}

/** Receiving here (a code, a join or a file), and the Import file… button that goes with it. */
function receiveActions(im: SetupImport, codeOpen: boolean, setCodeOpen: (open: boolean) => void, withFile: boolean) {
  return (
    <>
      {!codeOpen && im.imp.step === 'idle' && <Button onClick={() => setCodeOpen(true)}>Show my code</Button>}
      {withFile && (
        <Button
          onClick={() => { setCodeOpen(false); im.cancel(); void im.pick(); }}
          disabled={im.busy}
        >
          Import file…
        </Button>
      )}
    </>
  );
}

/** The step-by-step setup on a computer with no sources. */
export function FirstRun({ onFinish }: { onFinish: (to: 'guide' | 'none') => void }) {
  const [step, setStep] = useState<StepId>('welcome');
  const stepRef = useRef(step);
  stepRef.current = step;
  // The receive panel, opened from Welcome or from the sync step
  const [receiveFrom, setReceiveFrom] = useState<StepId | null>(null);
  // The code panel inside the receive view (closes when a setup or join arrives; the view stays for its preview)
  const [codeOpen, setCodeOpen] = useState(false);
  const [joined, setJoined] = useState(false);
  const [savedSource, setSavedSource] = useState<Source | null>(null);
  const [editingSaved, setEditingSaved] = useState(false);
  const [encryption, setEncryption] = useState(true);
  const [tmdbKey, setTmdbKey] = useState('');
  const [tmdbValid, setTmdbValid] = useState<boolean | null>(null);
  const [subdlKey, setSubdlKey] = useState('');
  const [subdlValid, setSubdlValid] = useState<boolean | null>(null);
  const support = useSyncSupport();

  useEffect(() => { void window.storage?.isEncryptionAvailable().then((r) => { if (r.data !== undefined) setEncryption(r.data); }); }, []);

  const im = useSetupImport(() => {
    // Joined a sync: no restart, and Sync brings no sources
    const from = receiveFrom;
    setReceiveFrom(null);
    setJoined(true);
    setStep(stepAfterJoin(from ?? 'welcome', !!savedSource));
  });

  // Declining (or dismissing) what arrived goes back to where the receive view was opened
  const lastImpStep = useRef(im.imp.step);
  useEffect(() => {
    if (receiveViewCloses(lastImpStep.current, im.imp.step)) { setCodeOpen(false); setReceiveFrom(null); }
    lastImpStep.current = im.imp.step;
  }, [im.imp.step]);

  const finish = (to: 'guide' | 'none') => { void markDone().then(() => onFinish(to)); };
  const openReceive = (from: StepId) => { setReceiveFrom(from); setCodeOpen(true); };
  const closeReceive = () => {
    if (im.busy) return;
    im.cancel();
    setCodeOpen(false);
    setReceiveFrom(null);
  };

  // The source form stays mounted (hidden) off its step, so what was typed survives Back and Continue
  const formNeeded = !savedSource || editingSaved;
  const showForm = step === 'source' && formNeeded;

  const body = ((): ReactNode => {
    if (receiveFrom) {
      return (
        <ReceiveSection
          im={im}
          receiving={codeOpen}
          onReceiving={setCodeOpen}
          onPanelClose={() => setReceiveFrom(null)}
          title={receiveFrom === 'sync' ? 'Join its sync' : 'Receive a setup'}
          description={receiveFrom === 'sync'
            ? 'Type this code on the other computer: Settings › Sync & transfer › Add a computer…'
            : 'Tell this code to the person sending. From your own other computer: Settings › Sync & transfer › Send to a device…'}
          // The sync offer after the restart is only for a setup received by code from your own computer
          onApplying={(received) => (received ? saveSettings({ firstRun: 'offer-sync' }) : Promise.resolve())}
          actions={receiveActions(im, codeOpen, setCodeOpen, receiveFrom === 'welcome')}
        />
      );
    }
    switch (step) {
      case 'welcome':
        return (
          <>
            <StepHead title="Welcome to sbtlTV" lede="Let's get you set up. It takes a minute or two." />
            <div className="first-run__choices">
              <Choice main title="Set up sbtlTV" text="Add your TV source and pick a look." onClick={() => setStep('source')} />
              {support.receive && (
                <Choice title="Receive a setup" text="Someone sends you theirs with a short code, or bring it from your other computer." onClick={() => openReceive('welcome')} />
              )}
            </div>
          </>
        );
      case 'source':
        return (
          <>
            <StepHead title="Your TV source" lede="Your provider's login, or a playlist link." />
            {joined && <Hint tone="ok">Joined. Sync doesn't bring sources: add yours here.</Hint>}
            {savedSource && !editingSaved && (
              <div className="first-run__saved">
                <span><b>{savedSource.name}</b> added. {savedSource.type === 'xtream' ? 'Channels and movies are loading.' : 'Channels are loading.'}</span>
                <Button onClick={() => setEditingSaved(true)}>Edit</Button>
              </div>
            )}
          </>
        );
      case 'look':
        return (<><StepHead title="Pick a look" lede="Changes as you pick." /><AppearanceOptions /></>);
      case 'tmdb':
        return (
          <>
            <StepHead title="Movie details" lede="Optional." />
            <TmdbKeySection tmdbApiKey={tmdbKey} tmdbKeyValid={tmdbValid} onApiKeyChange={setTmdbKey} onApiKeyValidChange={setTmdbValid} />
          </>
        );
      case 'subtitles':
        return (
          <>
            <StepHead title="Subtitles" lede="Optional." />
            <SubdlKeySection subdlApiKey={subdlKey} subdlKeyValid={subdlValid} onSubdlKeyChange={setSubdlKey} onSubdlKeyValidChange={setSubdlValid} />
          </>
        );
      case 'sync':
        return (
          <>
            <StepHead title="Have sbtlTV on another computer?" lede="Optional. Keep your watchlist, progress and favorite channels the same on both. End-to-end encrypted." />
            {joined
              ? <Hint tone="ok">This computer is in your sync.</Hint>
              : support.sync === false
                ? <Hint>{noSyncLine()}</Hint>
                : (
                  <>
                    <div className="first-run__choices">
                      <Choice title="Join its sync" text="Shows a code to type in on the other computer." onClick={() => openReceive('sync')} />
                    </div>
                    <Hint>Its look comes too only if you turn on Settings in Sync.</Hint>
                  </>
                )}
          </>
        );
      case 'done':
        return <StepHead title="You're set" lede="Everything here can be changed anytime in Settings." />;
      default: {
        const unknown: never = step;
        return unknown;
      }
    }
  })();

  const unsaved = (step === 'tmdb' && keyUnsaved(tmdbKey, tmdbValid)) || (step === 'subtitles' && keyUnsaved(subdlKey, subdlValid));

  return (
    <FirstRunFrame
      step={step}
      receiving={!!receiveFrom}
      backDisabled={im.busy}
      focusKey={receiveFrom ? im.imp.step : undefined}
      onBack={() => { if (receiveFrom) closeReceive(); else { setEditingSaved(false); setStep(prevStep(step)); } }}
      onNext={() => { if (step === 'done') finish('guide'); else setStep(nextStep(step)); }}
      onSkip={() => setStep(nextStep(step))}
      onLetMeIn={() => finish('none')}
      nextLabel={step === 'done' ? 'Start watching' : 'Continue'}
      nextDisabled={unsaved}
      nextFormId={showForm ? SOURCE_FORM_ID : undefined}
    >
      {body}
      {formNeeded && !receiveFrom && (
        <div hidden={step !== 'source'}>
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
              // Only move on if the person is still on this step (Back during a slow save stays put)
              if (stepRef.current === 'source') setStep('look');
            }}
          />
        </div>
      )}
      {unsaved && <p className="first-run__unsaved" id="first-run-unsaved">Save the key first, or Skip.</p>}
    </FirstRunFrame>
  );
}

/** After a setup received by code (the app restarted): offer, once, to keep this computer in sync with the sender. */
export function OfferSyncFrame({ joining, busy, onJoin, onNotNow, children }: {
  joining: boolean;
  /** A join is running: Cancel would not stop it */
  busy?: boolean;
  onJoin: () => void;
  onNotNow: () => void;
  /** The receive view while joining */
  children?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, joining ? 'joining' : 'offer');
  return (
    <div className="first-run" role="dialog" aria-modal="true" aria-label="Keep this computer in sync">
      <div className="first-run__dim" />
      <div className="first-run__panel first-run__panel--short" ref={panel} tabIndex={-1}>
        <header className="first-run__top">
          <Logo className="first-run__logo" height={26} aria-hidden="true" />
        </header>
        <div className="first-run__body">
          {joining ? children : (
            <>
              <StepHead title="Keep this computer in sync with your other one?" lede="Your watchlist, progress and favorite channels stay the same on both. Only for your own computers. End-to-end encrypted." />
              <div className="first-run__choices">
                <Choice main title="Join its sync" text="Shows a code. On the other computer: Settings › Sync & transfer › Add a computer…" onClick={onJoin} />
              </div>
            </>
          )}
        </div>
        <footer className="first-run__foot">
          <span className="first-run__spacer" />
          <Button onClick={onNotNow} disabled={busy}>{joining ? 'Cancel' : 'Not now'}</Button>
        </footer>
      </div>
    </div>
  );
}

export function OfferSync({ onFinish }: { onFinish: () => void }) {
  const [joining, setJoining] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const support = useSyncSupport();
  const done = () => { void markDone().then(onFinish); };
  const im = useSetupImport(done);
  // Nothing to offer where Sync can't work (no keyring): finish quietly
  useEffect(() => { if (support.sync === false) done(); }, [support.sync]); // eslint-disable-line react-hooks/exhaustive-deps
  // A declined join (or anything dismissed) goes back to the offer
  const lastImpStep = useRef(im.imp.step);
  useEffect(() => {
    if (receiveViewCloses(lastImpStep.current, im.imp.step)) { setCodeOpen(false); setJoining(false); }
    lastImpStep.current = im.imp.step;
  }, [im.imp.step]);
  const cancel = () => {
    if (!joining) { done(); return; }
    if (im.busy) return;
    im.cancel();
    setCodeOpen(false);
    setJoining(false);
  };
  if (support.sync === false) return null;
  return (
    <OfferSyncFrame joining={joining} busy={im.busy} onJoin={() => { setJoining(true); setCodeOpen(true); }} onNotNow={cancel}>
      <ReceiveSection
        im={im}
        receiving={codeOpen}
        onReceiving={setCodeOpen}
        onPanelClose={() => setJoining(false)}
        title="Join its sync"
        description="Type this code on the other computer: Settings › Sync & transfer › Add a computer…"
        actions={receiveActions(im, codeOpen, setCodeOpen, false)}
      />
    </OfferSyncFrame>
  );
}
