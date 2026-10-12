import { useUpdateSettings } from '../../stores/uiStore';
import { OnOff, OptionRow, Section, SettingsTab } from './ui';

interface SecurityTabProps {
  allowLanSources: boolean;
  onAllowLanSourcesChange: (enabled: boolean) => void;
}

export function SecurityTab({
  allowLanSources,
  onAllowLanSourcesChange,
}: SecurityTabProps) {
  const updateSettings = useUpdateSettings();

  async function handleAllowLanChange(enabled: boolean) {
    onAllowLanSourcesChange(enabled);
    updateSettings({ allowLanSources: enabled });
    if (!window.storage) return;
    await window.storage.updateSettings({ allowLanSources: enabled });
  }

  return (
    <SettingsTab>
      <Section
        title="Network"
        description="By default sbtlTV blocks requests to local network addresses, so a malicious playlist cannot probe your internal network (SSRF protection)."
      >
        <OptionRow
          title="LAN sources"
          help={allowLanSources
            ? 'Requests to your local network are allowed. Keep this only for playlists you trust.'
            : 'Blocked: localhost, 127.x.x.x, 10.x.x.x, 172.16-31.x.x, 192.168.x.x, and cloud metadata endpoints (169.254.x.x). Allow this if your provider runs on your network (Plex, Jellyfin, a NAS).'}
        >
          <OnOff
            value={allowLanSources}
            offLabel="Blocked"
            onLabel="Allowed"
            onChange={(enabled) => void handleAllowLanChange(enabled)}
          />
        </OptionRow>
      </Section>
    </SettingsTab>
  );
}
