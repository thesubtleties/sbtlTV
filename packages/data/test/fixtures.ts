// Shared test data (queries, router and writes tests). Its own file: under vitest, importing a test file runs its tests.
import type { Db } from '../src/platform.js';
import { createSchema, reindexGuide } from '../src/schema.js';

export function seedFixture(db: Db): void {
  createSchema(db);
  db.exec(`
    insert into sources_meta(source_id, channel_count, category_count, last_channel_sync) values ('s1', 2, 2, 1000), ('s2', 1, 1, 2000);
    insert into categories values ('s1_news', 's1', 'News', 0), ('s1_sports', 's1', 'Sports', 1), ('s2_news', 's2', 'News', 0);
    insert into channels(stream_id, source_id, name, channel_num, direct_url, epg_channel_id) values
      ('s1_10', 's1', 'CBS', 2, 'http://x/10', 'cbs.us'),
      ('s1_11', 's1', 'ABC', 1, 'http://x/11', 'abc.us'),
      ('s2_20', 's2', 'CBS HD', null, 'http://y/20', 'cbs.us');
    insert into channel_categories values ('s1_10', 's1_news'), ('s1_11', 's1_news'), ('s1_11', 's1_sports'), ('s2_20', 's2_news');
    insert into epg_links values ('s1_10', 'epg1', 'cbs.us', 's1', 'exact', 'exact_id'), ('s2_20', 'epg1', 'cbs.us', 's2', 'exact', 'exact_id');
    insert into epg_programs values
      ('s1::epg1::cbs.us::1000', 's1', 'epg1', 'cbs.us', 1000, 2000, 'Morning', ''),
      ('s1::epg1::cbs.us::2000', 's1', 'epg1', 'cbs.us', 2000, 3000, 'Noon', ''),
      ('s1::epg1::cbs.us::3000', 's1', 'epg1', 'cbs.us', 3000, 4000, 'Evening', ''),
      ('s2::epg1::cbs.us::2000', 's2', 'epg1', 'cbs.us', 2000, 3000, 'Noon', ''),
      ('s2::epg1::cbs.us::3000', 's2', 'epg1', 'cbs.us', 3000, 4000, 'Evening', '');
    insert into vod_categories values ('s1', 's1_action', 'Action', 'movie'), ('s1', 's1_empty', 'Empty', 'movie'), ('s1', 's1_drama', 'Drama', 'series');
    insert into vod_movies(stream_id, source_id, name, direct_url, tmdb_id, popularity, added) values
      ('s1_m1', 's1', 'Heat', 'http://x/m1', 949, 50.5, 5000), ('s1_m2', 's1', 'Alien', 'http://x/m2', 348, 80.1, 6000);
    insert into vod_item_categories values ('s1_m1', 'movie', 's1_action'), ('s1_m2', 'movie', 's1_action');
    insert into vod_series(series_id, source_id, name, tmdb_id, popularity) values ('s1_sr1', 's1', 'Lost', 4607, 30);
    insert into vod_item_categories values ('s1_sr1', 'series', 's1_drama');
    insert into vod_episodes(id, series_id, season_num, episode_num, title, direct_url) values ('s1_e1', 's1_sr1', 1, 1, 'Pilot', 'http://x/e1'), ('s1_e2', 's1_sr1', 1, 2, 'Pilot 2', 'http://x/e2');
  `);
  reindexGuide(db);
}
