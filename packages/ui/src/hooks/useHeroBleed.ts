import { useCallback, useEffect, type RefObject } from 'react';

/** 0 at the top, 1 once the hero's bottom edge has reached the bars. */
export function chromeFade(scrollTop: number, heroHeight: number, chrome: number): number {
  return Math.min(1, Math.max(0, scrollTop / Math.max(1, heroHeight - chrome)));
}

const TITLE_BAR = 32;
const SOLID_AT = 0.5;

/**
 * The Movies / Series home: the hero runs up under the title bar and the header; what's behind them fills in to the
 * page colour as it scrolls away (HeaderStyles.css). The fill is its own layer (.vod-page__chrome-fill) driven by
 * opacity, so a scroll repaints only it; the root gets a class only (hero-bleed, and chrome-solid at half), the title bar
 * --bar-t (how far filled, for its logo and buttons). The page's
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
    const fade = chromeFade(scrollTop, hero.offsetHeight, chrome);
    const fill = page.querySelector<HTMLElement>('.vod-page__chrome-fill');
    if (fill) fill.style.opacity = String(Math.round(fade * 1000) / 1000);
    // The top shade: Floating's controls sit on their own glass, so it simply fades out with the scroll. Simple's
    // labels are light until the halfway switch, so there CSS keeps it whole until then
    const shade = page.querySelector<HTMLElement>('.vod-page__chrome-shade');
    if (shade) shade.style.opacity = document.documentElement.dataset.vodHeader === 'floating' ? String(Math.round((1 - fade) * 1000) / 1000) : '';
    // The title bar's logo and window buttons follow the scroll (HeaderStyles.css mixes their colour by --bar-t); set
    // on the title bar alone so only its few elements restyle. The header's labels switch at half instead
    // (chrome-solid): a blend there would pass through grey on light palettes
    document.querySelector<HTMLElement>('.title-bar')?.style.setProperty('--bar-t', String(Math.round(fade * 1000) / 1000));
    document.documentElement.classList.toggle('chrome-solid', fade >= SOLID_AT);
  }, [pageRef]);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('hero-bleed', active);
    const frame = active ? requestAnimationFrame(() => onScroll(startTop)) : 0;
    return () => {
      cancelAnimationFrame(frame);
      root.classList.remove('hero-bleed', 'chrome-solid');
      document.querySelector<HTMLElement>('.title-bar')?.style.removeProperty('--bar-t');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the starting scroll only
  }, [active, onScroll]);
  return { onScroll };
}
