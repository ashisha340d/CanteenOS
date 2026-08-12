import { describe, expect, it } from 'vitest';
import { PosDiscountType, PosOrderStatus, PosOrderType } from '@menuboard/shared';
import { createPosOrderSchema, posCheckoutSchema } from '../src/validation/schemas';

/**
 * The four rules a POS ticket must satisfy before it reaches a service, each enforced in more
 * than one place that has to agree:
 *
 *   naming     `ck_pos_orders_quick_sale_anonymous` (022) and `PosService.assertNamingIsCoherent`
 *   dish       `ck_pos_order_items_dish` (022) and `PosService.resolveLine`
 *   emptiness  `PosService.updateStatus`
 *   scheduling `ck_pos_orders_scheduled_has_time` (022)
 *
 * These cover the Zod layer, which is what a client hits first.
 */

const MENU_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const VARIANT_ID = '55555555-5555-4555-8555-555555555555';

function order(overrides: Record<string, unknown> = {}): unknown {
  return {
    orderType: PosOrderType.TAKEAWAY,
    items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
    ...overrides,
  };
}

describe('createPosOrderSchema — how a POS line names its dish', () => {
  it('accepts a catalogue line', () => {
    expect(createPosOrderSchema.safeParse(order()).success).toBe(true);
  });

  it('accepts a catalogue line with a variant', () => {
    const result = createPosOrderSchema.safeParse(
      order({ items: [{ menuItemId: MENU_ITEM_ID, variantId: VARIANT_ID, quantity: 2 }] }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts an ad-hoc line carrying its own price', () => {
    const result = createPosOrderSchema.safeParse(
      order({ items: [{ customItemName: 'Special Thali', unitPrice: 120, quantity: 2 }] }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects an ad-hoc line with no price — there is no catalogue price to resolve', () => {
    const result = createPosOrderSchema.safeParse(
      order({ items: [{ customItemName: 'Special Thali', quantity: 1 }] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a line naming its dish both ways', () => {
    const result = createPosOrderSchema.safeParse(
      order({ items: [{ menuItemId: MENU_ITEM_ID, customItemName: 'Chai', quantity: 1 }] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a line naming its dish neither way', () => {
    expect(createPosOrderSchema.safeParse(order({ items: [{ quantity: 1 }] })).success).toBe(false);
  });

  it('rejects a zero quantity — a line nobody is buying is not a line', () => {
    const result = createPosOrderSchema.safeParse(
      order({ items: [{ menuItemId: MENU_ITEM_ID, quantity: 0 }] }),
    );
    expect(result.success).toBe(false);
  });

  it('never accepts a price on a catalogue line from the client', () => {
    const result = createPosOrderSchema.safeParse(
      order({ items: [{ menuItemId: MENU_ITEM_ID, quantity: 1, lineTotal: 1 }] }),
    );
    expect(result.success).toBe(false);
  });
});

describe('createPosOrderSchema — a quick sale is anonymous', () => {
  it('accepts an unnamed quick sale', () => {
    const result = createPosOrderSchema.safeParse(order({ orderType: PosOrderType.QUICK_SALE }));
    expect(result.success).toBe(true);
  });

  it('rejects a quick sale carrying a registered entity', () => {
    const result = createPosOrderSchema.safeParse(
      order({ orderType: PosOrderType.QUICK_SALE, entityId: MENU_ITEM_ID }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a quick sale carrying a typed name', () => {
    const result = createPosOrderSchema.safeParse(
      order({ orderType: PosOrderType.QUICK_SALE, entityName: 'Ramesh' }),
    );
    expect(result.success).toBe(false);
  });

  it('allows every other type to be named without registering the person', () => {
    const result = createPosOrderSchema.safeParse(
      order({ orderType: PosOrderType.DINE_IN, entityName: 'Ramesh', tableLabel: 'T4', pax: 3 }),
    );
    expect(result.success).toBe(true);
  });
});

describe('createPosOrderSchema — drafts, schedules and empty tickets', () => {
  it('allows an empty DRAFT — that is what makes it a draft', () => {
    const result = createPosOrderSchema.safeParse(
      order({ status: PosOrderStatus.DRAFT, items: [] }),
    );
    expect(result.success).toBe(true);
  });

  it('refuses an empty ticket in any other status', () => {
    const result = createPosOrderSchema.safeParse(order({ status: PosOrderStatus.OPEN, items: [] }));
    expect(result.success).toBe(false);
  });

  it('refuses SCHEDULED without the time the food is wanted', () => {
    const result = createPosOrderSchema.safeParse(order({ status: PosOrderStatus.SCHEDULED }));
    expect(result.success).toBe(false);
  });

  it('accepts SCHEDULED with an offset-bearing timestamp', () => {
    const result = createPosOrderSchema.safeParse(
      order({ status: PosOrderStatus.SCHEDULED, scheduledFor: '2026-08-12T18:30:00.000Z' }),
    );
    expect(result.success).toBe(true);
  });

  it('refuses a status a ticket cannot be created in', () => {
    const result = createPosOrderSchema.safeParse(order({ status: PosOrderStatus.COMPLETED }));
    expect(result.success).toBe(false);
  });
});

describe('createPosOrderSchema — discounts', () => {
  it('caps a percentage line discount at 100%', () => {
    const result = createPosOrderSchema.safeParse(
      order({
        items: [
          {
            menuItemId: MENU_ITEM_ID,
            quantity: 1,
            discountType: PosDiscountType.PERCENT,
            discountValue: 101,
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('allows a flat amount discount above 100 — rupees, not percent', () => {
    const result = createPosOrderSchema.safeParse(
      order({
        items: [
          {
            menuItemId: MENU_ITEM_ID,
            quantity: 1,
            discountType: PosDiscountType.AMOUNT,
            discountValue: 250,
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe('posCheckoutSchema', () => {
  it('accepts split tender', () => {
    const result = posCheckoutSchema.safeParse({
      payments: [
        { method: 'CASH', amount: 100, tenderedAmount: 500 },
        { method: 'UPI', amount: 60, reference: 'UPI-1' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('refuses a checkout with no payment at all', () => {
    expect(posCheckoutSchema.safeParse({ payments: [] }).success).toBe(false);
  });

  it('refuses an unknown payment method', () => {
    const result = posCheckoutSchema.safeParse({ payments: [{ method: 'CHEQUE', amount: 10 }] });
    expect(result.success).toBe(false);
  });

  it('refuses a negative payment — a reversal is a void, not a checkout', () => {
    const result = posCheckoutSchema.safeParse({ payments: [{ method: 'CASH', amount: -10 }] });
    expect(result.success).toBe(false);
  });
});
