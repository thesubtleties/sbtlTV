const OS_NAMES: Record<string, string> = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };

/** A new GitHub issue with the version and OS filled in; the person adds what happened and drags the report zip in. */
export function issueUrl(version: string, platform: string): string {
  const body = `**sbtlTV** ${version} on ${OS_NAMES[platform] ?? platform}\n\n<!-- What happened, and what did you expect? -->\n\n↓ Drag the sbtltv-report zip here\n`;
  return `https://github.com/thesubtleties/sbtlTV/issues/new?body=${encodeURIComponent(body)}`;
}
