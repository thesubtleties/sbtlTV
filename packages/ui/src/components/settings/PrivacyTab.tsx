import { useEffect, useState } from 'react';
import type { IpCheckResult, StorageProtection } from '../../types/electron';
import { debugLog } from '../../utils/debugLog';
import { Button, Hint, OptionRow, Section, Segmented, SettingsTab } from './ui';
import './PrivacyTab.css';

interface PrivacyTabProps {
  tmdbKeySet: boolean;
  posterDbKeySet: boolean;
  teamLogosEnabled: boolean;
  autoUpdateEnabled: boolean;
  debugLoggingEnabled: boolean;
}

type Status = 'always' | 'on' | 'off' | 'not-set-up';
const STATUS_LABEL: Record<Status, string> = { always: 'Always', on: 'On', off: 'Off', 'not-set-up': 'Not set up' };

/** A service: what it sees across the row, whether it applies now on the right. */
function Who({ title, sees, status, note }: { title: string; sees: string; status: Status; note?: string }) {
  return (
    <div className="privacy__row">
      <div>
        <div className="st-row__title">{title}</div>
        <div className="st-row__help">{sees}{note && <> <span className="privacy__note">{note}</span></>}</div>
      </div>
      <span className={`privacy__status privacy__status--${status}`}>{STATUS_LABEL[status]}</span>
    </div>
  );
}

type IpCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'done'; data: IpCheckResult }
  | { state: 'failed'; error: string };

const KEYRING_NAMES: Record<string, string> = {
  kwallet: 'KWallet', kwallet5: 'KWallet', kwallet6: 'KWallet', gnome_libsecret: 'your keyring (Secret Service)',
};

/** How saved passwords and API keys are protected here, in plain words. */
function protectionText(p: StorageProtection): { text: string; tone?: 'ok' | 'warn' } {
  const strong = p.available && !(p.platform === 'linux' && (p.backend === 'basic_text' || p.backend === 'unknown'));
  if (!strong) {
    return {
      tone: 'warn',
      text: p.platform === 'linux'
        ? 'No system keyring is in use, so saved passwords and API keys are stored without strong encryption. To fix this, set up a keyring (KWallet or GNOME Keyring), choose it under Keyring below, and add them again.'
        : 'No system keyring was found, so saved passwords and API keys are stored without strong encryption.',
    };
  }
  const by = p.platform === 'darwin' ? "your Mac's Keychain"
    : p.platform === 'win32' ? 'Windows, for your user account'
    : KEYRING_NAMES[p.backend ?? ''] ?? 'your system keyring';
  return { tone: 'ok', text: `Saved passwords and API keys are encrypted by ${by}.` };
}

/** Linux keyrings, as --password-store values (see password-store.ts in the electron package). */
const KEYRING_OPTIONS = [
  { id: 'gnome-libsecret', label: 'Secret Service' },
  { id: 'kwallet6', label: 'KWallet 6' },
  { id: 'kwallet5', label: 'KWallet 5' },
  { id: 'kwallet', label: 'KWallet 4' },
  { id: 'basic', label: 'None' },
];

/** The keyring in use as a --password-store value, from Chromium's backend name. */
function keyringInUse(backend: string | null): string {
  if (backend === 'gnome_libsecret') return 'gnome-libsecret';
  if (backend === 'basic_text') return 'basic';
  return backend ?? '';
}

/**
 * Linux: which keyring encrypts saved passwords. sbtlTV keeps using the one it
 * has, so updates and desktop changes cannot move it; switching here starts over
 * with the new one.
 */
function KeyringRow({ protection }: { protection: StorageProtection }) {
  const current = keyringInUse(protection.backend);
  const [picked, setPicked] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = (id: string) => KEYRING_OPTIONS.find((option) => option.id === id)?.label ?? id;

  async function switchKeyring(keyring: string) {
    if (!window.privacy) return;
    setSwitching(true);
    setError(null);
    try {
      const result = await window.privacy.switchKeyring(keyring);
      if (result.error) throw new Error(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSwitching(false);
    }
  }

  return (
    <>
      <OptionRow
        title="Keyring"
        help={protection.launchKeyring
          ? `Set by --password-store=${protection.launchKeyring} where sbtlTV is started, which wins over this setting.`
          : 'sbtlTV keeps using this keyring, so updates and desktop changes do not switch it.'}
      >
        <Segmented
          compact
          value={picked ?? current}
          options={KEYRING_OPTIONS}
          onChange={(id) => setPicked(id === current ? null : id)}
          disabled={!!protection.launchKeyring || switching}
        />
      </OptionRow>
      {picked && (
        <Hint tone="warn">
          Switching to {label(picked)} restarts sbtlTV. A keyring cannot read what another one saved, so your
          provider passwords and API keys are removed and you enter them again after the restart.
          Setup backups are removed too.{' '}
          <Button variant="danger" onClick={() => void switchKeyring(picked)} disabled={switching}>
            {switching ? 'Restarting…' : 'Switch and restart'}
          </Button>{' '}
          <Button onClick={() => setPicked(null)} disabled={switching}>Cancel</Button>
        </Hint>
      )}
      {error && <Hint tone="danger">{error}</Hint>}
    </>
  );
}

/** What sbtlTV keeps, what IP the outside services see, and who sees what. */
export function PrivacyTab({ tmdbKeySet, posterDbKeySet, teamLogosEnabled, autoUpdateEnabled, debugLoggingEnabled }: PrivacyTabProps) {
  const [ipCheck, setIpCheck] = useState<IpCheck>({ state: 'idle' });
  const [protection, setProtection] = useState<StorageProtection | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.privacy?.storageProtection()
      .then((p) => { if (!cancelled) setProtection(p); })
      .catch((err) => debugLog(`storage protection check failed: ${err instanceof Error ? err.message : err}`, 'privacy'));
    return () => { cancelled = true; };
  }, []);

  async function checkIp() {
    if (!window.privacy) return;
    setIpCheck({ state: 'checking' });
    try {
      const result = await window.privacy.checkIp();
      setIpCheck(result.data ? { state: 'done', data: result.data } : { state: 'failed', error: result.error ?? 'No answer.' });
    } catch (error) {
      setIpCheck({ state: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }

  const place = ipCheck.state === 'done' ? [ipCheck.data.city, ipCheck.data.country].filter(Boolean).join(', ') : '';
  const protectionLine = protection ? protectionText(protection) : null;

  return (
    <SettingsTab>
      <Section
        title="On this computer"
        description="sbtlTV has no account and no server of its own, and sends no analytics, tracking or crash reports."
      >
        <Hint>Your settings, watch history, favorites, watchlist, guide and library are kept on this computer.</Hint>
        {protectionLine && <Hint tone={protectionLine.tone}>{protectionLine.text}</Hint>}
        {protection?.platform === 'linux' && <KeyringRow protection={protection} />}
        <Hint>
          {debugLoggingEnabled
            ? 'Debug logging is on. The log stays on this computer; logins are removed from it and provider addresses appear as labels.'
            : 'Debug logging is off.'}
        </Hint>
      </Section>

      <Section
        title="What IP do they see?"
        description="Asks Mullvad's public checker (am.i.mullvad.net) once, only when you click. Nothing is saved."
        actions={(
          <Button onClick={() => void checkIp()} disabled={ipCheck.state === 'checking' || !window.privacy}>
            {ipCheck.state === 'checking' ? 'Checking…' : 'Check'}
          </Button>
        )}
      >
        {ipCheck.state === 'done' && (
          <div className="privacy__ip">
            <div className="privacy__ip-row"><span>IP address</span><strong>{ipCheck.data.ip}</strong></div>
            {place && <div className="privacy__ip-row"><span>Location</span><strong>{place}</strong></div>}
            {ipCheck.data.organization && <div className="privacy__ip-row"><span>Network</span><strong>{ipCheck.data.organization}</strong></div>}
            <div className="privacy__ip-row">
              <span>Mullvad VPN</span>
              <strong>{ipCheck.data.mullvadServer ? `Yes (${ipCheck.data.mullvadServer})` : 'No'}</strong>
            </div>
            <Hint>This is the address your provider and the services below see. Streams use the same connection unless you route apps separately.</Hint>
          </div>
        )}
        {ipCheck.state === 'failed' && <Hint tone="warn">{ipCheck.error}</Hint>}
      </Section>

      <Section
        title="Who sees what"
        description="sbtlTV connects directly to each of these. Like a web browser, each request also says it comes from sbtlTV and which system you use."
      >
        <Who title="Your IPTV provider" status="always"
          sees="Your IP address, your account, and what you watch and when. They provide the streams." />
        <Who title="Guide sources" status="always"
          sees="Your IP address and when the guide refreshes: your provider's guide, and any guide URLs you add." />
        <Who title="Image hosts" status="always"
          sees="Channel logos and posters load from the addresses in your provider's data and from TMDB's image server; each sees your IP address and which images." />
        <Who title="GitHub" status="always"
          sees={`Two public data files with no account: the movie and series match file used by library syncs, and TMDB's browse lists when you have no TMDB key. Also ${autoUpdateEnabled ? 'the update check when sbtlTV starts' : 'update checks, only when you click Check for updates'} (your IP address and sbtlTV version).`} />
        <Who title="TMDB" status={tmdbKeySet ? 'on' : 'not-set-up'}
          sees="With your TMDB key: the key, your IP address and the lists you browse. Without one, only if GitHub's copy of the match file is unavailable: TMDB's public ID list, with your IP address." />
        <Who title="RatingPosterDB" status={posterDbKeySet ? 'on' : 'not-set-up'}
          sees="With your RPDB key: the key, your IP address and which titles' posters you see." />
        <Who title="ESPN" status={teamLogosEnabled ? 'on' : 'off'}
          sees="With team logos on: your IP address and which teams are playing on the channel you watch."
          note="Settings > Live TV > Guide > Team logos." />
        <Hint>Your internet provider can see which of these sbtlTV connects to, and what you stream when a provider uses plain http. A VPN hides that from your internet provider, though not from the services above.</Hint>
      </Section>
    </SettingsTab>
  );
}
