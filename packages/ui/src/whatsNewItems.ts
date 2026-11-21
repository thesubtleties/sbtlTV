export interface WhatsNewItem {
  id: string;
  title: string;
  text: string;
  /** A feature that can be on or off: shows a chip with its state right now ('sync': this computer is syncing) */
  state?: 'sync';
  /** Not in the Windows portable build: there it says so and links the installer instead of the chip and button */
  installOnly?: boolean;
  action?: { label: string; to: 'add-computer' | 'open-transfer' };
}

/** A short list per release (not the release notes). Keyed by version without a prerelease part. */
export const WHATS_NEW: Record<string, WhatsNewItem[]> = {
  '0.18.0': [
    { id: 'guide', title: 'Guide refresh', text: "What's on under each channel name, show details on hover, and ended shows outlined. The on-now line can be turned off in Settings › Guide." },
    { id: 'sync', title: 'Sync', state: 'sync', installOnly: true, text: 'Keep your watchlist, progress and favorite channels the same on your own computers. End-to-end encrypted.', action: { label: 'Add a computer…', to: 'add-computer' } },
    { id: 'send', title: 'Send a setup', installOnly: true, text: "Set up another computer, or someone else's, with a short code.", action: { label: 'Open Sync & transfer', to: 'open-transfer' } },
  ],
  '0.17.0': [
    { id: 'sync', title: 'Sync', state: 'sync', installOnly: true, text: 'Keep your watchlist, progress and favorite channels the same on your own computers. End-to-end encrypted.', action: { label: 'Add a computer…', to: 'add-computer' } },
    { id: 'send', title: 'Send a setup', installOnly: true, text: "Set up another computer, or someone else's, with a short code.", action: { label: 'Open Sync & transfer', to: 'open-transfer' } },
    { id: 'more-like-this', title: 'More like this', text: 'Similar titles from your library on every movie and series page.' },
    { id: 'vod-header', title: 'Movies & Series header', text: 'Two header styles, Simple or Floating, over full-bleed art. Settings › Appearance.' },
    { id: 'loading-screen', title: 'Loading screen', text: 'A proper loading screen while a movie or episode opens, with Cancel.' },
  ],
};
