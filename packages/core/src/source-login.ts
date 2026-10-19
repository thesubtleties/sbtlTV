/** An Xtream source with no password (e.g. from a setup shared without logins): nothing to sync until one is entered. */
export function needsLogin(s: { type: string; password?: string }): boolean {
  return s.type === 'xtream' && !s.password;
}
