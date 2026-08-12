import type { GstSyncStatus, HsnSacCodeType, MasterStatus } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  CountRow,
  GstSyncRunRow,
  HsnSacCodeRow,
  TaxProfileRow,
} from '../models/rows';
import type { ParsedHsnSacRecord } from '../utils/gstMasterSource';
import { newId } from '../utils/ids';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for the GST classification master, its synchronization runs, and the Tax
 * Profile master (021_gst_tax_masters.sql).
 *
 * None of these tables carry `revision`/`sync_seq`: they are Admin-Portal-only and never
 * reach the Android app, so unlike MasterRepository/MenuMasterRepository there is no sync
 * bookkeeping here. `hsn_sac_master` additionally has no soft delete — a code that leaves the
 * authoritative dataset is deactivated, never removed, so history stays resolvable.
 */

const HSN_SAC_COLUMNS = `id, code, code_type, description, chapter, heading, sub_heading,
    is_active, source, source_version, source_checksum, first_synced_at, last_synced_at,
    deactivated_at, created_at, updated_at`;

const TAX_PROFILE_SELECT = `SELECT tp.*, h.code AS hsn_sac_code, h.code_type AS hsn_sac_code_type,
         h.description AS hsn_sac_description,
         (SELECT COUNT(*) FROM menu_items mi
           WHERE mi.tax_profile_id = tp.id AND mi.deleted_at IS NULL) AS food_item_count
    FROM tax_profiles tp
    LEFT JOIN hsn_sac_master h ON h.id = tp.hsn_sac_id`;

/* --------------------------------------------------------- classification master */

export interface HsnSacSearchFilter {
  query?: string;
  codeType?: HsnSacCodeType;
  activeOnly: boolean;
  limit: number;
  offset: number;
}

/**
 * The columns of an existing row that a sync compares against, keyed `CODETYPE:CODE`.
 * Loading the whole master once is deliberate: 22k narrow rows is a few MB, and it turns the
 * diff into in-memory lookups instead of 22k round trips.
 */
export interface ExistingHsnSacRecord {
  id: string;
  description: string;
  chapter: string | null;
  heading: string | null;
  subHeading: string | null;
  isActive: boolean;
}

function searchConditions(filter: HsnSacSearchFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.activeOnly) conditions.push('is_active = 1');
  if (filter.codeType) {
    conditions.push('code_type = ?');
    params.push(filter.codeType);
  }
  if (filter.query !== undefined && filter.query !== '') {
    // Exact code first, then prefix, then description substring — one predicate, ordered by
    // the same three cases below so the best match surfaces without a second query.
    conditions.push('(code = ? OR code LIKE ? OR description LIKE ?)');
    params.push(filter.query, `${filter.query}%`, `%${filter.query}%`);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export const HsnSacRepository = {
  async search(db: Db, filter: HsnSacSearchFilter): Promise<HsnSacCodeRow[]> {
    const { where, params } = searchConditions(filter);
    const relevance =
      filter.query !== undefined && filter.query !== ''
        ? `CASE WHEN code = ? THEN 0 WHEN code LIKE ? THEN 1 ELSE 2 END, CHAR_LENGTH(code),`
        : '';
    const relevanceParams =
      filter.query !== undefined && filter.query !== ''
        ? [filter.query, `${filter.query}%`]
        : [];

    return selectRows<HsnSacCodeRow>(
      db,
      `SELECT ${HSN_SAC_COLUMNS} FROM hsn_sac_master ${where}
        ORDER BY ${relevance} code_type, code
        LIMIT ? OFFSET ?`,
      [...params, ...relevanceParams, filter.limit, filter.offset],
    );
  },

  async countSearch(db: Db, filter: HsnSacSearchFilter): Promise<number> {
    const { where, params } = searchConditions(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS count FROM hsn_sac_master ${where}`,
      params,
    );
    return Number(row?.count ?? 0);
  },

  async findById(db: Db, id: string): Promise<HsnSacCodeRow | null> {
    return selectOne<HsnSacCodeRow>(
      db,
      `SELECT ${HSN_SAC_COLUMNS} FROM hsn_sac_master WHERE id = ?`,
      [id],
    );
  },

  async findByCode(
    db: Db,
    codeType: HsnSacCodeType,
    code: string,
  ): Promise<HsnSacCodeRow | null> {
    return selectOne<HsnSacCodeRow>(
      db,
      `SELECT ${HSN_SAC_COLUMNS} FROM hsn_sac_master WHERE code_type = ? AND code = ?`,
      [codeType, code],
    );
  },

  async loadAllForDiff(db: Db): Promise<Map<string, ExistingHsnSacRecord>> {
    const rows = await selectRows<HsnSacCodeRow>(
      db,
      `SELECT id, code, code_type, description, chapter, heading, sub_heading, is_active
         FROM hsn_sac_master`,
    );
    const map = new Map<string, ExistingHsnSacRecord>();
    for (const row of rows) {
      map.set(`${row.code_type}:${row.code}`, {
        id: row.id,
        description: row.description,
        chapter: row.chapter,
        heading: row.heading,
        subHeading: row.sub_heading,
        isActive: row.is_active === 1,
      });
    }
    return map;
  },

  /** Bulk insert of brand-new codes. Chunking is the caller's job. */
  async insertMany(
    db: Db,
    records: ParsedHsnSacRecord[],
    meta: { source: string; sourceVersion: string | null; checksum: string; now: string },
  ): Promise<number> {
    if (records.length === 0) return 0;
    const placeholders = records.map(() => '(?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)').join(',');
    const params: unknown[] = [];
    for (const record of records) {
      params.push(
        newId(),
        record.code,
        record.codeType,
        record.description,
        record.chapter,
        record.heading,
        record.subHeading,
        meta.source,
        meta.sourceVersion,
        meta.checksum,
        meta.now,
        meta.now,
        meta.now,
        meta.now,
      );
    }
    const result = await mutate(
      db,
      `INSERT INTO hsn_sac_master
         (id, code, code_type, description, chapter, heading, sub_heading, is_active,
          source, source_version, source_checksum, first_synced_at, last_synced_at,
          created_at, updated_at)
       VALUES ${placeholders}`,
      params,
    );
    return result.affectedRows;
  },

  /**
   * Applies a changed description/classification, and reactivates a code that has returned to
   * the authoritative dataset.
   */
  async updateMany(
    db: Db,
    updates: { id: string; record: ParsedHsnSacRecord }[],
    meta: { sourceVersion: string | null; checksum: string; now: string },
  ): Promise<number> {
    let affected = 0;
    for (const { id, record } of updates) {
      const result = await mutate(
        db,
        `UPDATE hsn_sac_master
            SET description = ?, chapter = ?, heading = ?, sub_heading = ?,
                is_active = 1, deactivated_at = NULL,
                source_version = ?, source_checksum = ?, last_synced_at = ?, updated_at = ?
          WHERE id = ?`,
        [
          record.description,
          record.chapter,
          record.heading,
          record.subHeading,
          meta.sourceVersion,
          meta.checksum,
          meta.now,
          meta.now,
          id,
        ],
      );
      affected += result.affectedRows;
    }
    return affected;
  },

  /** Marks unchanged rows as seen in this dataset without touching their content. */
  async touchMany(
    db: Db,
    ids: string[],
    meta: { sourceVersion: string | null; checksum: string; now: string },
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await mutate(
      db,
      `UPDATE hsn_sac_master
          SET source_version = ?, source_checksum = ?, last_synced_at = ?
        WHERE id IN (${ids.map(() => '?').join(',')})`,
      [meta.sourceVersion, meta.checksum, meta.now, ...ids],
    );
    return result.affectedRows;
  },

  /** Never deletes. A code absent from the dataset is deactivated so references still resolve. */
  async deactivateMany(db: Db, ids: string[], now: string): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await mutate(
      db,
      `UPDATE hsn_sac_master
          SET is_active = 0, deactivated_at = ?, updated_at = ?
        WHERE id IN (${ids.map(() => '?').join(',')}) AND is_active = 1`,
      [now, now, ...ids],
    );
    return result.affectedRows;
  },

  async summaryCounts(db: Db): Promise<{
    total: number;
    active: number;
    inactive: number;
    hsn: number;
    sac: number;
    lastSyncedAt: string | null;
    sourceVersion: string | null;
    source: string | null;
  }> {
    const row = await selectOne<
      CountRow & {
        total: number;
        active: number;
        inactive: number;
        hsn: number;
        sac: number;
        last_synced_at: string | null;
        source_version: string | null;
        source: string | null;
      }
    >(
      db,
      `SELECT COUNT(*) AS total,
              SUM(is_active = 1) AS active,
              SUM(is_active = 0) AS inactive,
              SUM(code_type = 'HSN') AS hsn,
              SUM(code_type = 'SAC') AS sac,
              MAX(last_synced_at) AS last_synced_at,
              MAX(source_version) AS source_version,
              MAX(source) AS source
         FROM hsn_sac_master`,
    );
    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      inactive: Number(row?.inactive ?? 0),
      hsn: Number(row?.hsn ?? 0),
      sac: Number(row?.sac ?? 0),
      lastSyncedAt: row?.last_synced_at ?? null,
      sourceVersion: row?.source_version ?? null,
      source: row?.source ?? null,
    };
  },

  /**
   * Ids referenced by a tax profile. The sync uses this only to report; it never changes
   * behaviour, because deactivation already preserves the reference.
   */
  async findReferencedIds(db: Db, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await selectRows<HsnSacCodeRow & { hsn_sac_id: string }>(
      db,
      `SELECT DISTINCT hsn_sac_id FROM tax_profiles
        WHERE hsn_sac_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`,
      ids,
    );
    return new Set(rows.map((row) => row.hsn_sac_id));
  },
};

/* ------------------------------------------------------------- sync runs */

export const GstSyncRunRepository = {
  async start(
    db: Db,
    input: { startedBy: string | null; source: string; sourceUrl: string },
  ): Promise<string> {
    const id = newId();
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO gst_sync_runs
         (id, started_at, started_by, source, source_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, ?)`,
      [id, now, input.startedBy, input.source, input.sourceUrl, now, now],
    );
    return id;
  },

  async complete(
    db: Db,
    id: string,
    input: {
      status: GstSyncStatus;
      sourceVersion: string | null;
      sourceChecksum: string | null;
      downloaded: number;
      added: number;
      updated: number;
      deactivated: number;
      unchanged: number;
      failed: number;
      errorDetails: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE gst_sync_runs
          SET completed_at = ?, status = ?, source_version = ?, source_checksum = ?,
              records_downloaded = ?, records_added = ?, records_updated = ?,
              records_deactivated = ?, records_unchanged = ?, records_failed = ?,
              error_details = ?, updated_at = ?
        WHERE id = ?`,
      [
        now,
        input.status,
        input.sourceVersion,
        input.sourceChecksum,
        input.downloaded,
        input.added,
        input.updated,
        input.deactivated,
        input.unchanged,
        input.failed,
        input.errorDetails,
        now,
        id,
      ],
    );
  },

  async findById(db: Db, id: string): Promise<GstSyncRunRow | null> {
    return selectOne<GstSyncRunRow>(
      db,
      `SELECT r.*, u.name AS started_by_name
         FROM gst_sync_runs r
         LEFT JOIN users u ON u.id = r.started_by
        WHERE r.id = ?`,
      [id],
    );
  },

  async list(db: Db, limit: number, offset: number): Promise<GstSyncRunRow[]> {
    return selectRows<GstSyncRunRow>(
      db,
      `SELECT r.*, u.name AS started_by_name
         FROM gst_sync_runs r
         LEFT JOIN users u ON u.id = r.started_by
        ORDER BY r.started_at DESC
        LIMIT ? OFFSET ?`,
      [limit, offset],
    );
  },

  async count(db: Db): Promise<number> {
    const row = await selectOne<CountRow>(db, 'SELECT COUNT(*) AS count FROM gst_sync_runs');
    return Number(row?.count ?? 0);
  },

  async findLatest(db: Db): Promise<GstSyncRunRow | null> {
    return selectOne<GstSyncRunRow>(
      db,
      `SELECT r.*, u.name AS started_by_name
         FROM gst_sync_runs r
         LEFT JOIN users u ON u.id = r.started_by
        ORDER BY r.started_at DESC
        LIMIT 1`,
    );
  },

  /** A run left RUNNING by a crashed process must not block the next one forever. */
  async failStaleRuns(db: Db, olderThan: string): Promise<number> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE gst_sync_runs
          SET status = 'FAILED', completed_at = ?, updated_at = ?,
              error_details = 'The run did not finish; the server restarted while it was in progress.'
        WHERE status = 'RUNNING' AND started_at < ?`,
      [now, now, olderThan],
    );
    return result.affectedRows;
  },

  async hasRunning(db: Db): Promise<boolean> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS count FROM gst_sync_runs WHERE status = 'RUNNING'`,
    );
    return Number(row?.count ?? 0) > 0;
  },
};

/* ------------------------------------------------------------- tax profiles */

export interface TaxProfileListFilter {
  search?: string;
  status?: MasterStatus;
  limit: number;
  offset: number;
}

function profileWhere(filter: TaxProfileListFilter): { where: string; params: unknown[] } {
  const conditions = ['tp.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filter.status) {
    conditions.push('tp.status = ?');
    params.push(filter.status);
  }
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(tp.name LIKE ? OR tp.code LIKE ? OR h.code LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export const TaxProfileRepository = {
  async list(db: Db, filter: TaxProfileListFilter): Promise<TaxProfileRow[]> {
    const { where, params } = profileWhere(filter);
    return selectRows<TaxProfileRow>(
      db,
      `${TAX_PROFILE_SELECT} ${where} ORDER BY tp.sort_order, tp.name LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async count(db: Db, filter: TaxProfileListFilter): Promise<number> {
    const { where, params } = profileWhere(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS count FROM tax_profiles tp
         LEFT JOIN hsn_sac_master h ON h.id = tp.hsn_sac_id ${where}`,
      params,
    );
    return Number(row?.count ?? 0);
  },

  async findById(db: Db, id: string): Promise<TaxProfileRow | null> {
    return selectOne<TaxProfileRow>(
      db,
      `${TAX_PROFILE_SELECT} WHERE tp.id = ? AND tp.deleted_at IS NULL`,
      [id],
    );
  },

  async insert(
    db: Db,
    input: {
      id: string;
      code: string;
      name: string;
      description: string | null;
      hsnSacId: string | null;
      supplyType: string;
      gstTaxability: string;
      gstRate: number;
      cgstRate: number;
      sgstRate: number;
      igstRate: number;
      cessRate: number;
      priceIsInclusive: boolean;
      itcEligibility: string;
      effectiveFrom: string | null;
      effectiveTo: string | null;
      exemptionReason: string | null;
      regulatoryNotes: string | null;
      status: MasterStatus;
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO tax_profiles
         (id, code, name, description, hsn_sac_id, supply_type, gst_taxability,
          gst_rate, cgst_rate, sgst_rate, igst_rate, cess_rate, price_is_inclusive,
          itc_eligibility, effective_from, effective_to, exemption_reason, regulatory_notes,
          status, sort_order, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.code,
        input.name,
        input.description,
        input.hsnSacId,
        input.supplyType,
        input.gstTaxability,
        input.gstRate,
        input.cgstRate,
        input.sgstRate,
        input.igstRate,
        input.cessRate,
        input.priceIsInclusive ? 1 : 0,
        input.itcEligibility,
        input.effectiveFrom,
        input.effectiveTo,
        input.exemptionReason,
        input.regulatoryNotes,
        input.status,
        input.sortOrder,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  async update(
    db: Db,
    id: string,
    assignments: string[],
    params: unknown[],
  ): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE tax_profiles SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE tax_profiles SET deleted_at = ?, status = 'INACTIVE', updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /** Food items and variants that assign this profile; blocks deletion while non-zero. */
  async countReferences(db: Db, id: string): Promise<{ foodItems: number; variants: number }> {
    const row = await selectOne<CountRow & { food_items: number; variants: number }>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM menu_items WHERE tax_profile_id = ? AND deleted_at IS NULL)
           AS food_items,
         (SELECT COUNT(*) FROM menu_item_variants WHERE tax_profile_id = ? AND deleted_at IS NULL)
           AS variants`,
      [id, id],
    );
    return { foodItems: Number(row?.food_items ?? 0), variants: Number(row?.variants ?? 0) };
  },
};
