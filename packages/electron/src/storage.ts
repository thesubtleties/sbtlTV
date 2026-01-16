import Store from 'electron-store';
import { safeStorage } from 'electron';
import type { Source } from '@netv/core';

// Store schema - passwords stored as encrypted buffers
interface StoreSchema {
  sources: StoredSource[];
  settings: AppSettings;
}

// Source as stored (password encrypted)
interface StoredSource {
  id: string;
  name: string;
  type: 'xtream' | 'm3u' | 'epg';
  url: string;
  enabled: boolean;
  epg_url?: string;
  // Xtream-specific (encrypted)
  username?: string;
  encryptedPassword?: string; // Base64 encoded encrypted buffer
}

interface AppSettings {
  theme: 'dark' | 'light';
  lastSourceId?: string;
}

const store = new Store<StoreSchema>({
  name: 'netv-config',
  defaults: {
    sources: [],
    settings: {
      theme: 'dark',
    },
  },
});

/**
 * Encrypt a password using OS-level encryption
 */
function encryptPassword(password: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: base64 encode (not secure, but works)
    console.warn('[storage] safeStorage not available, using base64 fallback');
    return Buffer.from(password).toString('base64');
  }
  const encrypted = safeStorage.encryptString(password);
  return encrypted.toString('base64');
}

/**
 * Decrypt a password
 */
function decryptPassword(encryptedBase64: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: base64 decode
    return Buffer.from(encryptedBase64, 'base64').toString('utf-8');
  }
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  return safeStorage.decryptString(encrypted);
}

/**
 * Get all sources (with passwords decrypted)
 */
export function getSources(): Source[] {
  const stored = store.get('sources', []);
  return stored.map((s) => {
    const source: Source = {
      id: s.id,
      name: s.name,
      type: s.type,
      url: s.url,
      enabled: s.enabled,
      epg_url: s.epg_url,
    };
    if (s.type === 'xtream' && s.username) {
      source.username = s.username;
      if (s.encryptedPassword) {
        source.password = decryptPassword(s.encryptedPassword);
      }
    }
    return source;
  });
}

/**
 * Get a single source by ID
 */
export function getSource(id: string): Source | undefined {
  const sources = getSources();
  return sources.find((s) => s.id === id);
}

/**
 * Add or update a source
 */
export function saveSource(source: Source): void {
  const sources = store.get('sources', []);
  const stored: StoredSource = {
    id: source.id,
    name: source.name,
    type: source.type,
    url: source.url,
    enabled: source.enabled,
    epg_url: source.epg_url,
  };

  if (source.type === 'xtream') {
    stored.username = source.username;
    if (source.password) {
      stored.encryptedPassword = encryptPassword(source.password);
    }
  }

  const existingIndex = sources.findIndex((s) => s.id === source.id);
  if (existingIndex >= 0) {
    sources[existingIndex] = stored;
  } else {
    sources.push(stored);
  }

  store.set('sources', sources);
}

/**
 * Delete a source
 */
export function deleteSource(id: string): void {
  const sources = store.get('sources', []);
  store.set(
    'sources',
    sources.filter((s) => s.id !== id)
  );
}

/**
 * Get app settings
 */
export function getSettings(): AppSettings {
  return store.get('settings');
}

/**
 * Update app settings
 */
export function updateSettings(settings: Partial<AppSettings>): void {
  const current = store.get('settings');
  store.set('settings', { ...current, ...settings });
}

/**
 * Clear all data (for debugging/reset)
 */
export function clearAll(): void {
  store.clear();
}

/**
 * Check if secure encryption is available
 * Returns false on Linux without a keyring daemon
 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}
