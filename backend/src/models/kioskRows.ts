import type { MasterStatus, ReceiptTransport } from '@menuboard/shared';
import type { RowDataPacket } from '../db/types';

/**
 * The kiosk device registry, as MariaDB hands it back.
 *
 * No `sync_seq`: a kiosk device is Admin Portal configuration, never an entity the Android app
 * caches, so it stays out of the sync ledger the same way `settings` does.
 */
export interface KioskDeviceRow extends RowDataPacket {
  id: string;
  code: string;
  label: string;
  menu_code: string;
  station_id: string | null;
  outlet_name: string;
  outlet_name_hi: string | null;
  upi_vpa: string;
  upi_payee_name: string;
  receipt_transport: ReceiptTransport;
  /** JSON array of `menu_category_assignments.id`. */
  category_order: string | null;
  status: MasterStatus;
  last_seen_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  /** Present only on queries that join for display; never on the base select. */
  station_name?: string | null;
  menu_name?: string | null;
}
