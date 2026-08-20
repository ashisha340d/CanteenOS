import { useMemo, useState } from 'react';
import {
  Capability,
  MasterStatus,
  ProductKind,
  type ProductDto,
} from '@menuboard/shared';
import { WarehouseIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckboxField, SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { StatusChip } from '../../components/StatusChip';
import { useAuth } from '../../services/AuthContext';
import { useIngredientCategories } from '../../hooks/useIngredients';
import { useDeleteProduct, useProducts } from '../../hooks/usePurchase';
import { enumOptions, toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { ProductFormModal } from './ProductFormModal';
import { ProductLocationsPanel } from './ProductLocationsPanel';

const dash = (value: string | null | undefined): string =>
  value === null || value === undefined || value === '' ? '—' : value;

const showNumber = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : String(value);

export function ProductsTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canWrite = hasCapability(Capability.PRODUCT_WRITE);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [purchasableOnly, setPurchasableOnly] = useState(false);
  const [stockedOnly, setStockedOnly] = useState(false);
  const [batchTrackedOnly, setBatchTrackedOnly] = useState(false);
  const [belowReorderLevel, setBelowReorderLevel] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('purchase-products');
  const [editing, setEditing] = useState<ProductDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ProductDto | null>(null);
  const [locationsFor, setLocationsFor] = useState<ProductDto | null>(null);

  const query = useMemo(
    () => ({
      search: search || undefined,
      categoryId: categoryId || undefined,
      kind: (kind || undefined) as ProductKind | undefined,
      status: (status || undefined) as MasterStatus | undefined,
      purchasableOnly: purchasableOnly || undefined,
      stockedOnly: stockedOnly || undefined,
      batchTrackedOnly: batchTrackedOnly || undefined,
      belowReorderLevel: belowReorderLevel || undefined,
      page,
      pageSize,
    }),
    [
      search,
      categoryId,
      kind,
      status,
      purchasableOnly,
      stockedOnly,
      batchTrackedOnly,
      belowReorderLevel,
      page,
      pageSize,
    ],
  );

  const { data, isLoading, isError, refetch } = useProducts(query);
  const { data: categories } = useIngredientCategories({ page: 1, pageSize: 100 });
  const remove = useDeleteProduct();

  const filterCount =
    (categoryId ? 1 : 0) +
    (kind ? 1 : 0) +
    (status ? 1 : 0) +
    (purchasableOnly ? 1 : 0) +
    (stockedOnly ? 1 : 0) +
    (batchTrackedOnly ? 1 : 0) +
    (belowReorderLevel ? 1 : 0);
  const filtered = filterCount > 0 || search.trim() !== '';

  function resetFilters(): void {
    setCategoryId('');
    setKind('');
    setStatus('');
    setPurchasableOnly(false);
    setStockedOnly(false);
    setBatchTrackedOnly(false);
    setBelowReorderLevel(false);
    setPage(1);
  }

  const columns: DataTableColumn<ProductDto>[] = [
    { field: 'code', headerName: 'Code', width: 120, valueGetter: (row) => dash(row.code) },
    { field: 'name', headerName: 'Name', width: 240 },
    {
      field: 'categoryName',
      headerName: 'Category',
      width: 160,
      valueGetter: (row) => dash(row.categoryName),
    },
    { field: 'kind', headerName: 'Kind', width: 110 },
    {
      field: 'stockUomCode',
      headerName: 'Stock unit',
      width: 110,
      valueGetter: (row) => dash(row.stockUomCode),
    },
    {
      field: 'purchaseUomCode',
      headerName: 'Purchase unit',
      width: 130,
      valueGetter: (row) => dash(row.purchaseUomCode),
    },
    {
      field: 'purchaseConversionFactor',
      headerName: 'Conv. factor',
      width: 120,
      align: 'right',
      valueGetter: (row) => row.purchaseConversionFactor,
    },
    {
      field: 'taxProfileName',
      headerName: 'Tax profile',
      width: 170,
      valueGetter: (row) =>
        row.taxProfileName
          ? row.taxRate === null || row.taxRate === undefined
            ? row.taxProfileName
            : `${row.taxProfileName} · ${row.taxRate}%`
          : '—',
    },
    {
      field: 'hsnSacCode',
      headerName: 'HSN/SAC',
      width: 120,
      valueGetter: (row) => dash(row.hsnSacCode),
    },
    {
      field: 'isBatchTracked',
      headerName: 'Batch',
      width: 100,
      renderCell: (row) =>
        row.isBatchTracked ? (
          <Badge variant="secondary">{row.batchIssuePolicy}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      field: 'isExpiryTracked',
      headerName: 'Expiry',
      width: 100,
      renderCell: (row) =>
        row.isExpiryTracked ? (
          <Badge variant="outline">
            {row.shelfLifeDays === null ? 'Tracked' : `${row.shelfLifeDays}d`}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      field: 'reorderLevel',
      headerName: 'Reorder level',
      width: 130,
      align: 'right',
      valueGetter: (row) => showNumber(row.reorderLevel),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 110,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 130,
      sortable: false,
      align: 'right',
      alwaysVisible: true,
      renderCell: (row: ProductDto) => (
        <RowActions>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Stock policy by location for ${row.name}`}
                onClick={() => setLocationsFor(row)}
              >
                <WarehouseIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stock policy by location</TooltipContent>
          </Tooltip>
          {canWrite && (
            <>
              <EditAction label={row.name} onClick={() => setEditing(row)} />
              <DeleteAction
                label={row.name}
                tooltip="Delete — refused once the product has movement history"
                onClick={() => setDeleting(row)}
              />
            </>
          )}
        </RowActions>
      ),
    },
  ];

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      notify.success('Product deleted.');
    } catch (err) {
      notify.fromError(err);
    }
    setDeleting(null);
  }

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
            <SelectField
              label="Kind"
              value={kind}
              onChange={(next) => {
                setKind(next);
                setPage(1);
              }}
              emptyLabel="All kinds"
              options={enumOptions(ProductKind)}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
              emptyLabel="All statuses"
              options={enumOptions(MasterStatus)}
            />
            <CheckboxField
              label="Purchasable only"
              checked={purchasableOnly}
              onCheckedChange={(checked) => {
                setPurchasableOnly(checked);
                setPage(1);
              }}
            />
            <CheckboxField
              label="Stocked only"
              checked={stockedOnly}
              onCheckedChange={(checked) => {
                setStockedOnly(checked);
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
              label="At or below reorder level"
              helperText="What a requirement would be raised from."
              checked={belowReorderLevel}
              onCheckedChange={(checked) => {
                setBelowReorderLevel(checked);
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
        {...(canWrite ? { onCreate: () => setEditing(null), createLabel: 'New product' } : {})}
      />

      {isError ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
          <p className="text-sm font-medium">Products could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : view === 'table' ? (
        <DataTable
          gridId="purchase-products"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onRowDoubleClick={canWrite ? (row) => setEditing(row) : undefined}
          emptyTitle="No products yet"
          emptyMessage="Add the goods, services and expenses a supplier bill can be written against."
          {...(canWrite
            ? { emptyAction: { label: 'New product', onClick: () => setEditing(null) } }
            : {})}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onCardDoubleClick={canWrite ? (row) => setEditing(row) : undefined}
          emptyTitle="No products yet"
          emptyMessage="Add the goods a supplier bill can be written against."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold">{row.name}</p>
                <StatusChip status={row.status} />
              </div>
              <p className="text-muted-foreground text-xs">
                {dash(row.code)} · {dash(row.categoryName)}
              </p>
              <p className="text-muted-foreground text-xs">
                {row.purchaseUomCode && row.stockUomCode
                  ? `1 ${row.purchaseUomCode} = ${row.purchaseConversionFactor} ${row.stockUomCode}`
                  : `Stocked in ${dash(row.stockUomCode ?? row.unit)}`}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{row.kind}</Badge>
                {row.isBatchTracked && <Badge variant="secondary">{row.batchIssuePolicy}</Badge>}
                {row.isExpiryTracked && <Badge variant="outline">Expiry</Badge>}
                {row.reorderLevel !== null && (
                  <Badge variant="outline">Reorder {row.reorderLevel}</Badge>
                )}
              </div>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <ProductFormModal
          open
          editing={editing}
          canWrite={canWrite}
          onClose={() => setEditing(undefined)}
        />
      )}

      {/* The per-location levels are reachable without opening the whole product form — a store
          manager adjusting one shelf's reorder point should not have to scroll past its tax
          treatment to get there. */}
      <Sheet open={locationsFor !== null} onOpenChange={(next) => !next && setLocationsFor(null)}>
        <SheetContent side="right" className="w-[560px] sm:max-w-[560px]">
          <SheetHeader>
            <SheetTitle>{locationsFor?.name ?? 'Product'}</SheetTitle>
            <SheetDescription>
              Minimum, reorder and maximum levels held separately per store.
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-4 pb-4">
            {locationsFor && (
              <ProductLocationsPanel productId={locationsFor.id} canWrite={canWrite} />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete product"
        message={`Delete "${deleting?.name}"? A product that already appears on a purchase or in the stock ledger cannot be removed — set it INACTIVE instead.`}
        confirmLabel="Delete"
        danger
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
