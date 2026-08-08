import type { OrderStatus } from '../enums';
import type { IsoDate, Uuid } from './common';

/**
 * Exactly the seven reports named in the specification. No additional analytics.
 * Admin Portal only.
 */
export const ReportKind = {
  ORDERS_BY_BOARD: 'ORDERS_BY_BOARD',
  ORDERS_BY_DATE: 'ORDERS_BY_DATE',
  ORDERS_BY_USER: 'ORDERS_BY_USER',
  COMPLETED_ORDERS: 'COMPLETED_ORDERS',
  PENDING_ORDERS: 'PENDING_ORDERS',
  ACTIVITY_SUMMARY: 'ACTIVITY_SUMMARY',
  BILLING_EXPORT_HISTORY: 'BILLING_EXPORT_HISTORY',
} as const;
export type ReportKind = (typeof ReportKind)[keyof typeof ReportKind];

export interface ReportQuery {
  dateFrom: IsoDate;
  dateTo: IsoDate;
  boardId?: Uuid;
  userId?: Uuid;
  activityTypeId?: Uuid;
  status?: OrderStatus[];
  page?: number;
  pageSize?: number;
}

export interface OrdersByBoardRow {
  boardId: Uuid;
  boardName: string;
  totalOrders: number;
  pendingOrders: number;
  acknowledgedOrders: number;
  inProgressOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalPax: number;
}

export interface OrdersByDateRow {
  requiredDate: IsoDate;
  totalOrders: number;
  completedOrders: number;
  openOrders: number;
  totalPax: number;
}

export interface OrdersByUserRow {
  userId: Uuid;
  userName: string;
  totalOrders: number;
  completedOrders: number;
  openOrders: number;
  totalPax: number;
}

export interface OrderReportRow {
  orderId: Uuid;
  orderNumber: string;
  boardName: string;
  activityName: string | null;
  venue: string;
  pax: number;
  requiredDate: IsoDate;
  requiredTime: string;
  status: OrderStatus;
  createdByName: string;
  itemCount: number;
  acknowledgedCount: number;
}

export interface ActivitySummaryRow {
  activityTypeId: Uuid | null;
  activityName: string;
  totalOrders: number;
  totalPax: number;
  completedOrders: number;
}

/** Dashboard tiles for the Admin Portal landing page. */
export interface DashboardSummary {
  boards: { total: number; active: number };
  orders: {
    today: number;
    open: number;
    completedToday: number;
    overdue: number;
  };
  users: { total: number; active: number };
  billing: { exportsThisMonth: number; lastGeneratedAt: string | null };
}
