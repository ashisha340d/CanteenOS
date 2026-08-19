import { Component, type ErrorInfo, type ReactNode } from 'react';
import { LotusMark } from './Marks';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** How long the guest is left looking at the apology before the kiosk reloads itself. */
const RECOVER_AFTER_MS = 6_000;

/**
 * The last line of defence on an unattended tablet.
 *
 * Without this, one render error anywhere in the tree leaves a white screen on a stand in a
 * public hall until somebody notices — which, on a kiosk, can be hours. React gives no way to
 * recover a subtree whose state is already corrupt, so the honest recovery is the one a
 * person would perform: apologise briefly and reload the page. The device session survives a
 * reload, so the kiosk comes back on the menu rather than on a staff password prompt.
 *
 * Deliberately not translated through the string table: this component has to work when the
 * failure *was* the language provider, so it carries both languages as literals — the one
 * place in the kiosk where that is correct rather than sloppy.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };
  private timer: number | null = null;

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nowhere to report to — the kiosk holds no logging capability — but a tablet left in
    // kiosk mode still has a console somebody can open over remote debugging.
    console.error('Kiosk crashed', error, info.componentStack);
    this.timer = window.setTimeout(() => window.location.reload(), RECOVER_AFTER_MS);
  }

  override componentWillUnmount(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-5 bg-canvas px-8 text-center">
        <LotusMark className="animate-breathe size-16 text-trim" />
        <div>
          <h1 className="font-display text-2xl">This kiosk needs a moment</h1>
          <p className="mt-1 font-display text-lg text-ink-soft" lang="hi">
            कियोस्क को एक क्षण चाहिए
          </p>
        </div>
        <div className="max-w-md">
          <p className="text-base text-ink-soft">
            It will restart itself. Please ask a staff member if it does not.
          </p>
          <p className="mt-1 text-sm text-ink-faint" lang="hi">
            यह स्वयं पुनः आरंभ हो जाएगा। न हो तो कृपया कर्मचारी से कहें।
          </p>
        </div>
      </div>
    );
  }
}
