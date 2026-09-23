import type { DatabaseSync } from 'node:sqlite';
import type { Source, Channel, Category, DataTable, SyncProgress } from '@sbtltv/core';
import { XtreamClient, fetchAndParseM3U, parseM3U } from '@sbtltv/local-adapter';
import { checkProviderUrl, redactUrl } from '@sbtltv/core';
import { replaceChannels, setSourceError } from './writes.js';

export interface StageContext {
  db: DatabaseSync;
  tempDir: string;
  allowLanSources: boolean;
  log(category: string, message: string): void;
  progress(p: SyncProgress): void;
  changed(tables: DataTable[], sourceId: string | null): void;
}
export interface ChannelClient {
  testConnection(): Promise<unknown>;
  getLiveCategories(): Promise<Category[]>;
  getLiveStreams(): Promise<Channel[]>;
  getServerEpgUrl?(): string | undefined;
}

// Stamps each category with its 0-based provider-arrival index (both adapters deliver
// categories in provider order). Provider sort in the guide reads this position.
function withPositions(categories: Category[]): Category[] {
  return categories.map((c, i) => ({ ...c, position: i }));
}

// XtreamClient.testConnection reports failure as { success: false, error } rather than throwing.
function assertConnected(result: unknown): void {
  if (result && typeof result === 'object' && 'success' in result && !(result as { success: boolean }).success) {
    throw new Error((result as { error?: string }).error ?? 'Connection failed');
  }
}

// A playlist the user imported from a file has no URL to fetch again; its rows
// are replaced only when the renderer hands over new content.
export const isImportedPlaylist = (source: Source): boolean => source.type === 'm3u' && source.url.startsWith('imported:');

export async function syncChannels(ctx: StageContext, source: Source, client: ChannelClient | null, playlistContent?: string): Promise<{ channels: Channel[]; epgUrl?: string } | null> {
  if (isImportedPlaylist(source) && playlistContent === undefined) {
    ctx.log('sync', `Source ${source.name} is an imported file; keeping its stored channels`);
    return null;
  }
  ctx.progress({ sourceId: source.id, stage: 'channels', state: 'started' });
  ctx.log('sync', `Starting sync for source: ${source.name} (${source.type})`);
  try {
    let channels: Channel[]; let categories: Category[]; let epgUrl: string | undefined;
    if (source.type === 'm3u' && playlistContent !== undefined) {
      const parsed = parseM3U(playlistContent, source.id);
      channels = parsed.channels; categories = parsed.categories; epgUrl = parsed.epgUrl ?? undefined;
      ctx.log('sync', `Imported M3U parsed: ${channels.length} channels, ${categories.length} categories`);
    } else if (source.type === 'm3u') {
      checkProviderUrl(source.url, ctx.allowLanSources);
      ctx.log('sync', `Fetching M3U from: ${redactUrl(source.url)}`);
      const parsed = await fetchAndParseM3U(source.url, source.id);
      channels = parsed.channels; categories = parsed.categories; epgUrl = parsed.epgUrl ?? undefined;
      ctx.log('sync', `M3U parsed: ${channels.length} channels, ${categories.length} categories`);
    } else if (source.type === 'xtream' && client) {
      checkProviderUrl(source.url, ctx.allowLanSources);
      ctx.log('sync', 'Testing Xtream connection...');
      assertConnected(await client.testConnection());
      ctx.log('sync', 'Connection test passed');
      ctx.log('sync', 'Fetching live categories...');
      categories = await client.getLiveCategories();
      ctx.log('sync', `Got ${categories.length} categories`);
      ctx.log('sync', 'Fetching live streams...');
      channels = await client.getLiveStreams();
      ctx.log('sync', `Got ${channels.length} channels`);
      epgUrl = client.getServerEpgUrl?.();
    } else if (source.type === 'xtream') {
      throw new Error('Xtream source requires username and password');
    } else {
      throw new Error(`Unsupported source type: ${source.type}`);
    }
    ctx.log('sync', `Storing ${channels.length} channels and ${categories.length} categories in DB...`);
    const tables = replaceChannels(ctx.db, source.id, { categories: withPositions(categories), channels, epgUrl });
    ctx.changed(tables, source.id);
    ctx.log('sync', 'Channels and categories stored successfully');
    ctx.progress({ sourceId: source.id, stage: 'channels', state: 'finished', counts: { channels: channels.length, categories: categories.length } });
    return { channels, epgUrl };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ctx.log('sync', `Sync FAILED for ${source.name}: ${message}`);
    ctx.changed(setSourceError(ctx.db, source.id, message), source.id);
    ctx.progress({ sourceId: source.id, stage: 'channels', state: 'failed', message });
    return null;
  }
}

export function makeXtreamClient(source: Source): XtreamClient | null {
  if (source.type !== 'xtream' || !source.username || !source.password) return null;
  return new XtreamClient({ baseUrl: source.url, username: source.username, password: source.password }, source.id);
}
