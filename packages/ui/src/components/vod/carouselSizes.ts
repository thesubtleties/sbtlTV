/**
 * Horizontal row geometry. Virtuoso uses itemWidth() without measuring (fixedItemHeight is the
 * item WIDTH in horizontal mode), so these must equal the CSS exactly; carouselSizes.test.ts
 * checks them against MediaCard.css and HorizontalCarousel.css.
 */
export const CARD_WIDTH = { small: 120, medium: 160, large: 200 } as const;
/** Space between cards: right padding inside each item (Virtuoso ignores margins and gap). */
export const CARD_GAP = 16;
/** Scroller side padding, so the first card lines up with the row title. */
export const SIDE_PAD = 48;

export type CardSize = keyof typeof CARD_WIDTH;
export const itemWidth = (size: CardSize): number => CARD_WIDTH[size] + CARD_GAP;
