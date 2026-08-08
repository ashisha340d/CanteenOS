import type {
  ActivitySummaryRow,
  DashboardSummary,
  OrderReportRow,
  OrdersByBoardRow,
  OrdersByDateRow,
  OrdersByUserRow,
} from '@menuboard/shared';
import { selectOne, selectRows, type Db, type RowDataPacket } from '../db/types';
import type { CountRow } from '../models/rows';
import { fromDbDate, fromDbTime, todayIsoDate } from '../utils/time';

/**
 * Read-only aggregation queries backing exactly the seven specified reports plus the Admin
 * dashboard. Admin Portal only — no report endpoint is reachable from an Android token.
 *
 * Nothing beyond these seven is implemented; broader analytics is explicitly out of scope.
 */

export interface ReportFilter {
  dateFrom: string;
  dateTo: string;
  boardId?: string;
  userId?: string;
  activityTypeId?: string;
  limit: number;
  offset: number;
}

interface ByBoardRaw extends RowDataPacket {
  board_id: string;
  board_name: string;
  total_orders: number;
  pending_orders: number;
  acknowledged_orders: number;
  in_progress_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  total_pax: string | number;
}

interface ByDateRaw extends RowDataPacket {
  required_date: string;
  total_orders: number;
  completed_orders: number;
  open_orders: number;
  total_pax: string | number;
}

interface ByUserRaw extends RowDataPacket {
  user_id: string;
  user_name: string;
  total_orders: number;
  completed_orders: number;
  open_orders: number;
  total_pax: string | number;
}

interface OrderRowRaw extends RowDataPacket {
  order_id: string;
  order_number: string;
  board_name: string;
  activity_name: string | null;
  venue: string;
  pax: number;
  required_date: string;
  required_time: string;
  status: OrderReportRow['status'];
  created_by_name: string;
  item_count: number;
  acknowledged_count: number;
}

interface ActivityRaw extends RowDataPacket {
  activity_type_id: string | null;
  activity_name: string;
  total_orders: number;
  total_pax: string | number;
  completed_orders: number;
}

/** Shared WHERE fragment so every report applies the same filters identically. */
function baseFilter(filter: ReportFilter): { clause: string; params: unknown[] } {
  const conditions = ['o.deleted_at IS NULL', 'o.required_date >= ?', 'o.required_date <= ?'];
  const params: unknown[] = [filter.dateFrom, filter.dateTo];

  if (filter.boardId !== undefined) {
    conditions.push('o.board_id = ?');
    params.push(filter.boardId);
  }
  if (filter.userId !== undefined) {
    conditions.push('o.created_by = ?');
    params.push(filter.userId);
  }
  if (filter.activityTypeId !== undefined) {
    conditions.push('o.activity_type_id = ?');
    params.push(filter.activityTypeId);
  }

  return { clause: conditions.join(' AND '), params };
}

const ORDER_DETAIL_SELECT = `
  SELECT o.id AS order_id, o.order_number, o.venue, o.pax, o.required_date, o.required_time,
         o.status, b.name AS board_name,
         COALESCE(at.name, o.custom_activity) AS activity_name,
         cu.name AS created_by_name,
         (SELECT COUNT(*) FROM order_items oi
           WHERE oi.order_id = o.id AND oi.deleted_at IS NULL) AS item_count,
         (SELECT COUNT(*) FROM acknowledgements a
           WHERE a.order_id = o.id AND a.deleted_at IS NULL) AS acknowledged_count
    FROM orders o
   INNER JOIN boards b ON b.id = o.board_id
    LEFT JOIN activity_types at ON at.id = o.activity_type_id
   INNER JOIN users cu ON cu.id = o.created_by`;

function mapOrderRow(row: OrderRowRaw): OrderReportRow {
  return {
    orderId: row.order_id,
    orderNumber: row.order_number,
    boardName: row.board_name,
    activityName: row.activity_name,
    venue: row.venue,
    pax: Number(row.pax),
    requiredDate: fromDbDate(row.required_date) as string,
    requiredTime: fromDbTime(row.required_time) as string,
    status: row.status,
    createdByName: row.created_by_name,
    itemCount: Number(row.item_count),
    acknowledgedCount: Number(row.acknowledged_count),
  };
}

export class ReportRepository {
  async ordersByBoard(db: Db, filter: ReportFilter): Promise<OrdersByBoardRow[]> {
    const { clause, params } = baseFilter(filter);
    const rows = await selectRows<ByBoardRaw>(
      db,
      `SELECT o.board_id, b.name AS board_name,
              COUNT(*) AS total_orders,
              SUM(o.status = 'PENDING')          AS pending_orders,
              SUM(o.status = 'ACKNOWLEDGED')     AS acknowledged_orders,
              SUM(o.status = 'WORK_IN_PROGRESS') AS in_progress_orders,
              SUM(o.status IN ('DELIVERED','DONE'))        AS completed_orders,
              SUM(o.status = 'CANCELLED')        AS cancelled_orders,
              COALESCE(SUM(o.pax), 0)            AS total_pax
         FROM orders o
        INNER JOIN boards b ON b.id = o.board_id
        WHERE ${clause}
        GROUP BY o.board_id, b.name
        ORDER BY total_orders DESC, b.name ASC`,
      params,
    );

    return rows.map((row) => ({
      boardId: row.board_id,
      boardName: row.board_name,
      totalOrders: Number(row.total_orders),
      pendingOrders: Number(row.pending_orders),
      acknowledgedOrders: Number(row.acknowledged_orders),
      inProgressOrders: Number(row.in_progress_orders),
      completedOrders: Number(row.completed_orders),
      cancelledOrders: Number(row.cancelled_orders),
      totalPax: Number(row.total_pax),
    }));
  }

  async ordersByDate(db: Db, filter: ReportFilter): Promise<OrdersByDateRow[]> {
    const { clause, params } = baseFilter(filter);
    const rows = await selectRows<ByDateRaw>(
      db,
      `SELECT o.required_date,
              COUNT(*) AS total_orders,
              SUM(o.status IN ('DELIVERED','DONE')) AS completed_orders,
              SUM(o.status IN ('PENDING','ACKNOWLEDGED','WORK_IN_PROGRESS')) AS open_orders,
              COALESCE(SUM(o.pax), 0) AS total_pax
         FROM orders o
        WHERE ${clause}
        GROUP BY o.required_date
        ORDER BY o.required_date ASC`,
      params,
    );

    return rows.map((row) => ({
      requiredDate: fromDbDate(row.required_date) as string,
      totalOrders: Number(row.total_orders),
      completedOrders: Number(row.completed_orders),
      openOrders: Number(row.open_orders),
      totalPax: Number(row.total_pax),
    }));
  }

  async ordersByUser(db: Db, filter: ReportFilter): Promise<OrdersByUserRow[]> {
    const { clause, params } = baseFilter(filter);
    const rows = await selectRows<ByUserRaw>(
      db,
      `SELECT o.created_by AS user_id, u.name AS user_name,
              COUNT(*) AS total_orders,
              SUM(o.status IN ('DELIVERED','DONE')) AS completed_orders,
              SUM(o.status IN ('PENDING','ACKNOWLEDGED','WORK_IN_PROGRESS')) AS open_orders,
              COALESCE(SUM(o.pax), 0) AS total_pax
         FROM orders o
        INNER JOIN users u ON u.id = o.created_by
        WHERE ${clause}
        GROUP BY o.created_by, u.name
        ORDER BY total_orders DESC, u.name ASC`,
      params,
    );

    return rows.map((row) => ({
      userId: row.user_id,
      userName: row.user_name,
      totalOrders: Number(row.total_orders),
      completedOrders: Number(row.completed_orders),
      openOrders: Number(row.open_orders),
      totalPax: Number(row.total_pax),
    }));
  }

  async completedOrders(
    db: Db,
    filter: ReportFilter,
  ): Promise<{ rows: OrderReportRow[]; total: number }> {
    return this.ordersByStatus(db, filter, ["o.status IN ('DELIVERED','DONE')"]);
  }

  async pendingOrders(
    db: Db,
    filter: ReportFilter,
  ): Promise<{ rows: OrderReportRow[]; total: number }> {
    return this.ordersByStatus(db, filter, [
      "o.status IN ('PENDING','ACKNOWLEDGED','WORK_IN_PROGRESS')",
    ]);
  }

  private async ordersByStatus(
    db: Db,
    filter: ReportFilter,
    extraConditions: string[],
  ): Promise<{ rows: OrderReportRow[]; total: number }> {
    const { clause, params } = baseFilter(filter);
    const where = [clause, ...extraConditions].join(' AND ');

    const rows = await selectRows<OrderRowRaw>(
      db,
      `${ORDER_DETAIL_SELECT}
        WHERE ${where}
        ORDER BY o.required_date DESC, o.required_time DESC
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );

    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM orders o WHERE ${where}`,
      params,
    );

    return { rows: rows.map(mapOrderRow), total: countRow === null ? 0 : Number(countRow.total) };
  }

  async activitySummary(db: Db, filter: ReportFilter): Promise<ActivitySummaryRow[]> {
    const { clause, params } = baseFilter(filter);
    const rows = await selectRows<ActivityRaw>(
      db,
      `SELECT o.activity_type_id,
              COALESCE(at.name, o.custom_activity, 'Unspecified') AS activity_name,
              COUNT(*) AS total_orders,
              COALESCE(SUM(o.pax), 0) AS total_pax,
              SUM(o.status IN ('DELIVERED','DONE')) AS completed_orders
         FROM orders o
         LEFT JOIN activity_types at ON at.id = o.activity_type_id
        WHERE ${clause}
        GROUP BY o.activity_type_id, activity_name
        ORDER BY total_orders DESC, activity_name ASC`,
      params,
    );

    return rows.map((row) => ({
      activityTypeId: row.activity_type_id,
      activityName: row.activity_name,
      totalOrders: Number(row.total_orders),
      totalPax: Number(row.total_pax),
      completedOrders: Number(row.completed_orders),
    }));
  }

  async dashboard(db: Db): Promise<DashboardSummary> {
    const today = todayIsoDate();

    const boards = await selectOne<CountRow & { active: number }>(
      db,
      `SELECT COUNT(*) AS total, SUM(status = 'ACTIVE') AS active
         FROM boards WHERE deleted_at IS NULL`,
    );

    const orders = await selectOne<
      RowDataPacket & { today: number; open: number; completed_today: number; overdue: number }
    >(
      db,
      `SELECT
         SUM(required_date = ?) AS today,
         SUM(status IN ('PENDING','ACKNOWLEDGED','WORK_IN_PROGRESS')) AS open,
         SUM(status IN ('DELIVERED','DONE') AND required_date = ?) AS completed_today,
         SUM(status IN ('PENDING','ACKNOWLEDGED','WORK_IN_PROGRESS') AND required_date < ?) AS overdue
        FROM orders WHERE deleted_at IS NULL`,
      [today, today, today],
    );

    const users = await selectOne<CountRow & { active: number }>(
      db,
      `SELECT COUNT(*) AS total, SUM(status = 'ACTIVE') AS active
         FROM users WHERE deleted_at IS NULL`,
    );

    const billing = await selectOne<CountRow & { last_generated_at: string | null }>(
      db,
      `SELECT COUNT(*) AS total, MAX(generated_at) AS last_generated_at
         FROM billing_exports
        WHERE generated_at >= DATE_FORMAT(UTC_DATE(), '%Y-%m-01')`,
    );

    return {
      boards: {
        total: Number(boards?.total ?? 0),
        active: Number(boards?.active ?? 0),
      },
      orders: {
        today: Number(orders?.today ?? 0),
        open: Number(orders?.open ?? 0),
        completedToday: Number(orders?.completed_today ?? 0),
        overdue: Number(orders?.overdue ?? 0),
      },
      users: {
        total: Number(users?.total ?? 0),
        active: Number(users?.active ?? 0),
      },
      billing: {
        exportsThisMonth: Number(billing?.total ?? 0),
        lastGeneratedAt: billing?.last_generated_at ?? null,
      },
    };
  }
}

export const reportRepository = new ReportRepository();
