import { useEffect, useState } from 'react';
import { useCategoryBarWidth, useGuideOpacity, useUIStore } from '../stores/uiStore';
import { PALETTES, applyPaletteRoles, readableOn } from '../styles/palettes';
import type { DesktopColors } from '../types/electron';

/** The desktop's accent and Caelestia palette, kept current (null until read). */
export function useDesktopColors(): DesktopColors | null {
  const [colors, setColors] = useState<DesktopColors | null>(null);
  useEffect(() => {
    const api = window.appearance;
    if (!api) return;
    let disposed = false;
    api.getDesktopColors().then((value) => { if (!disposed) setColors(value); }).catch(() => {});
    const unsubscribe = api.onDesktopColorsChanged(setColors);
    return () => { disposed = true; unsubscribe(); };
  }, []);
  return colors;
}

/**
 * Syncs Zustand guide appearance state to CSS custom properties on :root.
 * Call once at the top of the App component.
 */
export function useCssVariableSync() {
  const categoryBarWidth = useCategoryBarWidth();
  const guideOpacity = useGuideOpacity();

  useEffect(() => {
    document.documentElement.style.setProperty('--category-content-width', `${categoryBarWidth}px`);
  }, [categoryBarWidth]);

  useEffect(() => {
    document.documentElement.style.setProperty('--guide-opacity', String(guideOpacity));
  }, [guideOpacity]);

  // Palette, accent and typeface. The palette roles go inline on :root; the
  // data attributes let palettes.css and tokens.css key off the choice.
  const palette = useUIStore((s) => s.settings.appearance?.palette ?? 'sbtl');
  const accent = useUIStore((s) => s.settings.appearance?.accent ?? 'palette');
  const typeface = useUIStore((s) => s.settings.appearance?.typeface ?? 'fira');
  const desktop = useDesktopColors();
  useEffect(() => {
    const roles = palette === 'caelestia'
      ? desktop?.caelestia ?? PALETTES.sbtl.roles
      : PALETTES[palette].roles;
    const systemAccent = accent === 'system' ? desktop?.accent : null;
    applyPaletteRoles(systemAccent ? { ...roles, accent: systemAccent, onAccent: readableOn(systemAccent) } : roles);
    document.documentElement.dataset.palette = palette;
  }, [palette, accent, desktop]);
  useEffect(() => {
    document.documentElement.dataset.typeface = typeface;
  }, [typeface]);

  // Linux performance mode: App.css drops every backdrop blur under this class.
  const performanceMode = useUIStore((s) => s.settings.linuxPerformanceMode === true) && !!window.platform?.isLinux;
  useEffect(() => {
    document.documentElement.classList.toggle('performance-mode', performanceMode);
  }, [performanceMode]);
}
