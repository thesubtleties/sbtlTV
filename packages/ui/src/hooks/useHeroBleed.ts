import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** 0 at the top, 1 once the hero's bottom edge has reached the bars. */
export function chromeFade(scrollTop: number, heroHeight: number, chrome: number): number {
  return Math.min(1, Math.max(0, scrollTop / Math.max(1, heroHeight - chrome)));
}

const TITLE_BAR = 32;
const round = (n: number) => String(Math.round(n * 1000) / 1000);

/** How far the bars have filled, on the title bar alone (its logo and window buttons mix their colour by it); null clears it. */
function setBarT(fade: number | null) {
  const bar = document.querySelector<HTMLElement>('.title-bar');
  if (fade === null) bar?.style.removeProperty('--bar-t');
  else bar?.style.setProperty('--bar-t', round(fade));
}

/**
 * The Movies / Series home: the hero runs up under the title bar and the header; what's behind them fills in to the
 * page colour as it scrolls away (HeaderStyles.css). The fill is its own layer (.vod-page__chrome-fill) driven by
 * opacity, so a scroll repaints only it; the root gets a class only (hero-bleed); the title bar and the header get
 * --bar-t (how far filled) for their colours. The page's
 * --bleed-chrome (title bar + header height); removes them when inactive or unmounted.
 */
export function useHeroBleed(active: boolean, pageRef: RefObject<HTMLElement | null>, startTop: number) {
  // A scroll of the home while a detail covers it would otherwise take the title bar back from the detail
  const activeRef = useRef(active);
  activeRef.current = active;
  const onScroll = useCallback((scrollTop: number) => {
    if (!activeRef.current) return;
    const page = pageRef.current;
    const hero = page?.querySelector<HTMLElement>('.hero');
    const strip = page?.querySelector<HTMLElement>('.h-category-strip');
    if (!page || !hero || !strip) return;
    const chrome = TITLE_BAR + strip.offsetHeight;
    page.style.setProperty('--bleed-chrome', `${chrome}px`);
    const fade = chromeFade(scrollTop, hero.offsetHeight, chrome);
    const fill = page.querySelector<HTMLElement>('.vod-page__chrome-fill');
    if (fill) fill.style.opacity = round(fade);
    // The top shade fades out with the scroll, and the title bar and the header follow it (--bar-t: HeaderStyles.css
    // mixes their labels, buttons and glass by it); each set on its own element so only those restyle
    const shade = page.querySelector<HTMLElement>('.vod-page__chrome-shade');
    if (shade) shade.style.opacity = round(1 - fade);
    strip.style.setProperty('--bar-t', round(fade));
    setBarT(fade);
  }, [pageRef]);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('hero-bleed', active);
    const frame = active ? requestAnimationFrame(() => onScroll(startTop)) : 0;
    return () => {
      cancelAnimationFrame(frame);
      root.classList.remove('hero-bleed');
      pageRef.current?.querySelector<HTMLElement>('.h-category-strip')?.style.removeProperty('--bar-t');
      setBarT(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the starting scroll only
  }, [active, onScroll]);
  return { onScroll };
}

/**
 * A movie or series detail: its backdrop runs up under the title bar, which is clear while the art is behind it
 * (<html class="detail-bleed">, set before the first paint so it's clear the moment the detail opens). As the backdrop
 * scrolls away its fill (.detail-bleed__fill) fades in and its shade (.detail-bleed__shade) out, by inline opacity on
 * those layers, and the title bar's --bar-t follows (HeaderStyles.css). Off while the detail is slid away for the player.
 */
export function useDetailBleed(active: boolean, scrollerRef: RefObject<HTMLElement | null>) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const onScroll = useCallback((scrollTop: number) => {
    const el = scrollerRef.current;
    const backdrop = el?.querySelector<HTMLElement>('.movie-detail__backdrop, .series-detail__backdrop');
    if (!activeRef.current || !el || !backdrop) return;
    // Filled once the backdrop has passed under the bar, or at the end of a page too short for that (a half-filled
    // bar would sit there, grey logo and all on light palettes)
    const span = Math.min(backdrop.offsetHeight - TITLE_BAR, el.scrollHeight - el.clientHeight);
    const fade = chromeFade(scrollTop, span + TITLE_BAR, TITLE_BAR);
    const fill = el.querySelector<HTMLElement>('.detail-bleed__fill');
    const shade = el.querySelector<HTMLElement>('.detail-bleed__shade');
    if (fill) fill.style.opacity = round(fade);
    if (shade) shade.style.opacity = round(1 - fade);
    setBarT(fade);
  }, [scrollerRef]);
  useLayoutEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.classList.add('detail-bleed');
    const frame = requestAnimationFrame(() => onScroll(scrollerRef.current?.scrollTop ?? 0));
    return () => { cancelAnimationFrame(frame); root.classList.remove('detail-bleed'); setBarT(null); };
  }, [active, onScroll, scrollerRef]);
  return { onScroll };
}
