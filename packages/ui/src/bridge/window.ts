import { invoke } from '@tauri-apps/api/core';
import type { ElectronWindowApi } from '../types/electron';

export function createWindowBridge(): ElectronWindowApi {
  return {
    minimize: () => invoke('window_minimize'),
    maximize: () => invoke('window_maximize'),
    close: () => invoke('window_close'),
    getSize: () => invoke<[number, number]>('window_get_size'),
    setSize: (width: number, height: number) =>
      invoke('window_set_size', { width, height }),
  };
}
