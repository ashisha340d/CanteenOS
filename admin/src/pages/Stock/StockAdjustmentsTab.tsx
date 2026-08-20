import { useMemo, useState } from 'react';
import {
  Capability,
  MasterStatus,
  StockAdjustmentReason,
  StockAdjustmentStatus,
  type StockAdjustmentDto,
} from '@menuboard/shared';
import { BanIcon, CheckCheckIcon, EyeIcon, SendIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SelectField, TextField } from '@/components/form/fields';
import { EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { StatusChip } from '../../components/StatusChip';
import { useInventoryLocations } from '../../hooks/usePurchase';
import {
  useCancelStockAdjustment,
  usePostStockAdjustment,
  useStockAdjustments,
  useSubmitStockAdjustment,
} from '../../hooks/useStock';
import { useAuth } from '../../services/AuthContext';
import { enumOptions, humanise, toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { StockAdjustmentFormModal } from './StockAdjustmentFormModal';
import { dash, formatDate, formatDateTime, money } from './stockFormat';

const EDITABLE_STATUSES: StockAdjustmentStatus[] = [StockAdjustmentStatus.DRAFT];
const CANCELLABLE_STATUSES: StockAdjustmentStatus[] = [
  StockAdjustmentStatus.DRAFT,
  StockAdjustmentStatus.SUBMITTED,
  StockAdjustmentStatus.APPROVED,
];
const POSTABLE_STATUSES: StockAdjustmentStatus[] = [
  StockAdjustmentStatus.SUBMITTED,
  StockAdjustmentStatus.APPROVED,
];

type ConfirmKind = 'submit' | 'post' | 'cancel';

/**
 * Stock adjustments: the documents that move stock with no supplier behind them.
 *
 * The lifecycle is the whole point of the screen — a draft can be corrected freely, a posted
 * one never can, and the transition between the two is the only place a balance changes
 * without a delivery note to check it against.
 */
export function StockAdjustmentsTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canCreate = hasCapability(Capability.STOCK_ADJUSTMENT_CREATE);
  const canApprove = hasCapability(Capability.STOCK_ADJUSTMENT_APPROVE);

  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('stock-adjustments');
  const [formFor, setFormFor] = useState<string | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; row: StockAdjustmentDto } | null>(
    null,
  );

  const query = useMemo(
    () => ({
      search: search || undefined,
      locationId: locationId || undefined,
      status: (status || undefined) as StockAdjustmentStatus | undefined,
      reason: (reason || undefined) as StockAdjustmentReason | undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      pageSize,
    }),
    [search, locationId, status, reason, dateFrom, dateTo, page, pageSize],
  );

  const { data, isLoading, isError, refetch } = useStockAdjustments(query);
  const { data: locations } = useInventoryLocations({
    page: 1,
    pageSize: 100,
    status: MasterStatus.ACTIVE,
  });

  const submit = useSubmitStockAdjustment();
  const post = usePostStockAdjustment();
  const cancel = useCancelStockAdjustment();
  const working = submit.isPending || post.isPending || cancel.isPending;

  const filterCount =
    (locationId ? 1 : 0) +
    (status ? 1 : 0) +
    (reason ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);
  const filtered = filterCount > 0 || search.trim() !== '';

  function resetFilters(): void {
    setLocationId('');
    setStatus('');
    setReason('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  async function runConfirmed(): Promise<void> {
    if (!confirm) return;
    const { kind, row } = confirm;
    try {
      if (kind === 'submit') {
        await submit.mutateAsync(row.id);
        notify.success(`${row.adjustmentNumber} submitted for approval.`);
      } else if (kind === 'post') {
        await post.mutateAsync(row.id);
        notify.success(`${row.adjustmentNumber} posted. Balances and the ledger are updated.`);
      } else {
        await cancel.mutateAsync({ id: row.id });
        notify.success(`${row.adjustmentNumber} cancelled.`);
      }
      setConfirm(null);
    } catch (err) {
      notify.fromError(err);
    }
  }

  const confirmCopy = (): { title: string; message: string; label: string; danger: boolean } => {
    if (!confirm) return { title: '', message: '', label: 'Confirm', danger: false };
    const { kind, row } = confirm;
    const where = row.locationName ?? 'the selected location';
    const lines = row.lineCount ?? row.lines?.length ?? 0;
    if (kind === 'submit') {
      return {
        title: 'Submit adjustment',
        message: `Submit ${row.adjustmentNumber} for approval? Its lines can no longer be edited once it leaves DRAFT.`,
        label: 'Submit',
        danger: false,
      };
    }
    if (kind === 'post') {
      return {
        title: 'Post adjustment',
        message: `Post ${row.adjustmentNumber} — ${lines} ${lines === 1 ? 'line' : 'lines'} at ${where}, ${money(row.totalInValue)} in and ${money(row.totalOutValue)} out.\n\nThis writes the stock ledger and rewrites the balance with no supplier document behind it. It cannot be undone: a mistake has to be corrected by posting an opposite adjustment.`,
        label: 'Post adjustment',
        danger: true,
      };
    }
    return {
      title: 'Cancel adjustment',
      message: `Cancel ${row.adjustmentNumber}? The document stays on the list as CANCELLED and no stock moves.`,
      label: 'Cancel adjustment',
      danger: true,
    };
  };

  const columns: DataTableColumn<StockAdjustmentDto>[] = [
    { field: 'adjustmentNumber', headerName: 'Number', width: 160 },
    {
      field: 'businessDate',
      headerName: 'Date',
      width: 130,
      valueGetter: (row) => formatDate(row.businessDate),
    },
    {
      field: 'locationName',
      headerName: 'Location',
      width: 170,
      valueGetter: (row) => dash(row.locationName),
    },
    {
      field: 'reason',
      headerName: 'Reason',
      width: 160,
      renderCell: (row) => <Badge variant="outline">{humanise(row.reason)}</Badge>,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 130,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
    {
      field: 'lineCount',
      headerName: 'Lines',
      width: 90,
      align: 'right',
      valueGetter: (row) => row.lineCount ?? row.lines?.length ?? 0,
    },
    {
      field: 'totalInValue',
      headerName: 'In value',
      width: 130,
      align: 'right',
      valueGetter: (row) => money(row.totalInValue),
    },
    {
      field: 'totalOutValue',
      headerName: 'Out value',
      width: 130,
      align: 'right',
      valueGetter: (row) => money(row.totalOutValue),
    },
    {
      field: 'createdByName',
      headerName: 'Raised by',
      width: 150,
      valueGetter: (row) => dash(row.createdByName),
    },
    {
      field: 'postedAt',
      headerName: 'Posted',
      width: 170,
      valueGetter: (row) => formatDateTime(row.postedAt),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 180,
      sortable: false,
      align: 'right',
      alwaysVisible: true,
      renderCell: (row) => (
        <RowActions>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Open ${row.adjustmentNumber}`}
                onClick={() => setFormFor(row.id)}
              >
                <EyeIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open</TooltipContent>
          </Tooltip>

          {canCreate && EDITABLE_STATUSES.includes(row.status) && (
            <EditAction label={row.adjustmentNumber} onClick={() => setFormFor(row.id)} />
          )}

          {canCreate && row.status === StockAdjustmentStatus.DRAFT && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Submit ${row.adjustmentNumber}`}
                  onClick={() => setConfirm({ kind: 'submit', row })}
                >
                  <SendIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Submit for approval</TooltipContent>
            </Tooltip>
          )}

          {canApprove && POSTABLE_STATUSES.includes(row.status) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Post ${row.adjustmentNumber}`}
                  onClick={() => setConfirm({ kind: 'post', row })}
                >
                  <CheckCheckIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Post — writes stock</TooltipContent>
            </Tooltip>
          )}

          {canCreate && CANCELLABLE_STATUSES.includes(row.status) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Cancel ${row.adjustmentNumber}`}
                  className="hover:text-destructive"
                  onClick={() => setConfirm({ kind: 'cancel', row })}
                >
                  <BanIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cancel</TooltipContent>
            </Tooltip>
          )}
        </RowActions>
      ),
    },
  ];

  const copy = confirmCopy();

  return (
    <>
      <ListToolbar
        search={search}
        onSearchChange={(next) => {
          setSearch(next);
          setPage(1);
        }}
        activeFilterCount={filterCount}
        onClearFilters={resetFilters}
        filters={
          <>
            <SelectField
              label="Location"
              value={locationId}
              onChange={(next) => {
                setLocationId(next);
                setPage(1);
              }}
              emptyLabel="Every location"
              options={toOptions(
                locations?.items ?? [],
                (location) => location.id,
                (location) => `${location.code} — ${location.name}`,
              )}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
              emptyLabel="All statuses"
              options={enumOptions(StockAdjustmentStatus)}
            />
            <SelectField
              label="Reason"
              value={reason}
              onChange={(next) => {
                setReason(next);
                setPage(1);
              }}
              emptyLabel="All reasons"
              options={enumOptions(StockAdjustmentReason)}
            />
            <TextField
              label="From"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
            />
            <TextField
              label="To"
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
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
        {...(canCreate ? { onCreate: () => setFormFor(null), createLabel: 'New adjustment' } : {})}
      />

      {isError ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
          <p className="text-sm font-medium">Adjustments could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : view === 'table' ? (
        <DataTable
          gridId="stock-adjustments"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onRowDoubleClick={(row) => setFormFor(row.id)}
          emptyTitle="No adjustments"
          emptyMessage="Raise one to write off wastage or expiry, or to correct a balance nothing else explains."
          {...(canCreate
            ? { emptyAction: { label: 'New adjustment', onClick: () => setFormFor(null) } }
            : {})}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onCardDoubleClick={(row) => setFormFor(row.id)}
          emptyTitle="No adjustments"
          emptyMessage="Raise one to write off wastage or expiry, or to correct a balance nothing else explains."
          {...(canCreate
            ? { emptyAction: { label: 'New adjustment', onClick: () => setFormFor(null) } }
            : {})}
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold">
                  {row.adjustmentNumber}
                </p>
                <StatusChip status={row.status} />
              </div>
              <p className="text-muted-foreground text-xs">
                {formatDate(row.businessDate)} · {dash(row.locationName)}
              </p>
              <p className="text-muted-foreground text-xs">
                {money(row.totalInValue)} in · {money(row.totalOutValue)} out ·{' '}
                {row.lineCount ?? row.lines?.length ?? 0} lines
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{humanise(row.reason)}</Badge>
                {row.stockCountId !== null && <Badge variant="secondary">From a count</Badge>}
              </div>
            </div>
          )}
        />
      )}

      {formFor !== undefined && (
        <StockAdjustmentFormModal
          open
          adjustmentId={formFor}
          canWrite={canCreate}
          onClose={() => setFormFor(undefined)}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={copy.title}
        message={copy.message}
        confirmLabel={copy.label}
        danger={copy.danger}
        loading={working}
        onConfirm={() => void runConfirmed()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
