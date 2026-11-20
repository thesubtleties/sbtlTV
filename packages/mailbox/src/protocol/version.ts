export const VERSION_HEADER = 'x-sbtltv-version';

/** major.minor.patch compared as numbers; anything after "-" ignored. Unparseable = false. */
export function versionAtLeast(v: string, min: string): boolean {
  const parse = (s: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(s);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parse(v), b = parse(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
