/**
 * Subtitle languages (the list comes from main: SUBTITLE_LANGUAGES). Without a
 * SubDL key Settings offers the three basic languages; with one, every
 * language SubDL has. Pure, for unit tests.
 */
import type { SubdlLanguage } from '../types/electron';
import { isoForPrimary } from './subtitleLogic';

const BASIC = ['en', 'es', 'fr'];

export function languageOptions(list: SubdlLanguage[], keySet: boolean, current: string): Array<{ id: string; label: string }> {
  const shown = list.filter((l) => keySet || BASIC.includes(l.code) || l.code === current);
  return [{ id: 'auto', label: 'Auto' }, ...shown.map((l) => ({ id: l.code, label: l.label }))];
}

/** System locales whose usual tag is not the one SubDL lists. */
function aliasLocale(locale: string): string {
  if (locale === 'nb' || locale === 'nn' || locale.startsWith('nb-') || locale.startsWith('nn-')) return 'no';
  if (locale.startsWith('zh-hant') || locale === 'zh-hk' || locale === 'zh-mo' || locale === 'zh-tw') return 'zh-tw';
  if (locale.startsWith('zh')) return 'zh-cn';
  return locale;
}

/** The system locale as a subtitle language code (en-US -> en, pt-BR -> pt-br, nb-NO -> no), or its bare primary code. */
export function localeLanguage(list: SubdlLanguage[], systemLocale: string): string {
  const locale = aliasLocale(systemLocale.toLowerCase().replace(/_/g, '-'));
  const primary = locale.split('-')[0];
  return (list.find((l) => l.code === locale) ?? list.find((l) => l.code === primary))?.code ?? primary;
}

/** mpv track codes (ISO 639-2) for the language setting; auto = the system language. */
export function isoCodesFor(list: SubdlLanguage[], setting: string, systemLocale: string): string[] {
  const code = setting === 'auto' ? localeLanguage(list, systemLocale) : setting;
  const entry = list.find((l) => l.code === code);
  return entry ? entry.iso : isoForPrimary(code.split('-')[0]);
}

/** The settings code for the language the picker should start on. */
export function pickerLanguage(list: SubdlLanguage[], setting: string, systemLocale: string): string {
  if (setting !== 'auto') return setting;
  const code = localeLanguage(list, systemLocale);
  return list.some((l) => l.code === code) ? code : 'en';
}
