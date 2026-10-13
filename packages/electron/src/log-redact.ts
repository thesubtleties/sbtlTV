// Provider credentials stay out of the debug log and the error card: IPTV
// URLs carry them in the path (Xtream: /live/<user>/<pass>/<id>.ts), the query
// or before the host. Pure, so it runs under node:test.

// A URL runs to the next whitespace: passwords can hold quotes, < or @, so
// nothing inside the token may end it early.
const URL_TOKEN = /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi;

/** Every URL in the text cut down to scheme://host/… (scheme://… when it has credentials before the host). */
export function redactUrls(text: string): string {
  return text.replace(URL_TOKEN, (token) => {
    const split = token.indexOf('://') + 3;
    const scheme = token.slice(0, split);
    const rest = token.slice(split);
    // user:pass@host, where the password may itself hold @ or /: keep none of it.
    if (rest.includes('@')) return `${scheme}…`;
    const hostEnd = rest.search(/[/?#]/);
    if (hostEnd === -1) return token;
    return `${scheme}${rest.slice(0, hostEnd)}/…`;
  });
}
