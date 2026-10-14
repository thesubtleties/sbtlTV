// Provider credentials stay out of the debug log and the error card: IPTV
// URLs carry them in the path (Xtream: /live/<user>/<pass>/<id>.ts), the query
// or before the host. Pure, so it runs under node:test.

// Every :// starts a URL, whatever is glued in front of it (no word-boundary or
// scheme rules a log line could slip past), and the URL runs to the next
// whitespace: passwords can hold quotes, < or @, so nothing inside may end it early.
const URL_TOKEN = /[a-z0-9+.-]*:\/\/\S*/gi;

/** Every URL in the text cut down to scheme://host/… (scheme://… when the URL holds an @ anywhere: credentials may sit before the host). */
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
