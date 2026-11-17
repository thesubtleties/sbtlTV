import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FirstRunFrame } from './FirstRun';
import type { StepId } from '../utils/firstRun';

const frame = (step: StepId) =>
  renderToStaticMarkup(createElement(FirstRunFrame, { step, onBack: () => {}, onNext: () => {}, onSkip: () => {}, onLetMeIn: () => {}, nextLabel: 'Continue' }));

describe('FirstRunFrame', () => {
  it('Welcome has the way out and no Back or Continue', () => {
    const html = frame('welcome');
    expect(html).toContain('I know what I&#x27;m doing, just let me in');
    expect(html).not.toContain('>Back<');
    expect(html).not.toContain('>Continue<');
  });
  it('later steps have Back, Continue and the Settings note; Skip only when optional', () => {
    expect(frame('source')).toContain('>Back<');
    expect(frame('source')).toContain('>Continue<');
    expect(frame('source')).toContain('Change any of this later in Settings');
    expect(frame('source')).not.toContain('>Skip<');
    expect(frame('tmdb')).toContain('>Skip<');
    expect(frame('done')).not.toContain('>Skip<');
  });
  it('shows one dot per step with the current one marked', () => {
    const html = frame('look');
    expect(html.match(/class="first-run__dot[" ]/g)?.length).toBe(7);
    expect(html.match(/first-run__dot--on/g)?.length).toBe(1);
    expect(html.match(/first-run__dot--done/g)?.length).toBe(2);
  });
});

describe('OfferSync', () => {
  it('after a received setup: one screen, join or not now, no Back', async () => {
    const { OfferSyncFrame } = await import('./FirstRun');
    const html = renderToStaticMarkup(createElement(OfferSyncFrame, { onJoin: () => {}, onNotNow: () => {} }));
    expect(html).toContain('Also keep your lists in sync with the computer that sent this?');
    expect(html).toContain('Join its sync');
    expect(html).toContain('>Not now<');
    expect(html).not.toContain('>Back<');
    expect(html).not.toContain('first-run__dot');
  });
});

describe('FirstRunFrame while applying', () => {
  it('Back is disabled while a received setup is being applied', () => {
    const html = renderToStaticMarkup(createElement(FirstRunFrame, { step: 'welcome', receiving: true, backDisabled: true, onBack: () => {}, onNext: () => {}, onSkip: () => {}, onLetMeIn: () => {}, nextLabel: 'Continue' }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Back</);
  });
});
