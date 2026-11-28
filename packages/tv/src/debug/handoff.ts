import { File, Paths } from 'expo-file-system';
import type { Source } from '@sbtltv/core';

// DEBUG ONLY (stick test): nothing outside src/debug may import this. It trusts whatever answers on 127.0.0.1:8765,
// which any app on the device could open, so it must never ship in a real build. The owner's test sources come from a
// one-off server on the test computer through `adb reverse tcp:8765 tcp:8765` (Fire OS blocks adb from the app's
// folders, and this needs no debuggable build); they are kept in the app's private documents, never logged or shown.
const HANDOFF = 'http://127.0.0.1:8765';
export async function readTestLogins(): Promise<Source[]> {
  const kept = new File(Paths.document, 'sbtl-test-sources.json');
  let text = kept.exists ? kept.textSync() : '';
  if (!text) {
    const r = await fetch(`${HANDOFF}/logins`).catch(() => null);
    if (!r || !r.ok) throw new Error('test logins missing: run the stick-test handoff server and adb reverse tcp:8765 tcp:8765');
    text = await r.text();
    // Kept for later launches; this run uses the text it fetched (a read right after expo's write can come back empty).
    kept.create({ overwrite: true }); kept.write(text);
  }
  return (JSON.parse(text) as { sources: Source[] }).sources;
}

// Results and the log back to the test computer the same way (best effort; also kept in the app's documents).
export async function sendToTestComputer(name: string, text: string): Promise<void> {
  await fetch(`${HANDOFF}/upload/${encodeURIComponent(name)}`, { method: 'POST', body: text }).catch(() => undefined);
}
