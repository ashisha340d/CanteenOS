import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

/** Client-generatable UUID v4 — every local primary key is created this way (ARCHITECTURE.md §6.2). */
export function newId(): string {
  return uuidv4();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a value is a server/local primary key rather than a human identifier.
 *
 * A deep link may carry either — `menuboard://equipment/MTC-KIT-OVN-001` from a printed QR
 * label, or a uuid from a notification — and the two are fetched through different endpoints.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
