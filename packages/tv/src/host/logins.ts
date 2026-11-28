import { File, Paths } from 'expo-file-system';
import type { Source } from '@sbtltv/core';
// The owner's test sources, pushed with adb into the app's private files (never logged, never in the repo).
export function readTestLogins(): Source[] {
  const f = new File(Paths.document, 'sbtl-test-sources.json');
  if (!f.exists) throw new Error('sbtl-test-sources.json missing: push it with adb (see the stick-test spec)');
  return (JSON.parse(f.textSync()) as { sources: Source[] }).sources;
}
