/// <reference types="vite/client" />
export function debugLog(message: string, category = 'updater'): void {
  const logMsg = `[${category}] ${message}`;
  // Development builds only: messages can hold stream URLs, which carry provider
  // credentials. Main writes them to the debug log with the URLs redacted.
  if (import.meta.env.DEV) console.log(logMsg);
  if (window.debug?.logFromRenderer) {
    window.debug.logFromRenderer(logMsg).catch(() => {});
  }
}
