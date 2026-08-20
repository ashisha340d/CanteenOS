import { useMemo, useState } from 'react';
import {
  Capability,
  type AccountsPayableDto,
  type AccountsPayableListQuery,
} from '@menuboard/shared';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { ListToolbar } from '../../components/ListToolbar';
import { StatusChip } from '../../components/StatusChip';
import { usePayables } from '../../hooks/useVendorAccounting';
import { useAuth } from '../../services/AuthContext';
import { dash, formatDate, money } from '../Stock/stockFormat';
import { VendorPaymentFormModal } from './VendorPaymentFormModal';
import {
  LoadError,
  NotPermitted,
  OverdueCell,
  SupplierPicker,
  TotalsBar,
} from './vendorAccountingShared';

/**
 * The bills somebody has decided to pay, and the one screen that turns "what do we owe" into
 * a single payment.
 *
 * A payment belongs to one supplier, so a selection spanning two of them cannot be paid in
 * one go — the action says so rather than failing at the server.
 */
export function PaymentQueueTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canRead = hasCapability(Capability.PAYABLE_READ);
  const canPay = hasCapability(Capability.VENDOR_PAYMENT_CREATE);

  const [supplierId, setSupplierId] = useState('');
  const [supplierLabel, setSupplierLabel] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<string[]>([]);
  const [payOpen, setPayOpen] = useState(false);

  const query = useMemo<AccountsPayableListQuery>(() => {
    const built: AccountsPayableListQuery = { page, pageSize, queuedOnly: true };
    if (supplierId !== '') built.supplierId = supplierId;
    return built;
  }, [supplierId, page, pageSize]);

  const { data, isLoading, isError, refetch } = usePayables(query, canRead);
  const rows = useMemo(() => data?.items ?? [], [data?.items]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.includes(row.id)),
    [rows, selected],
  );
  const selectedTotal = useMemo(
    () => selectedRows.reduce((sum, row) => sum + row.outstandingAmount, 0),
    [selectedRows],
  );
  const suppliersInSelection = useMemo(
    () => new Set(selectedRows.map((row) => row.supplierId)),
    [selectedRows],
  );
  const oneSupplier = suppliersInSelection.size === 1;
  const paySupplier = selectedRows[0];

  const queueTotal = useMemo(
    () => rows.reduce((sum, row) => sum + row.outstandingAmount, 0),
    [rows],
  );

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
      field: 'queuedAt',
      headerName: 'Queued',
      width: 130,
      valueGetter: (row) => formatDate(row.queuedAt),
    },
  ];

  if (!canRead) {
    return <NotPermitted what="The payment queue" capability="the payable read capability" />;
  }

  return (
    <>
      <p className="text-muted-foreground mb-3 text-xs">
        Bills queued for payment. Tick the ones going out together and pay them as one payment —
        a payment settles one supplier at a time.
      </p>

      <ListToolbar
        search=""
        onSearchChange={() => undefined}
        hideSearch
        activeFilterCount={supplierId ? 1 : 0}
        onClearFilters={() => {
          setSupplierId('');
          setSupplierLabel('');
          setPage(1);
        }}
        filters={
          <SupplierPicker
            id="queue-supplier"
            value={supplierId}
            displayValue={supplierLabel}
            onChange={(choice) => {
              setSupplierId(choice?.id ?? '');
              setSupplierLabel(choice?.label ?? '');
              setSelected([]);
              setPage(1);
            }}
          />
        }
        view="table"
        onViewChange={() => undefined}
        hideView
        page={page}
        pageSize={pageSize}
        total={data?.meta.total ?? 0}
        onPageChange={(next) => {
          setSelected([]);
          setPage(next);
        }}
        onPageSizeChange={(size) => {
          setSelected([]);
          setPageSize(size);
          setPage(1);
        }}
        extraActions={
          canPay ? (
            <Button
              size="sm"
              disabled={selectedRows.length === 0 || !oneSupplier}
              onClick={() => setPayOpen(true)}
            >
              {selectedRows.length === 0
                ? 'Pay selected'
                : !oneSupplier
                  ? 'One supplier at a time'
                  : `Pay selected · ${money(selectedTotal)}`}
            </Button>
          ) : null
        }
      />

      {isError ? (
        <LoadError what="The payment queue" onRetry={() => void refetch()} />
      ) : (
        <DataTable
          gridId="payment-queue"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={supplierId !== ''}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          bulkActions={() => (
            <span className="text-muted-foreground text-sm tabular-nums">
              {money(selectedTotal)} selected
              {oneSupplier ? '' : ' · spanning more than one supplier'}
            </span>
          )}
          emptyTitle="Nothing queued"
          emptyMessage="Queue a bill from the Payables tab and it appears here, ready to pay."
        />
      )}

      {rows.length > 0 && (
        <TotalsBar
          caption={`Visible total · ${rows.length} of ${(data?.meta.total ?? 0).toLocaleString()} queued bills on this page`}
          figures={[
            { label: 'Queued outstanding', value: money(queueTotal) },
            { label: 'Selected', value: money(selectedTotal), strong: true },
          ]}
        />
      )}

      <VendorPaymentFormModal
        open={payOpen && oneSupplier && paySupplier !== undefined}
        onClose={() => {
          setPayOpen(false);
          setSelected([]);
        }}
        supplierId={paySupplier?.supplierId ?? ''}
        supplierLabel={paySupplier?.supplierName ?? ''}
        preselectedPayableIds={selectedRows.map((row) => row.id)}
      />
    </>
  );
}
