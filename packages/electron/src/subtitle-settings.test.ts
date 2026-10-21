import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSubtitleSettings, preferredCaptionLanguage } from './subtitle-settings.js';

test('settings default to off, medium, outline, auto language', () => {
  for (const value of [undefined, null, 'x', 42, {}]) {
    assert.deepEqual(normalizeSubtitleSettings(value), { liveDefault: false, vodDefault: false, size: 'medium', style: 'outline', language: 'auto', preferSdh: false });
  }
});

test('settings keep valid values and drop invalid ones', () => {
  assert.deepEqual(
    normalizeSubtitleSettings({ liveDefault: true, vodDefault: 'yes', size: 'large', style: 'neon', language: 'es' }),
    { liveDefault: true, vodDefault: false, size: 'large', style: 'outline', language: 'es', preferSdh: false },
  );
  assert.equal(normalizeSubtitleSettings({ language: 'zz' }).language, 'auto');
});

test('caption language: auto follows the system language when it is one we can tell apart', () => {
  assert.equal(preferredCaptionLanguage('auto', 'en-US'), 'en');
  assert.equal(preferredCaptionLanguage('auto', 'es-MX'), 'es');
  assert.equal(preferredCaptionLanguage('auto', 'fr-CA'), 'fr');
  assert.equal(preferredCaptionLanguage('auto', 'de-DE'), null);   // no preference: any real captions
  assert.equal(preferredCaptionLanguage('es', 'en-US'), 'es');
});

test('language: any known code survives, unknown falls back to auto; preferSdh defaults false', () => {
  assert.equal(normalizeSubtitleSettings({ language: 'pt-br' }).language, 'pt-br');
  assert.equal(normalizeSubtitleSettings({ language: 'zz' }).language, 'auto');
  assert.equal(normalizeSubtitleSettings({}).preferSdh, false);
  assert.equal(normalizeSubtitleSettings({ preferSdh: true }).preferSdh, true);
});

test('live captions only prefer en/es/fr; another language means no preference', () => {
  assert.equal(preferredCaptionLanguage('es', 'en-US'), 'es');
  assert.equal(preferredCaptionLanguage('pt-br', 'en-US'), null);
});
