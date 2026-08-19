import type { MasterStatus, ReceiptTransport } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { KioskDeviceRow } from '../models/kioskRows';
import type { CountRow } from '../models/rows';
import { toJsonColumn } from '../utils/json';
import { toDbDateTime } from '../utils/time';

/**
 * The self-service stands, as rows rather than as four browsers' local storage.
 *
 * Every select joins the menu and the station for display: an operator looking at a list of
 * kiosks needs to read "North Hall — Prasad Menu — Mangarh", and making the portal issue three
 * requests to compose one line is how a settings page becomes slow enough to avoid using.
 */

const COLUMNS = `
  d.id, d.code, d.label, d.menu_code, d.station_id, d.outlet_name, d.outlet_name_hi,
  d.upi_vpa, d.upi_payee_name, d.receipt_transport, d.category_order, d.status,
  d.last_seen_at, d.created_by, d.created_at, d.updated_at, d.deleted_at, d.revision,
  s.name AS station_name, m.name AS menu_name`;

const FROM = `
  FROM kiosk_devices d
  LEFT JOIN stations s ON s.id = d.station_id AND s.deleted_at IS NULL
  LEFT JOIN menus m ON m.code = d.menu_code AND m.deleted_at IS NULL`;

export interface KioskDeviceInsert {
  id: string;
  code: string;
  label: string;
  menuCode: string;
  stationId: string | null;
  outletName: string;
  outletNameHi: string | null;
  upiVpa: string;
  upiPayeeName: string;
  receiptTransport: ReceiptTransport;
  categoryOrder: string[];
  status: MasterStatus;
  createdBy: string | null;
}

export type KioskDeviceUpdate = Partial<Omit<KioskDeviceInsert, 'id' | 'createdBy'>>;

export class KioskDeviceRepository {
  async findById(db: Db, id: string): Promise<KioskDeviceRow | null> {
    return selectOne<KioskDeviceRow>(
      db,
      `SELECT ${COLUMNS} ${FROM} WHERE d.id = ? AND d.deleted_at IS NULL`,
      [id],
    );
  }

  /**
   * By the code a tablet quotes. Deliberately case-insensitive on the collation the column
   * already carries, so a stand labelled `NORTH-1` still answers when somebody typed `north-1`
   * into the setup screen at six in the morning.
   */
  async findByCode(db: Db, code: string): Promise<KioskDeviceRow | null> {
    return selectOne<KioskDeviceRow>(
      db,
      `SELECT ${COLUMNS} ${FROM} WHERE d.code = ? AND d.deleted_at IS NULL`,
      [code],
    );
  }

  async list(db: Db, options: { activeOnly?: boolean } = {}): Promise<KioskDeviceRow[]> {
    const where = options.activeOnly === true ? "AND d.status = 'ACTIVE'" : '';
    return selectRows<KioskDeviceRow>(
      db,
      `SELECT ${COLUMNS} ${FROM} WHERE d.deleted_at IS NULL ${where} ORDER BY d.label ASC`,
    );
  }

  async countByCode(db: Db, code: string, excludeId: string | null): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM kiosk_devices
        WHERE code = ? AND deleted_at IS NULL AND (? IS NULL OR id <> ?)`,
      [code, excludeId, excludeId],
    );
    return row === null ? 0 : Number(row.total);
  }

  async insert(db: Db, input: KioskDeviceInsert): Promise<KioskDeviceRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO kiosk_devices
        (id, code, label, menu_code, station_id, outlet_name, outlet_name_hi, upi_vpa,
         upi_payee_name, receipt_transport, category_order, status, created_by,
         created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        input.id,
        input.code,
        input.label,
        input.menuCode,
        input.stationId,
        input.outletName,
        input.outletNameHi,
        input.upiVpa,
        input.upiPayeeName,
        input.receiptTransport,
        toJsonColumn(input.categoryOrder),
        input.status,
        input.createdBy,
        now,
        now,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted kiosk device could not be read back');
    return row;
  }

  async update(db: Db, id: string, input: KioskDeviceUpdate): Promise<KioskDeviceRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    const set = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if (input.code !== undefined) set('code', input.code);
    if (input.label !== undefined) set('label', input.label);
    if (input.menuCode !== undefined) set('menu_code', input.menuCode);
    if (input.stationId !== undefined) set('station_id', input.stationId);
    if (input.outletName !== undefined) set('outlet_name', input.outletName);
    if (input.outletNameHi !== undefined) set('outlet_name_hi', input.outletNameHi);
    if (input.upiVpa !== undefined) set('upi_vpa', input.upiVpa);
    if (input.upiPayeeName !== undefined) set('upi_payee_name', input.upiPayeeName);
    if (input.receiptTransport !== undefined) set('receipt_transport', input.receiptTransport);
    if (input.categoryOrder !== undefined) set('category_order', toJsonColumn(input.categoryOrder));
    if (input.status !== undefined) set('status', input.status);

    if (assignments.length > 0) {
      await mutate(
        db,
        `UPDATE kiosk_devices
            SET ${assignments.join(', ')}, updated_at = ?, revision = revision + 1
          WHERE id = ? AND deleted_at IS NULL`,
        [...params, toDbDateTime(), id],
      );
    }
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE kiosk_devices SET deleted_at = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  }

  /**
   * Stamped when a tablet reads its profile, which is the only heartbeat a kiosk has. Written
   * without bumping `revision`: a stand being switched on is not an edit to its configuration,
   * and treating it as one would make every list look freshly changed every minute.
   */
  async touch(db: Db, id: string): Promise<void> {
    await mutate(db, 'UPDATE kiosk_devices SET last_seen_at = ? WHERE id = ?', [
      toDbDateTime(),
      id,
    ]);
  }
}

export const kioskDeviceRepository = new KioskDeviceRepository();
