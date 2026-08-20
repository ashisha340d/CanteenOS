import { useMemo, useState } from 'react';
import {
  Capability,
  MasterStatus,
  StockCountStatus,
  type StockCountDto,
} from '@menuboard/shared';
import { BanIcon, ClipboardListIcon, ScrollTextIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SelectField, TextField } from '@/components/form/fields';
import { RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { StatusChip } from '../../components/StatusChip';
import { useInventoryLocations } from '../../hooks/usePurchase';
import { useCancelStockCount, useStockCounts } from '../../hooks/useStock';
import { useAuth } from '../../services/AuthContext';
import { enumOptions, toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { StockAdjustmentFormModal } from './StockAdjustmentFormModal';
import { StockCountFormModal } from './StockCountFormModal';
import { StockCountSheet } from './StockCountSheet';
import { dash, formatDate, money, varianceClass } from './stockFormat';

const OPEN_STATUSES: StockCountStatus[] = [
  StockCountStatus.DRAFT,
  StockCountStatus.COUNTING,
  StockCountStatus.SUBMITTED,
];

/**
 * Stock counts: the physical check that proves — or disproves — the balance.
 *
 * The list is a worklist; the counting itself happens on the sheet, which is where a counter
 * spends their time and is built for a keyboard rather than a mouse.
 */
export function StockCountsTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canCreate = hasCapability(Capability.STOCK_COUNT_CREATE);
  const canApprove = hasCapability(Capability.STOCK_COUNT_APPROVE);

  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('stock-counts');
  const [creating, setCreating] = useState(false);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [adjustmentFor, setAdjustmentFor] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<StockCountDto | null>(null);

  const query = useMemo(
    () => ({
      search: search || undefined,
      locationId: locationId || undefined,
      status: (status || undefined) as StockCountStatus | undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      pageSize,
    }),
    [search, locationId, status, dateFrom, dateTo, page, pageSize],
  );

  const { data, isLoading, isError, refetch } = useStockCounts(query);
  const { data: locations } = useInventoryLocations({
    page: 1,
    pageSize: 100,
    status: MasterStatus.ACTIVE,
  });
  const cancel = useCancelStockCount();

  const filterCount =
    (locationId ? 1 : 0) + (status ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);
  const filtered = filterCount > 0 || search.trim() !== '';

  function resetFilters(): void {
    setLocationId('');
    setStatus('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  async function confirmCancel(): Promise<void> {
    if (!cancelling) return;
    try {
      await cancel.mutateAsync({ id: cancelling.id });
      notify.success(`${cancelling.countNumber} cancelled.`);
      setCancelling(null);
    } catch (err) {
      notify.fromError(err);
    }
  }

  const columns: DataTableColumn<StockCountDto>[] = [
    { field: 'countNumber', headerName: 'Number', width: 150 },
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
      field: 'status',
      headerName: 'Status',
      width: 130,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
    {
      field: 'isFullCount',
      headerName: 'Scope',
      width: 110,
      renderCell: (row) => (
        <Badge variant="outline">{row.isFullCount ? 'Full' : 'Partial'}</Badge>
      ),
    },
    {
      field: 'progress',
      headerName: 'Counted',
      width: 150,
      sortable: false,
      renderCell: (row) => <Progress counted={row.countedLineCount} total={row.lineCount} />,
    },
    {
      field: 'varianceLineCount',
      headerName: 'Variances',
      width: 110,
      align: 'right',
      valueGetter: (row) => row.varianceLineCount ?? 0,
    },
    {
      field: 'totalVarianceValue',
      headerName: 'Variance value',
      width: 150,
      align: 'right',
      renderCell: (row) => (
        <span className={`tabular-nums ${varianceClass(row.totalVarianceValue ?? null)}`}>
          {money(row.totalVarianceValue)}
        </span>
      ),
    },
    {
      field: 'adjustmentNumber',
      headerName: 'Adjustment',
      width: 160,
      renderCell: (row) =>
        row.adjustmentId === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => setAdjustmentFor(row.adjustmentId)}
          >
            {row.adjustmentNumber ?? 'View adjustment'}
          </Button>
        ),
    },
    {
      field: 'createdByName',
      headerName: 'Raised by',
      width: 150,
      valueGetter: (row) => dash(row.createdByName),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 140,
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
                aria-label={`Open count sheet ${row.countNumber}`}
                onClick={() => setSheetFor(row.id)}
              >
                <ClipboardListIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open the count sheet</TooltipContent>
          </Tooltip>

          {row.adjustmentId !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Adjustment for ${row.countNumber}`}
                  onClick={() => setAdjustmentFor(row.adjustmentId)}
                >
                  <ScrollTextIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>The adjustment this count produced</TooltipContent>
            </Tooltip>
          )}

          {canCreate && OPEN_STATUSES.includes(row.status) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Cancel ${row.countNumber}`}
                  className="hover:text-destructive"
                  onClick={() => setCancelling(row)}
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
              options={enumOptions(StockCountStatus)}
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
        {...(canCreate ? { onCreate: () => setCreating(true), createLabel: 'New count' } : {})}
      />

      {isError ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
          <p className="text-sm font-medium">Stock counts could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : view === 'table' ? (
        <DataTable
          gridId="stock-counts"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onRowDoubleClick={(row) => setSheetFor(row.id)}
          emptyTitle="No stock counts"
          emptyMessage="Raise a count to check the physical shelf against what the system believes."
          {...(canCreate
            ? { emptyAction: { label: 'New count', onClick: () => setCreating(true) } }
            : {})}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onCardDoubleClick={(row) => setSheetFor(row.id)}
          emptyTitle="No stock counts"
          emptyMessage="Raise a count to check the physical shelf against what the system believes."
          {...(canCreate
            ? { emptyAction: { label: 'New count', onClick: () => setCreating(true) } }
            : {})}
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold">{row.countNumber}</p>
                <StatusChip status={row.status} />
              </div>
              <p className="text-muted-foreground text-xs">
                {formatDate(row.businessDate)} · {dash(row.locationName)}
              </p>
              <Progress counted={row.countedLineCount} total={row.lineCount} />
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{row.isFullCount ? 'Full count' : 'Partial'}</Badge>
                {(row.varianceLineCount ?? 0) > 0 && (
                  <Badge variant="secondary">{row.varianceLineCount} variances</Badge>
                )}
                {row.adjustmentId !== null && (
                  <Badge variant="secondary">{row.adjustmentNumber ?? 'Adjusted'}</Badge>
                )}
              </div>
            </div>
          )}
        />
      )}

      {creating && (
        <StockCountFormModal
          open
          canWrite={canCreate}
          onClose={() => setCreating(false)}
          onCreated={(count) => {
            setCreating(false);
            // Straight onto the sheet: raising a count and counting are one task.
            setSheetFor(count.id);
          }}
        />
      )}

      {sheetFor !== null && (
        <StockCountSheet
          open
          countId={sheetFor}
          canRecord={canCreate}
          canApprove={canApprove}
          onClose={() => setSheetFor(null)}
          onOpenAdjustment={(id) => setAdjustmentFor(id)}
        />
      )}

      {adjustmentFor !== null && (
        <StockAdjustmentFormModal
          open
          adjustmentId={adjustmentFor}
          canWrite={false}
          onClose={() => setAdjustmentFor(null)}
        />
      )}

      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel stock count"
        message={`Cancel ${cancelling?.countNumber ?? 'this count'}? The sheet stays on the list as CANCELLED and no adjustment is raised from it.`}
        confirmLabel="Cancel count"
        danger
        loading={cancel.isPending}
        onConfirm={() => void confirmCancel()}
        onCancel={() => setCancelling(null)}
      />
    </>
  );
}

/** How far through the sheet the counter is — the number that says whether to chase them. */
function Progress({
  counted,
  total,
}: {
  counted: number | undefined;
  total: number | undefined;
}): JSX.Element {
  const done = counted ?? 0;
  const all = total ?? 0;
  const pct = all === 0 ? 0 : Math.round((done / all) * 100);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="bg-muted h-1.5 w-14 shrink-0 overflow-hidden rounded-full">
        <span
          className={all > 0 && done >= all ? 'bg-tone-success-solid block h-full' : 'bg-tone-info-solid block h-full'}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">
        {done}/{all}
      </span>
    </span>
  );
}
