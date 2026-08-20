import { useMemo, useState } from 'react';
import {
  Capability,
  MasterStatus,
  StockMovementType,
  StockSourceType,
  type StockLedgerEntryDto,
} from '@menuboard/shared';
import { LockIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField, TextField } from '@/components/form/fields';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { SearchPickerField } from '../../components/SearchPickerField';
import { useInventoryLocations, useProducts } from '../../hooks/usePurchase';
import { useStockLedger } from '../../hooks/useStock';
import { useAuth } from '../../services/AuthContext';
import { enumOptions, humanise, toOptions } from '@/lib/options';
import { dash, formatDateTime, money, qty, quantityClass } from './stockFormat';

const MOVEMENT_TYPES = Object.values(StockMovementType);

/**
 * The stock ledger. Every movement that ever happened, and nothing else.
 *
 * Deliberately actionless: a posted movement is never edited or deleted, because the balance
 * it produced is only trustworthy if the history behind it is. A mistake is corrected by
 * posting its opposite, which appears here as its own row.
 */
export function StockLedgerTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canRead = hasCapability(Capability.STOCK_LEDGER_READ);

  const [productId, setProductId] = useState('');
  const [productLabel, setProductLabel] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [movementTypes, setMovementTypes] = useState<StockMovementType[]>([]);
  const [sourceType, setSourceType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [view, setView] = useViewMode('stock-ledger');

  const query = useMemo(
    () => ({
      productId: productId || undefined,
      locationId: locationId || undefined,
      movementType: movementTypes.length > 0 ? movementTypes : undefined,
      sourceType: (sourceType || undefined) as StockSourceType | undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      // Two movements can share a millisecond; the sequence is the only total order there is.
      sortBy: 'ledgerSeq',
      sortDir: 'desc' as const,
      page,
      pageSize,
    }),
    [productId, locationId, movementTypes, sourceType, dateFrom, dateTo, page, pageSize],
  );

  const { data, isLoading, isError, refetch } = useStockLedger(query, canRead);
  const { data: locations } = useInventoryLocations({
    page: 1,
    pageSize: 100,
    status: MasterStatus.ACTIVE,
  });
  const { data: products, isFetching: productsFetching } = useProducts({
    search: productSearch || undefined,
    page: 1,
    pageSize: 20,
    stockedOnly: true,
    status: MasterStatus.ACTIVE,
  });

  const filterCount =
    (productId ? 1 : 0) +
    (locationId ? 1 : 0) +
    (movementTypes.length > 0 ? 1 : 0) +
    (sourceType ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  function resetFilters(): void {
    setProductId('');
    setProductLabel('');
    setLocationId('');
    setMovementTypes([]);
    setSourceType('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  function toggleMovementType(type: StockMovementType, checked: boolean): void {
    setMovementTypes((current) =>
      checked ? [...current, type] : current.filter((entry) => entry !== type),
    );
    setPage(1);
  }

  // Ordered again on arrival so the display order is guaranteed even if a page came back
  // sorted some other way.
  const rows = useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => b.ledgerSeq - a.ledgerSeq),
    [data?.items],
  );

  const columns: DataTableColumn<StockLedgerEntryDto>[] = [
    {
      field: 'ledgerSeq',
      headerName: 'Seq',
      width: 90,
      align: 'right',
      valueGetter: (row) => row.ledgerSeq,
    },
    {
      field: 'occurredAt',
      headerName: 'Date & time',
      width: 170,
      valueGetter: (row) => formatDateTime(row.occurredAt),
    },
    {
      field: 'productName',
      headerName: 'Product',
      width: 210,
      valueGetter: (row) => dash(row.productName),
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
      field: 'movementType',
      headerName: 'Movement',
      width: 180,
      renderCell: (row) => <Badge variant="outline">{humanise(row.movementType)}</Badge>,
    },
    {
      field: 'quantityIn',
      headerName: 'In',
      width: 100,
      align: 'right',
      renderCell: (row) =>
        row.quantityIn > 0 ? (
          <span className={`font-medium tabular-nums ${quantityClass('IN')}`}>
            {qty(row.quantityIn)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      field: 'quantityOut',
      headerName: 'Out',
      width: 100,
      align: 'right',
      renderCell: (row) =>
        row.quantityOut > 0 ? (
          <span className={`font-medium tabular-nums ${quantityClass('OUT')}`}>
            {qty(row.quantityOut)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      field: 'unitCost',
      headerName: 'Unit cost',
      width: 120,
      align: 'right',
      valueGetter: (row) => money(row.unitCost),
    },
    {
      field: 'movementValue',
      headerName: 'Value',
      width: 130,
      align: 'right',
      valueGetter: (row) => money(row.movementValue),
    },
    {
      field: 'balanceQuantity',
      headerName: 'Balance after',
      width: 130,
      align: 'right',
      valueGetter: (row) => qty(row.balanceQuantity),
    },
    {
      field: 'sourceDocumentNumber',
      headerName: 'Source document',
      width: 200,
      renderCell: (row) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{dash(row.sourceDocumentNumber)}</span>
          <Badge variant="secondary">{humanise(row.sourceType)}</Badge>
        </span>
      ),
    },
    {
      field: 'actorName',
      headerName: 'Actor',
      width: 150,
      valueGetter: (row) => dash(row.actorName),
    },
  ];

  if (!canRead) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center">
        <LockIcon className="text-muted-foreground size-5" aria-hidden />
        <p className="text-sm font-medium">The stock ledger is not visible to your role.</p>
        <p className="text-muted-foreground text-sm">
          Ask an administrator for the stock ledger read capability.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="text-muted-foreground mb-3 flex items-center gap-1.5 text-xs">
        <LockIcon className="size-3.5 shrink-0" aria-hidden />
        Immutable history, newest first by ledger sequence. Movements are never edited or
        deleted — a mistake is corrected by posting its opposite.
      </p>

      <ListToolbar
        search=""
        onSearchChange={() => undefined}
        hideSearch
        activeFilterCount={filterCount}
        onClearFilters={resetFilters}
        filters={
          <>
            <SearchPickerField
              id="ledger-product"
              label="Product"
              value={productId || null}
              displayValue={productLabel}
              loading={productsFetching}
              onSearchChange={setProductSearch}
              options={(products?.items ?? []).map((product) => ({
                id: product.id,
                label: product.name,
                sublabel: [product.code, product.stockUomCode ?? product.unit]
                  .filter(Boolean)
                  .join(' · '),
              }))}
              onSelect={(option) => {
                setProductId(option.id);
                setProductLabel(option.label);
                setPage(1);
              }}
              onClear={() => {
                setProductId('');
                setProductLabel('');
                setPage(1);
              }}
            />
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
              label="Source document"
              value={sourceType}
              onChange={(next) => {
                setSourceType(next);
                setPage(1);
              }}
              emptyLabel="Any source"
              options={enumOptions(StockSourceType)}
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
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Movement type</span>
              <p className="text-muted-foreground text-xs">
                Nothing ticked means every movement type.
              </p>
              {MOVEMENT_TYPES.map((type) => (
                <CheckboxField
                  key={type}
                  label={humanise(type)}
                  checked={movementTypes.includes(type)}
                  onCheckedChange={(checked) => toggleMovementType(type, checked)}
                />
              ))}
            </div>
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
          <p className="text-sm font-medium">The stock ledger could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : view === 'table' ? (
        /* No onSortChange: the sequence is the order, and offering a timestamp sort would
           promise a precision the data does not have. */
        <DataTable
          gridId="stock-ledger"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filterCount > 0}
          emptyTitle="No movements yet"
          emptyMessage="Stock movements appear here as receipts, transfers, adjustments and sales post."
        />
      ) : (
        <EntityCardGrid
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filterCount > 0}
          emptyTitle="No movements yet"
          emptyMessage="Stock movements appear here as receipts, transfers, adjustments and sales post."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold">
                  {dash(row.productName)}
                </p>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  #{row.ledgerSeq}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                {formatDateTime(row.occurredAt)} · {dash(row.locationName)}
                {row.batchNumber ? ` · ${row.batchNumber}` : ''}
              </p>
              <p className="text-sm">
                <span
                  className={`font-semibold tabular-nums ${quantityClass(row.direction)}`}
                >
                  {row.direction === 'IN' ? '+' : '−'}
                  {qty(row.direction === 'IN' ? row.quantityIn : row.quantityOut)}
                </span>
                <span className="text-muted-foreground">
                  {' '}
                  → balance {qty(row.balanceQuantity)}
                </span>
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{humanise(row.movementType)}</Badge>
                <Badge variant="secondary">
                  {dash(row.sourceDocumentNumber ?? humanise(row.sourceType))}
                </Badge>
              </div>
            </div>
          )}
        />
      )}
    </>
  );
}
