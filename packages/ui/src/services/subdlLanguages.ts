/**
 * Subtitle languages (the list comes from main: SUBTITLE_LANGUAGES). Without a
 * SubDL key Settings offers the three basic languages; with one, every
 * language SubDL has. Pure, for unit tests.
 */
import type { SubdlLanguage } from '../types/electron';

const BASIC = ['en', 'es', 'fr'];

export function languageOptions(list: SubdlLanguage[], keySet: boolean, current: string): Array<{ id: string; label: string }> {
  const shown = list.filter((l) => keySet || BASIC.includes(l.code) || l.code === current);
  return [{ id: 'auto', label: 'Auto' }, ...shown.map((l) => ({ id: l.code, label: l.label }))];
}

/** mpv track codes (ISO 639-2) for the language setting; auto = the system language. */
export function isoCodesFor(list: SubdlLanguage[], setting: string, systemLocale: string): string[] {
  const locale = systemLocale.toLowerCase().replace('_', '-');
  const code = setting === 'auto' ? locale : setting;
  const primary = code.split('-')[0];
  const entry = list.find((l) => l.code === code) ?? list.find((l) => l.code === primary);
  return entry ? entry.iso : [primary];
}

/** The settings code for the language the picker should start on. */
export function pickerLanguage(list: SubdlLanguage[], setting: string, systemLocale: string): string {
  if (setting !== 'auto') return setting;
  const locale = systemLocale.toLowerCase().replace('_', '-');
  return (list.find((l) => l.code === locale) ?? list.find((l) => l.code === locale.split('-')[0]))?.code ?? 'en';
}
