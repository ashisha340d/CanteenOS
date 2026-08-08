import { randomUUID, randomBytes } from 'node:crypto';

/** UUID v4. The same format Android generates offline, so ids are interchangeable. */
export function newId(): string {
  return randomUUID();
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** URL-safe opaque secret, used for refresh tokens and signed media URLs. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
