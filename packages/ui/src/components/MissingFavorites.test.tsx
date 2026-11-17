import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MissingFavoriteRows, waitingFavorites } from './MissingFavorites';
import type { StoredFavorite } from '../db';

const row = (id: string, over: Partial<StoredFavorite> = {}): StoredFavorite => ({ id, type: 'channel', name: id, added: new Date(1), ...over });

describe('synced favorites this computer does not have', () => {
  it('shown only with Gray out, and only the ones without a channel here', () => {
    const rows = [row('a', { ids: [{ host: 'h', ch: '1' }] }), row('b', { stream_id: 'm1_2', ids: [{ host: 'h', ch: '2' }] }), row('c', { stream_id: 'm1_3' })];
    expect(waitingFavorites(rows, 'gray').map((r) => r.id)).toEqual(['a']);
    expect(waitingFavorites(rows, 'hide')).toEqual([]);
  });
  it('each: its name, "Not on this computer", Remove; nothing to play', () => {
    const html = renderToStaticMarkup(createElement(MissingFavoriteRows, { rows: [row('ESPN', { ids: [{ host: 'h', ch: '1' }] })], onRemove: () => {} }));
    expect(html).toContain('ESPN');
    expect(html).toContain('Not on this computer');
    expect(html).toContain('>Remove<');
    expect(html).not.toContain('Play');
  });
});
