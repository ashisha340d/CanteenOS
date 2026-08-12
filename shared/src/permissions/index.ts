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

  /** Read the HSN/SAC classification master and tax profiles. Everyone who reads masters. */
  TAX_READ: 'tax.read',
  /** Create/edit/deactivate Tax Profiles. Admin only. */
  TAX_WRITE: 'tax.write',
  /** Run "Sync GST Master" against the official GST/GSTN dataset. Admin only. */
  TAX_SYNC: 'tax.sync',
  /** Assign an HSN/SAC code that is not offered by the synchronized master. Admin only. */
  TAX_OVERRIDE: 'tax.override',

  /** See your own task list and the team's current activity. Everyone. */
  TASK_READ: 'task.read',
  /**
   * Create a task for yourself. User, Manager and Admin only — deliberately withheld from
   * Employee (who works what they are given, never invents their own line item) and from
   * Super Admin (who oversees the roster rather than carrying personal work on it).
   */
  TASK_SELF: 'task.self',
  /** Hand work to somebody else — User, Manager and Admin, never Super Admin or Employee. */
  TASK_ASSIGN: 'task.assign',
  /** Start, stop and finish a task already assigned to you. Everyone. */
  TASK_WORK: 'task.work',

  BOARD_READ_ALL: 'board.read.all',
  BOARD_CREATE: 'board.create',
  BOARD_UPDATE: 'board.update',
  BOARD_ARCHIVE: 'board.archive',
  /** Assign members on *this* board. Granted by board role, never globally below SUPER_ADMIN. */
  BOARD_MEMBER_MANAGE: 'board.member.manage',
  /** Assign members on *any* board, member or not. Super Admin only. */
  BOARD_MEMBER_MANAGE_ANY: 'board.member.manage.any',

  /** Read the Entity master — customers, employees, vendors. Everyone who reads masters. */
  ENTITY_READ: 'entity.read',
  /** Create/edit/deactivate an entity. Manager and above; the counter registers walk-ins. */
  ENTITY_WRITE: 'entity.write',

  /** See the POS dashboard and open tickets. */
  POS_READ: 'pos.read',
  /** Take an order: create, edit, schedule, hold as draft. */
  POS_OPERATE: 'pos.operate',
  /** Settle a ticket — record payment and close the sale. */
  POS_CHECKOUT: 'pos.checkout',
  /** Cancel an open ticket or reverse a completed sale. Manager and above. */
  POS_VOID: 'pos.void',

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

  /* ------------------------------- equipment monitoring & maintenance ------- */

  /** See equipment, floor plans and their maintenance state. Everyone. */
  EQUIPMENT_VIEW: 'equipment.view',
  /** Register a new asset (photo -> AI -> confirm). Manager and above. */
  EQUIPMENT_CREATE: 'equipment.create',
  EQUIPMENT_EDIT: 'equipment.edit',
  /** Retire is the normal end of life; deletion erases the asset. Admin only. */
  EQUIPMENT_DELETE: 'equipment.delete',
  /**
   * Raise a problem/fault against an asset. Held by *every* role including Employee: the
   * person standing in front of the broken oven is the one who must be able to report it,
   * and withholding this is the single fastest way to make the module useless.
   */
  EQUIPMENT_REPORT_PROBLEM: 'equipment.report_problem',
  EQUIPMENT_UPLOAD_DOCUMENT: 'equipment.upload_document',
  /** Create/edit floors, areas and locations, and move an asset between them. */
  EQUIPMENT_MANAGE_LOCATION: 'equipment.manage_location',
  /** Upload a floor plan and pin equipment onto it. Admin and Manager. */
  EQUIPMENT_MANAGE_FLOORPLAN: 'equipment.manage_floorplan',

  MAINTENANCE_VIEW: 'maintenance.view',
  /** Open a maintenance/inspection request. Everyone. */
  MAINTENANCE_CREATE: 'maintenance.create',
  /** Hand a ticket to a person or a supplier. Manager and above. */
  MAINTENANCE_ASSIGN: 'maintenance.assign',
  /** Verify that a resolved ticket actually holds. Manager and above. */
  MAINTENANCE_APPROVE: 'maintenance.approve',
  MAINTENANCE_CLOSE: 'maintenance.close',
  /** Create and edit preventive maintenance schedules. Manager and above. */
  MAINTENANCE_SCHEDULE: 'maintenance.schedule',
  MAINTENANCE_DELETE: 'maintenance.delete',

  SUPPLIER_VIEW: 'supplier.view',
  /** Maintain the supplier master and set an asset's default supplier. Manager and above. */
  SUPPLIER_MANAGE: 'supplier.manage',
  /**
   * Place the call or send the WhatsApp. Separate from SUPPLIER_MANAGE because contacting a
   * supplier is a floor action, while editing the master is an office one.
   */
  SUPPLIER_CONTACT: 'supplier.contact',

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
/**
 * Removes capabilities from an already-composed list. The roles otherwise nest strictly
 * additively (each tier is the one below plus its own grants); Task assignment is the one
 * place the specification carves out an exception — Super Admin inherits everything else an
 * Admin holds but must not create or hand out task work — so composition alone cannot express
 * it and this is the one place a tier subtracts from what it would otherwise inherit.
 */
function without(list: readonly Capability[], ...remove: Capability[]): Capability[] {
  const excluded = new Set<Capability>(remove);
  return list.filter((capability) => !excluded.has(capability));
}

const EMPLOYEE_CAPABILITIES: readonly Capability[] = [
  Capability.MASTER_READ,
  Capability.TAX_READ,
  Capability.TASK_READ,
  Capability.TASK_WORK,
  // Equipment monitoring starts at the bottom of the roster, not the top: whoever is standing
  // in front of the equipment must be able to see it and report what is wrong with it.
  Capability.EQUIPMENT_VIEW,
  Capability.EQUIPMENT_REPORT_PROBLEM,
  Capability.MAINTENANCE_VIEW,
  Capability.MAINTENANCE_CREATE,
  Capability.SYNC_USE,
];

const USER_CAPABILITIES: readonly Capability[] = [
  ...EMPLOYEE_CAPABILITIES,
  Capability.RECIPE_READ,
  // A counter operator is an ordinary USER: they take and settle sales, but never author the
  // entity master and never reverse a completed one.
  Capability.ENTITY_READ,
  Capability.POS_READ,
  Capability.POS_OPERATE,
  Capability.POS_CHECKOUT,
  // A User raises their own to-dos and may hand work to an Employee, same as a Manager.
  Capability.TASK_SELF,
  Capability.TASK_ASSIGN,
  // A User attaches the warranty card they were just handed, and rings the supplier — but
  // does not maintain the supplier master or register assets.
  Capability.EQUIPMENT_UPLOAD_DOCUMENT,
  Capability.SUPPLIER_VIEW,
  Capability.SUPPLIER_CONTACT,
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
  Capability.ENTITY_WRITE,
  Capability.POS_VOID,
  // The Manager runs the floor: registers what arrives, positions it, routes the ticket and
  // signs the fix off. Everything except erasing an asset or a ticket outright.
  Capability.EQUIPMENT_CREATE,
  Capability.EQUIPMENT_EDIT,
  Capability.EQUIPMENT_MANAGE_LOCATION,
  Capability.EQUIPMENT_MANAGE_FLOORPLAN,
  Capability.MAINTENANCE_ASSIGN,
  Capability.MAINTENANCE_APPROVE,
  Capability.MAINTENANCE_CLOSE,
  Capability.MAINTENANCE_SCHEDULE,
  Capability.SUPPLIER_MANAGE,
];

const ADMIN_CAPABILITIES: readonly Capability[] = [
  ...MANAGER_CAPABILITIES,
  Capability.USER_WRITE,
  Capability.USER_ROLE_ASSIGN,
  Capability.PERMISSION_READ,
  Capability.PERMISSION_WRITE,
  Capability.MASTER_WRITE,
  Capability.TAX_WRITE,
  Capability.TAX_SYNC,
  Capability.TAX_OVERRIDE,
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
  // Destroying an asset record or a maintenance ticket destroys its history with it, so both
  // stop at Admin. Retiring an asset and cancelling a ticket are the Manager-level equivalents.
  Capability.EQUIPMENT_DELETE,
  Capability.MAINTENANCE_DELETE,
];

/**
 * Super Admin additionally reaches across board boundaries, but — unlike every other tier —
 * does not carry personal task work: they oversee the roster, they are never on it.
 */
const SUPER_ADMIN_CAPABILITIES: readonly Capability[] = [
  ...without(ADMIN_CAPABILITIES, Capability.TASK_SELF, Capability.TASK_ASSIGN),
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
