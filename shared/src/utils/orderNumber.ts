import { CROCKFORD_ALPHABET, ORDER_NUMBER } from '../constants';

/**
 * Builds an order number that a fully offline device can produce on its own.
 *
 * Format: ORD-YYYYMMDD-XXXXXX where the suffix is Crockford base32 derived from the
 * order's UUID. Uniqueness comes from the UUID, so no server coordination is needed and
 * the number never changes after creation (docs/SCOPE.md decision 1).
 */
export function buildOrderNumber(orderId: string, requiredDate: Date | string): string {
  const datePart = toCompactDate(requiredDate);
  const suffix = uuidToBase32Suffix(orderId, ORDER_NUMBER.SUFFIX_LENGTH);
  return `${ORDER_NUMBER.PREFIX}-${datePart}-${suffix}`;
}

export function isValidOrderNumber(value: string): boolean {
  return ORDER_NUMBER.PATTERN.test(value);
}

function toCompactDate(value: Date | string): string {
  if (typeof value === 'string') {
    // Accept YYYY-MM-DD directly to avoid timezone drift on the device.
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) return `${match[1]}${match[2]}${match[3]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date for order number: ${String(value)}`);
  }
  const yyyy = String(date.getFullYear()).padStart(4, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Folds the UUID's 128 bits into `length` base32 characters. Uses every hex digit so the
 * result depends on the whole UUID rather than a truncated prefix.
 */
function uuidToBase32Suffix(uuid: string, length: number): string {
  const hex = uuid.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length < 16) {
    throw new Error(`Invalid UUID for order number: ${uuid}`);
  }

  const buckets = new Array<number>(length).fill(0);
  for (let i = 0; i < hex.length; i += 1) {
    const nibble = parseInt(hex[i] as string, 16);
    const slot = i % length;
    // 31-multiplier mixing keeps adjacent UUIDs from colliding in the same bucket.
    buckets[slot] = ((buckets[slot] as number) * 31 + nibble) % CROCKFORD_ALPHABET.length;
  }

  return buckets.map((value) => CROCKFORD_ALPHABET[value] as string).join('');
}
