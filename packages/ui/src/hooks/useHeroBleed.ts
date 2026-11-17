import { useCallback, useEffect, type RefObject } from 'react';

/** 0 at the top, 1 once the hero's bottom edge has reached the bars. */
export function chromeFade(scrollTop: number, heroHeight: number, chrome: number): number {
  return Math.min(1, Math.max(0, scrollTop / Math.max(1, heroHeight - chrome)));
}

const TITLE_BAR = 32;

/**
 * The Movies / Series home: the hero runs up under the title bar and the header; what's behind them fills in to the
 * page colour as it scrolls away (HeaderStyles.css). Sets the root class + --chrome-fade, and the page's
 * --bleed-chrome (title bar + header height); removes them when inactive or unmounted.
 */
export function useHeroBleed(active: boolean, pageRef: RefObject<HTMLElement | null>, startTop: number) {
  const onScroll = useCallback((scrollTop: number) => {
    const page = pageRef.current;
    const hero = page?.querySelector<HTMLElement>('.hero');
    const strip = page?.querySelector<HTMLElement>('.h-category-strip');
    if (!page || !hero || !strip) return;
    const chrome = TITLE_BAR + strip.offsetHeight;
    page.style.setProperty('--bleed-chrome', `${chrome}px`);
    document.documentElement.style.setProperty('--chrome-fade', chromeFade(scrollTop, hero.offsetHeight, chrome).toFixed(3));
  }, [pageRef]);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('hero-bleed', active);
    if (active) requestAnimationFrame(() => onScroll(startTop));
    return () => { root.classList.remove('hero-bleed'); root.style.removeProperty('--chrome-fade'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the starting scroll only
  }, [active, onScroll]);
  return { onScroll };
}
