import { describe, expect, test } from 'vitest';
import { CARD_GAP, CARD_WIDTH, SIDE_PAD, itemWidth } from './carouselSizes';

// Virtuoso skips measuring (fixedItemHeight = item width in horizontal mode), so these numbers
// must equal the CSS exactly; a mismatch makes the end of a row jump (the 0.14.1 Mac hitch).
// Read the real CSS files. Vitest runs in Node; the UI has no Node types, so a minimal one here.
const fsMod = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsMod)) as { readFileSync(path: URL, enc: 'utf8'): string };
const css = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
const rule = (src: string, selector: string) => {
  const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
};

describe('carousel sizes match the CSS', () => {
  test('card widths', () => {
    const mc = css('MediaCard.css');
    for (const size of ['small', 'medium', 'large'] as const) {
      expect(rule(mc, `.media-card--${size}`)).toMatch(new RegExp(`width:\\s*${CARD_WIDTH[size]}px`));
    }
  });
  test('gap and side padding', () => {
    const hc = css('HorizontalCarousel.css');
    expect(rule(hc, '.carousel__item')).toMatch(new RegExp(`padding:\\s*16px\\s+${CARD_GAP}px\\s+24px\\s+0`));
    expect(rule(hc, '.carousel__virtual')).toMatch(new RegExp(`padding-inline:\\s*${SIDE_PAD}px`));
  });
  test('end spacer completes the right edge (Chromium leaves out the scroller\'s own end padding)', () => {
    const hc = css('HorizontalCarousel.css');
    expect(rule(hc, '.carousel__virtual [data-testid="virtuoso-item-list"]::after')).toMatch(new RegExp(`width:\\s*${SIDE_PAD - CARD_GAP}px`));
  });
  test('the shared scroller keeps its own scrolling (Continue Watching is not virtualized)', () => {
    const sc = rule(css('HorizontalCarousel.css'), '.carousel__scroll-container');
    expect(sc).toMatch(/overflow-x:\s*auto/);
    expect(sc).not.toMatch(/padding-inline/);
  });
  test('items align to the top, not the text baseline (a card without a poster sank 225px)', () => {
    const hc = css('HorizontalCarousel.css');
    expect(rule(hc, '.carousel__virtual [data-testid="virtuoso-item-list"] > div')).toMatch(/vertical-align:\s*top/);
  });
  test('the feather sits above the left scroll fade (it hangs inside the fade\'s 48px strip)', () => {
    const hc = css('HorizontalCarousel.css');
    const z = (sel: string) => Number(/z-index:\s*(\d+)/.exec(rule(hc, sel))?.[1] ?? 0);
    expect(z('.carousel__mark')).toBeGreaterThan(z('.carousel__fade'));
  });
  test('rows keep hover blur layers warm only while hovered (200 always-on layers made sideways scroll hitch)', () => {
    const mc = css('MediaCard.css');
    const cold = rule(mc, '.carousel:not(:hover) .media-card__play-icon,\n.carousel:not(:hover) .media-card__heart:not(.media-card__heart--active)::after,\n.carousel:not(:hover) .media-card__remove::before');
    expect(cold).toMatch(/backdrop-filter:\s*none/);
    expect(cold).toMatch(/will-change:\s*auto/);
    expect(rule(mc, '.carousel .media-card__poster')).toMatch(/will-change:\s*auto/);
  });
  test('item width is card plus gap', () => {
    expect(itemWidth('medium')).toBe(176);
  });
});
