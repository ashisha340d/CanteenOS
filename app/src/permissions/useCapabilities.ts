import { useMemo } from 'react';
import type { Capability } from '@menuboard/shared';
import { ANDROID_FORBIDDEN_CAPABILITIES } from '@menuboard/shared';
import { useAuthStore } from '../state/authStore';

/**
 * RBAC-gating convention for this app: screens and actions are shown/hidden based on the
 * `capabilities` array the server returned at login/`/auth/me` — never a hardcoded role
 * check (mirrors docs/TASK.md §6.2's Admin Portal rule, applied here). Capabilities in
 * `ANDROID_FORBIDDEN_CAPABILITIES` are defensively filtered client-side too, on top of the
 * server already stripping them from the token, so no UI entry point can ever appear for
 * billing/reports/masters-write/user-write/etc. even if a future capability is added to a
 * role by mistake.
 */
export function useCapabilities(): {
  capabilities: Set<Capability>;
  has: (capability: Capability) => boolean;
} {
  const capabilities = useAuthStore((s) => s.capabilities);

  return useMemo(() => {
    const forbidden = new Set<string>(ANDROID_FORBIDDEN_CAPABILITIES);
    const allowed = new Set(capabilities.filter((c) => !forbidden.has(c))) as Set<Capability>;
    return {
      capabilities: allowed,
      has: (capability: Capability) => allowed.has(capability),
    };
  }, [capabilities]);
}
