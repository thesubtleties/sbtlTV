import { useEffect } from 'react';
import { useCategoryBarWidth, useGuideOpacity } from '../stores/uiStore';

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
}
