import { describe, expect, it } from 'vitest';
import {
  BoardRole,
  OrderStatus,
  UserRole,
  canTransitionOrderStatus,
  deriveOrderDisplayStatus,
  isOrderLocked,
  nextOrderStatus,
  OrderDisplayStatus,
  previousOrderStatus,
} from '../src/enums';
import {
  ANDROID_FORBIDDEN_CAPABILITIES,
  boardRoleHasCapability,
  Capability,
  effectiveCapabilities,
  hasCapability,
  ROLE_CAPABILITIES,
  roleHasCapability,
} from '../src/permissions';

describe('capability matrix', () => {
  it('nests the roles: each tier holds everything the tier below it holds', () => {
    const ladder = [
      UserRole.EMPLOYEE,
      UserRole.USER,
      UserRole.MANAGER,
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN,
    ];
    for (let index = 1; index < ladder.length; index += 1) {
      const lower = ROLE_CAPABILITIES[ladder[index - 1] as UserRole];
      const higher = ROLE_CAPABILITIES[ladder[index] as UserRole];
      for (const capability of lower) {
        expect(higher).toContain(capability);
      }
    }
  });

  it('gives Super Admin strictly more than Admin — the any-board member grant', () => {
    expect(roleHasCapability(UserRole.SUPER_ADMIN, Capability.BOARD_MEMBER_MANAGE_ANY)).toBe(true);
    expect(roleHasCapability(UserRole.ADMIN, Capability.BOARD_MEMBER_MANAGE_ANY)).toBe(false);
  });

  it('grants BOARD_MEMBER_MANAGE globally to Admin, scoped to a board for Manager', () => {
    // ADMIN has the global grant (plus BOARD_READ_ALL, so it reaches any board via
    // requireBoardAccess). MANAGER only holds it through board membership.
    expect(roleHasCapability(UserRole.ADMIN, Capability.BOARD_MEMBER_MANAGE)).toBe(true);
    expect(roleHasCapability(UserRole.MANAGER, Capability.BOARD_MEMBER_MANAGE)).toBe(false);
    expect(boardRoleHasCapability(BoardRole.OWNER, Capability.BOARD_MEMBER_MANAGE)).toBe(true);
    expect(boardRoleHasCapability(BoardRole.MANAGER, Capability.BOARD_MEMBER_MANAGE)).toBe(true);
    expect(boardRoleHasCapability(BoardRole.MEMBER, Capability.BOARD_MEMBER_MANAGE)).toBe(false);
  });

  it('restricts EMPLOYEE to reading — nothing that writes, bills or assigns', () => {
    const forbidden = [
      Capability.ORDER_CREATE,
      Capability.ORDER_UPDATE,
      Capability.ORDER_QUANTITY_EDIT,
      Capability.ORDER_DONE,
      Capability.THREAD_POST,
      Capability.SHOPPING_LIST_GENERATE,
      Capability.BILLING_READ,
      Capability.BILLING_PROCESS,
      Capability.BOARD_MEMBER_MANAGE,
      Capability.ALERT_CONFIG,
    ];
    for (const capability of forbidden) {
      expect(roleHasCapability(UserRole.EMPLOYEE, capability)).toBe(false);
    }
  });

  it('lets an Employee see a board only through a VIEWER membership', () => {
    expect(hasCapability(UserRole.EMPLOYEE, null, Capability.ORDER_READ)).toBe(false);
    expect(hasCapability(UserRole.EMPLOYEE, BoardRole.VIEWER, Capability.ORDER_READ)).toBe(true);
    expect(hasCapability(UserRole.EMPLOYEE, BoardRole.VIEWER, Capability.THREAD_POST)).toBe(false);
  });

  it('gives Manager the quantity, done and shopping grants that User lacks', () => {
    const managerOnly = [
      Capability.ORDER_QUANTITY_EDIT,
      Capability.ORDER_DONE,
      Capability.SHOPPING_LIST_GENERATE,
    ];
    for (const capability of managerOnly) {
      expect(roleHasCapability(UserRole.MANAGER, capability)).toBe(true);
      expect(roleHasCapability(UserRole.USER, capability)).toBe(false);
    }
  });

  it('reserves billing and alarm configuration for Admin and above', () => {
    for (const capability of [Capability.BILLING_PROCESS, Capability.ALERT_CONFIG]) {
      expect(roleHasCapability(UserRole.ADMIN, capability)).toBe(true);
      expect(roleHasCapability(UserRole.SUPER_ADMIN, capability)).toBe(true);
      expect(roleHasCapability(UserRole.MANAGER, capability)).toBe(false);
    }
  });

  it('does not grant board-scoped order/thread capabilities globally to MANAGER or USER', () => {
    for (const role of [UserRole.MANAGER, UserRole.USER]) {
      expect(roleHasCapability(role, Capability.ORDER_UPDATE)).toBe(false);
      expect(roleHasCapability(role, Capability.ATTACHMENT_DELETE_ANY)).toBe(false);
    }
  });

  it('only grants ATTACHMENT_DELETE_ANY at board level to OWNER', () => {
    expect(boardRoleHasCapability(BoardRole.OWNER, Capability.ATTACHMENT_DELETE_ANY)).toBe(true);
    expect(boardRoleHasCapability(BoardRole.MANAGER, Capability.ATTACHMENT_DELETE_ANY)).toBe(false);
    expect(boardRoleHasCapability(BoardRole.MEMBER, Capability.ATTACHMENT_DELETE_ANY)).toBe(false);
    expect(boardRoleHasCapability(BoardRole.VIEWER, Capability.ATTACHMENT_DELETE_ANY)).toBe(false);
  });

  it('grants ATTACHMENT_UPLOAD to every board role except VIEWER', () => {
    expect(boardRoleHasCapability(BoardRole.OWNER, Capability.ATTACHMENT_UPLOAD)).toBe(true);
    expect(boardRoleHasCapability(BoardRole.MANAGER, Capability.ATTACHMENT_UPLOAD)).toBe(true);
    expect(boardRoleHasCapability(BoardRole.MEMBER, Capability.ATTACHMENT_UPLOAD)).toBe(true);
    expect(boardRoleHasCapability(BoardRole.VIEWER, Capability.ATTACHMENT_UPLOAD)).toBe(false);
  });

  it('effective hasCapability() falls back from global to board role', () => {
    expect(hasCapability(UserRole.USER, BoardRole.MEMBER, Capability.ORDER_CREATE)).toBe(true);
    expect(hasCapability(UserRole.USER, BoardRole.VIEWER, Capability.ORDER_CREATE)).toBe(false);
    expect(hasCapability(UserRole.USER, null, Capability.ORDER_CREATE)).toBe(false);
    expect(hasCapability(UserRole.ADMIN, null, Capability.ORDER_CREATE)).toBe(true);
  });

  it('a VIEWER can read and acknowledge but never write', () => {
    expect(boardRoleHasCapability(BoardRole.VIEWER, Capability.ORDER_READ)).toBe(true);
    expect(boardRoleHasCapability(BoardRole.VIEWER, Capability.ORDER_ACKNOWLEDGE)).toBe(true);
    expect(boardRoleHasCapability(BoardRole.VIEWER, Capability.ORDER_CREATE)).toBe(false);
    expect(boardRoleHasCapability(BoardRole.VIEWER, Capability.ORDER_UPDATE)).toBe(false);
    expect(boardRoleHasCapability(BoardRole.VIEWER, Capability.THREAD_POST)).toBe(false);
  });

  it('effectiveCapabilities() unions the two axes without duplicates', () => {
    const capabilities = effectiveCapabilities(UserRole.USER, BoardRole.MEMBER);
    expect(capabilities).toContain(Capability.ORDER_CREATE);
    expect(capabilities).toContain(Capability.MASTER_READ);
    expect(new Set(capabilities).size).toBe(capabilities.length);
  });
});

describe('Android capability boundary', () => {
  it('is empty — the specification moved every module into the phone', () => {
    expect(ANDROID_FORBIDDEN_CAPABILITIES).toEqual([]);
  });

  it('does not forbid the capabilities the mobile app needs day-to-day', () => {
    const dailyUse = [
      Capability.ORDER_READ,
      Capability.ORDER_CREATE,
      Capability.ORDER_QUANTITY_EDIT,
      Capability.ORDER_DONE,
      Capability.THREAD_POST,
      Capability.SHOPPING_LIST_GENERATE,
      Capability.RECIPE_READ,
      Capability.BILLING_PROCESS,
      Capability.SYNC_USE,
    ];
    for (const capability of dailyUse) {
      expect(ANDROID_FORBIDDEN_CAPABILITIES).not.toContain(capability);
    }
  });
});

describe('order status flow', () => {
  it('advances exactly one step forward', () => {
    expect(canTransitionOrderStatus(OrderStatus.PENDING, OrderStatus.ACKNOWLEDGED)).toBe(true);
    expect(canTransitionOrderStatus(OrderStatus.ACKNOWLEDGED, OrderStatus.PREPARATION)).toBe(true);
    expect(canTransitionOrderStatus(OrderStatus.PREPARATION, OrderStatus.WORK_IN_PROGRESS)).toBe(
      true,
    );
    expect(canTransitionOrderStatus(OrderStatus.WORK_IN_PROGRESS, OrderStatus.DELIVERED)).toBe(
      true,
    );
  });

  it('refuses to skip a step forward', () => {
    expect(canTransitionOrderStatus(OrderStatus.PENDING, OrderStatus.PREPARATION)).toBe(false);
    expect(canTransitionOrderStatus(OrderStatus.ACKNOWLEDGED, OrderStatus.DELIVERED)).toBe(false);
  });

  it('allows an undo to rewind any number of steps', () => {
    expect(canTransitionOrderStatus(OrderStatus.DELIVERED, OrderStatus.PENDING)).toBe(true);
    expect(canTransitionOrderStatus(OrderStatus.WORK_IN_PROGRESS, OrderStatus.ACKNOWLEDGED)).toBe(
      true,
    );
  });

  it('reaches DONE from any live status, and lets DONE be undone to DELIVERED', () => {
    for (const status of [
      OrderStatus.PENDING,
      OrderStatus.ACKNOWLEDGED,
      OrderStatus.PREPARATION,
      OrderStatus.WORK_IN_PROGRESS,
      OrderStatus.DELIVERED,
    ]) {
      expect(canTransitionOrderStatus(status, OrderStatus.DONE)).toBe(true);
    }
    expect(canTransitionOrderStatus(OrderStatus.DONE, OrderStatus.DELIVERED)).toBe(true);
    expect(canTransitionOrderStatus(OrderStatus.DONE, OrderStatus.PENDING)).toBe(false);
  });

  it('treats CANCELLED as a one-way door', () => {
    expect(canTransitionOrderStatus(OrderStatus.PREPARATION, OrderStatus.CANCELLED)).toBe(true);
    expect(canTransitionOrderStatus(OrderStatus.CANCELLED, OrderStatus.PENDING)).toBe(false);
    expect(canTransitionOrderStatus(OrderStatus.CANCELLED, OrderStatus.DONE)).toBe(false);
  });

  it('is idempotent, because an offline device may replay the same change', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(canTransitionOrderStatus(status, status)).toBe(true);
    }
  });

  it('walks the flow with next/previous and stops at both ends', () => {
    expect(nextOrderStatus(OrderStatus.PENDING)).toBe(OrderStatus.ACKNOWLEDGED);
    expect(nextOrderStatus(OrderStatus.DELIVERED)).toBeNull();
    expect(previousOrderStatus(OrderStatus.ACKNOWLEDGED)).toBe(OrderStatus.PENDING);
    expect(previousOrderStatus(OrderStatus.PENDING)).toBeNull();
    // DONE and CANCELLED are off the flow entirely.
    expect(nextOrderStatus(OrderStatus.DONE)).toBeNull();
    expect(previousOrderStatus(OrderStatus.CANCELLED)).toBeNull();
  });
});

describe('derived display status', () => {
  const at = '2026-08-07T10:00:00.000Z';

  it('shows the lifecycle status when nothing cross-cutting applies', () => {
    expect(deriveOrderDisplayStatus({ status: OrderStatus.PREPARATION })).toBe(
      OrderStatus.PREPARATION,
    );
  });

  it('shows On Shopping while a raised list is still ahead of the work', () => {
    expect(
      deriveOrderDisplayStatus({
        status: OrderStatus.ACKNOWLEDGED,
        shoppingGeneratedAt: at,
      }),
    ).toBe(OrderDisplayStatus.ON_SHOPPING);
  });

  it('stops showing On Shopping once the kitchen has started', () => {
    expect(
      deriveOrderDisplayStatus({
        status: OrderStatus.WORK_IN_PROGRESS,
        shoppingGeneratedAt: at,
      }),
    ).toBe(OrderStatus.WORK_IN_PROGRESS);
  });

  it('lets Billed outrank Done and the lifecycle', () => {
    expect(deriveOrderDisplayStatus({ status: OrderStatus.DONE, billedAt: at })).toBe(
      OrderDisplayStatus.BILLED,
    );
    expect(
      deriveOrderDisplayStatus({ status: OrderStatus.ACKNOWLEDGED, billedAt: at }),
    ).toBe(OrderDisplayStatus.BILLED);
  });

  it('lets Cancelled outrank everything, including a bill', () => {
    expect(deriveOrderDisplayStatus({ status: OrderStatus.CANCELLED, billedAt: at })).toBe(
      OrderDisplayStatus.CANCELLED,
    );
  });

  it('locks an order once and only once it has been billed', () => {
    expect(isOrderLocked({ status: OrderStatus.DONE })).toBe(false);
    expect(isOrderLocked({ status: OrderStatus.DELIVERED, billedAt: at })).toBe(true);
  });
});
