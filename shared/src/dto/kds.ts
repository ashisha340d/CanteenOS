import type { AvailabilityStatus, PosPaymentMethod } from '../enums';
import type { Uuid, IsoDateTime } from './common';

/* ------------------------------------------------------------------ KDS line status */

export const PosKdsLineStatus = {
  /** On the board, not yet acknowledged by the counter. */
  QUEUED: 'QUEUED',
  /** A person at the counter has seen it and tapped acknowledge. */
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  /** Handed over. Terminal — only `revert` moves it back. */
  SERVED: 'SERVED',
} as const;
export type PosKdsLineStatus = (typeof PosKdsLineStatus)[keyof typeof PosKdsLineStatus];

/* --------------------------------------------------------------- KDS board shapes */

/**
 * One line on a KDS card. Routing is resolved server-side: `printingGroupId` sends it to the
 * right kitchen screen, `counterId` to the right counter screen — falling back to the order's
 * counter when the item carries no route of its own.
 */
export interface KdsLineDto {
  id: Uuid;
  itemName: string;
  variantName: string | null;
  customItemName: string | null;
  quantity: number;
  notes: string | null;
  /** What the payer was charged — the value an exchange must match. */
  lineTotal: number;
  kdsStatus: PosKdsLineStatus;
  acknowledgedAt: IsoDateTime | null;
  servedAt: IsoDateTime | null;
  servedByName: string | null;
  /** Kitchen station this line belongs to; null when the item has no printing route. */
  printingGroupId: Uuid | null;
  printingGroupName: string | null;
  /** Per-item prep target in seconds; null falls back to the KDS default. */
  prepSeconds: number | null;
}

/** An order card as a counter or kitchen screen sees it — lines already filtered to its scope. */
export interface KdsOrderDto {
  id: Uuid;
  orderNumber: string;
  dailySequence: number;
  businessDate: string;
  orderType: string;
  counterId: Uuid | null;
  counterName: string | null;
  entityName: string | null;
  placedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  notes: string | null;
  lines: KdsLineDto[];
}

export interface KdsQueueDto {
  scope: { counterId?: Uuid; printingGroupId?: Uuid };
  orders: KdsOrderDto[];
  /** Aggregated outstanding quantities across the whole queue, for the summary rail. */
  summary: { itemName: string; quantity: number }[];
}

/** The last served lines at a counter — the undo list. `revert` accepts anything in it. */
export interface KdsRecentActionDto {
  lineId: Uuid;
  orderId: Uuid;
  orderNumber: string;
  itemName: string;
  variantName: string | null;
  quantity: number;
  servedAt: IsoDateTime;
  servedByName: string | null;
}

export interface KdsMetricsDto {
  pendingLines: number;
  pendingOrders: number;
  servedTodayLines: number;
  servedTodayOrders: number;
  /** Average seconds from queue to served, across today's served lines. */
  avgServeSeconds: number | null;
  /** Lines past their prep deadline right now. */
  overdueLines: number;
}

/* -------------------------------------------------------------------- KDS config */

export interface KdsConfigDto {
  /**
   * The three alarm voices as authenticated URL paths (`/api/v1/alerts/sounds/:slot/file`) — the
   * front desk uploads them on the KDS & CDS tab. Null means no file for that voice; the
   * display falls back to its built-in synth pattern. Fetch bytes with the session token and
   * hand the blob URL to an <audio> element — the route will not take an unauthenticated
   * <audio src>. A board can never choose or silence these; only the admin panel decides.
   */
  toneNewOrder: string | null;
  toneDueSoon: string | null;
  toneOverdue: string | null;
  /** Playback level for every board alarm, 0–1. Admin-owned, like the tones themselves. */
  alarmVolume: number;
  /** Fallback prep target when a menu item carries none. */
  defaultPrepSeconds: number;
  /** Warn this many seconds before a line's deadline. */
  dueSoonSeconds: number;
  /** Repeat the overdue alarm every this-many seconds once past the deadline. */
  overdueRepeatSeconds: number;
  /** How many recent serves the revert list offers. */
  revertWindow: number;
}

/* ------------------------------------------------------------- station menu file */

/**
 * A station's own menu file: the counter or kitchen can rename a dish for its screen and
 * mark it finished for the shift without touching the menu master. Overrides live per
 * station; `displayName` is the effective name (master name when the station has none).
 */
export interface KdsStationMenuItemDto {
  menuItemId: Uuid;
  categoryName: string;
  masterName: string;
  displayName: string;
  /** True when the station renamed the dish — reverting clears the override row. */
  hasCustomName: boolean;
  /**
   * Finished for this shift: the counter has run out. Unlike the rename, this is *not* local —
   * it writes the menu's own availability, so the Digital Menu Board stops offering the dish
   * and the shift scheduler puts it back at the next morning/evening boundary.
   */
  isFinished: boolean;
  /** The menu's availability as it stands, for the rare state that is neither of the above. */
  availability: AvailabilityStatus;
  /**
   * Counted stock for this shift. Null when nobody registered a number, in which case the dish
   * is simply available until somebody marks it finished.
   */
  openingQty: number | null;
  /** Sold through this counter since `qtyRegisteredAt`. Zero when no stock is registered. */
  issuedQty: number;
  /** `openingQty - issuedQty`, floored at zero. Null when no stock is registered. */
  remainingQty: number | null;
  qtyRegisteredAt: IsoDateTime | null;
  primaryMediaUrl: string | null;
  basePrice: number | null;
}

export type KdsStationKind = 'counter' | 'kitchen';
export type KdsShift = 'MORNING' | 'EVENING';

export interface KdsStationMenuDto {
  stationKind: KdsStationKind;
  stationId: Uuid;
  /** Which shift the counted stock belongs to; it resets when the shift turns over. */
  shift: KdsShift;
  businessDate: string;
  items: KdsStationMenuItemDto[];
}

/** Send only what changed. `displayName: null` clears the rename, `openingQty: null` the count. */
export interface KdsStationMenuUpsertRequest {
  displayName?: string | null;
  isFinished?: boolean;
  openingQty?: number | null;
}

/* --------------------------------------------------------------------- CDS bill */

/**
 * The bill a customer-facing display shows: the counter's open ticket while it is being rung
 * up, and then the settled bill for a short hold after checkout — the customer still has to
 * pay and read it after the cashier presses done.
 */
export interface CdsBillDto {
  orderId: Uuid;
  orderNumber: string;
  counterName: string | null;
  lines: { itemName: string; variantName: string | null; quantity: number; lineTotal: number }[];
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  roundOffAmount: number;
  totalAmount: number;
  /**
   * UPI deep link the QR resolves to, e.g. upi://pay?pa=…&am=…. Only present when the bill is
   * actually to be paid by UPI — a cash bill shows no QR however the counter is configured.
   */
  upiLink: string | null;
  /** True once the cashier has settled it; the display switches from cart to pay/thank-you. */
  isSettled: boolean;
  /** How the settled bill was tendered. Empty while the ticket is still open. */
  paymentMethods: PosPaymentMethod[];
  updatedAt: IsoDateTime;
}

/* ---------------------------------------------------------------- CDS live mirror */

export interface CdsLiveLineDto {
  itemName: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * The till's unsaved cart, mirrored to the customer display as the cashier works. Pushed by
 * the POS over the socket and relayed straight to the counter's CDS room — never persisted,
 * never authoritative: the saved bill (CdsBillDto) takes over the moment the ticket settles.
 * `upiLink` is filled in by the relay, never by the till.
 */
export interface CdsLiveDto {
  counterId: Uuid;
  orderNumber: string | null;
  lines: CdsLiveLineDto[];
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  /** Tender methods selected at checkout; empty while the cashier is still ringing up. */
  paymentMethods: PosPaymentMethod[];
  upiLink: string | null;
}

/* ------------------------------------------------------------------- write bodies */

export interface KdsExchangeRequest {
  /** Lines being returned, by line id. */
  lineIds: Uuid[];
  /** Replacement lines — combined unit value must equal the exchanged lines' total. */
  additions: { menuItemId: Uuid; variantId?: Uuid | null; quantity: number }[];
  /** Must equal the exchanged lines' combined lineTotal; the server re-checks. */
  expectedValue: number;
}

/* ------------------------------------------------------------------ socket events */

export const KDS_SOCKET_EVENTS = {
  /** Room join requests from a display. */
  KDS_SUBSCRIBE: 'kds:subscribe',
  CDS_SUBSCRIBE: 'cds:subscribe',
  /** Server → room: something on this scope's board changed; refetch. */
  KDS_CHANGED: 'kds:changed',
  /** Server → counter room: the active bill changed. Payload: CdsBillDto. */
  CDS_BILL: 'cds:bill',
  /** POS → server → counter room: the till's live cart. Payload: CdsLiveDto; null clears it. */
  CDS_LIVE: 'cds:live',
} as const;
