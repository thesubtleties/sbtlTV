// The data process installs a guard that refuses URLs the user has not allowed
// (see @sbtltv/core url-guard). The renderer path goes through main's fetch
// proxy, which enforces the same rule itself, so the guard is a no-op there.
type UrlGuard = (url: string) => void;
let guard: UrlGuard | null = null;

export function setUrlGuard(next: UrlGuard | null): void { guard = next; }

const MAX_REDIRECTS = 5;

// fetch() with every redirect hop passed through the guard.
export async function guardedFetch(url: string, init?: RequestInit): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop++) {
    guard?.(current);
    const response = await fetch(current, { ...init, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects (${MAX_REDIRECTS})`);
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
}
