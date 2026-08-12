import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Shown instead of the default panel. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /**
   * Changing this remounts the boundary, clearing a caught error. Route-level boundaries pass
   * the pathname so navigating away from a broken page recovers without a reload.
   */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Without this, any render-time throw unmounts the whole tree and leaves a white page with no
 * way back — React has no default UI for a render error. Class component because there is
 * still no hook equivalent of componentDidCatch.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <EmptyState
        icon={<TriangleAlertIcon />}
        title="Something went wrong"
        description={error.message || 'This page could not be displayed.'}
        action={{ label: 'Try again', onClick: this.reset }}
      />
    );
  }
}

/**
 * Top-level boundary. A failure this high up means the shell itself is broken, so the only
 * honest recovery is a reload — there is no working navigation left to offer.
 */
export function RootErrorBoundary({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ErrorBoundary
      fallback={(error) => (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-md space-y-4 text-center">
            <TriangleAlertIcon className="text-destructive mx-auto size-10" />
            <h1 className="text-lg font-semibold">The portal could not start</h1>
            <p className="text-muted-foreground text-sm">
              {error.message || 'An unexpected error occurred.'}
            </p>
            <Button onClick={() => window.location.reload()}>Reload</Button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
