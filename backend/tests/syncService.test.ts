import { SYNC_ENTITIES } from '@menuboard/shared';
import { describe, expect, it } from 'vitest';
import { syncService } from '../src/services/SyncService';

/** `resolveCursor` reads every key in SYNC_ENTITIES; fill the ones a test does not care about. */
function changeSet(
  partial: Partial<Record<(typeof SYNC_ENTITIES)[number], { syncSeq: number }[]>>,
): Record<string, { syncSeq: number }[]> {
  const full: Record<string, { syncSeq: number }[]> = {};
  for (const entity of SYNC_ENTITIES) full[entity] = partial[entity] ?? [];
  return full;
}

/**
 * `resolveConflict` and `resolveCursor` are private, pure decision functions on SyncService —
 * they touch no database and have no side effects, so they are exercised directly here rather
 * than through the full push/pull HTTP surface (covered by scripts/smoke.mjs).
 */
const service = syncService as unknown as {
  resolveConflict: (
    item: { baseRevision?: number; clientTimestamp: string },
    serverRevision: number,
    serverUpdatedAt: string,
  ) => 'client-wins' | 'server-wins';
  resolveCursor: (
    changes: Record<string, { syncSeq: number }[]>,
    fromCursor: number,
    limit: number,
  ) => { nextCursor: number; hasMore: boolean };
};

describe('SyncService.resolveConflict (last-write-wins with a revision guard)', () => {
  it('is client-wins when the client never sent a baseRevision (new/unconditional write)', () => {
    const result = service.resolveConflict(
      { clientTimestamp: '2026-01-01T00:00:00.000Z' },
      5,
      '2026-01-01 00:00:00',
    );
    expect(result).toBe('client-wins');
  });

  it('is client-wins when the baseRevision matches the server (no real conflict)', () => {
    const result = service.resolveConflict(
      { baseRevision: 3, clientTimestamp: '2026-01-01T00:00:00.000Z' },
      3,
      '2025-01-01 00:00:00',
    );
    expect(result).toBe('client-wins');
  });

  it('is client-wins when revisions diverge but the client timestamp is strictly later', () => {
    const result = service.resolveConflict(
      { baseRevision: 2, clientTimestamp: '2026-06-01T12:00:00.000Z' },
      5,
      '2026-05-01 12:00:00',
    );
    expect(result).toBe('client-wins');
  });

  it('is server-wins when revisions diverge and the server timestamp is later or equal', () => {
    const result = service.resolveConflict(
      { baseRevision: 2, clientTimestamp: '2026-01-01T00:00:00.000Z' },
      5,
      '2026-06-01 00:00:00',
    );
    expect(result).toBe('server-wins');
  });

  it('is server-wins (fails safe) when the client clock is unparseable', () => {
    const result = service.resolveConflict(
      { baseRevision: 2, clientTimestamp: 'not-a-timestamp' },
      5,
      '2026-01-01 00:00:00',
    );
    expect(result).toBe('server-wins');
  });
});

describe('SyncService.resolveCursor (atomic pull pagination)', () => {
  it('advances to the highest syncSeq seen when no entity was truncated', () => {
    const { nextCursor, hasMore } = service.resolveCursor(
      changeSet({ orders: [{ syncSeq: 10 }, { syncSeq: 12 }], boards: [{ syncSeq: 8 }] }),
      5,
      100,
    );
    expect(nextCursor).toBe(12);
    expect(hasMore).toBe(false);
  });

  it('stays at the minimum highest-seq of any truncated entity, so no row is skipped', () => {
    // orders filled its page (limit 2) topping out at 20; boards did not fill its page and
    // topped out at 30. The next cursor must not jump past what orders has not yet delivered.
    const { nextCursor, hasMore } = service.resolveCursor(
      changeSet({ orders: [{ syncSeq: 15 }, { syncSeq: 20 }], boards: [{ syncSeq: 30 }] }),
      5,
      2,
    );
    expect(nextCursor).toBe(20);
    expect(hasMore).toBe(true);
  });

  it('never regresses the cursor below fromCursor when every entity is empty', () => {
    const { nextCursor, hasMore } = service.resolveCursor(changeSet({}), 42, 100);
    expect(nextCursor).toBe(42);
    expect(hasMore).toBe(false);
  });
});
