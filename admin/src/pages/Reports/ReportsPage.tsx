import { useMemo, useState } from 'react';
import { ReportKind, type ReportQuery } from '@menuboard/shared';
import type {
  ActivitySummaryRow,
  OrderReportRow,
  OrdersByBoardRow,
  OrdersByDateRow,
  OrdersByUserRow,
} from '@menuboard/shared';
import type { BillingExportDto } from '@menuboard/shared';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { TextField } from '@/components/form/fields';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { StatusChip } from '../../components/StatusChip';
import { PageHeader } from '@/components/ui/PageHeader';
import { useReport } from '../../hooks/useAdmin';

const TABS: { kind: ReportKind; label: string }[] = [
  { kind: ReportKind.ORDERS_BY_BOARD, label: 'Orders by Board' },
  { kind: ReportKind.ORDERS_BY_DATE, label: 'Orders by Date' },
  { kind: ReportKind.ORDERS_BY_USER, label: 'Orders by User' },
  { kind: ReportKind.COMPLETED_ORDERS, label: 'Completed Orders' },
  { kind: ReportKind.PENDING_ORDERS, label: 'Pending Orders' },
  { kind: ReportKind.ACTIVITY_SUMMARY, label: 'Activity Summary' },
  { kind: ReportKind.BILLING_EXPORT_HISTORY, label: 'Billing Export History' },
];

/** Every report is date-bounded, so "empty" nearly always means "wrong period". */
const REPORT_EMPTY = {
  emptyTitle: 'No data in this period',
  emptyMessage: 'No records fall inside the selected dates. Try widening the range.',
} as const;

function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const orderReportColumns: DataTableColumn<OrderReportRow>[] = [
  { field: 'orderNumber', headerName: 'Order #', width: 170 },
  { field: 'boardName', headerName: 'Board', width: 160 },
  { field: 'venue', headerName: 'Venue', width: 180 },
  { field: 'pax', headerName: 'Pax', width: 80, align: 'right' },
  { field: 'requiredDate', headerName: 'Date', width: 120 },
  { field: 'requiredTime', headerName: 'Time', width: 90 },
  {
    field: 'status',
    headerName: 'Status',
    width: 130,
    renderCell: (r) => <StatusChip status={r.status} />,
  },
  { field: 'createdByName', headerName: 'Created by', width: 150 },
  { field: 'itemCount', headerName: 'Items', width: 80, align: 'right' },
  { field: 'acknowledgedCount', headerName: 'Acknowledged', width: 120, align: 'right' },
];

export function ReportsPage(): JSX.Element {
  const [kind, setKind] = useState<ReportKind>(ReportKind.ORDERS_BY_BOARD);
  const [dateFrom, setDateFrom] = useState(todayIso(-30));
  const [dateTo, setDateTo] = useState(todayIso());
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const query: ReportQuery = useMemo(
    () => ({ dateFrom, dateTo, page, pageSize }),
    [dateFrom, dateTo, page],
  );
  const { data, isLoading } = useReport<unknown>(kind, query, true);

  const paginated =
    kind === ReportKind.COMPLETED_ORDERS ||
    kind === ReportKind.PENDING_ORDERS ||
    kind === ReportKind.BILLING_EXPORT_HISTORY;

  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Reports"
        subtitle="Figures across orders, billing and consumption for a date range you choose."
      />

      <Tabs
        value={kind}
        onValueChange={(next) => {
          setKind(next as ReportKind);
          setPage(1);
        }}
        className="mb-4"
      >
        {/* Seven tabs do not fit a phone; scrolling them beats wrapping into three rows. */}
        <ScrollArea className="w-full">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.kind} value={t.kind}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </Tabs>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:items-end">
        <TextField
          label="From"
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          className="sm:w-44"
        />
        <TextField
          label="To"
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          className="sm:w-44"
        />
      </div>

      {kind === ReportKind.ORDERS_BY_BOARD && (
        <DataTable
          gridId="report-orders-by-board"
          getRowId={(r: OrdersByBoardRow) => r.boardId}
          loading={isLoading}
          {...REPORT_EMPTY}
          rows={(data?.rows as OrdersByBoardRow[] | undefined) ?? []}
          columns={[
            { field: 'boardName', headerName: 'Board', width: 200 },
            { field: 'totalOrders', headerName: 'Total', width: 100, align: 'right' },
            { field: 'pendingOrders', headerName: 'Pending', width: 100, align: 'right' },
            { field: 'acknowledgedOrders', headerName: 'Acknowledged', width: 130, align: 'right' },
            { field: 'inProgressOrders', headerName: 'In progress', width: 120, align: 'right' },
            { field: 'completedOrders', headerName: 'Completed', width: 110, align: 'right' },
            { field: 'cancelledOrders', headerName: 'Cancelled', width: 110, align: 'right' },
            { field: 'totalPax', headerName: 'Total pax', width: 100, align: 'right' },
          ]}
        />
      )}

      {kind === ReportKind.ORDERS_BY_DATE && (
        <DataTable
          gridId="report-orders-by-date"
          getRowId={(r: OrdersByDateRow) => r.requiredDate}
          loading={isLoading}
          {...REPORT_EMPTY}
          rows={(data?.rows as OrdersByDateRow[] | undefined) ?? []}
          columns={[
            { field: 'requiredDate', headerName: 'Date', width: 140 },
            { field: 'totalOrders', headerName: 'Total', width: 100, align: 'right' },
            { field: 'completedOrders', headerName: 'Completed', width: 110, align: 'right' },
            { field: 'openOrders', headerName: 'Open', width: 100, align: 'right' },
            { field: 'totalPax', headerName: 'Total pax', width: 100, align: 'right' },
          ]}
        />
      )}

      {kind === ReportKind.ORDERS_BY_USER && (
        <DataTable
          gridId="report-orders-by-user"
          getRowId={(r: OrdersByUserRow) => r.userId}
          loading={isLoading}
          {...REPORT_EMPTY}
          rows={(data?.rows as OrdersByUserRow[] | undefined) ?? []}
          columns={[
            { field: 'userName', headerName: 'User', width: 200 },
            { field: 'totalOrders', headerName: 'Total', width: 100, align: 'right' },
            { field: 'completedOrders', headerName: 'Completed', width: 110, align: 'right' },
            { field: 'openOrders', headerName: 'Open', width: 100, align: 'right' },
            { field: 'totalPax', headerName: 'Total pax', width: 100, align: 'right' },
          ]}
        />
      )}

      {(kind === ReportKind.COMPLETED_ORDERS || kind === ReportKind.PENDING_ORDERS) && (
        <DataTable
          gridId={`report-${kind.toLowerCase()}`}
          getRowId={(r: OrderReportRow) => r.orderId}
          loading={isLoading}
          {...REPORT_EMPTY}
          rows={(data?.rows as OrderReportRow[] | undefined) ?? []}
          columns={orderReportColumns}
        />
      )}

      {kind === ReportKind.ACTIVITY_SUMMARY && (
        <DataTable
          gridId="report-activity-summary"
          getRowId={(r: ActivitySummaryRow) => r.activityTypeId ?? 'none'}
          loading={isLoading}
          {...REPORT_EMPTY}
          rows={(data?.rows as ActivitySummaryRow[] | undefined) ?? []}
          columns={[
            { field: 'activityName', headerName: 'Activity', width: 200 },
            { field: 'totalOrders', headerName: 'Total orders', width: 130, align: 'right' },
            { field: 'totalPax', headerName: 'Total pax', width: 110, align: 'right' },
            { field: 'completedOrders', headerName: 'Completed', width: 110, align: 'right' },
          ]}
        />
      )}

      {kind === ReportKind.BILLING_EXPORT_HISTORY && (
        <DataTable
          gridId="report-billing-history"
          getRowId={(r: BillingExportDto) => r.id}
          loading={isLoading}
          {...REPORT_EMPTY}
          rows={(data?.rows as BillingExportDto[] | undefined) ?? []}
          columns={[
            { field: 'billingVersion', headerName: 'Version', width: 90, align: 'right' },
            { field: 'periodFrom', headerName: 'From', width: 110 },
            { field: 'periodTo', headerName: 'To', width: 110 },
            {
              field: 'status',
              headerName: 'Status',
              width: 120,
              renderCell: (r) => <StatusChip status={r.status} />,
            },
            { field: 'totalOrders', headerName: 'Orders', width: 90, align: 'right' },
            { field: 'totalPax', headerName: 'Pax', width: 90, align: 'right' },
            {
              field: 'generatedByName',
              headerName: 'Generated by',
              width: 150,
              valueGetter: (r) => r.generatedByName ?? '—',
            },
            {
              field: 'generatedAt',
              headerName: 'Generated at',
              width: 170,
              valueGetter: (r) => new Date(r.generatedAt).toLocaleString(),
            },
            { field: 'checksum', headerName: 'Checksum', width: 200 },
          ]}
        />
      )}

      {paginated && data?.page && (
        <div className="mt-3 flex items-center justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-muted-foreground text-sm tabular-nums">
            {page} / {Math.max(1, data.page.totalPages)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= Math.max(1, data.page.totalPages)}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}
