import { useMemo, useState } from 'react';
import {
  Capability,
  PayableStatus,
  type AccountsPayableDto,
  type AccountsPayableListQuery,
} from '@menuboard/shared';
import { CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckboxField, SelectField, TextField } from '@/components/form/fields';
import { RowActions } from '@/components/RowActions';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { StatusChip } from '../../components/StatusChip';
import { usePayables, useQueuePayable } from '../../hooks/useVendorAccounting';
import { useAuth } from '../../services/AuthContext';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { Chip, dash, formatDate, money } from '../Stock/stockFormat';
import {
  LoadError,
  NotPermitted,
  OverdueCell,
  SupplierPicker,
  TotalsBar,
} from './vendorAccountingShared';

/**
 * What the business owes, one row per bill.
 *
 * Nothing here is editable — a payable is a consequence of a posted invoice, and the only
 * ways its numbers move are a payment, a memo or a return. The one action is queueing it for
 * payment, which is a decision about intent rather than a change to the money.
 */
export function PayablesTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canRead = hasCapability(Capability.PAYABLE_READ);
  const canSubmit = hasCapability(Capability.PAYABLE_SUBMIT);

  const [supplierId, setSupplierId] = useState('');
  const [supplierLabel, setSupplierLabel] = useState('');
  const [status, setStatus] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [queuedOnly, setQueuedOnly] = useState(false);
  const [dueBefore, setDueBefore] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('payables');

  const query = useMemo<AccountsPayableListQuery>(() => {
    const built: AccountsPayableListQuery = { page, pageSize };
    if (supplierId !== '') built.supplierId = supplierId;
    if (status !== '') built.status = status as PayableStatus;
    if (overdueOnly) built.overdueOnly = true;
    if (queuedOnly) built.queuedOnly = true;
    if (dueBefore !== '') built.dueBefore = dueBefore;
    return built;
  }, [supplierId, status, overdueOnly, queuedOnly, dueBefore, page, pageSize]);

  const { data, isLoading, isError, refetch } = usePayables(query, canRead);
  const queue = useQueuePayable();

  const rows = useMemo(() => data?.items ?? [], [data?.items]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          original: sum.original + row.originalAmount,
          paid: sum.paid + row.paidAmount,
          outstanding: sum.outstanding + row.outstandingAmount,
        }),
        { original: 0, paid: 0, outstanding: 0 },
      ),
    [rows],
  );

  const filterCount =
    (supplierId ? 1 : 0) +
    (status ? 1 : 0) +
    (overdueOnly ? 1 : 0) +
    (queuedOnly ? 1 : 0) +
    (dueBefore ? 1 : 0);

  function resetFilters(): void {
    setSupplierId('');
    setSupplierLabel('');
    setStatus('');
    setOverdueOnly(false);
    setQueuedOnly(false);
    setDueBefore('');
    setPage(1);
  }

  function onQueue(row: AccountsPayableDto): void {
    queue.mutate(row.id, {
      onSuccess: () => notify.success(`${row.documentNumber} queued for payment.`),
      onError: (error) => notify.fromError(error),
    });
  }

  const settled = (row: AccountsPayableDto): boolean =>
    row.status === PayableStatus.PAID || row.status === PayableStatus.CANCELLED;

  const columns: DataTableColumn<AccountsPayableDto>[] = [
    {
      field: 'supplierName',
      headerName: 'Supplier',
      width: 200,
      valueGetter: (row) => dash(row.supplierName),
    },
    { field: 'documentNumber', headerName: 'Our doc no', width: 170 },
    {
      field: 'supplierInvoiceNumber',
      headerName: 'Their bill no',
      width: 150,
      valueGetter: (row) => dash(row.supplierInvoiceNumber),
    },
    {
      field: 'invoiceDate',
      headerName: 'Invoice date',
      width: 130,
      valueGetter: (row) => formatDate(row.invoiceDate),
    },
    {
      field: 'dueDate',
      headerName: 'Due date',
      width: 130,
      valueGetter: (row) => formatDate(row.dueDate),
    },
    {
      field: 'daysOverdue',
      headerName: 'Days overdue',
      width: 130,
      renderCell: (row) => <OverdueCell days={row.daysOverdue} />,
    },
    {
      field: 'originalAmount',
      headerName: 'Original',
      width: 120,
      align: 'right',
      valueGetter: (row) => money(row.originalAmount),
    },
    {
      field: 'paidAmount',
      headerName: 'Paid',
      width: 120,
      align: 'right',
      valueGetter: (row) => money(row.paidAmount),
    },
    {
      field: 'adjustedAmount',
      headerName: 'Adjusted',
      width: 120,
      align: 'right',
      valueGetter: (row) => money(row.adjustedAmount),
    },
    {
      field: 'outstandingAmount',
      headerName: 'Outstanding',
      width: 130,
      align: 'right',
      renderCell: (row) => (
        <span className="font-semibold tabular-nums">{money(row.outstandingAmount)}</span>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
    {
      field: 'isQueued',
      headerName: 'Queued',
      width: 110,
      renderCell: (row) =>
        row.isQueued ? (
          <Chip tone="progress">Queued</Chip>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      field: 'actions',
      headerName: 'Queue',
      width: 90,
      sortable: false,
      align: 'right',
      alwaysVisible: true,
      renderCell: (row) =>
        !canSubmit ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <RowActions>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Queue ${row.documentNumber} for payment`}
                    disabled={row.isQueued || settled(row) || queue.isPending}
                    onClick={() => onQueue(row)}
                  >
                    <CheckIcon />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {row.isQueued
                  ? 'Already in the payment queue'
                  : settled(row)
                    ? 'Nothing left to pay on this bill'
                    : 'Queue for payment'}
              </TooltipContent>
            </Tooltip>
          </RowActions>
        ),
    },
  ];

  if (!canRead) {
    return <NotPermitted what="Accounts payable" capability="the payable read capability" />;
  }

  return (
    <>
      <ListToolbar
        search=""
        onSearchChange={() => undefined}
        hideSearch
        activeFilterCount={filterCount}
        onClearFilters={resetFilters}
        filters={
          <>
            <SupplierPicker
              id="payables-supplier"
              value={supplierId}
              displayValue={supplierLabel}
              onChange={(choice) => {
                setSupplierId(choice?.id ?? '');
                setSupplierLabel(choice?.label ?? '');
                setPage(1);
              }}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
              emptyLabel="Any status"
              options={enumOptions(PayableStatus)}
            />
            <TextField
              label="Due before"
              type="date"
              value={dueBefore}
              onChange={(event) => {
                setDueBefore(event.target.value);
                setPage(1);
              }}
              helperText="Everything falling due on or before this date."
            />
            <CheckboxField
              label="Overdue only"
              checked={overdueOnly}
              onCheckedChange={(checked) => {
                setOverdueOnly(checked);
                setPage(1);
              }}
            />
            <CheckboxField
              label="Queued only"
              checked={queuedOnly}
              onCheckedChange={(checked) => {
                setQueuedOnly(checked);
                setPage(1);
              }}
            />
          </>
        }
        view={view}
        onViewChange={setView}
        page={page}
        pageSize={pageSize}
        total={data?.meta.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {isError ? (
        <LoadError what="Accounts payable" onRetry={() => void refetch()} />
      ) : view === 'table' ? (
        <DataTable
          gridId="payables"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filterCount > 0}
          emptyTitle="Nothing owed"
          emptyMessage="A payable appears the moment a credit purchase posts."
        />
      ) : (
        <EntityCardGrid
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filterCount > 0}
          emptyTitle="Nothing owed"
          emptyMessage="A payable appears the moment a credit purchase posts."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold">
                  {dash(row.supplierName)}
                </p>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {money(row.outstandingAmount)}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                {row.documentNumber} · bill {dash(row.supplierInvoiceNumber)}
              </p>
              <p className="text-muted-foreground text-xs">
                Invoiced {formatDate(row.invoiceDate)} · due {formatDate(row.dueDate)}
              </p>
              <p className="text-muted-foreground text-xs">
                {money(row.originalAmount)} original · {money(row.paidAmount)} paid ·{' '}
                {money(row.adjustedAmount)} adjusted
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <StatusChip status={row.status} />
                <OverdueCell days={row.daysOverdue} />
                {row.isQueued && <Chip tone="progress">Queued</Chip>}
              </div>
            </div>
          )}
        />
      )}

      {rows.length > 0 && (
        <TotalsBar
          caption={`Visible total · ${rows.length} of ${(data?.meta.total ?? 0).toLocaleString()} rows on this page`}
          figures={[
            { label: 'Original', value: money(totals.original) },
            { label: 'Paid', value: money(totals.paid) },
            { label: 'Outstanding', value: money(totals.outstanding), strong: true },
          ]}
        />
      )}
    </>
  );
}
