import { describe, expect, it } from 'vitest';
import { heroBleedActive, vodPageClasses } from './VodPage';

describe('vodPageClasses', () => {
  it('floats on every view in the Floating style, bleeds only on the home', () => {
    expect(vodPageClasses({ collapsed: false, contentHidden: false, detailOpen: false, bleed: false, floating: true, sliding: false })).toBe('vod-page vod-page--floating');
    expect(vodPageClasses({ collapsed: false, contentHidden: false, detailOpen: false, bleed: true, floating: false, sliding: false })).toBe('vod-page vod-page--bleed');
    expect(vodPageClasses({ collapsed: true, contentHidden: true, detailOpen: true, bleed: true, floating: true, sliding: true }))
      .toBe('vod-page vod-page--bleed vod-page--floating vod-page--sliding vod-page--collapsed vod-page--content-hidden vod-page--detail-open');
  });
});

describe('heroBleedActive', () => {
  const base = { bleed: true, hasDetail: false, isPageCollapsed: false, shouldPageBeCollapsed: false };
  it('on for the home, off on a grid, while the page is slid away, and while a detail covers the home', () => {
    expect(heroBleedActive(base)).toBe(true);
    expect(heroBleedActive({ ...base, bleed: false })).toBe(false);
    expect(heroBleedActive({ ...base, shouldPageBeCollapsed: true })).toBe(false);
    expect(heroBleedActive({ ...base, hasDetail: true })).toBe(false);
  });
  it('back on while a detail slides away for the player: the home shows behind it, with its own title bar look', () => {
    expect(heroBleedActive({ ...base, hasDetail: true, isPageCollapsed: true })).toBe(true);
  });
});
