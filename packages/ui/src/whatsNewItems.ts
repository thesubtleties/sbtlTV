export interface WhatsNewItem {
  id: string;
  title: string;
  text: string;
  /** Off until the user turns it on: shown with an "off" tag */
  off?: boolean;
  action?: { label: string; to: 'add-computer' | 'open-transfer' };
}

/** A short list per release (not the release notes). Keyed by version without a prerelease part. */
export const WHATS_NEW: Record<string, WhatsNewItem[]> = {
  '0.17.0': [
    { id: 'sync', title: 'Sync', off: true, text: 'Keep your watchlist, progress and favorite channels the same on your own computers. End-to-end encrypted.', action: { label: 'Add a computer…', to: 'add-computer' } },
    { id: 'send', title: 'Send a setup', text: "Set up another computer, or someone else's, with a short code.", action: { label: 'Open Sync & transfer', to: 'open-transfer' } },
    { id: 'more-like-this', title: 'More like this', text: 'Similar titles from your library on every movie and series page.' },
    { id: 'vod-header', title: 'Movies & Series header', text: 'Two header styles, Simple or Floating, over full-bleed art. Settings › Appearance.' },
    { id: 'loading-screen', title: 'Loading screen', text: 'A proper loading screen while a movie or episode opens, with Cancel.' },
  ],
};
