/**
 * Color palettes: every palette sets the same roles, and tokens.css derives
 * the rest. sbtl is the default (its values are also in palettes.css for the
 * first paint); the others are shtl's dark palettes, from each scheme's
 * official colors. Caelestia's palette comes from the desktop at runtime.
 */

export interface PaletteRoles {
  bg: string;
  card: string;
  surface: string;
  line: string;
  edge: string;
  fg: string;
  muted: string;
  accent: string;
  onAccent: string;
  danger: string;
  teal: string;
  /** Primary buttons on the Movies/Series pages (Play) and their text */
  button: string;
  onButton: string;
  /** Favorite/watchlist hearts: the filled heart (semi-transparent), the pale
      layer under it that keeps it readable on any poster, and its hover.
      Derived from `danger` when a palette does not set them. */
  heart?: string;
  heartBase?: string;
  heartHover?: string;
}

/** Heart tones from one red or pink, matching sbtl's two-layer original. */
function heartTones(hex: string): Pick<PaletteRoles, 'heart' | 'heartBase' | 'heartHover'> {
  return {
    heart: `color-mix(in srgb, ${hex} 80%, transparent)`,
    heartBase: `color-mix(in srgb, ${hex} 40%, white)`,
    heartHover: `color-mix(in srgb, color-mix(in srgb, ${hex} 85%, black) 85%, transparent)`,
  };
}

const HEART_SOURCE: Partial<Record<string, string>> = {
  catppuccin: '#f38ba8', tokyonight: '#f7768e', kanagawa: '#e46876', gruvbox: '#fb4934',
  nord: '#bf616a', rosepine: '#eb6f92', everforest: '#e67e80', dracula: '#ff79c6',
};

export type BuiltInPaletteId = 'sbtl' | 'mocha' | 'pi' | 'catppuccin' | 'tokyonight' | 'kanagawa' | 'gruvbox' | 'nord' | 'rosepine' | 'everforest' | 'dracula';

export const PALETTES: Record<BuiltInPaletteId, { label: string; roles: PaletteRoles }> = {
  sbtl: { label: 'sbtl', roles: {
    bg: '#0d0d0d', card: '#141414', surface: '#1a1a1a', line: 'rgba(255, 255, 255, 0.1)', edge: 'rgba(255, 255, 255, 0.2)',
    fg: '#ffffff', muted: 'rgba(255, 255, 255, 0.5)', accent: '#00d4ff', onAccent: '#0d0d0d', danger: '#ef4444', teal: '#22c55e',
    button: 'rgba(255, 255, 255, 0.85)', onButton: '#0d0d0d',
    heart: 'rgba(220, 60, 60, 0.8)', heartBase: 'rgb(255, 180, 180)', heartHover: 'rgba(200, 50, 50, 0.85)' } },
  // Mocha: a black cat with bright green eyes, and a Halloween cat
  // (pumpkin-orange hearts).
  mocha: { label: 'Mocha', roles: {
    bg: '#0b0a0d', card: '#141218', surface: '#1e1b23', line: '#2d2833', edge: '#3f3846',
    fg: '#ebe6dc', muted: '#8f8798', accent: '#5fe38a', onAccent: '#0b0a0d', danger: '#ff5c5c', teal: '#b48cf2',
    button: '#ebe6dc', onButton: '#0b0a0d',
    heart: 'color-mix(in srgb, #ff7a2f 85%, transparent)', heartBase: '#ffd2b0', heartHover: 'color-mix(in srgb, #e05f16 90%, transparent)' } },
  // Pi: a Russian Blue, silver blue-grey with yellow-green eyes.
  pi: { label: 'Pi', roles: {
    bg: '#14181d', card: '#1b2027', surface: '#252b33', line: '#333a44', edge: '#465059',
    fg: '#e2e8ef', muted: '#8f9aa7', accent: '#cddd86', onAccent: '#14181d', danger: '#e66a6a', teal: '#8db3d6',
    button: '#d3dbe4', onButton: '#14181d',
    heart: 'color-mix(in srgb, #d98aab 85%, transparent)', heartBase: '#f6d6e4', heartHover: 'color-mix(in srgb, #bd6c8e 90%, transparent)' } },
  catppuccin: { label: 'Catppuccin', roles: {
    bg: '#11111b', card: '#1e1e2e', surface: '#313244', line: '#45475a', edge: '#585b70',
    fg: '#cdd6f4', muted: '#9399b2', accent: '#cba6f7', onAccent: '#11111b', danger: '#f38ba8', teal: '#94e2d5',
    button: '#cba6f7', onButton: '#11111b' } },
  tokyonight: { label: 'Tokyo Night', roles: {
    bg: '#16161e', card: '#1a1b26', surface: '#292e42', line: '#3b4261', edge: '#545c7e',
    fg: '#c0caf5', muted: '#737aa2', accent: '#7aa2f7', onAccent: '#16161e', danger: '#f7768e', teal: '#73daca',
    button: '#7aa2f7', onButton: '#16161e' } },
  kanagawa: { label: 'Kanagawa', roles: {
    bg: '#16161d', card: '#1f1f28', surface: '#2a2a37', line: '#363646', edge: '#54546d',
    fg: '#dcd7ba', muted: '#938aa9', accent: '#7e9cd8', onAccent: '#1f1f28', danger: '#e46876', teal: '#7aa89f',
    button: '#7e9cd8', onButton: '#1f1f28' } },
  gruvbox: { label: 'Gruvbox', roles: {
    bg: '#1d2021', card: '#282828', surface: '#3c3836', line: '#504945', edge: '#665c54',
    fg: '#ebdbb2', muted: '#a89984', accent: '#fabd2f', onAccent: '#282828', danger: '#fb4934', teal: '#8ec07c',
    button: '#ebdbb2', onButton: '#282828' } },
  nord: { label: 'Nord', roles: {
    bg: '#242933', card: '#2e3440', surface: '#3b4252', line: '#434c5e', edge: '#4c566a',
    fg: '#eceff4', muted: '#9aa3b5', accent: '#88c0d0', onAccent: '#2e3440', danger: '#bf616a', teal: '#a3be8c',
    button: '#88c0d0', onButton: '#2e3440' } },
  rosepine: { label: 'Rosé Pine', roles: {
    bg: '#191724', card: '#1f1d2e', surface: '#26233a', line: '#403d52', edge: '#524f67',
    fg: '#e0def4', muted: '#908caa', accent: '#ebbcba', onAccent: '#191724', danger: '#eb6f92', teal: '#9ccfd8',
    button: '#ebbcba', onButton: '#191724' } },
  everforest: { label: 'Everforest', roles: {
    bg: '#1e2326', card: '#272e33', surface: '#2e383c', line: '#374145', edge: '#414b50',
    fg: '#d3c6aa', muted: '#9da9a0', accent: '#a7c080', onAccent: '#1e2326', danger: '#e67e80', teal: '#83c092',
    button: '#a7c080', onButton: '#1e2326' } },
  dracula: { label: 'Dracula', roles: {
    bg: '#191a21', card: '#282a36', surface: '#343746', line: '#44475a', edge: '#565970',
    fg: '#f8f8f2', muted: '#a4abcc', accent: '#bd93f9', onAccent: '#191a21', danger: '#ff5555', teal: '#8be9fd',
    button: '#bd93f9', onButton: '#191a21' } },
};

export const PALETTE_ORDER = Object.keys(PALETTES) as BuiltInPaletteId[];

const CSS_NAMES: Record<keyof PaletteRoles, string> = {
  bg: '--bg', card: '--card', surface: '--surface', line: '--line', edge: '--edge', fg: '--fg',
  muted: '--muted', accent: '--accent', onAccent: '--on-accent', danger: '--danger', teal: '--teal',
  button: '--button', onButton: '--on-button',
  heart: '--heart', heartBase: '--heart-base', heartHover: '--heart-hover',
};

/** Set the palette roles on the root element (inline, above palettes.css). */
export function applyPaletteRoles(roles: PaletteRoles, paletteId?: string): void {
  const style = document.documentElement.style;
  const full: PaletteRoles = { ...heartTones(HEART_SOURCE[paletteId ?? ''] ?? roles.danger), ...roles };
  for (const [role, name] of Object.entries(CSS_NAMES)) {
    const value = full[role as keyof PaletteRoles];
    if (value) style.setProperty(name, value);
  }
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Black or white, whichever reads better on `hex` ('#rrggbb'). */
export function readableOn(hex: string): string {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}
