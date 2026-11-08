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
    expect(rule(hc, '.carousel__scroll-container')).toMatch(new RegExp(`padding-inline:\\s*${SIDE_PAD}px`));
  });
  test('end spacer completes the right edge (Chromium leaves out the scroller\'s own end padding)', () => {
    const hc = css('HorizontalCarousel.css');
    expect(rule(hc, '.carousel__scroll-container [data-testid="virtuoso-item-list"]::after')).toMatch(new RegExp(`width:\\s*${SIDE_PAD - CARD_GAP}px`));
  });
  test('item width is card plus gap', () => {
    expect(itemWidth('medium')).toBe(176);
  });
});
