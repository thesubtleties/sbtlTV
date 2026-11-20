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
  it('shows Sync as off until this computer is syncing, then on', () => {
    expect(html.match(/whats-new__state"/g)?.length).toBe(1);
    expect(html).toContain('>off<');
    const on = renderToStaticMarkup(createElement(WhatsNew, { version: '0.17.0', items: WHATS_NEW['0.17.0'], syncOn: true, onAction: () => {}, onClose: () => {} }));
    expect(on).toContain('whats-new__state is-on');
    expect(on).toContain('>on<');
    expect(on).not.toContain('>off<');
  });
  it('points to the full notes and has Done', () => {
    expect(html).toContain('Full notes in Settings › About');
    expect(html).toContain('>Done<');
  });
});
