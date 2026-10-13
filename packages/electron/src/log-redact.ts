// Provider credentials stay out of the debug log and the error card: IPTV
// URLs carry them in the path (Xtream: /live/<user>/<pass>/<id>.ts), the query
// or before the host. Pure, so it runs under node:test.

const URL_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)(?:[^\s/?#@"'<>]*@)?([^\s/?#"'<>]+)([/?#][^\s"'<>]*)?/gi;

/** Every URL in the text cut down to scheme://host/… */
export function redactUrls(text: string): string {
  return text.replace(URL_PATTERN, (_match, scheme: string, host: string, rest: string | undefined) =>
    rest ? `${scheme}${host}/…` : `${scheme}${host}`);
}
