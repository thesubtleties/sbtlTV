/**
 * One sbtlTV per profile. A second copy on the same profile can't open the page's database
 * (Continue Watching and the watchlist come up empty) and runs sync as the same computer.
 * Electron's lock is per profile, so copies with their own --user-data-dir never meet.
 *
 * A copy that doesn't get the lock keeps asking for a while before giving up: the Linux
 * updater starts the new AppImage before the old one has quit, and a restart can overlap the
 * old process's exit. Each failed ask focuses the running copy, so a plain second launch
 * still brings the open window forward at once.
 *
 * The wait blocks on purpose: startup code after the check (the keyring switch) must run
 * before Electron is ready, and a blocked thread can't become ready.
 */
const sleepBlocking = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

export function holdSingleInstance(opts: {
  argv: string[];
  requestLock: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => void;
  waitMs?: number;
  stepMs?: number;
}): boolean {
  // Dev runs (electron . --dev) stay free to start side by side
  if (opts.argv.includes('--dev')) return true;
  if (opts.requestLock()) return true;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? sleepBlocking;
  const waitMs = opts.waitMs ?? 10_000;
  const stepMs = opts.stepMs ?? 500;
  const until = now() + waitMs;
  while (now() < until) {
    sleep(stepMs);
    if (opts.requestLock()) return true;
  }
  return false;
}
