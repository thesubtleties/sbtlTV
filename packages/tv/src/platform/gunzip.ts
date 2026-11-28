import type { Files, Gunzip } from '@sbtltv/data';
type NativeGunzip = { gunzipFile(src: string, dest: string, maxBytes: number): Promise<void> };
export function makeGunzip(native: NativeGunzip, files: Pick<Files, 'remove'>): Gunzip {
  return {
    async gunzipFile(src, dest, { maxBytes, label }) {
      try { await native.gunzipFile(src, dest, maxBytes); }
      catch (e) { files.remove(dest); if ((e as { code?: string }).code === 'ERR_SIZE_CAP') throw new Error(`${label} exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`); throw e; }
    },
  };
}
