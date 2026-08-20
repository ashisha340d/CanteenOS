import type {
  AreaCleaningStatusDto,
  CleaningComplianceDto,
  CleaningComplianceQuery,
  CleaningComplianceRowDto,
  CleaningDashboardDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { selectRows, type Db } from '../db/types';
import {
  mapAreaCleaningStatus,
  mapCleaningEvent,
  mapCleaningTask,
  mapComplianceRow,
  rateOf,
} from '../models/mappers';
import type { CleaningComplianceRow, CleaningMissedAssetRow } from '../models/rows';
import { CleanableAssetRepository } from '../repositories/CleanableAssetRepository';
import { CleaningEventRepository } from '../repositories/CleaningEventRepository';
import { CleaningMasterRepository } from '../repositories/CleaningMasterRepository';
import { CleaningTaskRepository } from '../repositories/CleaningTaskRepository';
import { CleaningWorkforceRepository } from '../repositories/CleaningWorkforceRepository';
import { cleaningTaskService } from './CleaningTaskService';

/**
 * The two read-only surfaces: the dashboard and the compliance report.
 *
 * One definition of compliance runs through both, and it is stated once here so the number on
 * the dashboard and the number in the report can never disagree:
 *
 *   **fell due** — the task had a `due_at` inside the window and that moment has passed.
 *   **on time**  — it was completed at or before its `due_at`.
 *   **late**     — completed, but after `due_at`.
 *   **missed**   — fell due and was never completed.
 *
 * `complianceRate` is completed ÷ fell-due; `onTimeRate` is on-time ÷ fell-due. Both read 100
 * when nothing fell due, because nothing was missed — a fresh install must not open on a red
 * dashboard telling a manager they have failed at something they have not started.
 */

const DASHBOARD_WINDOW_DAYS = 7;
const DASHBOARD_LIST_LIMIT = 12;
const DEFAULT_REPORT_DAYS = 30;

/**
 * The grouped compliance query, once.
 *
 * `groupKey` / `groupLabel` / `joins` are composed from a closed set of dimension definitions
 * below — never from caller text — so the four cuts of the report are the same SQL asked four
 * different questions, and their totals are guaranteed to agree.
 */
interface Dimension {
  key: string;
  label: string;
  joins: string;
}

const DIMENSIONS: Readonly<Record<'area' | 'assetType' | 'shift' | 'person', Dimension>> = {
  area: {
    key: "COALESCE(ar.id, 'none')",
    label: "COALESCE(ar.name, 'No area')",
    joins: 'LEFT JOIN equipment_areas ar ON ar.id = ct.area_id',
  },
  assetType: {
    key: "COALESCE(at.id, 'none')",
    label: "COALESCE(at.name, 'No type')",
    joins: `JOIN cleanable_assets a2 ON a2.id = ct.cleanable_asset_id
            LEFT JOIN cleanable_asset_types at ON at.id = a2.asset_type_id`,
  },
  shift: {
    key: "COALESCE(sh.id, 'none')",
    label: "COALESCE(sh.name, 'No shift')",
    joins: 'LEFT JOIN shifts sh ON sh.id = ct.shift_id',
  },
  person: {
    key: "COALESCE(u.id, 'none')",
    label: "COALESCE(u.name, 'Unassigned')",
    joins: 'LEFT JOIN users u ON u.id = COALESCE(ct.completed_by, ct.assigned_to)',
  },
};

export class CleaningComplianceService {
  /** The portal's landing screen and the module's one-glance health check. */
  async dashboard(userId: string): Promise<CleaningDashboardDto> {
    const pool = getPool();
    const viewer = await cleaningTaskService.viewerFor(userId);

    const [
      counts,
      window,
      overdue,
      awaiting,
      recentReports,
      byAreaRows,
      responsibles,
      openCorrective,
      overdueCorrective,
      reportsToday,
      criticalUncleaned,
      assetsWithoutRules,
      expiredChemicals,
    ] = await Promise.all([
      CleaningTaskRepository.counts(pool),
      CleaningTaskRepository.complianceWindow(pool, DASHBOARD_WINDOW_DAYS),
      CleaningTaskRepository.list(pool, {
        overdueOnly: true,
        limit: DASHBOARD_LIST_LIMIT,
        offset: 0,
      }),
      CleaningTaskRepository.list(pool, {
        awaitingVerification: true,
        limit: DASHBOARD_LIST_LIMIT,
        offset: 0,
      }),
      CleaningEventRepository.list(pool, { limit: DASHBOARD_LIST_LIMIT, offset: 0 }),
      CleaningTaskRepository.byArea(pool, DASHBOARD_WINDOW_DAYS),
      CleaningWorkforceRepository.listAllResponsibles(pool),
      CleaningTaskRepository.countCorrectiveActions(pool, { openOnly: true }),
      CleaningTaskRepository.countCorrectiveActions(pool, { overdueOnly: true }),
      CleaningEventRepository.countReportsToday(pool),
      CleanableAssetRepository.countCriticalUncleaned(pool),
      CleanableAssetRepository.countWithoutRules(pool),
      CleaningMasterRepository.countExpiredChemicals(pool),
    ]);

    const byArea: AreaCleaningStatusDto[] = byAreaRows.map((row) =>
      mapAreaCleaningStatus(
        row,
        responsibles
          .filter((responsible) => responsible.area_id === row.area_id)
          .map((responsible) => responsible.user_name ?? '')
          .filter((name) => name !== ''),
      ),
    );

    return {
      counts: {
        openTasks: Number(counts?.open_tasks ?? 0),
        overdueTasks: Number(counts?.overdue_tasks ?? 0),
        unassignedTasks: Number(counts?.unassigned_tasks ?? 0),
        dueToday: Number(counts?.due_today ?? 0),
        inProgress: Number(counts?.in_progress ?? 0),
        awaitingVerification: Number(counts?.awaiting_verification ?? 0),
        failedVerifications: Number(counts?.failed_verifications ?? 0),
        recleanRequired: Number(counts?.reclean_required ?? 0),
        openCorrectiveActions: openCorrective,
        overdueCorrectiveActions: overdueCorrective,
        reportsToday,
        criticalAssetsUncleaned: criticalUncleaned,
        assetsWithoutRules,
        expiredChemicals,
      },
      complianceRate: rateOf(window.onTime, window.fellDue),
      verificationPassRate: rateOf(window.verified, window.verified + window.failed),
      overdue: overdue.map((row) => mapCleaningTask(row, viewer)),
      awaitingVerification: awaiting.map((row) => mapCleaningTask(row, viewer)),
      recentReports: recentReports.map(mapCleaningEvent),
      byArea,
    };
  }

  /** The hygiene record, cut four ways, plus the assets that were simply never done. */
  async compliance(query: CleaningComplianceQuery): Promise<CleaningComplianceDto> {
    const pool = getPool();
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const from =
      query.from ??
      new Date(Date.now() - DEFAULT_REPORT_DAYS * 86_400_000).toISOString().slice(0, 10);

    const scope = { from, to, ...query };
    const [totals, byArea, byAssetType, byShift, byPerson, missedAssets] = await Promise.all([
      this.grouped(pool, null, scope),
      this.grouped(pool, 'area', scope),
      this.grouped(pool, 'assetType', scope),
      this.grouped(pool, 'shift', scope),
      this.grouped(pool, 'person', scope),
      this.missedAssets(pool, scope),
    ]);

    return {
      from,
      to,
      totals: totals[0] ?? emptyRow(),
      byArea,
      byAssetType,
      byShift,
      byPerson,
      missedAssets,
    };
  }

  /**
   * One grouped pass over the window. `dimension` is a key of the closed map above; passing
   * null groups everything into a single "All" row, which is how the totals stay consistent
   * with the cuts — same predicate, same arithmetic, one fewer GROUP BY column.
   */
  private async grouped(
    db: Db,
    dimension: keyof typeof DIMENSIONS | null,
    scope: CleaningComplianceQuery & { from: string; to: string },
  ): Promise<CleaningComplianceRowDto[]> {
    const spec = dimension === null ? null : DIMENSIONS[dimension];
    const conditions = ['ct.due_at IS NOT NULL', 'DATE(ct.due_at) BETWEEN ? AND ?'];
    const params: unknown[] = [scope.from, scope.to];

    if (scope.areaId !== undefined) {
      conditions.push('ct.area_id = ?');
      params.push(scope.areaId);
    }
    if (scope.shiftId !== undefined) {
      conditions.push('ct.shift_id = ?');
      params.push(scope.shiftId);
    }
    if (scope.assetTypeId !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM cleanable_assets af WHERE af.id = ct.cleanable_asset_id AND af.asset_type_id = ?)',
      );
      params.push(scope.assetTypeId);
    }

    const rows = await selectRows<CleaningComplianceRow>(
      db,
      `SELECT ${spec === null ? "'all'" : spec.key} AS group_key,
              ${spec === null ? "'All cleaning'" : spec.label} AS group_label,
              COUNT(*) AS due_count,
              SUM(ct.completed_at IS NOT NULL) AS completed_count,
              SUM(ct.completed_at IS NOT NULL AND ct.completed_at <= ct.due_at) AS on_time_count,
              SUM(ct.completed_at IS NOT NULL AND ct.completed_at > ct.due_at) AS late_count,
              SUM(ct.completed_at IS NULL AND ct.status NOT IN ('CANCELLED')) AS missed_count,
              (SELECT COUNT(*) FROM cleaning_verifications v
                WHERE v.task_id = ct.id AND v.outcome = 'PASS') AS verified_count,
              (SELECT COUNT(*) FROM cleaning_verifications v
                WHERE v.task_id = ct.id AND v.outcome = 'FAIL') AS failed_count
         FROM cleaning_tasks ct
         ${spec?.joins ?? ''}
        WHERE ${conditions.join(' AND ')}
        ${spec === null ? '' : 'GROUP BY group_key, group_label'}
        ORDER BY due_count DESC`,
      params,
    );
    return rows.map(mapComplianceRow);
  }

  /** The auditor's first question: what fell due in this window and was never cleaned. */
  private async missedAssets(
    db: Db,
    scope: CleaningComplianceQuery & { from: string; to: string },
  ): Promise<CleaningComplianceDto['missedAssets']> {
    const conditions = [
      'ct.due_at IS NOT NULL',
      'DATE(ct.due_at) BETWEEN ? AND ?',
      'ct.completed_at IS NULL',
      "ct.status <> 'CANCELLED'",
    ];
    const params: unknown[] = [scope.from, scope.to];
    if (scope.areaId !== undefined) {
      conditions.push('ct.area_id = ?');
      params.push(scope.areaId);
    }
    if (scope.assetTypeId !== undefined) {
      conditions.push('a.asset_type_id = ?');
      params.push(scope.assetTypeId);
    }

    const rows = await selectRows<CleaningMissedAssetRow>(
      db,
      `SELECT a.id AS cleanable_asset_id, a.code, a.name,
              COALESCE(ar.name, '') AS area_name,
              a.risk_level, a.food_contact,
              COUNT(*) AS missed,
              (SELECT MAX(done.completed_at) FROM cleaning_tasks done
                WHERE done.cleanable_asset_id = a.id AND done.completed_at IS NOT NULL) AS last_cleaned_at
         FROM cleaning_tasks ct
         JOIN cleanable_assets a ON a.id = ct.cleanable_asset_id
         LEFT JOIN equipment_areas ar ON ar.id = ct.area_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY a.id, a.code, a.name, ar.name, a.risk_level, a.food_contact
        ORDER BY a.risk_level = 'CRITICAL' DESC, missed DESC
        LIMIT 100`,
      params,
    );

    return rows.map((row) => ({
      cleanableAssetId: row.cleanable_asset_id,
      code: row.code,
      name: row.name,
      areaName: row.area_name,
      riskLevel: row.risk_level,
      foodContact: row.food_contact,
      missed: Number(row.missed),
      lastCleanedAt:
        row.last_cleaned_at === null
          ? null
          : `${row.last_cleaned_at.replace(' ', 'T')}Z`.replace('ZZ', 'Z'),
    }));
  }
}

function emptyRow(): CleaningComplianceRowDto {
  return {
    key: 'all',
    label: 'All cleaning',
    due: 0,
    completed: 0,
    onTime: 0,
    late: 0,
    missed: 0,
    verified: 0,
    failed: 0,
    complianceRate: 100,
    onTimeRate: 100,
    passRate: 100,
  };
}

export const cleaningComplianceService = new CleaningComplianceService();
