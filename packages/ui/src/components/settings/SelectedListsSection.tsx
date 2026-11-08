import { OnOff, OptionRow, Section } from './ui';
import { useSelectedListsEnabled, useUpdateSettings } from '../../stores/uiStore';

/** One switch for both homes; shown on the Movies and the Series tab. */
export function SelectedListsSection() {
  const enabled = useSelectedListsEnabled();
  const updateSettings = useUpdateSettings();
  async function set(on: boolean) {
    updateSettings({ selectedListsEnabled: on });
    await window.storage?.updateSettings({ selectedListsEnabled: on });
  }
  return (
    <Section
      title="Selected lists"
      description="Rows chosen by the sbtlTV developer and matched to your library. Checked about once a day from sbtltv.com."
    >
      <OptionRow title="Show Selected rows" help="On the Movies and Series homes. Off: sbtltv.com is never asked.">
        <OnOff value={enabled} onChange={(on) => void set(on)} />
      </OptionRow>
    </Section>
  );
}
