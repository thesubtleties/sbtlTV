import fs from 'node:fs';
import path from 'node:path';

const PATTERN = /^before-import-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.sbtltv$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

export const CACHE_RESET_MARKER = 'reset-cache-on-start';
export const PENDING_PLAYLISTS = 'pending-playlists.json';

export function backupName(now: Date): string {
  return `before-import-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}.sbtltv`;
}

export function backupLabel(name: string): string | null {
  const m = PATTERN.exec(name);
  return m ? `Before import, ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[4]}:${m[5]}` : null;
}

export function backupsToPrune(names: string[], keep = 3): string[] {
  const backups = names.filter((n) => PATTERN.test(n)).sort();  // the name sorts by time
  return backups.slice(0, Math.max(0, backups.length - keep));
}

/** After an import: the guide/library cache belongs to the old sources, so it goes before the data process opens it. */
export function resetCacheIfMarked(userData: string): boolean {
  const marker = path.join(userData, CACHE_RESET_MARKER);
  if (!fs.existsSync(marker)) return false;
  for (const f of ['sbtltv-data.sqlite', 'sbtltv-data.sqlite-wal', 'sbtltv-data.sqlite-shm']) fs.rmSync(path.join(userData, f), { force: true });
  fs.rmSync(marker, { force: true });
  return true;
}
