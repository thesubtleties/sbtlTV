import { invoke } from '@tauri-apps/api/core';
import type { StorageApi, StorageResult, Source, AppSettings, M3UImportResult } from '../types/electron';

export function createStorageBridge(): StorageApi {
  return {
    getSources: () => invoke<StorageResult<Source[]>>('get_sources'),
    getSource: (id: string) =>
      invoke<StorageResult<Source | undefined>>('get_source', { id }),
    saveSource: (source: Source) =>
      invoke<StorageResult>('save_source', { source }),
    deleteSource: (id: string) =>
      invoke<StorageResult>('delete_source', { id }),
    getSettings: () => invoke<StorageResult<AppSettings>>('get_settings'),
    updateSettings: (settings: Partial<AppSettings>) =>
      invoke<StorageResult>('update_settings', { settings }),
    isEncryptionAvailable: () =>
      invoke<StorageResult<boolean>>('is_encryption_available'),
    importM3UFile: () =>
      invoke<StorageResult<M3UImportResult> & { canceled?: boolean }>('import_m3u_file'),
  };
}
