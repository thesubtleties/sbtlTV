import { useEffect, type RefObject } from 'react';
import { wrapFocus } from '../utils/firstRun';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps keyboard focus inside a modal panel, and moves it in (to [data-autofocus] when there is one) when the panel opens or `key` changes. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, key?: unknown): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A new step or view: move to what it marks as the place to start (its title, or a primary action),
    // so a screen reader reads the new step; otherwise keep focus where it is inside the panel
    const start = el.querySelector<HTMLElement>('[data-autofocus]');
    if (start) start.focus({ preventScroll: true });
    else if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [ref, key]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      const to = wrapFocus(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (to === null) return;
      e.preventDefault();
      items[to].focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ref]);
}
