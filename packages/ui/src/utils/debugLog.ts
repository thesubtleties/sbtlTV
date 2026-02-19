export function debugLog(message: string): void {
  const logMsg = `[updater] ${message}`;
  console.log(logMsg);
  if (window.debug?.logFromRenderer) {
    window.debug.logFromRenderer(logMsg).catch(() => {});
  }
}
