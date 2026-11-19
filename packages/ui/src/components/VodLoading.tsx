import { useEffect, useState } from 'react';
import { SbtlLoader } from './toast/SbtlLoader';
import './VodLoading.css';

/**
 * Between pressing Play on a movie or episode and its first frame: the title's art blurred under a veil of the page
 * colour (dimmed on dark palettes, frosted on light ones), the sbtl letters popping, and the title. Covers the Movies /
 * Series page (fading in while it or its detail slides away), so nothing of the home shows during a slow open.
 * Cancel or Escape stop the load; Escape goes no further, so the page under it doesn't also go back.
 */
export function VodLoading({ title, detail, art, onCancel }: { title: string; detail?: string; art?: string; onCancel: () => void }) {
  const [artFailed, setArtFailed] = useState(false);
  useEffect(() => setArtFailed(false), [art]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCancel();
    };
    // Capture on window: ahead of the page's and the app's own Escape handling
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  return (
    <div className="vod-loading">
      {art && !artFailed && (
        <img className="vod-loading__art" src={art} alt="" aria-hidden="true" onError={() => setArtFailed(true)} />
      )}
      <div className="vod-loading__veil" />
      <div className="vod-loading__center">
        <SbtlLoader size={110} slow />
        <div className="vod-loading__title">{title}</div>
        {detail && <div className="vod-loading__detail">{detail}</div>}
        <span className="vod-loading__sr" role="status">Loading {title}</span>
      </div>
      <button className="vod-loading__cancel" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/**
 * Whether playback has begun: the position moved on a little between two updates. An opened file can still buffer for
 * seconds (standing still), and a resume's seek lands with a jump; neither is a frame playing.
 */
export function playbackStarted(previous: number | null, position: number): boolean {
  if (previous === null) return false;
  const step = position - previous;
  return step > 0.1 && step < 2;
}
