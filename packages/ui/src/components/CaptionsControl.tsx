import { useEffect, useRef, useState } from 'react';
import { useSubtitleStore } from '../stores/subtitleStore';
import { formatDelay, trackLabel } from '../services/subtitleLogic';
import { systemLocale } from '../hooks/useSubtitleController';
import './CaptionsControl.css';

/** CC button: click toggles captions, right-click or the arrow opens tracks and delay. */
export function CaptionsControl({ disabled }: { disabled: boolean }) {
  const kind = useSubtitleStore((s) => s.kind);
  const tracks = useSubtitleStore((s) => s.tracks);
  const selectedId = useSubtitleStore((s) => s.selectedId);
  const delay = useSubtitleStore((s) => s.delay);
  const visible = useSubtitleStore((s) => s.visible);
  const ccState = useSubtitleStore((s) => s.ccState);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const unreadable = kind === 'live' && ccState === 'unreadable';
  const none = tracks.length === 0 || unreadable;
  // Live captions stay selected (decoding) while hidden; on = shown
  const on = !none && (kind === 'live' ? visible : selectedId !== null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    // Esc closes only the menu: stop it before App's window handler exits fullscreen or closes panels
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenuOpen(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menuOpen]);

  useEffect(() => { if (none) setMenuOpen(false); }, [none]);

  const toggle = () => {
    if (kind) useSubtitleStore.getState().toggle(systemLocale());
  };

  const title = unreadable
    ? "This channel's captions can't be read"
    : none
      ? (kind === 'vod' ? 'No subtitles in this file' : 'No captions on this channel')
      : `${on ? 'Captions on' : 'Captions off'} (V) · right-click for tracks and delay`;

  return (
    <div className="cc" ref={rootRef}>
      <button
        className={`npb-btn cc__btn${on ? ' cc__btn--on' : ''}`}
        onClick={toggle}
        onContextMenu={(e) => { e.preventDefault(); if (!none) setMenuOpen((o) => !o); }}
        disabled={disabled || none}
        title={title}
        aria-pressed={on}
      >
        <CcIcon />
        {delay !== 0 && <span className="cc__dot" aria-hidden="true" />}
      </button>
      <button
        className="cc__arrow"
        onClick={() => setMenuOpen((o) => !o)}
        disabled={disabled || none}
        aria-label="Caption options"
        title="Caption options"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 7L5 3l4 4" /></svg>
      </button>

      {menuOpen && (
        <div className="cc__menu" role="menu">
          <div className="cc__heading">Subtitles</div>
          <button className={`cc__item${!on ? ' cc__item--active' : ''}`} role="menuitemradio" aria-checked={!on}
            onClick={() => useSubtitleStore.getState().selectTrack(null)}>Off</button>
          {tracks.map((t) => (
            <button key={t.id} className={`cc__item${on && selectedId === t.id ? ' cc__item--active' : ''}`} role="menuitemradio"
              aria-checked={on && selectedId === t.id} onClick={() => useSubtitleStore.getState().selectTrack(t.id)}>
              {trackLabel(t)}
            </button>
          ))}
          <div className="cc__divider" />
          <div className="cc__delay">
            <span className="cc__delay-label">Delay</span>
            <button className="cc__step" onClick={() => useSubtitleStore.getState().nudgeDelay(-0.1)} title="Earlier (Z)">−</button>
            <span className="cc__delay-value">{formatDelay(delay)}</span>
            <button className="cc__step" onClick={() => useSubtitleStore.getState().nudgeDelay(0.1)} title="Later (X)">+</button>
            <button className="cc__reset" onClick={() => useSubtitleStore.getState().setDelay(0)} disabled={delay === 0}>Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CcIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6" />
    </svg>
  );
}
