import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

const RECOVER_AFTER_MS = 6_000;

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };
  private timer: number | null = null;

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('KDS crashed', error, info.componentStack);
    this.timer = window.setTimeout(() => window.location.reload(), RECOVER_AFTER_MS);
  }

  override componentWillUnmount(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-canvas px-8 text-center">
        <h1 className="text-2xl">This display needs a moment</h1>
        <p className="text-base text-ink-soft">It will restart itself. Please tell staff if it does not.</p>
      </div>
    );
  }
}
