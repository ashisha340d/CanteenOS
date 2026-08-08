import { BoardRole, UserRole } from '../enums';

/**
 * The default role -> capability grants.
 *
 * The five roles are fixed by specification, but which capability each one holds is no
 * longer purely code-defined: the backend seeds `role_capabilities` / `board_role_capabilities`
 * from these constants on first migration, then serves the live, editable rows from the
 * database (backend/src/services/PermissionsCacheService.ts) for every authorisation check
 * and for the Admin Portal's Permissions page. These exports remain the fallback the mobile
 * app uses for optimistic, non-authoritative UI (`useBoardCapability`) and the seed values a
 * fresh database starts from.
 */
export const Capability = {
  // Administration
  USER_READ: 'user.read',
  USER_WRITE: 'user.write',
  USER_ROLE_ASSIGN: 'user.role.assign',
  PERMISSION_READ: 'permission.read',
  /** Edit which role holds which capability. Admin only. */
  PERMISSION_WRITE: 'permission.write',

  MASTER_READ: 'master.read',
  MASTER_WRITE: 'master.write',

  BOARD_READ_ALL: 'board.read.all',
  BOARD_CREATE: 'board.create',
  BOARD_UPDATE: 'board.update',
  BOARD_ARCHIVE: 'board.archive',
  /** Assign members on *this* board. Granted by board role, never globally below SUPER_ADMIN. */
  BOARD_MEMBER_MANAGE: 'board.member.manage',
  /** Assign members on *any* board, member or not. Super Admin only. */
  BOARD_MEMBER_MANAGE_ANY: 'board.member.manage.any',

  ORDER_READ: 'order.read',
  ORDER_CREATE: 'order.create',
  ORDER_UPDATE: 'order.update',
  ORDER_CANCEL: 'order.cancel',
  ORDER_STATUS_UPDATE: 'order.status.update',
  ORDER_ACKNOWLEDGE: 'order.acknowledge',
  /** Change item quantities and the pax/serving count. Manager and above only. */
  ORDER_QUANTITY_EDIT: 'order.quantity.edit',
  /** Mark an order Done — it leaves the active set. Admin and Manager. */
  ORDER_DONE: 'order.done',
  /** Hand an order to a specific board member. Whoever runs the floor: Manager and above. */
  ORDER_ASSIGN: 'order.assign',

  THREAD_READ: 'thread.read',
  THREAD_POST: 'thread.post',
  THREAD_DELETE_ANY: 'thread.delete.any',

  ATTACHMENT_UPLOAD: 'attachment.upload',
  ATTACHMENT_DELETE_ANY: 'attachment.delete.any',

  RECIPE_READ: 'recipe.read',
  RECIPE_WRITE: 'recipe.write',

  SHOPPING_LIST_READ: 'shopping.read',
  SHOPPING_LIST_GENERATE: 'shopping.generate',

  SYNC_USE: 'sync.use',

  REPORT_READ: 'report.read',
  BILLING_GENERATE: 'billing.generate',
  BILLING_READ: 'billing.read',
  /** Finalise billing on an order. Locks it permanently. Admin only. */
  BILLING_PROCESS: 'billing.process',
  AUDIT_READ: 'audit.read',
  SETTINGS_READ: 'settings.read',
  SETTINGS_WRITE: 'settings.write',
  /** Configure alarm sounds, lead times and audiences. Admin only. */
  ALERT_CONFIG: 'alert.config',
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

/**
 * The roles nest: each row below is the row above plus its own additions, matching the
 * specification's "inherits all <lower role> permissions" wording. Building them by
 * composition means a capability can never be granted to a Manager but forgotten for an
 * Admin.
 */
const EMPLOYEE_CAPABILITIES: readonly Capability[] = [
  Capability.MASTER_READ,
  Capability.SYNC_USE,
];

const USER_CAPABILITIES: readonly Capability[] = [
  ...EMPLOYEE_CAPABILITIES,
  Capability.RECIPE_READ,
];

const MANAGER_CAPABILITIES: readonly Capability[] = [
  ...USER_CAPABILITIES,
  Capability.USER_READ,
  Capability.BOARD_CREATE,
  Capability.ORDER_QUANTITY_EDIT,
  Capability.ORDER_DONE,
  Capability.ORDER_ASSIGN,
  Capability.SHOPPING_LIST_READ,
  Capability.SHOPPING_LIST_GENERATE,
];

const ADMIN_CAPABILITIES: readonly Capability[] = [
  ...MANAGER_CAPABILITIES,
  Capability.USER_WRITE,
  Capability.USER_ROLE_ASSIGN,
  Capability.PERMISSION_READ,
  Capability.PERMISSION_WRITE,
  Capability.MASTER_WRITE,
  Capability.BOARD_READ_ALL,
  Capability.BOARD_UPDATE,
  Capability.BOARD_ARCHIVE,
  Capability.BOARD_MEMBER_MANAGE,
  Capability.ORDER_READ,
  Capability.ORDER_CREATE,
  Capability.ORDER_UPDATE,
  Capability.ORDER_CANCEL,
  Capability.ORDER_STATUS_UPDATE,
  Capability.ORDER_ACKNOWLEDGE,
  Capability.THREAD_READ,
  Capability.THREAD_POST,
  Capability.THREAD_DELETE_ANY,
  Capability.ATTACHMENT_UPLOAD,
  Capability.ATTACHMENT_DELETE_ANY,
  Capability.RECIPE_WRITE,
  Capability.REPORT_READ,
  Capability.BILLING_GENERATE,
  Capability.BILLING_READ,
  Capability.BILLING_PROCESS,
  Capability.AUDIT_READ,
  Capability.SETTINGS_READ,
  Capability.SETTINGS_WRITE,
  Capability.ALERT_CONFIG,
];

/** Super Admin additionally reaches across board boundaries. */
const SUPER_ADMIN_CAPABILITIES: readonly Capability[] = [
  ...ADMIN_CAPABILITIES,
  Capability.BOARD_MEMBER_MANAGE_ANY,
];

export const ROLE_CAPABILITIES: Readonly<Record<UserRole, readonly Capability[]>> = {
  [UserRole.SUPER_ADMIN]: SUPER_ADMIN_CAPABILITIES,
  [UserRole.ADMIN]: ADMIN_CAPABILITIES,
  [UserRole.MANAGER]: MANAGER_CAPABILITIES,
  [UserRole.USER]: USER_CAPABILITIES,
  [UserRole.EMPLOYEE]: EMPLOYEE_CAPABILITIES,
};

/**
 * Capabilities granted by board membership, scoped to that board only. A Manager or User
 * has no access to a board they are not a member of.
 *
 * BOARD_MEMBER_MANAGE is granted globally to ADMIN (via ADMIN_CAPABILITIES, which also
 * includes BOARD_READ_ALL, so an Admin can manage members on any board) and scoped to a
 * specific board for OWNER and MANAGER board roles. Super Admin bypasses membership checks
 * entirely via BOARD_MEMBER_MANAGE_ANY.
 */
export const BOARD_ROLE_CAPABILITIES: Readonly<Record<BoardRole, readonly Capability[]>> = {
  [BoardRole.OWNER]: [
    Capability.BOARD_UPDATE,
    Capability.BOARD_ARCHIVE,
    Capability.BOARD_MEMBER_MANAGE,
    Capability.ORDER_READ,
    Capability.ORDER_CREATE,
    Capability.ORDER_UPDATE,
    Capability.ORDER_CANCEL,
    Capability.ORDER_STATUS_UPDATE,
    Capability.ORDER_ACKNOWLEDGE,
    Capability.ORDER_ASSIGN,
    Capability.THREAD_READ,
    Capability.THREAD_POST,
    Capability.THREAD_DELETE_ANY,
    Capability.ATTACHMENT_UPLOAD,
    Capability.ATTACHMENT_DELETE_ANY,
    Capability.RECIPE_READ,
    Capability.SHOPPING_LIST_READ,
  ],
  [BoardRole.MANAGER]: [
    Capability.BOARD_MEMBER_MANAGE,
    Capability.ORDER_READ,
    Capability.ORDER_CREATE,
    Capability.ORDER_UPDATE,
    Capability.ORDER_CANCEL,
    Capability.ORDER_STATUS_UPDATE,
    Capability.ORDER_ACKNOWLEDGE,
    Capability.ORDER_ASSIGN,
    Capability.THREAD_READ,
    Capability.THREAD_POST,
    Capability.ATTACHMENT_UPLOAD,
    Capability.RECIPE_READ,
    Capability.SHOPPING_LIST_READ,
  ],
  [BoardRole.MEMBER]: [
    Capability.ORDER_READ,
    Capability.ORDER_CREATE,
    Capability.ORDER_UPDATE,
    Capability.ORDER_STATUS_UPDATE,
    Capability.ORDER_ACKNOWLEDGE,
    Capability.THREAD_READ,
    Capability.THREAD_POST,
    Capability.ATTACHMENT_UPLOAD,
    Capability.RECIPE_READ,
  ],
  [BoardRole.VIEWER]: [
    Capability.ORDER_READ,
    Capability.THREAD_READ,
    Capability.ORDER_ACKNOWLEDGE,
  ],
};

/**
 * Capabilities the mobile client may never exercise.
 *
 * Deliberately empty. The original split assumed a desktop Admin Portal owned users,
 * masters, billing and reports; the current specification puts all of it in the phone —
 * Users and Archive are bottom-nav destinations, an Admin bills from the order card, and
 * alarm sounds are configured in Settings. Role remains the only gate. The constant and
 * its middleware check are kept so a capability can be walled off again by adding it here.
 */
export const ANDROID_FORBIDDEN_CAPABILITIES: readonly Capability[] = [];

export function roleHasCapability(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function boardRoleHasCapability(role: BoardRole, capability: Capability): boolean {
  return BOARD_ROLE_CAPABILITIES[role].includes(capability);
}

/**
 * Effective capability check.
 *
 * @param role       the user's global role
 * @param boardRole  the user's role on the board in question, or null when the check is
 *                   not board-scoped or the user is not a member
 */
export function hasCapability(
  role: UserRole,
  boardRole: BoardRole | null,
  capability: Capability,
): boolean {
  if (roleHasCapability(role, capability)) return true;
  if (boardRole !== null && boardRoleHasCapability(boardRole, capability)) return true;
  return false;
}

/** Every capability a user effectively holds, for the client-side permission store. */
export function effectiveCapabilities(
  role: UserRole,
  boardRole: BoardRole | null,
): Capability[] {
  const set = new Set<Capability>(ROLE_CAPABILITIES[role]);
  if (boardRole !== null) {
    for (const capability of BOARD_ROLE_CAPABILITIES[boardRole]) set.add(capability);
  }
  return [...set];
}
