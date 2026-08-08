/**
 * Dependency-free bridge between the local-first repositories and the sync engine.
 *
 * `syncQueueRepository.enqueue` calls `nudgeSync()` after every outbox insert so a local
 * mutation is pushed within a second instead of waiting for the 30s periodic timer. It lives
 * in its own module (rather than repositories importing the engine directly) because the
 * engine's push worker already imports the repositories — a direct import would be a cycle.
 */
let handler: (() => void) | null = null;

export function setSyncNudgeHandler(next: (() => void) | null): void {
  handler = next;
}

export function nudgeSync(): void {
  handler?.();
}
