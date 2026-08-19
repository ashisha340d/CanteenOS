import React from 'react';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/state/authStore';
import { LoadingScreen } from '../src/components/LoadingScreen';

/**
 * Entry route. The real gating decision lives in `_layout.tsx`'s `useAuthGate`; this just
 * gives the router somewhere to land before that effect fires its first `replace`.
 */
export default function Index(): React.JSX.Element {
  const status = useAuthStore((s) => s.status);
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);

  if (status === 'unknown') return <LoadingScreen />;
  if (status === 'signedOut') return <Redirect href="/login" />;
  // A locked device lands on the pad, not on the boards. This used to fall through to the
  // tabs and rely on the gate's effect to bounce it back, which painted a frame of the
  // signed-in app behind the lock before the replace landed.
  if (status === 'pinRequired') return <Redirect href="/pin-login" />;
  if (mustChangePassword) return <Redirect href="/change-password" />;
  return <Redirect href="/(tabs)/boards" />;
}
