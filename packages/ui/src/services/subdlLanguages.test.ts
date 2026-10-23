import { describe, expect, it } from 'vitest';
import { languageOptions, isoCodesFor, pickerLanguage } from './subdlLanguages';

const LIST = [
  { code: 'en', label: 'English', iso: ['eng'] },
  { code: 'es', label: 'Español', iso: ['spa'] },
  { code: 'fr', label: 'Français', iso: ['fre', 'fra'] },
  { code: 'pt-br', label: 'Português (Brasil)', iso: ['por'] },
];

describe('languageOptions', () => {
  it('without a key: Auto and the three basic languages', () => {
    expect(languageOptions(LIST, false, 'auto').map((o) => o.id)).toEqual(['auto', 'en', 'es', 'fr']);
  });
  it('with a key: Auto and every SubDL language', () => {
    expect(languageOptions(LIST, true, 'auto').map((o) => o.id)).toEqual(['auto', 'en', 'es', 'fr', 'pt-br']);
  });
  it('a stored language beyond the basic three stays listed after the key is removed', () => {
    expect(languageOptions(LIST, false, 'pt-br').map((o) => o.id)).toEqual(['auto', 'en', 'es', 'fr', 'pt-br']);
  });
});

describe('isoCodesFor', () => {
  it('maps a setting to mpv track codes; auto follows the system language', () => {
    expect(isoCodesFor(LIST, 'pt-br', 'en-US')).toEqual(['por']);
    expect(isoCodesFor(LIST, 'auto', 'fr-CA')).toEqual(['fre', 'fra']);
    expect(isoCodesFor(LIST, 'auto', 'pt-BR')).toEqual(['por']);
  });
  it('before the list has loaded, common languages still map to mpv codes', () => {
    expect(isoCodesFor([], 'auto', 'en-US')).toContain('eng');
    expect(isoCodesFor([], 'de', 'en-US')).toContain('ger');
  });
  it('unknown language: the bare code still matches tracks tagged with it', () => {
    expect(isoCodesFor(LIST, 'auto', 'xx-YY')).toEqual(['xx']);
  });
});

describe('locale aliases', () => {
  const ALL = [
    ...LIST,
    { code: 'no', label: 'Norsk', iso: ['nor', 'nob', 'nno'] },
    { code: 'zh-cn', label: '中文 (简体)', iso: ['chi', 'zho'] },
    { code: 'zh-tw', label: '中文 (繁體)', iso: ['chi', 'zho'] },
  ];
  it('Norwegian and Chinese system locales map to SubDL languages', () => {
    expect(pickerLanguage(ALL, 'auto', 'nb-NO')).toBe('no');
    expect(pickerLanguage(ALL, 'auto', 'nn')).toBe('no');
    expect(pickerLanguage(ALL, 'auto', 'zh-HK')).toBe('zh-tw');
    expect(pickerLanguage(ALL, 'auto', 'zh-Hant-TW')).toBe('zh-tw');
    expect(pickerLanguage(ALL, 'auto', 'zh-SG')).toBe('zh-cn');
    expect(pickerLanguage(ALL, 'auto', 'zh')).toBe('zh-cn');
    expect(isoCodesFor(ALL, 'auto', 'nb-NO')).toContain('nob');
  });
});
