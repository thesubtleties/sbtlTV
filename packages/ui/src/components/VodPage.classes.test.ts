import { describe, expect, it } from 'vitest';
import { vodPageClasses } from './VodPage';

describe('vodPageClasses', () => {
  it('floats on every view in the Floating style, bleeds only on the home', () => {
    expect(vodPageClasses({ collapsed: false, contentHidden: false, detailOpen: false, bleed: false, floating: true, sliding: false })).toBe('vod-page vod-page--floating');
    expect(vodPageClasses({ collapsed: false, contentHidden: false, detailOpen: false, bleed: true, floating: false, sliding: false })).toBe('vod-page vod-page--bleed');
    expect(vodPageClasses({ collapsed: true, contentHidden: true, detailOpen: true, bleed: true, floating: true, sliding: true }))
      .toBe('vod-page vod-page--bleed vod-page--floating vod-page--sliding vod-page--collapsed vod-page--content-hidden vod-page--detail-open');
  });
});
