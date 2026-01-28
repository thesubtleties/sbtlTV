import { invoke } from '@tauri-apps/api/core';
import type { FetchProxyApi, StorageResult, FetchProxyResponse } from '../types/electron';

export function createFetchProxyBridge(): FetchProxyApi {
  return {
    fetch: (
      url: string,
      options?: { method?: string; headers?: Record<string, string>; body?: string },
    ) =>
      invoke<StorageResult<FetchProxyResponse>>('fetch_proxy', { url, options }),
    fetchBinary: (url: string) =>
      invoke<StorageResult<string>>('fetch_binary', { url }),
  };
}
