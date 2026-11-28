import { checkProviderUrl, redactUrl } from '@sbtltv/core';
import type { Files, Net } from '@sbtltv/data';
import type { FetchResult } from '../../modules/sbtl-native';

const MAX_REDIRECTS = 5;
type NativeFetch = { fetchToFile(url: string, dest: string, maxBytes: number): Promise<FetchResult> };
const capText = (label: string, maxBytes: number) => `${label} exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`;

// The redirect loop of node/platform.ts's get(), over one native request per hop: every hop is checked against the
// LAN block here, in the shared guard, because the native side never follows a redirect itself.
export function makeNet(native: NativeFetch, files: Pick<Files, 'remove'>): Net {
  return {
    async downloadToFile(url, dest, { maxBytes, allowLan, label }) {
      let current = url;
      try {
        for (let redirects = 0; ; redirects++) {
          checkProviderUrl(current, allowLan);
          let r: FetchResult;
          try { r = await native.fetchToFile(current, dest, maxBytes); }
          catch (e) { if ((e as { code?: string }).code === 'ERR_SIZE_CAP') throw new Error(capText(label, maxBytes)); throw e; }
          if (r.status >= 300 && r.status < 400 && r.location) {
            if (redirects >= MAX_REDIRECTS) throw new Error(`too many redirects (${MAX_REDIRECTS}) fetching ${redactUrl(current)}`);
            current = new URL(r.location, current).toString();
            continue;
          }
          if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
          return { status: r.status, bytes: r.bytes };
        }
      } catch (e) { files.remove(dest); throw e; }
    },
  };
}
