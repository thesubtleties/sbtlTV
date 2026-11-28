export interface SelfTest { name: string; run: () => void | Promise<void> }
export interface SelfTestSuite { name: string; tests: SelfTest[] }
export interface SelfTestResult { suite: string; name: string; ok: boolean; error?: string; ms: number }

export function assertEq(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

export async function runSelfTests(suites: SelfTestSuite[]): Promise<SelfTestResult[]> {
  const out: SelfTestResult[] = [];
  for (const s of suites) for (const t of s.tests) {
    const t0 = Date.now();
    try { await t.run(); out.push({ suite: s.name, name: t.name, ok: true, ms: Date.now() - t0 }); }
    catch (e) { if (e instanceof Error && e.stack) console.log('SELFTEST-STACK ' + t.name + ' ' + e.stack.split('\n').slice(0, 6).join(' | ')); out.push({ suite: s.name, name: t.name, ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }); }
  }
  console.log('SELFTEST ' + JSON.stringify({ passed: out.filter((r) => r.ok).length, failed: out.filter((r) => !r.ok) }));
  return out;
}
