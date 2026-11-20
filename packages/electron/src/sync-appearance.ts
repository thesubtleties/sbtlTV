/**
 * Look settings from another computer, fitted to this one: a palette read from this desktop's shell
 * (Caelestia) or the desktop's own accent can't be copied to a computer that doesn't have them, so
 * for those parts this computer keeps its own choice. A look from an older app has no Movies & Series
 * header in it: this computer keeps its own.
 */
export interface AppearanceLike { palette?: string; typeface?: string; accent?: string; header?: string }

export function fitAppearance<T extends AppearanceLike>(incoming: T, local: AppearanceLike, has: { caelestia: boolean; accent: boolean }): T {
  const out = { ...incoming };
  if (out.header === undefined && local.header !== undefined) out.header = local.header;
  if (out.palette === 'caelestia' && !has.caelestia) out.palette = local.palette && local.palette !== 'caelestia' ? local.palette : 'sbtl';
  if (out.accent === 'system' && !has.accent) out.accent = local.accent && local.accent !== 'system' ? local.accent : 'palette';
  return out;
}
