import type { KioskDeviceDto, KioskDeviceSummaryDto } from '@menuboard/shared';
import type { KioskDeviceRow } from './kioskRows';
import { parseIdArray } from '../utils/json';
import { fromDbDateTime, fromDbDateTimeRequired } from '../utils/time';

export function mapKioskDevice(row: KioskDeviceRow): KioskDeviceDto {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    menuCode: row.menu_code,
    menuName: row.menu_name ?? null,
    stationId: row.station_id,
    stationName: row.station_name ?? null,
    outletName: row.outlet_name,
    outletNameHi: row.outlet_name_hi,
    upiVpa: row.upi_vpa,
    upiPayeeName: row.upi_payee_name,
    receiptTransport: row.receipt_transport,
    categoryOrder: parseIdArray(row.category_order),
    status: row.status,
    lastSeenAt: fromDbDateTime(row.last_seen_at),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

/**
 * What a tablet may see before it has been told which stand it is.
 *
 * Narrower than the full row on purpose. The picker on the setup screen only needs enough to
 * let a member of staff recognise the stand they are standing at, and a kiosk session — which
 * is default-deny by design — has no business being handed the payee details of every other
 * stand in the organisation in order to answer one question about itself.
 */
export function mapKioskDeviceSummary(row: KioskDeviceRow): KioskDeviceSummaryDto {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    outletName: row.outlet_name,
    outletNameHi: row.outlet_name_hi,
    stationName: row.station_name ?? null,
    menuName: row.menu_name ?? null,
  };
}
