/**
 * Whether `mpv --list-options` output lists an option. mpv refuses to start on an option it doesn't know, so an
 * option newer than some builds (e.g. --media-controls, Windows, 2024+) is only passed when the binary lists it.
 * Lines look like " --media-controls                 Choices: no player yes (default: player)".
 */
export function listsOption(listOutput: string, name: string): boolean {
  const want = `--${name}`;
  return listOutput.split(/\r?\n/).some((line) => {
    const t = line.trimStart();
    return t === want || t.startsWith(want + ' ') || t.startsWith(want + '\t') || t.startsWith(want + '=');
  });
}
