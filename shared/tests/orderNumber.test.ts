import { describe, expect, it } from 'vitest';
import { buildOrderNumber, isValidOrderNumber } from '../src/utils/orderNumber';

describe('buildOrderNumber', () => {
  const uuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

  it('formats as ORD-YYYYMMDD-XXXXXX', () => {
    const orderNumber = buildOrderNumber(uuid, '2026-08-07');
    expect(orderNumber).toMatch(/^ORD-20260807-[0-9A-Z]{6}$/);
  });

  it('accepts a Date instance and a YYYY-MM-DD string identically', () => {
    const fromString = buildOrderNumber(uuid, '2026-08-07');
    const fromDate = buildOrderNumber(uuid, new Date(2026, 7, 7));
    expect(fromString).toBe(fromDate);
  });

  it('is deterministic for the same order id and date', () => {
    const first = buildOrderNumber(uuid, '2026-01-01');
    const second = buildOrderNumber(uuid, '2026-01-01');
    expect(first).toBe(second);
  });

  it('produces different suffixes for different order ids on the same date', () => {
    const a = buildOrderNumber('11111111-1111-4111-8111-111111111111', '2026-01-01');
    const b = buildOrderNumber('22222222-2222-4222-8222-222222222222', '2026-01-01');
    expect(a).not.toBe(b);
  });

  it('never needs server coordination: same UUID always yields the same number regardless of date formatting drift', () => {
    const isoWithTime = buildOrderNumber(uuid, '2026-08-07T00:00:00.000Z');
    const plainDate = buildOrderNumber(uuid, '2026-08-07');
    expect(isoWithTime).toBe(plainDate);
  });

  it('throws on an invalid date', () => {
    expect(() => buildOrderNumber(uuid, 'not-a-date')).toThrow();
  });

  it('throws on a malformed UUID', () => {
    expect(() => buildOrderNumber('too-short', '2026-01-01')).toThrow();
  });

  it('round-trips through isValidOrderNumber', () => {
    const orderNumber = buildOrderNumber(uuid, '2026-08-07');
    expect(isValidOrderNumber(orderNumber)).toBe(true);
    expect(isValidOrderNumber('not-an-order-number')).toBe(false);
  });
});
