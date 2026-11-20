/** The look (Settings › Appearance): palette, typeface, accent, Movies & Series header. No Electron here, so it tests in plain Node. */
export const PALETTES = ['sbtl', 'sbtl-light', 'mocha', 'pi', 'catppuccin', 'tokyonight', 'kanagawa', 'gruvbox', 'nord', 'rosepine', 'everforest', 'dracula', 'caelestia'] as const;
export const TYPEFACES = ['fira', 'mono', 'system'] as const;
export const ACCENTS = ['palette', 'system'] as const;
export const HEADERS = ['simple', 'floating'] as const;
export interface Appearance {
  palette: (typeof PALETTES)[number];
  typeface: (typeof TYPEFACES)[number];
  accent: (typeof ACCENTS)[number];  // 'system' takes the OS accent where there is one
  header: (typeof HEADERS)[number];  // Movies & Series header: 'simple' tabs (default) or the 'floating' capsule
}

export function normalizeAppearance(value: Partial<Appearance> | undefined): Appearance {
  const palette = PALETTES.find(p => p === value?.palette) ?? 'sbtl';
  const typeface = TYPEFACES.find(t => t === value?.typeface) ?? 'fira';
  const accent = ACCENTS.find(a => a === value?.accent) ?? 'palette';
  const header = HEADERS.find(h => h === value?.header) ?? 'simple';
  return { palette, typeface, accent, header };
}
