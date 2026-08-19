import type { CartLine } from '../state/cart';

/**
 * "Ready in about 14 min."
 *
 * Built from `preparation_time_minutes` in the Menu Master, never invented. Dishes are cooked
 * in parallel, so the base is the slowest dish rather than the sum; volume still costs
 * something, so every four units beyond the first adds two minutes. When the catalogue states
 * no preparation time for anything in the cart, the kiosk promises nothing and says so.
 */
export function estimateMinutes(lines: CartLine[]): number | null {
  const stated = lines.filter((line) => line.preparationTimeMinutes !== null);
  if (stated.length === 0) return null;

  const slowest = stated.reduce(
    (max, line) => Math.max(max, line.preparationTimeMinutes ?? 0),
    0,
  );
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  const volumeMinutes = Math.max(0, Math.ceil((units - 1) / 4)) * 2;

  return Math.max(1, slowest + volumeMinutes);
}

export function readyBy(minutes: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + minutes * 60_000);
}
