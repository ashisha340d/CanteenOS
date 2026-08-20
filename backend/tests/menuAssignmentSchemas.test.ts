import { describe, expect, it } from 'vitest';
import {
  createMenuItemSchema,
  createModifierGroupSchema,
  moveCounterRouteSchema,
  moveModifierAssignmentSchema,
  movePrintingRouteSchema,
} from '../src/validation/schemas';

const entityId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';

describe('menu assignment schemas', () => {
  it('accepts atomic counter moves for menu items', () => {
    expect(
      moveCounterRouteSchema.parse({
        entityType: 'MENU_ITEM',
        entityId,
        targetCounterId: targetId,
      }),
    ).toMatchObject({ entityType: 'MENU_ITEM', entityId, targetCounterId: targetId });
  });

  it('accepts atomic kitchen and modifier unassignments', () => {
    expect(
      movePrintingRouteSchema.safeParse({
        entityType: 'MENU_ITEM',
        entityId,
        sourceRouteId: targetId,
      }).success,
    ).toBe(true);
    expect(
      moveModifierAssignmentSchema.safeParse({
        entityType: 'MENU_ITEM',
        entityId,
        sourceAssignmentId: targetId,
      }).success,
    ).toBe(true);
  });

  it('rejects a move with neither a source nor a target', () => {
    expect(moveCounterRouteSchema.safeParse({ entityType: 'MENU_ITEM', entityId }).success).toBe(false);
    expect(movePrintingRouteSchema.safeParse({ entityType: 'MENU_ITEM', entityId }).success).toBe(false);
    expect(moveModifierAssignmentSchema.safeParse({ entityType: 'MENU_ITEM', entityId }).success).toBe(false);
  });

  it('rejects an invalid modifier selection range', () => {
    expect(
      createModifierGroupSchema.safeParse({
        name: 'Toppings',
        minSelect: 3,
        maxSelect: 2,
      }).success,
    ).toBe(false);
  });

  it('accepts menu item descriptions in both languages', () => {
    const parsed = createMenuItemSchema.parse({
      name: 'Dal',
      nameHi: 'दाल',
      description: 'Slow-cooked lentils',
      descriptionHi: 'धीमी आंच पर पकी दाल',
      categoryId: entityId,
      unit: 'plate',
    });
    expect(parsed.description).toBe('Slow-cooked lentils');
    expect(parsed.descriptionHi).toBe('धीमी आंच पर पकी दाल');
  });
});
