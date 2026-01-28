import { invoke } from '@tauri-apps/api/core';
import type { PlatformApi } from '../types/electron';

let cached: PlatformApi | null = null;

export async function createPlatformBridge(): Promise<PlatformApi> {
  if (cached) return cached;
  cached = await invoke<PlatformApi>('get_platform');
  return cached;
}
