import type { MasterStatus } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, VendorRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * The purchase-facing read of the entity master: `entities` rows of type VENDOR, together
 * with the `vendor_*` profile columns migration 004 added to them.
 *
 * There is no vendors table and there must not be one — `entities` already carries gstin,
 * state code, credit limit and the running account balance the till settles against, and a
 * second supplier master would be a second version of the truth. `EntityRepository` owns the
 * shared master; this reads it through the purchase lens and writes only the profile columns.
 */

const VENDOR_COLUMNS = `e.id, e.code, e.type, e.name, e.phone, e.email, e.address, e.city,
    e.state_code, e.gstin, e.pan, e.credit_limit, e.account_balance, e.status,
    e.vendor_payment_terms, e.vendor_credit_days, e.vendor_bank_name, e.vendor_bank_account,
    e.vendor_bank_ifsc, e.vendor_opening_balance, e.vendor_is_approved,
    e.vendor_default_location_id`;

const VENDOR_SELECT = `SELECT ${VENDOR_COLUMNS} FROM entities e`;

/** Every read is pinned to VENDOR rows: a customer has no purchase profile to speak of. */
const VENDOR_SCOPE = "e.type = 'VENDOR' AND e.deleted_at IS NULL";

export interface VendorListFilter {
  search?: string;
  status?: MasterStatus;
  approvedOnly?: boolean;
  limit: number;
  offset: number;
}

export interface UpdateVendorProfileInput {
  paymentTerms?: string | null;
  creditDays?: number;
  bankName?: string | null;
  bankAccount?: string | null;
  bankIfsc?: string | null;
  openingBalance?: number;
  isApproved?: boolean;
  defaultLocationId?: string | null;
}

const UPDATABLE_COLUMNS: Readonly<Record<keyof UpdateVendorProfileInput, string>> = {
  paymentTerms: 'vendor_payment_terms',
  creditDays: 'vendor_credit_days',
  bankName: 'vendor_bank_name',
  bankAccount: 'vendor_bank_account',
  bankIfsc: 'vendor_bank_ifsc',
  openingBalance: 'vendor_opening_balance',
  isApproved: 'vendor_is_approved',
  defaultLocationId: 'vendor_default_location_id',
};

function buildWhere(filter: VendorListFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [VENDOR_SCOPE];
  const params: unknown[] = [];

  if (filter.status !== undefined) {
    conditions.push('e.status = ?');
    params.push(filter.status);
  }
  if (filter.approvedOnly === true) conditions.push('e.vendor_is_approved = 1');
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(e.name LIKE ? OR e.code LIKE ? OR e.phone LIKE ? OR e.gstin LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like, like);
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export class VendorRepository {
  async findById(db: Db, id: string): Promise<VendorRow | null> {
    return selectOne<VendorRow>(db, `${VENDOR_SELECT} WHERE e.id = ? AND ${VENDOR_SCOPE}`, [id]);
  }

  async list(db: Db, filter: VendorListFilter): Promise<{ rows: VendorRow[]; total: number }> {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<VendorRow>(
      db,
      `${VENDOR_SELECT} ${where} ORDER BY e.sort_order ASC, e.name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM entities e ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  /** Writes only the `vendor_*` columns; the shared entity fields stay with EntityService. */
  async updateProfile(
    db: Db,
    id: string,
    input: UpdateVendorProfileInput,
  ): Promise<VendorRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      const value = input[key as keyof UpdateVendorProfileInput];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    if (assignments.length === 0) return this.findById(db, id);

    const result = await mutate(
      db,
      `UPDATE entities SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND type = 'VENDOR' AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    if (result.affectedRows === 0) return null;
    return this.findById(db, id);
  }
}

export const vendorRepository = new VendorRepository();
