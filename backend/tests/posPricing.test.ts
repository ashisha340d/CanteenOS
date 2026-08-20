import { describe, expect, it } from 'vitest';
import { applyTax, isInterStateSupply, money, type TaxTreatment } from '../src/services/posPricing';

/**
 * `applyTax` is the only GST computation in the codebase — the till and the purchase posting
 * engine both route through it. A drift here would make a sale and a supplier bill disagree
 * about the same rate, so the invariants are pinned rather than assumed.
 */

function treatment(overrides: Partial<TaxTreatment> = {}): TaxTreatment {
  return {
    taxProfileId: 'profile-1',
    rate: 5,
    cessRate: 0,
    cgstRate: 2.5,
    sgstRate: 2.5,
    igstRate: 5,
    priceIsInclusive: true,
    interState: false,
    ...overrides,
  };
}

describe('applyTax', () => {
  it('divides tax back out of an inclusive price', () => {
    const result = applyTax(105, treatment());
    expect(result.taxableAmount).toBe(100);
    expect(result.taxAmount).toBe(5);
    expect(result.lineTotal).toBe(105);
  });

  it('adds tax on top of an exclusive price', () => {
    const result = applyTax(100, treatment({ priceIsInclusive: false }));
    expect(result.taxableAmount).toBe(100);
    expect(result.taxAmount).toBe(5);
    expect(result.lineTotal).toBe(105);
  });

  it('splits GST in half intra-state and charges no IGST', () => {
    const result = applyTax(105, treatment());
    expect(result.cgstAmount).toBe(2.5);
    expect(result.sgstAmount).toBe(2.5);
    expect(result.igstAmount).toBe(0);
  });

  it('charges the whole GST as IGST inter-state and no CGST/SGST', () => {
    const result = applyTax(105, treatment({ interState: true }));
    expect(result.cgstAmount).toBe(0);
    expect(result.sgstAmount).toBe(0);
    expect(result.igstAmount).toBe(5);
  });

  it('never loses a paise when the split is odd — SGST absorbs the remainder', () => {
    // 18% inclusive on 77.77 produces a GST portion that does not halve cleanly.
    const result = applyTax(
      77.77,
      treatment({ rate: 18, cgstRate: 9, sgstRate: 9, igstRate: 18 }),
    );
    expect(money(result.cgstAmount + result.sgstAmount + result.igstAmount + result.cessAmount)).toBe(
      result.taxAmount,
    );
    expect(money(result.taxableAmount + result.taxAmount)).toBe(result.lineTotal);
  });

  it('keeps the components summing to the total across a sweep of awkward values', () => {
    const rates = [0, 5, 12, 18, 28];
    for (const rate of rates) {
      for (const inclusive of [true, false]) {
        for (const interState of [true, false]) {
          for (const net of [0.01, 1.03, 9.99, 77.77, 333.33, 10_000.05]) {
            const result = applyTax(
              net,
              treatment({
                rate,
                cgstRate: rate / 2,
                sgstRate: rate / 2,
                igstRate: rate,
                priceIsInclusive: inclusive,
                interState,
              }),
            );
            const parts = money(
              result.cgstAmount + result.sgstAmount + result.igstAmount + result.cessAmount,
            );
            expect(parts).toBe(result.taxAmount);
            expect(money(result.taxableAmount + result.taxAmount)).toBe(result.lineTotal);
            // An inclusive price must never invent value: the line total is what was charged.
            if (inclusive) expect(result.lineTotal).toBe(money(net));
          }
        }
      }
    }
  });

  it('carries cess separately from GST and still reconciles', () => {
    const result = applyTax(
      112,
      treatment({ rate: 5, cessRate: 7, cgstRate: 2.5, sgstRate: 2.5, igstRate: 5 }),
    );
    expect(result.taxableAmount).toBe(100);
    expect(result.cessAmount).toBe(7);
    expect(money(result.cgstAmount + result.sgstAmount)).toBe(money(result.taxAmount - 7));
    expect(result.lineTotal).toBe(112);
  });

  it('produces no tax at a zero rate', () => {
    const result = applyTax(
      100,
      treatment({ rate: 0, cessRate: 0, cgstRate: 0, sgstRate: 0, igstRate: 0 }),
    );
    expect(result.taxableAmount).toBe(100);
    expect(result.taxAmount).toBe(0);
    expect(result.lineTotal).toBe(100);
  });
});

describe('isInterStateSupply', () => {
  it('is inter-state only when both states are known and differ', () => {
    expect(isInterStateSupply('27', '29')).toBe(true);
    expect(isInterStateSupply('27', '27')).toBe(false);
  });

  it('falls back to intra-state when either state is unknown', () => {
    // Guessing IGST on an uncaptured GSTIN would wrongly deny the CGST/SGST split on what is
    // almost always a local purchase.
    expect(isInterStateSupply(null, '29')).toBe(false);
    expect(isInterStateSupply('27', null)).toBe(false);
    expect(isInterStateSupply(null, null)).toBe(false);
  });

  it('ignores incidental whitespace around a state code', () => {
    expect(isInterStateSupply(' 27 ', '27')).toBe(false);
  });

  /**
   * `pos.home_state_code` comes out of `settings`, whose value column is JSON-valid text read
   * through an unchecked `getValue<string>()` cast. A code stored as the bare JSON number `27`
   * arrives as a number, and calling `.trim()` on it used to throw — which would have taken
   * down any POS sale to an out-of-state entity the moment a home state was configured.
   */
  it('survives a state code that arrives as a number, not a string', () => {
    const asNumber = 27 as unknown as string;
    expect(() => isInterStateSupply(asNumber, '29')).not.toThrow();
    expect(isInterStateSupply(asNumber, '29')).toBe(true);
    expect(isInterStateSupply(asNumber, '27')).toBe(false);
    expect(isInterStateSupply('27', 27 as unknown as string)).toBe(false);
  });

  it('pads a single-digit code so 9 and 09 are the same state', () => {
    // Getting this wrong charges IGST between two parties in the same state.
    expect(isInterStateSupply(9 as unknown as string, '09')).toBe(false);
    expect(isInterStateSupply('9', '09')).toBe(false);
    expect(isInterStateSupply(9 as unknown as string, '27')).toBe(true);
  });

  it('treats an empty or unusable code as unknown rather than as a mismatch', () => {
    expect(isInterStateSupply('', '27')).toBe(false);
    expect(isInterStateSupply('   ', '27')).toBe(false);
    expect(isInterStateSupply(Number.NaN as unknown as string, '27')).toBe(false);
  });
});
