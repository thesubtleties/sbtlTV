import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { MpvApi, MpvStatus, MpvResult } from '../types/electron';

// Collect unlisteners for cleanup
const unlisteners: UnlistenFn[] = [];

export function createMpvBridge(): MpvApi {
  return {
    load: (url: string) => invoke<MpvResult>('mpv_load', { url }),
    play: () => invoke<MpvResult>('mpv_play'),
    pause: () => invoke<MpvResult>('mpv_pause'),
    togglePause: () => invoke<MpvResult>('mpv_toggle_pause'),
    stop: () => invoke<MpvResult>('mpv_stop'),
    setVolume: (volume: number) => invoke<MpvResult>('mpv_set_volume', { volume }),
    toggleMute: () => invoke<MpvResult>('mpv_toggle_mute'),
    seek: (seconds: number) => invoke<MpvResult>('mpv_seek', { seconds }),
    getStatus: () => invoke<MpvStatus>('mpv_get_status'),

    onReady: (callback: (ready: boolean) => void) => {
      listen<boolean>('mpv-ready', (event) => callback(event.payload)).then(
        (unlisten) => unlisteners.push(unlisten),
      );
    },

    onStatus: (callback: (status: MpvStatus) => void) => {
      listen<MpvStatus>('mpv-status', (event) => callback(event.payload)).then(
        (unlisten) => unlisteners.push(unlisten),
      );
    },

    onError: (callback: (error: string) => void) => {
      listen<string>('mpv-error', (event) => callback(event.payload)).then(
        (unlisten) => unlisteners.push(unlisten),
      );
    },

    removeAllListeners: () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
      unlisteners.length = 0;
    },
  };
}
