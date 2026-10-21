// Languages subtitles can be in. code: what settings store (lowercase);
// subdl: SubDL's language code; iso: what mpv reports for embedded tracks
// (ISO 639-2). No electron imports, so it runs under node:test.

export interface SubtitleLanguage { code: string; subdl: string; label: string; iso: string[] }

export const BASIC_LANGUAGE_CODES = ['en', 'es', 'fr'] as const;

export const SUBTITLE_LANGUAGES: readonly SubtitleLanguage[] = [
  { code: 'en', subdl: 'EN', label: 'English', iso: ['eng'] },
  { code: 'es', subdl: 'ES', label: 'Español', iso: ['spa'] },
  { code: 'fr', subdl: 'FR', label: 'Français', iso: ['fre', 'fra'] },
  { code: 'ar', subdl: 'AR', label: 'العربية', iso: ['ara'] },
  { code: 'pt-br', subdl: 'BR_PT', label: 'Português (Brasil)', iso: ['por'] },
  { code: 'pt', subdl: 'PT', label: 'Português', iso: ['por'] },
  { code: 'de', subdl: 'DE', label: 'Deutsch', iso: ['ger', 'deu'] },
  { code: 'it', subdl: 'IT', label: 'Italiano', iso: ['ita'] },
  { code: 'nl', subdl: 'NL', label: 'Nederlands', iso: ['dut', 'nld'] },
  { code: 'sv', subdl: 'SV', label: 'Svenska', iso: ['swe'] },
  { code: 'da', subdl: 'DA', label: 'Dansk', iso: ['dan'] },
  { code: 'no', subdl: 'NO', label: 'Norsk', iso: ['nor', 'nob', 'nno'] },
  { code: 'fi', subdl: 'FI', label: 'Suomi', iso: ['fin'] },
  { code: 'pl', subdl: 'PL', label: 'Polski', iso: ['pol'] },
  { code: 'cs', subdl: 'CS', label: 'Čeština', iso: ['cze', 'ces'] },
  { code: 'ro', subdl: 'RO', label: 'Română', iso: ['rum', 'ron'] },
  { code: 'hu', subdl: 'HU', label: 'Magyar', iso: ['hun'] },
  { code: 'el', subdl: 'EL', label: 'Ελληνικά', iso: ['gre', 'ell'] },
  { code: 'tr', subdl: 'TR', label: 'Türkçe', iso: ['tur'] },
  { code: 'ru', subdl: 'RU', label: 'Русский', iso: ['rus'] },
  { code: 'uk', subdl: 'UK', label: 'Українська', iso: ['ukr'] },
  { code: 'bg', subdl: 'BG', label: 'Български', iso: ['bul'] },
  { code: 'hr', subdl: 'HR', label: 'Hrvatski', iso: ['hrv'] },
  { code: 'sr', subdl: 'SR', label: 'Srpski', iso: ['srp'] },
  { code: 'sl', subdl: 'SL', label: 'Slovenščina', iso: ['slv'] },
  { code: 'he', subdl: 'HE', label: 'עברית', iso: ['heb'] },
  { code: 'fa', subdl: 'FA', label: 'فارسی', iso: ['per', 'fas'] },
  { code: 'hi', subdl: 'HI', label: 'हिन्दी', iso: ['hin'] },
  { code: 'bn', subdl: 'BN', label: 'বাংলা', iso: ['ben'] },
  { code: 'ur', subdl: 'UR', label: 'اردو', iso: ['urd'] },
  { code: 'id', subdl: 'ID', label: 'Bahasa Indonesia', iso: ['ind'] },
  { code: 'ms', subdl: 'MS', label: 'Bahasa Melayu', iso: ['may', 'msa'] },
  { code: 'vi', subdl: 'VI', label: 'Tiếng Việt', iso: ['vie'] },
  { code: 'th', subdl: 'TH', label: 'ไทย', iso: ['tha'] },
  { code: 'zh-cn', subdl: 'ZH', label: '中文 (简体)', iso: ['chi', 'zho'] },
  { code: 'zh-tw', subdl: 'ZH_BG', label: '中文 (繁體)', iso: ['chi', 'zho'] },
  { code: 'ja', subdl: 'JA', label: '日本語', iso: ['jpn'] },
  { code: 'ko', subdl: 'KO', label: '한국어', iso: ['kor'] },
  { code: 'is', subdl: 'IS', label: 'Íslenska', iso: ['ice', 'isl'] },
  { code: 'et', subdl: 'ET', label: 'Eesti', iso: ['est'] },
];

const BY_CODE = new Map(SUBTITLE_LANGUAGES.map((l) => [l.code, l]));

export function languageByCode(code: string): SubtitleLanguage | undefined {
  return BY_CODE.get(code);
}

/** SubDL's code for a stored language; null for auto or an unknown code. */
export function subdlCode(code: string): string | null {
  return BY_CODE.get(code)?.subdl ?? null;
}
