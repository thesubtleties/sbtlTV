import { describe, it, expect } from 'vitest';
import { parseM3U } from '@sbtltv/local-adapter';

const SOURCE_ID = 'test-source';

/** Helper to build a minimal M3U string */
function m3u(...entries: { name: string; group?: string; url: string; logo?: string; tvgId?: string; chno?: number }[]): string {
  const lines = ['#EXTM3U'];
  for (const e of entries) {
    const attrs = [
      e.group ? `group-title="${e.group}"` : '',
      e.logo ? `tvg-logo="${e.logo}"` : '',
      e.tvgId ? `tvg-id="${e.tvgId}"` : '',
      e.chno !== undefined ? `tvg-chno="${e.chno}"` : '',
    ].filter(Boolean).join(' ');
    lines.push(`#EXTINF:-1 ${attrs},${e.name}`);
    lines.push(e.url);
  }
  return lines.join('\n');
}

describe('parseM3U', () => {
  it('parses a basic channel', () => {
    const result = parseM3U(m3u({ name: 'CNN', group: 'News', url: 'http://example.com/cnn' }), SOURCE_ID);

    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].name).toBe('CNN');
    expect(result.channels[0].direct_url).toBe('http://example.com/cnn');
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].category_name).toBe('News');
  });

  it('creates separate channels for different streams', () => {
    const result = parseM3U(m3u(
      { name: 'CNN', group: 'News', url: 'http://example.com/cnn' },
      { name: 'BBC', group: 'News', url: 'http://example.com/bbc' },
    ), SOURCE_ID);

    expect(result.channels).toHaveLength(2);
    expect(result.channels[0].name).toBe('CNN');
    expect(result.channels[1].name).toBe('BBC');
  });

  describe('duplicate streams in multiple groups', () => {
    it('merges category_ids when same channel appears in multiple groups', () => {
      const result = parseM3U(m3u(
        { name: 'CNN', group: 'News', url: 'http://example.com/cnn' },
        { name: 'CNN', group: '1_FAVORITES', url: 'http://example.com/cnn' },
      ), SOURCE_ID);

      // Should be ONE channel, not two
      expect(result.channels).toHaveLength(1);
      expect(result.channels[0].name).toBe('CNN');
      // Should have both categories
      expect(result.channels[0].category_ids).toHaveLength(2);

      // Both categories should exist
      const catNames = result.categories.map(c => c.category_name).sort();
      expect(catNames).toEqual(['1_FAVORITES', 'News']);
    });

    it('handles channel in three or more groups', () => {
      const result = parseM3U(m3u(
        { name: 'ESPN', group: 'Sports', url: 'http://example.com/espn' },
        { name: 'ESPN', group: '1_FAVORITES', url: 'http://example.com/espn' },
        { name: 'ESPN', group: '2_SPORTS', url: 'http://example.com/espn' },
      ), SOURCE_ID);

      expect(result.channels).toHaveLength(1);
      expect(result.channels[0].category_ids).toHaveLength(3);
      expect(result.categories).toHaveLength(3);
    });

    it('does not duplicate category_ids if same group listed twice', () => {
      const result = parseM3U(m3u(
        { name: 'CNN', group: 'News', url: 'http://example.com/cnn' },
        { name: 'CNN', group: 'News', url: 'http://example.com/cnn' },
      ), SOURCE_ID);

      expect(result.channels).toHaveLength(1);
      // Same category — should not duplicate
      expect(result.channels[0].category_ids).toHaveLength(1);
    });

    it('treats different URLs as different channels even with same name', () => {
      const result = parseM3U(m3u(
        { name: 'CNN', group: 'News', url: 'http://example.com/cnn-hd' },
        { name: 'CNN', group: 'News', url: 'http://example.com/cnn-sd' },
      ), SOURCE_ID);

      // Different URLs = different channels (different stream_ids)
      expect(result.channels).toHaveLength(2);
    });
  });

  it('handles channels with no group', () => {
    const result = parseM3U(m3u(
      { name: 'Random', url: 'http://example.com/random' },
    ), SOURCE_ID);

    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].category_ids).toEqual([]);
    expect(result.categories).toHaveLength(0);
  });

  it('handles duplicate of a channel with no group into a group', () => {
    const result = parseM3U(m3u(
      { name: 'CNN', url: 'http://example.com/cnn' },
      { name: 'CNN', group: 'Favorites', url: 'http://example.com/cnn' },
    ), SOURCE_ID);

    expect(result.channels).toHaveLength(1);
    // Should pick up the Favorites category
    expect(result.channels[0].category_ids).toHaveLength(1);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].category_name).toBe('Favorites');
  });
});
