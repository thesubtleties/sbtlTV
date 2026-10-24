/**
 * Whether a saved secret was sealed by a keyring (Chromium's encrypted values
 * start with "v10"/"v11"). While the system offers no encryption, storage.ts
 * reads saved secrets as plain base64, which turns such a value into garbage: an
 * export or a backup must refuse instead of carrying that garbage as the login.
 */
export function isKeyringSealed(base64: string): boolean {
  const prefix = Buffer.from(base64, 'base64').subarray(0, 3).toString('latin1');
  return prefix === 'v10' || prefix === 'v11';
}
