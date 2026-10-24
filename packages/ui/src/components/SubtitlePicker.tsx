import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
  const panelRef = useRef<HTMLDivElement>(null);
  const current = useSubtitleStore((s) => (s.selectedId !== null ? s.downloaded[s.selectedId]?.nId : undefined));

  useEffect(() => {
    let alive = true;
    setResults(null);
    setError(null);
    setFocus(0);
    void window.subdl?.find(subdl.title, language).then((r) => {
      if (!alive) return;
      const name = languages.find((l) => l.code === language)?.label ?? language;
      if (r.error) setError(failureText(r.error));
      else if (!r.results?.length) setError(`None in ${name} on SubDL. Try another language.`);
      setResults(r.results ?? []);
    });
    return () => { alive = false; };
  }, [subdl.title, language, languages]);

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

  // Focus moves into the picker when it opens (remote and keyboard), and back to the CC button when it closes
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('.subpick__lang')?.focus();
    return () => { (document.querySelector<HTMLElement>('.cc__arrow') ?? opener)?.focus?.(); };
  }, []);
  useEffect(() => {
    if (results?.length) listRef.current?.querySelector<HTMLElement>('[data-index="0"]')?.focus();
  }, [results]);

  // Up/Down move between rows, Esc closes (after the CC menu, if that is open); Enter is the focused control's own
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.querySelector('.cc__menu')) return;
        useSubtitleStore.getState().openPicker(false);
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (e.target as HTMLElement | null)?.dataset?.index !== undefined) {
        const list = results ?? [];
        const next = Math.min(Math.max(focus + (e.key === 'ArrowDown' ? 1 : -1), 0), Math.max(list.length - 1, 0));
        setFocus(next);
        listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Tab stays inside the picker
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('select, button:not([disabled])') ?? [])].filter((el) => el.tabIndex >= 0);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  return (
    <div className="subpick" role="dialog" aria-label="Find subtitles" ref={panelRef} onKeyDown={trapTab}>
      <div className="subpick__head">
        <span className="subpick__title">Find subtitles</span>
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
      <div className="subpick__list" ref={listRef}>
        {results === null && <div className="subpick__note">Searching…</div>}
        {results?.map((r, i) => (
          <button
            key={r.nId}
            data-index={i}
            tabIndex={i === focus ? 0 : -1}
            aria-current={r.nId === current ? 'true' : undefined}
            className={`subpick__row${i === focus ? ' subpick__row--focus' : ''}${r.nId === current ? ' subpick__row--current' : ''}`}
            onMouseEnter={() => setFocus(i)}
            onFocus={() => setFocus(i)}
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
      {usage && (
        <div className="subpick__foot">
          {usage.downloadsLeft > 0 ? `${usage.downloadsLeft} of ${usage.downloadsLimit} downloads left today` : 'No downloads left today'}
        </div>
      )}
    </div>
  );
}
