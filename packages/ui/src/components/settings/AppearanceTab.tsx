import { useUIStore, useUpdateSettings } from '../../stores/uiStore';
import { useDesktopColors } from '../../hooks/useCssVariableSync';
import { PALETTES, PALETTE_ORDER, type PaletteRoles } from '../../styles/palettes';
import type { Appearance, PaletteId } from '../../types/electron';
import { OptionRow, Segmented, SettingsTab } from './ui';
import './AppearanceTab.css';
import { saveSettings } from '../../utils/saveSettings';

const DEFAULT_APPEARANCE: Appearance = { palette: 'sbtl', typeface: 'fira', accent: 'palette' };

const TYPEFACES: { id: Appearance['typeface']; label: string; help: string }[] = [
  { id: 'fira', label: 'Fira Sans', help: 'Fira Sans everywhere, the same on every system.' },
  { id: 'mono', label: 'Mono', help: 'JetBrains Mono everywhere, for a terminal look.' },
  { id: 'system', label: 'System', help: "Your system's interface font." },
];

function PaletteTile({ label, roles, selected, onSelect }: {
  label: string;
  roles: PaletteRoles;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`palette-tile${selected ? ' palette-tile--on' : ''}`}
      style={{ background: selected ? undefined : roles.card }}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="palette-tile__label" style={{ color: selected ? undefined : roles.fg }}>{label}</span>
      <span className="palette-tile__swatch">
        {[roles.card, roles.surface, roles.fg, roles.accent, roles.teal, roles.danger].map((color, index) => (
          <span key={index} style={{ background: color }} />
        ))}
      </span>
    </button>
  );
}

export function AppearanceTab() {
  const appearance = useUIStore((s) => s.settings.appearance) ?? DEFAULT_APPEARANCE;
  const updateSettings = useUpdateSettings();
  const desktop = useDesktopColors();
  const isLinux = !!window.platform?.isLinux;

  function save(partial: Partial<Appearance>) {
    const next = { ...appearance, ...partial };
    updateSettings({ appearance: next });
    void saveSettings({ appearance: next });
  }

  const selectPalette = (palette: PaletteId) => save({ palette });
  const paletteLabel = appearance.palette === 'caelestia' ? 'Caelestia' : PALETTES[appearance.palette].label;
  const caelestiaMissing = appearance.palette === 'caelestia' && desktop && !desktop.caelestia;

  return (
    <SettingsTab className="appearance-tab">
      <OptionRow
        title="Colors"
        help={
          <>
            {caelestiaMissing
              ? "Caelestia's palette isn't available right now, so sbtl's colors are showing."
              : appearance.palette === 'caelestia'
                ? "Following Caelestia: the colors change with your wallpaper."
                : `${paletteLabel}${appearance.palette === 'sbtl' ? ", the original look." : '.'}`}
            {isLinux && (
              <span className="opt-row__note">
                Following the desktop works with Caelestia for now. Using another shell? Ask for it on GitHub.
              </span>
            )}
          </>
        }
      >
        <div className="palette-tiles">
          {PALETTE_ORDER.map((id) => (
            <PaletteTile
              key={id}
              label={PALETTES[id].label}
              roles={PALETTES[id].roles}
              selected={appearance.palette === id}
              onSelect={() => selectPalette(id)}
            />
          ))}
          {desktop?.caelestia && (
            <PaletteTile
              label="Caelestia"
              roles={desktop.caelestia}
              selected={appearance.palette === 'caelestia'}
              onSelect={() => selectPalette('caelestia')}
            />
          )}
        </div>
      </OptionRow>

      {desktop?.accent && (
        <OptionRow
          title="Accent"
          help={appearance.accent === 'system'
            ? "Your system's accent color, on the palette's other colors."
            : "The palette's own accent."}
        >
          <Segmented
            value={appearance.accent}
            options={[{ id: 'palette', label: 'Palette' }, { id: 'system', label: 'System' }]}
            onChange={(accent) => save({ accent })}
          />
        </OptionRow>
      )}

      <OptionRow title="Typeface" help={TYPEFACES.find((t) => t.id === appearance.typeface)?.help}>
        <Segmented
          value={appearance.typeface}
          options={TYPEFACES.map(({ id, label }) => ({ id, label }))}
          onChange={(typeface) => save({ typeface })}
        />
      </OptionRow>
    </SettingsTab>
  );
}
