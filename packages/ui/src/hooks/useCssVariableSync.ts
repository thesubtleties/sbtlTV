import { useEffect } from 'react';
import { useCategoryBarWidth, useGuideOpacity, useUIStore } from '../stores/uiStore';

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

  // Linux performance mode: App.css drops every backdrop blur under this class.
  const performanceMode = useUIStore((s) => s.settings.linuxPerformanceMode === true) && !!window.platform?.isLinux;
  useEffect(() => {
    document.documentElement.classList.toggle('performance-mode', performanceMode);
  }, [performanceMode]);
}
