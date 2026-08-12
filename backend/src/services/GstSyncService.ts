import {
  GST_MASTER_SOURCE,
  GstSyncStatus,
  type GstSyncRunDto,
  type HsnSacMasterSummaryDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { mapGstSyncRun } from '../models/mappers';
import {
  GstSyncRunRepository,
  HsnSacRepository,
} from '../repositories/TaxRepository';
import { ConflictError, NotFoundError, isAppError } from '../utils/errors';
import { fetchGstMasterDataset, type ParsedHsnSacRecord } from '../utils/gstMasterSource';
import { buildPage, resolvePaging } from '../utils/http';
import { logger } from '../utils/logger';
import { fromDbDateTime, toDbDateTime } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * "Sync GST Master": import the official GST/GSTN HSN/SAC classification dataset.
 *
 * What this deliberately does NOT do:
 *  - It never writes a tax rate. The official dataset has none, so rates stay on tax_profiles
 *    where an administrator owns them.
 *  - It never edits a Tax Profile, a Food Item or a Variant. Classification data changing must
 *    not silently re-tax anything that is already selling.
 *  - It never deletes. A code missing from the dataset is deactivated, so a food item that
 *    already references it keeps resolving.
 */

/** Rows per INSERT. Keeps the statement well inside max_allowed_packet at ~22k records. */
const INSERT_CHUNK = 500;
/** Ids per UPDATE ... WHERE id IN (...). */
const UPDATE_CHUNK = 500;
/** A RUNNING row older than this was orphaned by a restart, not genuinely in flight. */
const STALE_RUN_MS = 30 * 60 * 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class GstSyncService {
  async getSummary(): Promise<HsnSacMasterSummaryDto> {
    const pool = getPool();
    const [counts, latest] = await Promise.all([
      HsnSacRepository.summaryCounts(pool),
      GstSyncRunRepository.findLatest(pool),
    ]);

    return {
      totalCodes: counts.total,
      activeCodes: counts.active,
      inactiveCodes: counts.inactive,
      hsnCodes: counts.hsn,
      sacCodes: counts.sac,
      lastSyncedAt: fromDbDateTime(counts.lastSyncedAt),
      source: counts.source ?? GST_MASTER_SOURCE.NAME,
      sourceVersion: counts.sourceVersion,
      lastSyncStatus: latest?.status ?? null,
    };
  }

  async listRuns(query: { page?: number; pageSize?: number }) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const [rows, total] = await Promise.all([
      GstSyncRunRepository.list(pool, pageSize, offset),
      GstSyncRunRepository.count(pool),
    ]);
    return buildPage(rows.map(mapGstSyncRun), total, page, pageSize);
  }

  async getRun(id: string): Promise<GstSyncRunDto> {
    const row = await GstSyncRunRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Synchronization run', id);
    return mapGstSyncRun(row);
  }

  /**
   * Runs one synchronization to completion and returns its summary.
   *
   * The download and parse happen OUTSIDE the transaction — they are slow and must not hold
   * locks — and the diff is applied inside one, so a partially-applied dataset can never be
   * observed. The run row is written on its own connection so a rolled-back apply still
   * leaves a FAILED audit record behind.
   */
  async sync(actor: AuditActor): Promise<GstSyncRunDto> {
    const pool = getPool();

    await GstSyncRunRepository.failStaleRuns(pool, toDbDateTime(new Date(Date.now() - STALE_RUN_MS)));
    if (await GstSyncRunRepository.hasRunning(pool)) {
      throw new ConflictError('A GST master synchronization is already in progress');
    }

    const runId = await GstSyncRunRepository.start(pool, {
      startedBy: actor.userId,
      source: GST_MASTER_SOURCE.NAME,
      sourceUrl: GST_MASTER_SOURCE.URL,
    });

    try {
      const dataset = await fetchGstMasterDataset();
      logger.info('GST master dataset downloaded', {
        runId,
        records: dataset.records.length,
        rejected: dataset.rejected.length,
        sourceVersion: dataset.sourceVersion,
        bytes: dataset.byteLength,
      });

      const counts = await withTransaction(async (connection) => {
        const existing = await HsnSacRepository.loadAllForDiff(connection);
        const now = toDbDateTime();
        const meta = {
          source: GST_MASTER_SOURCE.NAME,
          sourceVersion: dataset.sourceVersion,
          checksum: dataset.checksum,
          now,
        };

        const toInsert: ParsedHsnSacRecord[] = [];
        const toUpdate: { id: string; record: ParsedHsnSacRecord }[] = [];
        const unchangedIds: string[] = [];
        const seenKeys = new Set<string>();

        for (const record of dataset.records) {
          const key = `${record.codeType}:${record.code}`;
          seenKeys.add(key);
          const current = existing.get(key);

          if (current === undefined) {
            toInsert.push(record);
            continue;
          }
          // Reactivation counts as a change: a returning code must not stay inactive.
          const changed =
            current.description !== record.description ||
            current.chapter !== record.chapter ||
            current.heading !== record.heading ||
            current.subHeading !== record.subHeading ||
            !current.isActive;

          if (changed) toUpdate.push({ id: current.id, record });
          else unchangedIds.push(current.id);
        }

        const toDeactivate: string[] = [];
        for (const [key, current] of existing) {
          if (!seenKeys.has(key) && current.isActive) toDeactivate.push(current.id);
        }

        let added = 0;
        for (const part of chunk(toInsert, INSERT_CHUNK)) {
          added += await HsnSacRepository.insertMany(connection, part, meta);
        }
        const updated = await HsnSacRepository.updateMany(connection, toUpdate, meta);
        for (const part of chunk(unchangedIds, UPDATE_CHUNK)) {
          await HsnSacRepository.touchMany(connection, part, meta);
        }
        let deactivated = 0;
        for (const part of chunk(toDeactivate, UPDATE_CHUNK)) {
          deactivated += await HsnSacRepository.deactivateMany(connection, part, now);
        }

        // Reported so an administrator can see that a deactivated code is still in use by a
        // profile. It changes nothing: the row survives precisely so the reference resolves.
        const referenced = await HsnSacRepository.findReferencedIds(connection, toDeactivate);

        return {
          added,
          updated,
          deactivated,
          unchanged: unchangedIds.length,
          referencedDeactivated: referenced.size,
        };
      });

      await GstSyncRunRepository.complete(pool, runId, {
        status: GstSyncStatus.SUCCESS,
        sourceVersion: dataset.sourceVersion,
        sourceChecksum: dataset.checksum,
        downloaded: dataset.records.length,
        added: counts.added,
        updated: counts.updated,
        deactivated: counts.deactivated,
        unchanged: counts.unchanged,
        failed: dataset.rejected.length,
        errorDetails:
          dataset.rejected.length > 0
            ? JSON.stringify(dataset.rejected.slice(0, 50))
            : null,
      });

      const run = await this.getRun(runId);
      await withTransaction((connection) =>
        auditService.record(connection, actor, {
          action: AuditAction.GST_MASTER_SYNCED,
          entityType: 'hsn_sac_master',
          entityId: runId,
          after: {
            source: run.source,
            sourceVersion: run.sourceVersion,
            recordsDownloaded: run.recordsDownloaded,
            recordsAdded: run.recordsAdded,
            recordsUpdated: run.recordsUpdated,
            recordsDeactivated: run.recordsDeactivated,
            recordsUnchanged: run.recordsUnchanged,
            recordsFailed: run.recordsFailed,
            referencedDeactivated: counts.referencedDeactivated,
          },
        }),
      );

      logger.info('GST master synchronization complete', { runId, ...counts });
      return run;
    } catch (error) {
      const message = isAppError(error)
        ? error.message
        : 'The synchronization failed unexpectedly';
      await GstSyncRunRepository.complete(pool, runId, {
        status: GstSyncStatus.FAILED,
        sourceVersion: null,
        sourceChecksum: null,
        downloaded: 0,
        added: 0,
        updated: 0,
        deactivated: 0,
        unchanged: 0,
        failed: 0,
        errorDetails: message,
      });
      await withTransaction((connection) =>
        auditService.record(connection, actor, {
          action: AuditAction.GST_MASTER_SYNC_FAILED,
          entityType: 'hsn_sac_master',
          entityId: runId,
          after: { source: GST_MASTER_SOURCE.NAME, error: message },
        }),
      );
      logger.error('GST master synchronization failed', { runId }, error);
      throw error;
    }
  }
}

export const gstSyncService = new GstSyncService();
