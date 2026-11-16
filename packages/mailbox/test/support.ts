/** Test helpers: a proof-of-work header the way the app makes one (challenge from the server's hello). */
import { POW_HEADER, VERSION_HEADER, checkPow, powInput, solvePow } from '../src/protocol';

type Fetcher = { fetch: (r: Request) => Response | Promise<Response> };

export async function challengeOf(app: Fetcher, version = '0.17.0'): Promise<string> {
  const res = await app.fetch(new Request('http://mailbox/v1/hello', { headers: { [VERSION_HEADER]: version } }));
  return ((await res.json()) as { challenge: string }).challenge;
}

/** The proof header value for this exact request; `exact` = exactly `bits` zero bits (no lucky overshoot). */
export async function proof(app: Fetcher, path: string, text: string, bits: number, version = '0.17.0', exact = false, challenge?: string): Promise<string> {
  const ch = challenge ?? await challengeOf(app, version);
  const input = powInput(path, text, ch, version);
  let nonce = solvePow(input, bits);
  while (exact && checkPow(input, nonce, bits + 1)) nonce = solvePow(input, bits);
  return `${ch}.${nonce}`;
}

export { POW_HEADER, VERSION_HEADER };
