/** Shown: laid out and not display:none (the category tabs are hidden in the Floating style). */
const visible = (el: HTMLElement) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;

/** The Floating capsule's highlight sits on the active item that's actually shown: Home, All, or Genres on a category. */
export function highlightTarget(nav: HTMLElement): HTMLElement | null {
  return [...nav.querySelectorAll<HTMLElement>('.h-category-strip__pill.active, .h-category-strip__genres-btn.active')].find(visible) ?? null;
}
