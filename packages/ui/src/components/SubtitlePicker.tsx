import { useEffect, useRef, useState } from 'react';
import { useSubtitleStore, type SubdlLoadInfo } from '../stores/subtitleStore';
import { useSubdlLanguages } from '../hooks/useSubdlLanguages';
import { subdlStatusText } from '../services/subtitleLogic';
import type { SubdlFailure, SubdlResultInfo, SubdlUsageInfo } from '../types/electron';
import { AiMark } from './AiMark';
import './SubtitlePicker.css';

const LANG_KEY = 'sbtl.subdlPickerLanguage';

function storedLanguage(): string | null {
  try { return localStorage.getItem(LANG_KEY); } catch { return null; }
}
function storeLanguage(code: string): void {
  try { localStorage.setItem(LANG_KEY, code); } catch { /* private window: not remembered */ }
}

function failureText(error: SubdlFailure): string {
  if (error === 'quota' || error === 'not-found' || error === 'auth') return subdlStatusText(error)!;
  return "SubDL didn't answer. Try again in a moment.";
}

/** CC menu > Find subtitles...: SubDL results for this movie or episode; playback keeps going. */
export function SubtitlePicker() {
  const open = useSubtitleStore((s) => s.pickerOpen);
  const subdl = useSubtitleStore((s) => s.subdl);
  if (!open || !subdl) return null;
  return <PickerPanel subdl={subdl} />;
}

function PickerPanel({ subdl }: { subdl: SubdlLoadInfo }) {
  const languages = useSubdlLanguages();
  const [language, setLanguage] = useState(() => storedLanguage() ?? subdl.language);
  const [results, setResults] = useState<SubdlResultInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [usage, setUsage] = useState<SubdlUsageInfo | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = useSubtitleStore((s) => (s.selectedId !== null ? s.downloaded[s.selectedId]?.nId : undefined));

  useEffect(() => {
    let alive = true;
    setResults(null);
    setError(null);
    setFocus(0);
    void window.subdl?.find(subdl.title, language).then((r) => {
      if (!alive) return;
      if (r.error) setError(failureText(r.error));
      else if (!r.results?.length) setError('No subtitles found on SubDL');
      setResults(r.results ?? []);
    });
    return () => { alive = false; };
  }, [subdl.title, language]);

  useEffect(() => {
    let alive = true;
    void window.subdl?.usage().then((r) => { if (alive) setUsage(r.usage ?? null); });
    return () => { alive = false; };
  }, [loadingId]);

  async function pick(r: SubdlResultInfo) {
    if (loadingId) return;
    setLoadingId(r.nId);
    setError(null);
    await useSubtitleStore.getState().loadSubdl(r.nId, true, language, r.ai);
    setLoadingId(null);
    const state = useSubtitleStore.getState();
    const picked = state.selectedId !== null && state.downloaded[state.selectedId]?.nId === r.nId;
    if (picked) state.openPicker(false);
    else setError(subdlStatusText(state.subdlStatus === 'cut' ? null : state.subdlStatus) ?? "That subtitle couldn't be loaded. Try another.");
  }

  // Arrow keys, Enter and Esc belong to the picker while it is open (not seeking or closing the player)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement && e.key !== 'Escape') return;
      const list = results ?? [];
      if (e.key === 'Escape') useSubtitleStore.getState().openPicker(false);
      else if (e.key === 'ArrowDown') setFocus((f) => Math.min(f + 1, Math.max(list.length - 1, 0)));
      else if (e.key === 'ArrowUp') setFocus((f) => Math.max(f - 1, 0));
      else if (e.key === 'Enter' && list[focus]) void pick(list[focus]);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  return (
    <div className="subpick" role="dialog" aria-label="Find subtitles">
      <div className="subpick__head">
        <span className="subpick__title">Subtitles</span>
        <select
          className="subpick__lang"
          aria-label="Language"
          value={language}
          onChange={(e) => { setLanguage(e.target.value); storeLanguage(e.target.value); }}
        >
          {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button className="subpick__close" onClick={() => useSubtitleStore.getState().openPicker(false)} aria-label="Close">×</button>
      </div>
      <div className="subpick__list" ref={listRef} role="listbox">
        {results === null && <div className="subpick__note">Searching…</div>}
        {results?.map((r, i) => (
          <button
            key={r.nId}
            data-index={i}
            role="option"
            aria-selected={i === focus}
            className={`subpick__row${i === focus ? ' subpick__row--focus' : ''}${r.nId === current ? ' subpick__row--current' : ''}`}
            onMouseEnter={() => setFocus(i)}
            onClick={() => void pick(r)}
            disabled={loadingId !== null}
          >
            <span className="subpick__name">{r.releaseName}</span>
            <span className="subpick__meta">
              {r.hi && <span className="subpick__badge">SDH</span>}
              {r.pack && <span className="subpick__badge">Pack</span>}
              {r.ai && <AiMark />}
              {r.author && <span className="subpick__author">{r.author}</span>}
              {loadingId === r.nId && <span className="subpick__author">Loading…</span>}
            </span>
          </button>
        ))}
      </div>
      {error && <div className="subpick__error">{error}</div>}
      {usage && <div className="subpick__foot">{usage.downloadsLeft} of {usage.downloadsLimit} downloads left today</div>}
    </div>
  );
}
