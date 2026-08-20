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

  /* ------------------------------------- product, unit & location masters --- */

  /** Read the purchase/stock product master. Everyone who touches goods. */
  PRODUCT_READ: 'product.read',
  /** Create/edit a product, its units, tax profile, batch policy and stock levels. Manager+. */
  PRODUCT_WRITE: 'product.write',
  /** Maintain the unit-of-measure master and its conversion factors. Manager and above. */
  UOM_MANAGE: 'inventory.uom.manage',
  /** Maintain inventory locations — warehouse, day store, kitchen, production. Manager+. */
  INVENTORY_LOCATION_MANAGE: 'inventory.location.manage',
  /** Maintain the supplier↔product mapping used by OCR and automated purchasing. Manager+. */
  SUPPLIER_PRODUCT_MANAGE: 'purchase.supplier_product.manage',

  /* ------------------------------------------- inventory & stock movement --- */

  /** Read stock balances per product and location. Everyone who works a store. */
  INVENTORY_READ: 'inventory.read',
  /** Read the immutable stock ledger — every movement and its source document. */
  STOCK_LEDGER_READ: 'stock.ledger.read',
  /** Record a physical stock count. Floor staff count what is in front of them. */
  STOCK_COUNT_CREATE: 'stock.count.create',
  /** Approve a completed count so its variance may be posted. Manager and above. */
  STOCK_COUNT_APPROVE: 'stock.count.approve',
  /** Raise a stock adjustment (wastage, expiry, count variance). Manager and above. */
  STOCK_ADJUSTMENT_CREATE: 'stock.adjustment.create',
  /**
   * Post a stock adjustment. Separate from creating one because an adjustment rewrites the
   * physical truth without a supplier document behind it. Admin only.
   */
  STOCK_ADJUSTMENT_APPROVE: 'stock.adjustment.approve',
  /** Raise a transfer between two locations. Manager and above. */
  STOCK_TRANSFER_CREATE: 'stock.transfer.create',
  /** Approve a requested transfer. Manager and above. */
  STOCK_TRANSFER_APPROVE: 'stock.transfer.approve',
  /** Pick and dispatch an approved transfer out of the source location. Manager and above. */
  STOCK_TRANSFER_DISPATCH: 'stock.transfer.dispatch',
  /**
   * Book a dispatched transfer into the destination location. Reaches User: the person
   * standing in the receiving store is the person who confirms what actually arrived.
   */
  STOCK_TRANSFER_RECEIVE: 'stock.transfer.receive',

  /* -------------------------------------------------- purchase management --- */

  /** See the purchase dashboard and read purchase documents. Manager and above. */
  PURCHASE_READ: 'purchase.read',
  /** Raise a purchase requirement. Manager and above. */
  PURCHASE_REQUIREMENT_CREATE: 'purchase.requirement.create',
  /** Approve a requirement so it may be ordered. Manager and above. */
  PURCHASE_REQUIREMENT_APPROVE: 'purchase.requirement.approve',
  /** Draft a purchase order. Manager and above. */
  PURCHASE_ORDER_CREATE: 'purchase.order.create',
  /** Approve a purchase order — it commits the business to a supplier. Admin only. */
  PURCHASE_ORDER_APPROVE: 'purchase.order.approve',
  /** Raise a direct purchase entry with no requirement or order behind it. Manager and above. */
  PURCHASE_ENTRY_CREATE: 'purchase.entry.create',
  /** Book goods in against an order, an entry, or nothing at all. Manager and above. */
  PURCHASE_RECEIVE: 'purchase.receive',
  /** Accept or reject received quantity. Only accepted quantity becomes stock. Manager+. */
  PURCHASE_QC: 'purchase.qc',
  /** Record the supplier's financial claim. Manager and above. */
  PURCHASE_INVOICE_CREATE: 'purchase.invoice.create',
  /** Approve an invoice that failed three-way matching. Admin only. */
  PURCHASE_INVOICE_APPROVE: 'purchase.invoice.approve',
  /**
   * Post a purchase: stock in, invoice, vendor ledger, payable and settlement, atomically.
   * The single capability that turns a draft into an immutable, auditable transaction.
   */
  PURCHASE_POST: 'purchase.post',
  /** Return goods to a supplier. Manager and above. */
  PURCHASE_RETURN_CREATE: 'purchase.return.create',
  /** Post a purchase return — it moves stock out and adjusts the supplier. Admin only. */
  PURCHASE_RETURN_APPROVE: 'purchase.return.approve',
  /** Raise a debit memo against a supplier. Manager and above. */
  DEBIT_MEMO_CREATE: 'purchase.debit_memo.create',
  /** Post a debit memo. It changes what is owed, so it stops at Admin. */
  DEBIT_MEMO_APPROVE: 'purchase.debit_memo.approve',
  /** Record a supplier credit memo. Manager and above. */
  CREDIT_MEMO_CREATE: 'purchase.credit_memo.create',
  /** Post a credit memo. It changes what is owed, so it stops at Admin. */
  CREDIT_MEMO_APPROVE: 'purchase.credit_memo.approve',
  /** Read the vendor ledger, statement and running balance. Manager and above. */
  VENDOR_LEDGER_READ: 'purchase.vendor_ledger.read',
  /** Read accounts payable, outstanding and ageing. Manager and above. */
  PAYABLE_READ: 'purchase.payable.read',
  /** Queue an approved payable for payment. Manager and above. */
  PAYABLE_SUBMIT: 'purchase.payable.submit',
  /** Pay a supplier and allocate it against invoices. Money leaves — Admin only. */
  VENDOR_PAYMENT_CREATE: 'purchase.payment.create',
  /** Read purchase registers, price history and variance reports. Manager and above. */
  PURCHASE_REPORT_READ: 'purchase.report.read',

  /* ------------------------------- equipment monitoring & maintenance ------- */

  /**
   * The monitoring surface: the register, the dashboard, floor plans, timelines and history.
   * **Manager and above.** A reporter does not hold this and cannot browse the estate; they
   * reach one machine at a time by scanning its label (see EQUIPMENT_REPORT_PROBLEM).
   */
  EQUIPMENT_VIEW: 'equipment.view',
  /** Register a new asset (photo -> AI -> confirm). Manager and above. */
  EQUIPMENT_CREATE: 'equipment.create',
  EQUIPMENT_EDIT: 'equipment.edit',
  /** Retire is the normal end of life; deletion erases the asset. Admin only. */
  EQUIPMENT_DELETE: 'equipment.delete',
  /**
   * Raise a problem/fault against an asset, and — because you cannot report what you cannot
   * identify — resolve one machine by its QR code or asset id and read that machine's identity
   * and open problems. **User and above.** It deliberately grants *nothing* wider: a holder of
   * this and not EQUIPMENT_VIEW sees the machine in front of them and no other.
   */
  EQUIPMENT_REPORT_PROBLEM: 'equipment.report_problem',
  /** Attach a warranty card, invoice or service report to an asset. Manager and above. */
  EQUIPMENT_UPLOAD_DOCUMENT: 'equipment.upload_document',
  /** Create/edit floors, areas and locations, and move an asset between them. */
  EQUIPMENT_MANAGE_LOCATION: 'equipment.manage_location',
  /** Upload a floor plan and pin equipment onto it. Admin and Manager. */
  EQUIPMENT_MANAGE_FLOORPLAN: 'equipment.manage_floorplan',

  /** Read a ticket and its status. User and above — a reporter must be able to follow it up. */
  MAINTENANCE_VIEW: 'maintenance.view',
  /** Open a maintenance/inspection request. User and above. */
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

  /* ------------------------------------------ cleaning & hygiene management (§3e) */

  /** See the cleaning schedule, your own tasks and an asset's cleaning history. Everyone. */
  CLEANING_VIEW: 'cleaning.view',
  /** Start, perform and complete a cleaning task assigned to you. Everyone. */
  CLEANING_WORK: 'cleaning.work',
  /**
   * Report a spill or a contamination, which raises an immediate cleaning task. Reaches
   * Employee for the same reason EQUIPMENT_REPORT_PROBLEM does: whoever is standing in the
   * mess is the person who must be able to say so.
   */
  CLEANING_REPORT_INCIDENT: 'cleaning.report_incident',
  /** Pass or fail a completed clean. Manager and above — never the person who cleaned it. */
  CLEANING_VERIFY: 'cleaning.verify',
  /** Reassign a cleaning task, or give an unassigned one an owner. Manager and above. */
  CLEANING_ASSIGN: 'cleaning.assign',
  /** Maintain the cleanable asset register and its types. Manager and above. */
  CLEANING_ASSET_MANAGE: 'cleaning.asset_manage',
  /** Create and edit cleaning rules, frequencies and triggers. Manager and above. */
  CLEANING_RULE_MANAGE: 'cleaning.rule_manage',
  /** Author and publish cleaning procedures, steps and standards. Manager and above. */
  CLEANING_PROCEDURE_MANAGE: 'cleaning.procedure_manage',
  /** Maintain the chemical and cleaning tool masters. Manager and above. */
  CLEANING_CHEMICAL_MANAGE: 'cleaning.chemical_manage',
  /** Own and close a corrective action raised by a failed check. Manager and above. */
  CLEANING_CORRECTIVE_ACTION_MANAGE: 'cleaning.corrective_action_manage',
  /** Maintain skills, shifts and who is responsible for which area. Manager and above. */
  CLEANING_WORKFORCE_MANAGE: 'cleaning.workforce_manage',
  /**
   * Publish an operational event (batch completed, equipment used, shift ended) into the
   * cleaning engine. Manager and above because it manufactures work for other people; this is
   * also the capability an external POS/KDS/production integration authenticates as.
   */
  CLEANING_EVENT_PUBLISH: 'cleaning.event_publish',
  /** Read hygiene compliance dashboards and reports. Manager and above. */
  CLEANING_COMPLIANCE_VIEW: 'cleaning.compliance_view',
  /** Destroy a cleaning record, which destroys its compliance history. Admin only. */
  CLEANING_DELETE: 'cleaning.delete',

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
  // No part of the Equipment module: an Employee carries out work that is handed to them, and
  // reporting a fault opens a ticket somebody then has to be accountable for. Reporting starts
  // at User.
  // Cleaning reaches the bottom of the roster too: the person who cleans the mixer is the
  // person who does this work, and the person standing in a spill must be able to report it.
  Capability.CLEANING_VIEW,
  Capability.CLEANING_WORK,
  Capability.CLEANING_REPORT_INCIDENT,
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
  // Equipment starts here, and starts narrow: a User scans the machine in front of them,
  // reports what is wrong with it (with photos and video), and can then follow that ticket's
  // status. They cannot browse the estate, register or edit an asset, or ring a supplier —
  // EQUIPMENT_VIEW and the supplier capabilities are Manager's.
  Capability.EQUIPMENT_REPORT_PROBLEM,
  Capability.MAINTENANCE_VIEW,
  Capability.MAINTENANCE_CREATE,
  // Goods, not purchasing. A store keeper reads the product master, sees what is on their
  // shelf, counts it, and confirms what arrived from another store. They cannot buy anything,
  // cannot price anything, and cannot post an adjustment that rewrites the balance.
  Capability.PRODUCT_READ,
  Capability.INVENTORY_READ,
  Capability.STOCK_COUNT_CREATE,
  Capability.STOCK_TRANSFER_RECEIVE,
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
  // The Manager runs the floor: monitors the estate, registers what arrives, positions it,
  // routes the ticket and signs the fix off. Everything except erasing an asset or a ticket
  // outright. Monitoring — the register, the dashboard, floor plans and timelines — starts
  // here rather than lower down: below this a person reports the one machine they are standing
  // in front of and nothing more.
  Capability.EQUIPMENT_VIEW,
  Capability.EQUIPMENT_CREATE,
  Capability.EQUIPMENT_EDIT,
  Capability.EQUIPMENT_UPLOAD_DOCUMENT,
  Capability.EQUIPMENT_MANAGE_LOCATION,
  Capability.EQUIPMENT_MANAGE_FLOORPLAN,
  Capability.MAINTENANCE_ASSIGN,
  Capability.MAINTENANCE_APPROVE,
  Capability.MAINTENANCE_CLOSE,
  Capability.MAINTENANCE_SCHEDULE,
  Capability.SUPPLIER_VIEW,
  Capability.SUPPLIER_CONTACT,
  Capability.SUPPLIER_MANAGE,
  // The Manager owns the hygiene system: what gets cleaned, how, by whom, and whether it
  // passed. Verification is deliberately above CLEANING_WORK so the person who cleaned it is
  // never the person who signs it off.
  Capability.CLEANING_VERIFY,
  Capability.CLEANING_ASSIGN,
  Capability.CLEANING_ASSET_MANAGE,
  Capability.CLEANING_RULE_MANAGE,
  Capability.CLEANING_PROCEDURE_MANAGE,
  Capability.CLEANING_CHEMICAL_MANAGE,
  Capability.CLEANING_CORRECTIVE_ACTION_MANAGE,
  Capability.CLEANING_WORKFORCE_MANAGE,
  Capability.CLEANING_EVENT_PUBLISH,
  Capability.CLEANING_COMPLIANCE_VIEW,
  // The Manager buys the goods. They own the masters behind purchasing, raise every purchase
  // document, receive and QC the delivery, and post it — including settling a cash purchase,
  // because a van driver waiting at the back door cannot wait for an Admin. What they cannot
  // do is commit the business to a supplier on paper (PO approval), wave through an invoice
  // that failed matching, pay off a credit bill, or post an adjustment or memo that rewrites
  // a balance with no supplier document behind it. Those sit with Admin.
  Capability.PURCHASE_READ,
  Capability.PRODUCT_WRITE,
  Capability.UOM_MANAGE,
  Capability.INVENTORY_LOCATION_MANAGE,
  Capability.SUPPLIER_PRODUCT_MANAGE,
  Capability.STOCK_LEDGER_READ,
  Capability.STOCK_COUNT_APPROVE,
  Capability.STOCK_ADJUSTMENT_CREATE,
  Capability.STOCK_TRANSFER_CREATE,
  Capability.STOCK_TRANSFER_APPROVE,
  Capability.STOCK_TRANSFER_DISPATCH,
  Capability.PURCHASE_REQUIREMENT_CREATE,
  Capability.PURCHASE_REQUIREMENT_APPROVE,
  Capability.PURCHASE_ORDER_CREATE,
  Capability.PURCHASE_ENTRY_CREATE,
  Capability.PURCHASE_RECEIVE,
  Capability.PURCHASE_QC,
  Capability.PURCHASE_INVOICE_CREATE,
  Capability.PURCHASE_POST,
  Capability.PURCHASE_RETURN_CREATE,
  Capability.DEBIT_MEMO_CREATE,
  Capability.CREDIT_MEMO_CREATE,
  Capability.VENDOR_LEDGER_READ,
  Capability.PAYABLE_READ,
  Capability.PAYABLE_SUBMIT,
  Capability.PURCHASE_REPORT_READ,
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
  // Deleting a cleaning record erases the evidence that the clean happened, so it stops at
  // Admin. Cancelling a task and deactivating a rule are the Manager-level equivalents.
  Capability.CLEANING_DELETE,
  // The four purchase decisions that move money or rewrite a balance without a supplier
  // delivery behind them. A Manager raises each of these; only an Admin makes them real.
  Capability.PURCHASE_ORDER_APPROVE,
  Capability.PURCHASE_INVOICE_APPROVE,
  Capability.PURCHASE_RETURN_APPROVE,
  Capability.DEBIT_MEMO_APPROVE,
  Capability.CREDIT_MEMO_APPROVE,
  Capability.VENDOR_PAYMENT_CREATE,
  Capability.STOCK_ADJUSTMENT_APPROVE,
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

/**
 * Everything a kiosk session may do — an allowlist, not a denylist.
 *
 * The polarity is deliberate and is the opposite of the Android rule above. A phone is held
 * by an identified member of staff; a kiosk is an unattended tablet in a public hall, and the
 * token on it must be assumed readable by anyone who picks the device up. So the session is
 * default-deny: reading the published menu, and raising and settling its own counter sale.
 * Nothing else — no boards, no orders, no masters, no entities, no voids, no refunds.
 *
 * Adding a capability here widens what a stolen kiosk token can do. Nothing may be added
 * because a screen would be convenient.
 */
export const KIOSK_ALLOWED_CAPABILITIES: readonly Capability[] = [
  Capability.MASTER_READ,
  Capability.POS_READ,
  Capability.POS_OPERATE,
  Capability.POS_CHECKOUT,
];

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
