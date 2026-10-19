import { Component, type ErrorInfo, type ReactNode } from 'react';
import { debugLog } from '../utils/debugLog';

/**
 * Last line of defence: a render error anywhere shows a calm message with a way
 * back, instead of an empty window (React unmounts the whole tree otherwise).
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    debugLog(`Render error: ${error.message}${info.componentStack ? ` at ${info.componentStack.trim().split('\n')[0]}` : ''}`, 'app');
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', padding: 24, textAlign: 'center', background: 'var(--bg, #0d0d0d)', color: 'var(--text, #eee)' }}>
        <div>
          <h2 style={{ margin: '0 0 8px' }}>Something went wrong</h2>
          <p style={{ margin: '0 0 16px', opacity: 0.8 }}>sbtlTV hit an error showing this screen. Details are in the debug log.</p>
          <button type="button" className="st-btn st-btn--primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
