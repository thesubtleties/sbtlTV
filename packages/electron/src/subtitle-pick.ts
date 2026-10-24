// Which SubDL results to try first. Pure.
//   1. episodes: only files for the wanted episode; single-episode uploads before season packs
//   2. the chosen language
//   3. human-made before AI-translated
//   4. SDH or standard, as the setting prefers
//   5. popularity when SubDL gives one; otherwise SubDL's own order
import type { SubdlResult } from './subdl-client.js';
import { subdlCode } from './subtitle-languages.js';

export interface PickPrefs { language: string; preferSdh: boolean; season?: number; episode?: number }

export function rankResults(results: SubdlResult[], prefs: PickPrefs): SubdlResult[] {
  const want = (subdlCode(prefs.language) ?? prefs.language).toLowerCase();
  const episodic = prefs.season != null && prefs.episode != null;
  const usable = episodic
    ? results.filter((r) => (r.season === null || r.season === prefs.season) && r.episode === prefs.episode)
    : results;
  const score = (r: SubdlResult) => [
    episodic && r.pack ? 1 : 0,
    r.language === want || r.language === prefs.language ? 0 : 1,
    r.ai ? 1 : 0,
    r.hi === prefs.preferSdh ? 0 : 1,
    -(r.popularity ?? 0),
  ];
  return usable
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => {
      for (let k = 0; k < a.s.length; k++) if (a.s[k] !== b.s[k]) return a.s[k] - b.s[k];
      return a.i - b.i;
    })
    .map((x) => x.r);
}
