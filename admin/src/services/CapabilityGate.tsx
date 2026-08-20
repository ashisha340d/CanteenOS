import type { Capability } from '@menuboard/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * Route guard.
 *
 * It used to redirect silently to the dashboard, which was actively misleading: a user who
 * followed a link to a screen they were not granted — or, far more commonly, whose signed-in
 * session predates a permission change — landed on the dashboard with no explanation and
 * reasonably concluded the feature was broken. Capabilities are issued at sign-in and only
 * refreshed on a full page load, so "your session is out of date" is the likeliest cause of
 * getting here, and the one worth saying out loud.
 *
 * Unauthenticated users still redirect, because for them the login screen *is* the explanation.
 */
export function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}): JSX.Element {
  const { hasCapability, status, user, logout } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <CapabilityGateShell title="Checking your access…" />;
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  if (hasCapability(capability)) return <>{children}</>;

  return (
    <CapabilityGateShell title="You do not have access to this screen">
      <p className="text-muted-foreground text-sm">
        <span className="text-foreground font-medium">{user?.name ?? 'Your account'}</span> is not
        granted <code className="bg-muted rounded px-1 py-0.5 text-xs">{capability}</code>, which
        this screen requires.
      </p>
      <p className="text-muted-foreground text-sm">
        If this permission was granted recently, your signed-in session is still using the
        capabilities it was issued at sign-in. Reload the page to pick them up, or sign in again.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-sm font-medium"
          onClick={() => window.location.reload()}
        >
          Reload and retry
        </button>
        <button
          type="button"
          className="border-border hover:bg-muted rounded-md border px-3 py-1.5 text-sm font-medium"
          onClick={() => void logout()}
        >
          Sign in again
        </button>
        <a
          href="/"
          className="border-border hover:bg-muted rounded-md border px-3 py-1.5 text-sm font-medium"
        >
          Back to dashboard
        </a>
      </div>
      <p className="text-muted-foreground/70 pt-1 font-mono text-[11px]">{location.pathname}</p>
    </CapabilityGateShell>
  );
}

function CapabilityGateShell({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="border-border bg-card w-full max-w-lg space-y-3 rounded-lg border p-6">
        <h1 className="text-foreground text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** Inline conditional render, for hiding a nav item or an action button. */
export function IfCapable({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}): JSX.Element | null {
  const { hasCapability } = useAuth();
  return hasCapability(capability) ? <>{children}</> : null;
}
