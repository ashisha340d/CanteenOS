import type { CleaningEventSource, CleaningTriggerEvent } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CleaningEventRow, CountRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * The event log the whole module hangs off.
 *
 * Every task in the system was raised by a row in this table — a person tapping "this needs
 * cleaning", a shift starting, the sweep noticing a schedule came due. Keeping the log means
 * "why does this task exist?" always has an answer, and it is the only way to measure whether
 * the automation is doing anything.
 *
 * `dedupe_key` is UNIQUE, which is what makes the ingest endpoint idempotent: a POS retrying a
 * batch-completed publish cannot manufacture a second round of work.
 */

const EVENT_SELECT = `SELECT e.*,
         a.name AS cleanable_asset_name,
         ar.name AS area_name,
         eq.name AS equipment_name,
         u.name AS reported_by_name
    FROM cleaning_events e
    LEFT JOIN cleanable_assets a ON a.id = e.cleanable_asset_id
    LEFT JOIN equipment_areas ar ON ar.id = e.area_id
    LEFT JOIN equipment eq ON eq.id = e.equipment_id
    LEFT JOIN users u ON u.id = e.reported_by`;

export interface EventFilter {
  search?: string;
  eventType?: CleaningTriggerEvent;
  source?: CleaningEventSource;
  areaId?: string;
  cleanableAssetId?: string;
  reportedBy?: string;
  unprocessedOnly?: boolean;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface EventInsert {
  id: string;
  eventType: CleaningTriggerEvent;
  source: CleaningEventSource;
  occurredAt: string;
  cleanableAssetId: string | null;
  areaId: string | null;
  equipmentId: string | null;
  shiftId: string | null;
  assetTypeId: string | null;
  reportedBy: string | null;
  note: string | null;
  payload: string | null;
  dedupeKey: string | null;
}

function eventWhere(filter: EventFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.eventType !== undefined) {
    conditions.push('e.event_type = ?');
    params.push(filter.eventType);
  }
  if (filter.source !== undefined) {
    conditions.push('e.source = ?');
    params.push(filter.source);
  }
  if (filter.areaId !== undefined) {
    conditions.push('e.area_id = ?');
    params.push(filter.areaId);
  }
  if (filter.cleanableAssetId !== undefined) {
    conditions.push('e.cleanable_asset_id = ?');
    params.push(filter.cleanableAssetId);
  }
  if (filter.reportedBy !== undefined) {
    conditions.push('e.reported_by = ?');
    params.push(filter.reportedBy);
  }
  if (filter.unprocessedOnly === true) conditions.push('e.processed_at IS NULL');
  if (filter.from !== undefined) {
    conditions.push('e.occurred_at >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    conditions.push('e.occurred_at <= ?');
    params.push(filter.to);
  }
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(e.note LIKE ? OR a.name LIKE ? OR ar.name LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }

  return {
    where: conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}

export const CleaningEventRepository = {
  async list(db: Db, filter: EventFilter): Promise<CleaningEventRow[]> {
    const { where, params } = eventWhere(filter);
    return selectRows<CleaningEventRow>(
      db,
      `${EVENT_SELECT} ${where} ORDER BY e.occurred_at DESC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async count(db: Db, filter: EventFilter): Promise<number> {
    const { where, params } = eventWhere(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM cleaning_events e
         LEFT JOIN cleanable_assets a ON a.id = e.cleanable_asset_id
         LEFT JOIN equipment_areas ar ON ar.id = e.area_id
        ${where}`,
      params,
    );
    return Number(row?.total ?? 0);
  },

  async findById(db: Db, id: string): Promise<CleaningEventRow | null> {
    return selectOne<CleaningEventRow>(db, `${EVENT_SELECT} WHERE e.id = ?`, [id]);
  },

  async findByDedupeKey(db: Db, dedupeKey: string): Promise<CleaningEventRow | null> {
    return selectOne<CleaningEventRow>(db, `${EVENT_SELECT} WHERE e.dedupe_key = ?`, [dedupeKey]);
  },

  async insert(db: Db, input: EventInsert): Promise<void> {
    await mutate(
      db,
      `INSERT INTO cleaning_events
         (id, event_type, source, occurred_at, cleanable_asset_id, area_id, equipment_id,
          shift_id, asset_type_id, reported_by, note, payload, dedupe_key, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.eventType,
        input.source,
        input.occurredAt,
        input.cleanableAssetId,
        input.areaId,
        input.equipmentId,
        input.shiftId,
        input.assetTypeId,
        input.reportedBy,
        input.note,
        input.payload,
        input.dedupeKey,
        toDbDateTime(),
      ],
    );
  },

  /** Records the outcome of processing. A failure is stored, not thrown away. */
  async markProcessed(
    db: Db,
    id: string,
    tasksCreated: number,
    processError: string | null,
  ): Promise<void> {
    await mutate(
      db,
      `UPDATE cleaning_events SET processed_at = ?, tasks_created = ?, process_error = ?
        WHERE id = ?`,
      [toDbDateTime(), tasksCreated, processError, id],
    );
  },

  async countReportsToday(db: Db): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM cleaning_events
        WHERE reported_by IS NOT NULL AND DATE(occurred_at) = UTC_DATE()`,
    );
    return Number(row?.total ?? 0);
  },
};
