import { nowIso, offsetIso } from '../utils/date';

const MS_PER_SECOND = 1000;

/**
 * Exponential backoff with jitter for the sync and media upload workers.
 * Schedule: 2s, 4s, 8s, 16s, 32s, 60s, then every 60s.
 * Jitter is ±25% of the base delay to reduce thundering-herd after a network partition.
 */
export function computeNextAttemptAtIso(attempts: number, fromIso?: string): string {
  const baseSeconds = attempts < 6 ? 2 ** attempts : 60;
  const baseMs = baseSeconds * MS_PER_SECOND;
  const jitterMs = baseMs * 0.25;
  const delayMs = baseMs - jitterMs + Math.random() * jitterMs * 2;
  return offsetIso(fromIso ?? nowIso(), delayMs);
}

export function backoffDelayMs(attempts: number): number {
  const baseSeconds = attempts < 6 ? 2 ** attempts : 60;
  const baseMs = baseSeconds * MS_PER_SECOND;
  const jitterMs = baseMs * 0.25;
  return baseMs - jitterMs + Math.random() * jitterMs * 2;
}
