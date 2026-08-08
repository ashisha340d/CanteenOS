import { ReportKind, type DashboardSummary, type ReportQuery } from '@menuboard/shared';
import { getPool } from '../db/pool';
import { reportRepository, type ReportFilter } from '../repositories/ReportRepository';
import { billingService } from './BillingService';
import { buildPage, resolvePaging } from '../utils/http';
import { ValidationError } from '../utils/errors';

/**
 * The seven specified reports, and nothing else. Admin Portal only — REPORT_READ is in
 * ANDROID_FORBIDDEN_CAPABILITIES.
 *
 * Any request for analytics beyond these is out of scope (docs/SCOPE.md).
 */
export class ReportService {
  async dashboard(): Promise<DashboardSummary> {
    return reportRepository.dashboard(getPool());
  }

  async run(kind: ReportKind, query: ReportQuery) {
    const filter = this.toFilter(query);
    const pool = getPool();

    switch (kind) {
      case ReportKind.ORDERS_BY_BOARD:
        return { kind, rows: await reportRepository.ordersByBoard(pool, filter) };

      case ReportKind.ORDERS_BY_DATE:
        return { kind, rows: await reportRepository.ordersByDate(pool, filter) };

      case ReportKind.ORDERS_BY_USER:
        return { kind, rows: await reportRepository.ordersByUser(pool, filter) };

      case ReportKind.COMPLETED_ORDERS: {
        const { rows, total } = await reportRepository.completedOrders(pool, filter);
        return { kind, rows, page: this.pageMeta(query, total) };
      }

      case ReportKind.PENDING_ORDERS: {
        const { rows, total } = await reportRepository.pendingOrders(pool, filter);
        return { kind, rows, page: this.pageMeta(query, total) };
      }

      case ReportKind.ACTIVITY_SUMMARY:
        return { kind, rows: await reportRepository.activitySummary(pool, filter) };

      case ReportKind.BILLING_EXPORT_HISTORY: {
        const page = await billingService.list({
          ...(query.boardId !== undefined ? { boardId: query.boardId } : {}),
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          ...(query.page !== undefined ? { page: query.page } : {}),
          ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        });
        return { kind, rows: page.items, page };
      }

      default:
        // Unreachable while ReportKind stays closed; kept so adding a member is a compile error
        // rather than a silent empty report.
        throw new ValidationError(`Unknown report: ${String(kind)}`);
    }
  }

  private toFilter(query: ReportQuery): ReportFilter {
    if (query.dateFrom > query.dateTo) {
      throw new ValidationError('The reporting period is inverted', [
        { path: 'dateTo', message: 'The end date must not be before the start date' },
      ]);
    }

    const { pageSize, offset } = resolvePaging(query);
    return {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      ...(query.boardId !== undefined ? { boardId: query.boardId } : {}),
      ...(query.userId !== undefined ? { userId: query.userId } : {}),
      ...(query.activityTypeId !== undefined ? { activityTypeId: query.activityTypeId } : {}),
      limit: pageSize,
      offset,
    };
  }

  private pageMeta(query: ReportQuery, total: number) {
    const { page, pageSize } = resolvePaging(query);
    return buildPage([], total, page, pageSize);
  }
}

export const reportService = new ReportService();
