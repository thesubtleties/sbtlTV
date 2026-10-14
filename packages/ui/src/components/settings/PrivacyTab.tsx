import { useState } from 'react';
import { Button, Hint, Section, SettingsTab } from './ui';
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
  | { state: 'done'; data: NonNullable<Awaited<ReturnType<NonNullable<Window['privacy']>['checkIp']>>['data']> }
  | { state: 'failed'; error: string };

/** Who can see what when sbtlTV is used, from what it actually connects to. */
export function PrivacyTab({ tmdbKeySet, posterDbKeySet, teamLogosEnabled, autoUpdateEnabled, debugLoggingEnabled }: PrivacyTabProps) {
  const [ipCheck, setIpCheck] = useState<IpCheck>({ state: 'idle' });

  async function checkIp() {
    if (!window.privacy) return;
    setIpCheck({ state: 'checking' });
    try {
      const result = await window.privacy.checkIp();
      setIpCheck(result.data ? { state: 'done', data: result.data } : { state: 'failed', error: result.error ?? 'No answer' });
    } catch (error) {
      setIpCheck({ state: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }

  const place = ipCheck.state === 'done' ? [ipCheck.data.city, ipCheck.data.country].filter(Boolean).join(', ') : '';

  return (
    <SettingsTab>
      <Section
        title="Who sees what"
        description="sbtlTV has no server of its own: no account, analytics, telemetry or crash reporting. Everything below happens directly between this computer and the service named."
      >
        <Who title="Your IPTV provider" status="always"
          sees="Your IP address, your account, and every channel and title you play, with times. They are the stream." />
        <Who title="Guide sources" status="always"
          sees="Your IP address and when the guide refreshes: your provider's guide, and any guide URLs you add." />
        <Who title="Image hosts" status="always"
          sees="Channel logos and posters load from the addresses in your provider's data and from TMDB's image server; each sees your IP address and which images." />
        <Who title="GitHub" status="always"
          sees={`The movie and series match file downloaded with a library sync (no account), and ${autoUpdateEnabled ? 'the update check at launch (your IP address, sbtlTV version and system).' : 'update checks, which are off (Settings > About).'}`} />
        <Who title="TMDB" status={tmdbKeySet ? 'on' : 'not-set-up'}
          sees="With your TMDB key: the key, your IP address and the lists you browse (trending, popular, genres)." />
        <Who title="RatingPosterDB" status={posterDbKeySet ? 'on' : 'not-set-up'}
          sees="With your RPDB key: the key, your IP address and which titles' posters you see." />
        <Who title="ESPN" status={teamLogosEnabled ? 'on' : 'off'}
          sees="With team logos on: your IP address and which teams are playing on the channel you watch."
          note="Settings > EPG > Team logos." />
      </Section>

      <Section title="On this computer only">
        <Hint>Your settings, watch history, favorites, watchlist, guide and library stay on this computer. Provider passwords and API keys are encrypted with your system's keychain.</Hint>
        <Hint>
          {debugLoggingEnabled
            ? 'The debug log is on: it is written on this computer only, with stream links cut to their host (they carry provider passwords).'
            : 'The debug log is off.'}
        </Hint>
        <Hint>Many providers stream over plain http, so your internet provider can see what you stream. A VPN hides that from your internet provider, but not from your IPTV provider.</Hint>
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
            <Hint>This is the address your provider and the services above see. Streams take the same route unless you send apps through different connections.</Hint>
          </div>
        )}
        {ipCheck.state === 'failed' && <Hint tone="warn">{ipCheck.error}</Hint>}
      </Section>
    </SettingsTab>
  );
}
