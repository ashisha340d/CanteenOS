import type {
  KioskLanguageMode,
  KioskRecommendationMode,
  KioskSkin,
  MasterStatus,
  ReceiptTransport,
} from '../enums';
import type { IsoDateTime, Uuid } from './common';

/**
 * What the Admin Portal decides about a kiosk, and what a kiosk is allowed to ask for.
 *
 * The split matters: everything here is either presentation the organisation owns centrally
 * (skin, language, whether a bill may be sent to a phone) or an instruction to act on a sale
 * that already exists. Nothing in this file lets a tablet describe a price, a tax or a device
 * on the network — those stay server-side, which is what keeps the endpoints reachable from
 * a public hall narrow enough to be safe.
 */

/* ------------------------------------------------------------------ the device registry */

/**
 * One stand in the hall, as the Admin Portal holds it.
 *
 * This used to live in the tablet's own `localStorage`, which meant provisioning a kiosk was
 * something a person did while standing at it, and re-provisioning four of them was four
 * walks. It is now a row: an operator at a desk defines every stand, and a tablet's entire
 * local state is the *code* of the stand it is standing at. The WebUSB grant is the one thing
 * that cannot move, because a browser will only hand out a USB device to a gesture made on the
 * machine the device is plugged into.
 */
export interface KioskDeviceDto {
  id: Uuid;
  /** What the tablet stores and quotes back. Short, human, and printed on the stand. */
  code: string;
  /** What the operator calls it in the portal — "North Hall, left of the pillar". */
  label: string;
  /** `menus.code` of the published menu this stand sells from. */
  menuCode: string;
  menuName: string | null;
  stationId: Uuid | null;
  stationName: string | null;
  /** What this stand calls itself on screen — never the legal name, which is org-wide. */
  outletName: string;
  outletNameHi: string | null;
  /** UPI VPA the payment QR is drawn for. Public by nature: it is on the QR. */
  upiVpa: string;
  upiPayeeName: string;
  /** Which ESC/POS route this stand tries first. */
  receiptTransport: ReceiptTransport;
  /**
   * The categories of this stand's menu, in the order the operator dragged them into. Holds
   * `menu_category_assignments.id` values. Anything the menu has and this list does not falls
   * to the end in the menu's own order, so adding a category in the Menu Master never makes a
   * dish invisible at a stand somebody forgot to re-sort.
   */
  categoryOrder: Uuid[];
  status: MasterStatus;
  /** When a tablet last read its profile under this code. Null until one ever has. */
  lastSeenAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** The narrow projection a tablet may read while it is deciding which stand it is. */
export interface KioskDeviceSummaryDto {
  id: Uuid;
  code: string;
  label: string;
  outletName: string;
  outletNameHi: string | null;
  stationName: string | null;
  menuName: string | null;
}

export interface CreateKioskDeviceRequest {
  code: string;
  label: string;
  menuCode: string;
  stationId?: Uuid | null;
  outletName: string;
  outletNameHi?: string | null;
  upiVpa?: string;
  upiPayeeName?: string;
  receiptTransport?: ReceiptTransport;
  categoryOrder?: Uuid[];
  status?: MasterStatus;
}

export type UpdateKioskDeviceRequest = Partial<CreateKioskDeviceRequest>;

/* ---------------------------------------------------------------------- the profile */

/**
 * The guest-facing configuration a kiosk reads at start-up and re-reads periodically.
 *
 * Deliberately *not* held on the device: a hall with four kiosks should change its look once,
 * in one place, and see all four follow. The `device` member is the stand's own row, resolved
 * from the code the tablet quoted — one poll therefore keeps both the organisation's
 * presentation and the stand's own binding current, and an operator who re-points a stand at a
 * different menu sees it happen without touching the tablet.
 */
export interface KioskProfileDto {
  skin: KioskSkin;
  languageMode: KioskLanguageMode;
  /** Shown above the menu when the device config does not name the outlet itself. */
  organisationName: string;
  /**
   * The billing identity, which belongs to the organisation and not to a tablet: four kiosks
   * in one hall must not be able to carry four different GSTINs because four people typed
   * them into four browsers. The kiosk renders these on the bill; it cannot edit them.
   */
  legalName: string;
  addressLine: string;
  gstin: string;
  /** Printed under the token; a line the hall chooses, not one the kiosk invents. */
  receiptFooter: string;
  /** False unless the backend actually holds WhatsApp credentials; the kiosk hides the offer. */
  whatsappBillEnabled: boolean;
  /** True when a networked counter printer is configured server-side. */
  networkPrinterConfigured: boolean;
  /** Printable columns of the configured roll — 32 on 58 mm, 48 on 80 mm. */
  receiptColumns: number;
  /** Seconds of stillness before an abandoned order is offered back to the next guest. */
  idlePromptSeconds: number;
  /** Whether the kiosk may suggest a drink or a sweet before payment, and which. */
  recommendations: KioskRecommendationMode;
  /**
   * The hall's own greeting, shown while the menu loads and again over the token. Data rather
   * than a string table entry: "राधे राधे" is right at Mangarh and wrong somewhere else, and
   * which words a hall greets its guests with is not a developer's decision.
   */
  greeting: string;
  greetingHi: string;
  /** The stand this tablet said it was, or null when it quoted a code nothing answers to. */
  device: KioskDeviceDto | null;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ bill delivery */

/**
 * Print a settled bill. The printer is never named by the caller — the server prints to the
 * device named in its own settings, so a tablet in a public hall cannot aim the backend at an
 * arbitrary host and port.
 */
export interface PrintPosBillRequest {
  copies?: number;
}

export interface PrintPosBillResultDto {
  transport: ReceiptTransport;
  bytesSent: number;
  /** Which device took the job, for the operator's benefit when a receipt does not appear. */
  target: string;
  printedAt: IsoDateTime;
}

/**
 * Send the GST bill of a settled sale to a phone number over WhatsApp.
 *
 * The number is passed rather than read off the ticket only when the guest gives it after the
 * sale is closed; when it was captured before checkout the ticket already carries it and this
 * may be omitted.
 */
export interface SendPosBillWhatsAppRequest {
  phone?: string;
}

export interface SendPosBillWhatsAppResultDto {
  /** E.164, as it was actually dialled — useful when the country code was inferred. */
  phone: string;
  /** The provider's message id, so a delivery query has something to quote. */
  messageId: string;
  sentAt: IsoDateTime;
}
