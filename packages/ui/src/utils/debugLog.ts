export function debugLog(message: string, category = 'updater'): void {
  const logMsg = `[${category}] ${message}`;
  console.log(logMsg);
  if (window.debug?.logFromRenderer) {
    window.debug.logFromRenderer(logMsg).catch(() => {});
  }
}
