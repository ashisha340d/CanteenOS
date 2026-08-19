import { useEffect, useState } from 'react';
import type { BoardRole, Capability } from '@menuboard/shared';
import { hasCapability } from '@menuboard/shared';
import { boardRepository } from '../db/repositories';
import { useAuthStore } from '../state/authStore';

/**
 * Board-scoped capability check, mirroring the backend's two-plane authorisation
 * (docs/TASK.md §4): global role capabilities plus the caller's board membership role,
 * read from the local `board_members` cache. Renders nothing until resolved.
 */
export function useBoardCapability(boardId: string | undefined, capability: Capability): boolean {
  const user = useAuthStore((s) => s.user);
  const [boardRole, setBoardRole] = useState<BoardRole | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!boardId || !user) {
      setBoardRole(null);
      return;
    }
    boardRepository
      .findMembership(boardId, user.id)
      .then((membership) => {
        if (!cancelled) setBoardRole(membership?.boardRole ?? null);
      })
      // A failed read must deny rather than reject unhandled: no membership is the safe
      // answer, and an unhandled rejection here took down the screen that asked.
      .catch(() => {
        if (!cancelled) setBoardRole(null);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, user]);

  if (!user) return false;
  return hasCapability(user.role, boardRole, capability);
}
