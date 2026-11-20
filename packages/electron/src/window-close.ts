/**
 * Closing the window (the X button) is the usual way to quit on Windows and Linux, so the page saves
 * where playback is and sync sends it before the window goes. Not when a quit already did that: the
 * close then has to go through at once, or the window cancels the quit (macOS then kept the app
 * running with no window and its data process already stopped).
 */
export function saveOnWindowClose(s: { alreadySaved: boolean; quitting: boolean; installingUpdate: boolean; recovering: boolean }): boolean {
  return !s.alreadySaved && !s.quitting && !s.installingUpdate && !s.recovering;
}
