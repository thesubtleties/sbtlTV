import { useEffect, useState } from 'react';
import { useUIStore } from '../stores/uiStore';
import type { SubdlLanguage } from '../types/electron';

let cached: SubdlLanguage[] | null = null;
let pending: Promise<SubdlLanguage[]> | null = null;

/** The subtitle language list from main (fetched once per session). */
export function loadSubdlLanguages(): Promise<SubdlLanguage[]> {
  if (cached) return Promise.resolve(cached);
  pending ??= (window.subdl?.languages() ?? Promise.resolve([])).then((list) => (cached = list));
  return pending;
}

export function subdlLanguagesNow(): SubdlLanguage[] {
  return cached ?? [];
}

export function useSubdlLanguages(): SubdlLanguage[] {
  const [list, setList] = useState<SubdlLanguage[]>(cached ?? []);
  useEffect(() => {
    let alive = true;
    void loadSubdlLanguages().then((l) => { if (alive) setList(l); });
    return () => { alive = false; };
  }, []);
  return list;
}

/** A SubDL key is saved. */
export function useSubdlKeySet(): boolean {
  return useUIStore((s) => (s.settings.subdlApiKey ?? '').trim().length > 0);
}
