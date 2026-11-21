import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import type { StoredProgram } from '../db';
import type { GuideHoverApi } from './guideHover';
import { GuideHoverCard } from './GuideHoverCard';

/** How long the pointer rests on a show before its card appears */
export const HOVER_DELAY_MS = 350;
/** Leaving a show: the card waits this long, so moving to the next one doesn't make it blink */
export const HOVER_HIDE_MS = 80;
/** A card hidden this recently comes straight back on the next show (crossing the gap between rows) */
export const HOVER_SKIP_DELAY_MS = 300;

/**
 * Owns the hover card's state and timers, so showing, moving and hiding it re-render only the card (not the guide's
 * rows). The guide drives it through `apiRef`. It drops the card whenever what's under the pointer may have changed
 * without the pointer moving: `resetKey` (the window, the category, a jump, the rows), the guide hiding, the window
 * losing focus. A show whose element is gone by the time its card would open is skipped.
 */
export function GuideHoverLayer({ apiRef, now, visible, resetKey }: {
  apiRef: Ref<GuideHoverApi>;
  now: Date;
  visible: boolean;
  resetKey: string;
}) {
  const [hover, setHover] = useState<{ program: StoredProgram; rect: DOMRect; x: number } | null>(null);
  const shown = useRef(false);
  shown.current = hover !== null;
  const timers = useRef<{ show?: number; hide?: number }>({});
  const hiddenAt = useRef(-Infinity);

  const clear = () => {
    window.clearTimeout(timers.current.show);
    window.clearTimeout(timers.current.hide);
  };
  const drop = () => {
    clear();
    hiddenAt.current = -Infinity;
    setHover(null);
  };

  useImperativeHandle(apiRef, () => ({
    show: (program, el, x) => {
      clear();
      const open = () => {
        if (!el.isConnected) return;
        setHover({ program, rect: el.getBoundingClientRect(), x });
      };
      if (shown.current || performance.now() - hiddenAt.current < HOVER_SKIP_DELAY_MS) open();
      else timers.current.show = window.setTimeout(open, HOVER_DELAY_MS);
    },
    hide: () => {
      clear();
      timers.current.hide = window.setTimeout(() => {
        hiddenAt.current = performance.now();
        setHover(null);
      }, HOVER_HIDE_MS);
    },
    drop,
  }), []);

  useEffect(() => { drop(); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!visible) drop(); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onBlur = () => drop();
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      clear();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return hover && visible
    ? createPortal(<GuideHoverCard program={hover.program} anchor={hover.rect} pointerX={hover.x} now={now} />, document.body)
    : null;
}
