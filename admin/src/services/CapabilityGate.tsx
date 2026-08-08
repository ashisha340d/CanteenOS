import type { Capability } from '@menuboard/shared';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

/** Route guard: redirects to the dashboard if the signed-in user lacks the capability. */
export function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}): JSX.Element {
  const { hasCapability } = useAuth();
  if (!hasCapability(capability)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
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
