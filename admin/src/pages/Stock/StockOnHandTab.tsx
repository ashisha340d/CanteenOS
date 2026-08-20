import { useMemo, useState } from 'react';
import { MasterStatus, type StockBalanceDto } from '@menuboard/shared';
import {
  BoxesIcon,
  CalendarXIcon,
  HistoryIcon,
  HourglassIcon,
  IndianRupeeIcon,
  TrendingDownIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatTile } from '@/components/ui/StatTile';
import { StatGridSkeleton } from '@/components/ui/Skeletons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckboxField, NumberField, SelectField } from '@/components/form/fields';
import { RowActions } from '@/components/RowActions';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { useIngredientCategories } from '../../hooks/useIngredients';
import { useInventoryLocations } from '../../hooks/usePurchase';
import { useStockBalances, useStockSummary } from '../../hooks/useStock';
import { toOptions } from '@/lib/options';
import { StockCardDrawer } from './StockCardDrawer';
import { Chip, EXPIRY_SOON_DAYS, ExpiryCell, dash, money, qty } from './stockFormat';

/**
 * What is physically on the shelf, one row per product ⋅ location ⋅ batch.
 *
 * Nothing here is editable: a balance is a consequence, and the only way to change one is to
 * post a document that moves stock. The row's one affordance is the stock card behind it.
 */
export function StockOnHandTab(): JSX.Element {
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [belowReorderLevel, setBelowReorderLevel] = useState(false);
  const [expiringWithinDays, setExpiringWithinDays] = useState('');
  const [batchTrackedOnly, setBatchTrackedOnly] = useState(false);
  const [nonZeroOnly, setNonZeroOnly] = useState(true);
  const [sortBy, setSortBy] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('stock-balances');
  const [stockCardFor, setStockCardFor] = useState<StockBalanceDto | null>(null);

  const query = useMemo(
    () => ({
      search: search || undefined,
      locationId: locationId || undefined,
      categoryId: categoryId || undefined,
      // Sent either way: "hide the settled zeros" is a UI default, not a server one.
      nonZeroOnly,
      belowReorderLevel: belowReorderLevel || undefined,
      expiringWithinDays: expiringWithinDays === '' ? undefined : Number(expiringWithinDays),
      batchTrackedOnly: batchTrackedOnly || undefined,
      sortBy: sortBy || undefined,
      sortDir: sortBy ? sortDir : undefined,
      page,
      pageSize,
    }),
    [
      search,
      locationId,
      categoryId,
      nonZeroOnly,
      belowReorderLevel,
      expiringWithinDays,
      batchTrackedOnly,
      sortBy,
      sortDir,
      page,
      pageSize,
    ],
  );

  const { data, isLoading, isError, refetch } = useStockBalances(query);
  const summary = useStockSummary(locationId || null);
  const { data: locations } = useInventoryLocations({
    page: 1,
    pageSize: 100,
    status: MasterStatus.ACTIVE,
  });
  const { data: categories } = useIngredientCategories({ page: 1, pageSize: 100 });

  const filterCount =
    (locationId ? 1 : 0) +
    (categoryId ? 1 : 0) +
    (belowReorderLevel ? 1 : 0) +
    (expiringWithinDays !== '' ? 1 : 0) +
    (batchTrackedOnly ? 1 : 0) +
    // The default is on, so it only counts as a filter when the operator has changed it.
    (nonZeroOnly ? 0 : 1);
  const filtered = filterCount > 0 || search.trim() !== '';

  function resetFilters(): void {
    setLocationId('');
    setCategoryId('');
    setBelowReorderLevel(false);
    setExpiringWithinDays('');
    setBatchTrackedOnly(false);
    setNonZeroOnly(true);
    setSortBy('');
    setPage(1);
  }

  /** Every stat tile is a saved filter; clicking one narrows the table to what it counted. */
  function showAll(): void {
    setBelowReorderLevel(false);
    setExpiringWithinDays('');
    setBatchTrackedOnly(false);
    setNonZeroOnly(true);
    setSortBy('');
    setPage(1);
  }

  function showBelowReorder(): void {
    showAll();
    setBelowReorderLevel(true);
  }

  function showExpiring(days: number): void {
    showAll();
    setExpiringWithinDays(String(days));
  }

  function showNegative(): void {
    showAll();
    setSortBy('quantity');
    setSortDir('asc');
  }

  const columns: DataTableColumn<StockBalanceDto>[] = [
    {
      field: 'productName',
      headerName: 'Product',
      width: 230,
      valueGetter: (row) => dash(row.productName),
    },
    {
      field: 'productCode',
      headerName: 'Code',
      width: 110,
      valueGetter: (row) => dash(row.productCode),
    },
    {
      field: 'locationName',
      headerName: 'Location',
      width: 150,
      valueGetter: (row) => dash(row.locationName),
    },
    {
      field: 'batchNumber',
      headerName: 'Batch',
      width: 130,
      valueGetter: (row) => dash(row.batchNumber),
    },
    {
      field: 'expiryDate',
      headerName: 'Expiry',
      width: 190,
      renderCell: (row) => (
        <ExpiryCell expiryDate={row.expiryDate} daysToExpiry={row.daysToExpiry} />
      ),
    },
    {
      field: 'quantity',
      headerName: 'Qty',
      width: 120,
      align: 'right',
      renderCell: (row) => (
        <span className={row.quantity < 0 ? 'text-tone-danger font-semibold tabular-nums' : 'tabular-nums'}>
          {qty(row.quantity)}
          {row.productUnit ? <span className="text-muted-foreground/70"> {row.productUnit}</span> : null}
        </span>
      ),
    },
    {
      field: 'reservedQuantity',
      headerName: 'Reserved',
      width: 110,
      align: 'right',
      valueGetter: (row) => qty(row.reservedQuantity),
    },
    {
      field: 'availableQuantity',
      headerName: 'Available',
      width: 110,
      align: 'right',
      valueGetter: (row) => qty(row.availableQuantity),
    },
    {
      field: 'averageCost',
      headerName: 'Avg cost',
      width: 120,
      align: 'right',
      valueGetter: (row) => money(row.averageCost),
    },
    {
      field: 'stockValue',
      headerName: 'Value',
      width: 130,
      align: 'right',
      valueGetter: (row) => money(row.stockValue),
    },
    {
      field: 'reorderLevel',
      headerName: 'Reorder',
      width: 140,
      renderCell: (row) =>
        row.isBelowReorderLevel === true ? (
          <Chip tone="progress">
            Below {row.reorderLevel === null || row.reorderLevel === undefined ? 'level' : qty(row.reorderLevel)}
          </Chip>
        ) : row.reorderLevel === null || row.reorderLevel === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="text-muted-foreground tabular-nums">{qty(row.reorderLevel)}</span>
        ),
    },
    {
      field: 'actions',
      headerName: 'Stock card',
      width: 110,
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
                aria-label={`Stock card for ${row.productName ?? 'product'}`}
                onClick={() => setStockCardFor(row)}
              >
                <HistoryIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Movement history for this product at this location</TooltipContent>
          </Tooltip>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      {summary.isLoading ? (
        <div className="mb-4">
          <StatGridSkeleton count={6} />
        </div>
      ) : summary.isError ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3">
          <p className="text-muted-foreground text-sm">Headline figures could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void summary.refetch()}>
            Try again
          </Button>
        </div>
      ) : summary.data ? (
        <div className="mb-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr))]">
          <StatTile
            label="Distinct products"
            value={summary.data.distinctProducts.toLocaleString()}
            hint={summary.data.locationName ?? 'Every location'}
            icon={<BoxesIcon />}
            onClick={showAll}
          />
          <StatTile
            label="Stock value"
            value={money(summary.data.totalStockValue)}
            hint="At the valuation held"
            icon={<IndianRupeeIcon />}
          />
          <StatTile
            label="Below reorder"
            value={summary.data.belowReorderCount.toLocaleString()}
            hint="Raise a requirement"
            tone="progress"
            emphasis={summary.data.belowReorderCount > 0}
            icon={<TrendingDownIcon />}
            onClick={showBelowReorder}
          />
          <StatTile
            label="Expiring soon"
            value={summary.data.expiringSoonCount.toLocaleString()}
            hint={`Within ${EXPIRY_SOON_DAYS} days`}
            tone="progress"
            emphasis={summary.data.expiringSoonCount > 0}
            icon={<HourglassIcon />}
            onClick={() => showExpiring(EXPIRY_SOON_DAYS)}
          />
          <StatTile
            label="Expired"
            value={summary.data.expiredCount.toLocaleString()}
            hint="Already past expiry"
            tone="danger"
            emphasis={summary.data.expiredCount > 0}
            icon={<CalendarXIcon />}
            onClick={() => showExpiring(0)}
          />
          <StatTile
            label="Negative balances"
            value={summary.data.negativeBalanceCount.toLocaleString()}
            hint="Lowest first"
            tone="danger"
            emphasis={summary.data.negativeBalanceCount > 0}
            icon={<TriangleAlertIcon />}
            onClick={showNegative}
          />
        </div>
      ) : null}

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
              label="Category"
              value={categoryId}
              onChange={(next) => {
                setCategoryId(next);
                setPage(1);
              }}
              emptyLabel="All categories"
              options={toOptions(
                categories?.items ?? [],
                (category) => category.id,
                (category) => category.name,
              )}
            />
            <NumberField
              label="Expiring within (days)"
              value={expiringWithinDays}
              onChange={(event) => {
                setExpiringWithinDays(event.target.value);
                setPage(1);
              }}
              min={0}
              step="1"
              helperText="Leave blank to ignore expiry. Zero shows what is already expired."
            />
            <CheckboxField
              label="At or below reorder level"
              checked={belowReorderLevel}
              onCheckedChange={(checked) => {
                setBelowReorderLevel(checked);
                setPage(1);
              }}
            />
            <CheckboxField
              label="Batch tracked only"
              checked={batchTrackedOnly}
              onCheckedChange={(checked) => {
                setBatchTrackedOnly(checked);
                setPage(1);
              }}
            />
            <CheckboxField
              label="Hide zero balances"
              helperText="On by default. Switch it off to see what has settled back to zero."
              checked={nonZeroOnly}
              onCheckedChange={(checked) => {
                setNonZeroOnly(checked);
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
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
          <p className="text-sm font-medium">Stock balances could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : view === 'table' ? (
        <DataTable
          gridId="stock-balances"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={(field, dir) => {
            setSortBy(field);
            setSortDir(dir);
            setPage(1);
          }}
          onRowDoubleClick={(row) => setStockCardFor(row)}
          emptyTitle="Nothing on hand"
          emptyMessage="A balance appears the moment a receipt, transfer or adjustment posts against a location."
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onCardDoubleClick={(row) => setStockCardFor(row)}
          emptyTitle="Nothing on hand"
          emptyMessage="A balance appears the moment a receipt, transfer or adjustment posts against a location."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold">
                  {dash(row.productName)}
                </p>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {qty(row.quantity)} {row.productUnit ?? ''}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                {dash(row.productCode)} · {dash(row.locationName)}
                {row.batchNumber ? ` · ${row.batchNumber}` : ''}
              </p>
              <p className="text-muted-foreground text-xs">
                Available {qty(row.availableQuantity)} · Reserved {qty(row.reservedQuantity)} ·{' '}
                {money(row.stockValue)}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                {row.expiryDate ? (
                  <ExpiryCell expiryDate={row.expiryDate} daysToExpiry={row.daysToExpiry} />
                ) : null}
                {row.isBelowReorderLevel === true && <Badge variant="outline">Below reorder</Badge>}
                {row.quantity < 0 && <Badge variant="destructive">Negative</Badge>}
              </div>
            </div>
          )}
        />
      )}

      <StockCardDrawer balance={stockCardFor} onClose={() => setStockCardFor(null)} />
    </>
  );
}
