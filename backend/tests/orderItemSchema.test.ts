import { describe, expect, it } from 'vitest';
import { createOrderSchema } from '../src/validation/schemas';

/**
 * An order line names its dish either by pointing at the catalogue or by carrying free text
 * typed on the spot — never both, never neither. The rule is enforced in three places that
 * must agree: `ck_order_items_dish` (migration 008), `refineDishNaming` here, and
 * `OrderService.resolveItems`. These cover the Zod layer, which is what a client hits first.
 */
function order(items: unknown[]): unknown {
  return {
    boardId: '11111111-1111-4111-8111-111111111111',
    activityTypeId: '22222222-2222-4222-8222-222222222222',
    venue: 'Main Hall',
    pax: 100,
    requiredDate: '2026-01-01',
    requiredTime: '12:30',
    items,
  };
}

const MENU_ITEM_ID = '33333333-3333-4333-8333-333333333333';

describe('createOrderSchema — how an order line names its dish', () => {
  it('accepts a catalogued line (menuItemId only)', () => {
    const result = createOrderSchema.safeParse(
      order([{ menuItemId: MENU_ITEM_ID, quantity: 2 }]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts an ad-hoc line (customItemName only) — no master record needed', () => {
    const result = createOrderSchema.safeParse(
      order([{ customItemName: 'Masala Chai', quantity: 30 }]),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a line naming its dish both ways', () => {
    const result = createOrderSchema.safeParse(
      order([{ menuItemId: MENU_ITEM_ID, customItemName: 'Masala Chai', quantity: 1 }]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a line naming its dish neither way', () => {
    expect(createOrderSchema.safeParse(order([{ quantity: 1 }])).success).toBe(false);
  });

  it('treats a blank custom name as absent rather than as a name', () => {
    const result = createOrderSchema.safeParse(order([{ customItemName: '   ', quantity: 1 }]));
    expect(result.success).toBe(false);
  });

  it('allows a catalogued and an ad-hoc line on the same order', () => {
    const result = createOrderSchema.safeParse(
      order([
        { menuItemId: MENU_ITEM_ID, quantity: 2 },
        { customItemName: 'Extra Salad', quantity: 5 },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('still enforces the 3-decimal quantity limit on an ad-hoc line', () => {
    const result = createOrderSchema.safeParse(
      order([{ customItemName: 'Masala Chai', quantity: 1.00005 }]),
    );
    expect(result.success).toBe(false);
  });
});
