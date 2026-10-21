// Subtitle and caption settings: what is stored, and the caption language
// they ask for. No electron imports, so it runs under node:test.

import { languageByCode } from './subtitle-languages.js';

export type SubtitleSize = 'small' | 'medium' | 'large';
export type SubtitleStyle = 'outline' | 'box' | 'shadow';
/** Captions and subtitles language: auto = the system language, else a SUBTITLE_LANGUAGES code */
export type CaptionLanguageSetting = string;
export type CaptionLanguage = 'en' | 'es' | 'fr';
export interface SubtitleSettings {
  liveDefault: boolean;  // live captions on when a channel starts
  vodDefault: boolean;   // movie & series subtitles on when one starts
  size: SubtitleSize;
  style: SubtitleStyle;
  language: CaptionLanguageSetting;
  preferSdh: boolean;  // downloaded subtitles: SDH (sound cues) over standard
}

const SIZES: readonly SubtitleSize[] = ['small', 'medium', 'large'];
const STYLES: readonly SubtitleStyle[] = ['outline', 'box', 'shadow'];

export function normalizeSubtitleSettings(value: unknown): SubtitleSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    liveDefault: v.liveDefault === true,
    vodDefault: v.vodDefault === true,
    size: SIZES.find(s => s === v.size) ?? 'medium',
    style: STYLES.find(s => s === v.style) ?? 'outline',
    language: typeof v.language === 'string' && (v.language === 'auto' || languageByCode(v.language)) ? v.language : 'auto',
    preferSdh: v.preferSdh === true,
  };
}

/**
 * The language live captions should be in: the setting, or for auto the system
 * language when it is one the caption check can tell apart (US/Canadian
 * broadcast captions are English, Spanish or French). null: no preference.
 */
export function preferredCaptionLanguage(setting: CaptionLanguageSetting, systemLocale: string): CaptionLanguage | null {
  const code = setting === 'auto' ? systemLocale.toLowerCase().split(/[-_]/)[0] : setting;
  return code === 'en' || code === 'es' || code === 'fr' ? code : null;
}
