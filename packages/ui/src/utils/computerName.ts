/** The name a computer gets when "Name this computer" is left blank (same rule as the sync engine's uniqueName). */
export function nameIfBlank(base: string, taken: string[], max = 40): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const n = `${base.slice(0, max - String(i).length - 1).trimEnd()} ${i}`;
    if (!taken.includes(n)) return n;
  }
}
