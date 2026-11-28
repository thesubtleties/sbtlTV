import { Paths } from 'expo-file-system';
import { rnPlatform } from '../platform';
import { assertEq, type SelfTestSuite } from './runner';

const P = rnPlatform();
const cache = () => Paths.cache.uri.replace(/^file:\/\//, '').replace(/\/$/, '');
const URL_TV = 'https://raw.githubusercontent.com/thesubtleties/sbtlTV-tmdb-cache/main/data/tmdb-tvs-enriched.ndjson.gz';

export const netSuite: SelfTestSuite = { name: 'net', tests: [
  { name: 'download (redirect loop + guard) and gunzip through rnPlatform', run: async () => {
    const gz = `${cache()}/selftest-${P.uuid()}.gz`; const out = `${cache()}/selftest-${P.uuid()}.ndjson`;
    const r = await P.net.downloadToFile(URL_TV, gz, { maxBytes: 256 * 1024 * 1024, allowLan: false, label: 'TMDB download' });
    assertEq(r.status, 200, 'status'); assertEq(r.bytes > 1_000_000, true, 'bytes');
    await P.gunzip.gunzipFile(gz, out, { maxBytes: 1024 * 1024 * 1024, label: 'TMDB decompression' });
    assertEq(P.files.size(out) > 10_000_000, true, 'inflated size');
    const capped = `${cache()}/selftest-${P.uuid()}.ndjson`;
    let msg = ''; try { await P.gunzip.gunzipFile(gz, capped, { maxBytes: 1024 * 1024, label: 'TMDB decompression' }); } catch (e) { msg = (e as Error).message; }
    assertEq(msg, 'TMDB decompression exceeds 1MB limit', 'cap text'); assertEq(P.files.exists(capped), false, 'capped output removed');
    P.files.remove(gz); P.files.remove(out);
  } },
  { name: 'a LAN address is refused before any request', run: async () => {
    let msg = ''; try { await P.net.downloadToFile('http://192.168.0.1/x', `${cache()}/nope`, { maxBytes: 1, allowLan: false, label: 'x' }); } catch (e) { msg = (e as Error).message; }
    assertEq(msg.startsWith('Blocked: local network access is disabled'), true, 'blocked');
  } },
] };
