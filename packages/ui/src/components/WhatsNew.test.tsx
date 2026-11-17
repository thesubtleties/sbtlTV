import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WhatsNew } from './WhatsNew';
import { WHATS_NEW } from '../whatsNewItems';

describe('WhatsNew', () => {
  const html = renderToStaticMarkup(createElement(WhatsNew, { version: '0.17.0', items: WHATS_NEW['0.17.0'], onAction: () => {}, onClose: () => {} }));
  it('names the version and lists each item with its action', () => {
    expect(html).toContain('Updated to 0.17.0');
    expect(html).toContain('Add a computer…');
    expect(html).toContain('Open Sync &amp; transfer');
    expect(html).toContain('More like this');
  });
  it('marks features that start off', () => {
    expect(html.match(/whats-new__off/g)?.length).toBe(1);
  });
  it('points to the full notes and has Done', () => {
    expect(html).toContain('Full notes in Settings › About');
    expect(html).toContain('>Done<');
  });
});
