// Subtitle and caption settings: what is stored, and the caption language
// they ask for. No electron imports, so it runs under node:test.

export type SubtitleSize = 'small' | 'medium' | 'large';
export type SubtitleStyle = 'outline' | 'box' | 'shadow';
/** Captions and subtitles language; auto = the system language */
export type CaptionLanguageSetting = 'auto' | 'en' | 'es' | 'fr';
export type CaptionLanguage = 'en' | 'es' | 'fr';
export interface SubtitleSettings {
  liveDefault: boolean;  // live captions on when a channel starts
  vodDefault: boolean;   // movie & series subtitles on when one starts
  size: SubtitleSize;
  style: SubtitleStyle;
  language: CaptionLanguageSetting;
}

const SIZES: readonly SubtitleSize[] = ['small', 'medium', 'large'];
const STYLES: readonly SubtitleStyle[] = ['outline', 'box', 'shadow'];
const LANGUAGES: readonly CaptionLanguageSetting[] = ['auto', 'en', 'es', 'fr'];

export function normalizeSubtitleSettings(value: unknown): SubtitleSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    liveDefault: v.liveDefault === true,
    vodDefault: v.vodDefault === true,
    size: SIZES.find(s => s === v.size) ?? 'medium',
    style: STYLES.find(s => s === v.style) ?? 'outline',
    language: LANGUAGES.find(l => l === v.language) ?? 'auto',
  };
}

/**
 * The language live captions should be in: the setting, or for auto the system
 * language when it is one the caption check can tell apart (US/Canadian
 * broadcast captions are English, Spanish or French). null: no preference.
 */
export function preferredCaptionLanguage(setting: CaptionLanguageSetting, systemLocale: string): CaptionLanguage | null {
  if (setting !== 'auto') return setting;
  const primary = systemLocale.toLowerCase().split(/[-_]/)[0];
  return primary === 'en' || primary === 'es' || primary === 'fr' ? primary : null;
}
