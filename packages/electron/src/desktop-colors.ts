/**
 * Colors the desktop provides, for the Appearance settings:
 * - the system accent (Windows/macOS from Electron; Linux from the desktop
 *   portal, which GNOME 47+ and Plasma 6 implement), and
 * - Caelestia's wallpaper palette (~/.local/state/caelestia/scheme.json), the
 *   same file shtl follows, mapped onto sbtlTV's palette roles with shtl's
 *   readability checks so a pale wallpaper cannot make text unreadable.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export interface PaletteRoles {
  bg: string;
  card: string;
  surface: string;
  line: string;
  edge: string;
  fg: string;
  muted: string;
  accent: string;
  onAccent: string;
  danger: string;
  teal: string;
}

export interface DesktopColors {
  /** '#rrggbb', or null when the desktop does not expose one */
  accent: string | null;
  /** Caelestia's palette mapped to sbtlTV roles, or null when not running Caelestia */
  caelestia: PaletteRoles | null;
}

// Starting point for roles Caelestia's scheme leaves unreadable: the sbtl palette.
const SBTL: PaletteRoles = {
  bg: '#0d0d0d', card: '#141414', surface: '#1a1a1a', line: 'rgba(255, 255, 255, 0.1)',
  edge: 'rgba(255, 255, 255, 0.2)', fg: '#ffffff', muted: 'rgba(255, 255, 255, 0.5)',
  accent: '#00d4ff', onAccent: '#0d0d0d', danger: '#ef4444', teal: '#22c55e',
};

const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast between two '#rrggbb' colors (0 if either is not one). */
export function contrast(a: string, b: string): number {
  if (!HEX.test(a) || !HEX.test(b)) return 0;
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Text color (black or white) that reads best on `hex`. */
export function readableOn(hex: string): string {
  return contrast('#000000', hex) > contrast('#ffffff', hex) ? '#000000' : '#ffffff';
}

/**
 * Map Caelestia's Material roles (hex without '#') onto palette roles. Port of
 * shtl's Theme.qml fromShell(): surfaces move together and only when text stays
 * readable on them; accent, danger and the second tone each need contrast too.
 */
export function paletteFromCaelestia(colours: Record<string, string>): PaletteRoles {
  const c = (name: string) => {
    const value = colours[name];
    return value && /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : undefined;
  };
  const palette: PaletteRoles = { ...SBTL };
  const surfaces = {
    bg: c('surfaceContainerLowest') ?? c('background'),
    card: c('surfaceContainer') ?? c('surface'),
    surface: c('surfaceContainerHigh') ?? c('surfaceVariant'),
    line: c('outlineVariant'),
    edge: c('outline'),
    fg: c('onSurface'),
    muted: c('onSurfaceVariant'),
  };
  if (surfaces.card && surfaces.fg && contrast(surfaces.fg, surfaces.card) >= 7
    && (!surfaces.muted || contrast(surfaces.muted, surfaces.card) >= 3.5)) {
    for (const [role, value] of Object.entries(surfaces)) {
      if (value) palette[role as keyof typeof surfaces] = value;
    }
  }
  const primary = c('primary');
  if (primary && contrast(primary, palette.card) >= 3) {
    palette.accent = primary;
    const onPrimary = c('onPrimary');
    palette.onAccent = onPrimary && contrast(onPrimary, primary) >= 4.5 ? onPrimary : readableOn(primary);
  }
  const error = c('error');
  if (error && contrast(error, palette.card) >= 3) palette.danger = error;
  const tertiary = c('tertiary');
  if (tertiary && contrast(tertiary, palette.card) >= 3) palette.teal = tertiary;
  return palette;
}

export const CAELESTIA_SCHEME = path.join(homedir(), '.local', 'state', 'caelestia', 'scheme.json');

function readCaelestia(): PaletteRoles | null {
  if (process.platform !== 'linux' || !existsSync(CAELESTIA_SCHEME)) return null;
  try {
    const scheme = JSON.parse(readFileSync(CAELESTIA_SCHEME, 'utf8')) as { colours?: Record<string, string> };
    return scheme.colours ? paletteFromCaelestia(scheme.colours) : null;
  } catch {
    return null; // half-written; the watcher reads it again on the next change
  }
}

/** Parse gdbus's reply to the portal's accent-color read: three doubles in 0..1. */
export function parsePortalAccent(output: string): string | null {
  const numbers = output.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)?.map(Number) ?? [];
  // The reply leads with the variant; the last three numbers are r, g, b.
  const rgb = numbers.slice(-3);
  if (rgb.length !== 3 || rgb.some(value => !(value >= 0 && value <= 1))) return null;
  return `#${rgb.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
}

function readLinuxAccent(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('gdbus', [
      'call', '--session', '--dest', 'org.freedesktop.portal.Desktop',
      '--object-path', '/org/freedesktop/portal/desktop',
      '--method', 'org.freedesktop.portal.Settings.ReadOne', 'org.freedesktop.appearance', 'accent-color',
    ], { timeout: 2000 }, (error, stdout) => resolve(error ? null : parsePortalAccent(stdout)));
  });
}

async function readAccent(): Promise<string | null> {
  if (process.platform === 'linux') return readLinuxAccent();
  if (process.platform !== 'win32' && process.platform !== 'darwin') return null;
  const { systemPreferences } = await import('electron');
  const value = systemPreferences.getAccentColor?.();
  return value && /^[0-9a-f]{6,8}$/i.test(value) ? `#${value.slice(0, 6).toLowerCase()}` : null;
}

export async function readDesktopColors(): Promise<DesktopColors> {
  const [accent, caelestia] = await Promise.all([readAccent().catch(() => null), Promise.resolve(readCaelestia())]);
  return { accent, caelestia };
}

/** Call `onChange` when Caelestia rewrites its scheme (every wallpaper change). */
export function watchDesktopColors(onChange: () => void): () => void {
  if (process.platform !== 'linux') return () => {};
  const dir = path.dirname(CAELESTIA_SCHEME);
  if (!existsSync(dir)) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dir, (_event, file) => {
      if (file !== path.basename(CAELESTIA_SCHEME)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 200);
    });
  } catch {
    return () => {};
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}
