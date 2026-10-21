import { describe, expect, it } from 'vitest';
import { languageOptions, isoCodesFor } from './subdlLanguages';

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
  it('unknown language: the bare code still matches tracks tagged with it', () => {
    expect(isoCodesFor(LIST, 'auto', 'xx-YY')).toEqual(['xx']);
  });
});
