import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown in the message: "Messages could not be shown". Without it, the whole window failed. */
  area?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches a crash while drawing, so River shows what happened and a way back instead of a blank
 * window. Around one page, only that page is replaced; the rest of River keeps working.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('River could not draw part of its window:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const area = this.props.area;
    return (
      <div className={`crash ${area ? 'crash--page' : ''}`} role="alert">
        <div className="crash__card glass">
          <h1 className="crash__title">Something went wrong</h1>
          <p className="muted">
            {area
              ? `${area} could not be shown. The rest of River still works.`
              : 'River ran into a problem while drawing this window. Your messages and keys are safe.'}
          </p>
          {error.message && <pre className="crash__detail">{error.message}</pre>}
          <div className="button-row">
            {area && (
              <button className="btn btn--ghost" onClick={() => this.setState({ error: null })}>
                Try again
              </button>
            )}
            <button className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
