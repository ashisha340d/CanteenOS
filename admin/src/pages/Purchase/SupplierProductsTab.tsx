import { useMemo, useState } from 'react';
import {
  Capability,
  MasterStatus,
  type SupplierProductDto,
} from '@menuboard/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { StatusChip } from '../../components/StatusChip';
import { useAuth } from '../../services/AuthContext';
import {
  useDeleteSupplierProduct,
  useProducts,
  useSupplierProducts,
  useVendors,
} from '../../hooks/usePurchase';
import { enumOptions, toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { SupplierProductFormModal } from './SupplierProductFormModal';

const dash = (value: string | null | undefined): string =>
  value === null || value === undefined || value === '' ? '—' : value;

export function SupplierProductsTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canWrite = hasCapability(Capability.SUPPLIER_PRODUCT_MANAGE);
  // The supplier lookup is PURCHASE_READ on the server; a storekeeper reads the mapping
  // without it, so the filter simply offers no suppliers rather than erroring.
  const canReadVendors = hasCapability(Capability.PURCHASE_READ);

  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [productId, setProductId] = useState('');
  const [status, setStatus] = useState('');
  const [preferredOnly, setPreferredOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('purchase-supplier-products');
  const [editing, setEditing] = useState<SupplierProductDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<SupplierProductDto | null>(null);

  const query = useMemo(
    () => ({
      search: search || undefined,
      supplierId: supplierId || undefined,
      productId: productId || undefined,
      status: (status || undefined) as MasterStatus | undefined,
      preferredOnly: preferredOnly || undefined,
      page,
      pageSize,
    }),
    [search, supplierId, productId, status, preferredOnly, page, pageSize],
  );

  const { data, isLoading, isError, refetch } = useSupplierProducts(query);
  const { data: vendors } = useVendors({ page: 1, pageSize: 100 }, canReadVendors);
  const { data: products } = useProducts({ page: 1, pageSize: 100 });
  const remove = useDeleteSupplierProduct();

  const filterCount =
    (supplierId ? 1 : 0) + (productId ? 1 : 0) + (status ? 1 : 0) + (preferredOnly ? 1 : 0);
  const filtered = filterCount > 0 || search.trim() !== '';

  const columns: DataTableColumn<SupplierProductDto>[] = [
    {
      field: 'supplierName',
      headerName: 'Supplier',
      width: 200,
      valueGetter: (row) => dash(row.supplierName),
    },
    {
      field: 'productName',
      headerName: 'Product',
      width: 220,
      valueGetter: (row) => dash(row.productName),
    },
    {
      field: 'supplierSku',
      headerName: 'Supplier SKU',
      width: 140,
      valueGetter: (row) => dash(row.supplierSku),
    },
    {
      field: 'supplierProductName',
      headerName: "Supplier's name",
      width: 220,
      valueGetter: (row) => dash(row.supplierProductName),
    },
    {
      field: 'purchaseUomCode',
      headerName: 'Purchase unit',
      width: 130,
      valueGetter: (row) => dash(row.purchaseUomCode),
    },
    {
      field: 'conversionFactor',
      headerName: 'Conv. factor',
      width: 120,
      align: 'right',
      valueGetter: (row) => row.conversionFactor,
    },
    {
      field: 'lastRate',
      headerName: 'Last rate',
      width: 120,
      align: 'right',
      valueGetter: (row) => (row.lastRate === null ? '—' : row.lastRate),
    },
    {
      field: 'isPreferred',
      headerName: 'Preferred',
      width: 110,
      renderCell: (row) =>
        row.isPreferred ? (
          <Badge variant="secondary">Preferred</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 110,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
    ...(canWrite
      ? [
        {
          field: 'actions',
          headerName: 'Actions',
          width: 100,
          sortable: false,
          align: 'right' as const,
          alwaysVisible: true,
          renderCell: (row: SupplierProductDto) => (
            <RowActions>
              <EditAction label={row.productName ?? 'mapping'} onClick={() => setEditing(row)} />
              <DeleteAction
                label={row.productName ?? 'mapping'}
                onClick={() => setDeleting(row)}
              />
            </RowActions>
          ),
        },
      ]
      : []),
  ];

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      notify.success('Supplier product removed.');
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
        onClearFilters={() => {
          setSupplierId('');
          setProductId('');
          setStatus('');
          setPreferredOnly(false);
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Supplier"
              disabled={!canReadVendors}
              value={supplierId}
              onChange={(next) => {
                setSupplierId(next);
                setPage(1);
              }}
              emptyLabel="All suppliers"
              options={toOptions(
                vendors?.items ?? [],
                (vendor) => vendor.id,
                (vendor) => vendor.name,
              )}
            />
            <SelectField
              label="Product"
              value={productId}
              onChange={(next) => {
                setProductId(next);
                setPage(1);
              }}
              emptyLabel="All products"
              options={toOptions(
                products?.items ?? [],
                (product) => product.id,
                (product) => product.name,
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
              options={enumOptions(MasterStatus)}
            />
            <CheckboxField
              label="Preferred only"
              checked={preferredOnly}
              onCheckedChange={(checked) => {
                setPreferredOnly(checked);
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
        {...(canWrite ? { onCreate: () => setEditing(null), createLabel: 'New mapping' } : {})}
      />

      {isError ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
          <p className="text-sm font-medium">Supplier products could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : view === 'table' ? (
        <DataTable
          gridId="purchase-supplier-products"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onRowDoubleClick={canWrite ? (row) => setEditing(row) : undefined}
          emptyTitle="No supplier products yet"
          emptyMessage="Map a supplier's SKU and pack to your product so a scanned bill resolves without guessing."
          {...(canWrite
            ? { emptyAction: { label: 'New mapping', onClick: () => setEditing(null) } }
            : {})}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onCardDoubleClick={canWrite ? (row) => setEditing(row) : undefined}
          emptyTitle="No supplier products yet"
          emptyMessage="Map a supplier's SKU and pack to your product."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold">
                  {dash(row.productName)}
                </p>
                <StatusChip status={row.status} />
              </div>
              <p className="text-muted-foreground truncate text-xs">{dash(row.supplierName)}</p>
              <p className="text-muted-foreground truncate text-xs">
                {dash(row.supplierSku)} · {dash(row.supplierProductName)}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                {row.purchaseUomCode && (
                  <Badge variant="outline">
                    1 {row.purchaseUomCode} = {row.conversionFactor} {row.productUnit ?? ''}
                  </Badge>
                )}
                {row.lastRate !== null && <Badge variant="outline">Last {row.lastRate}</Badge>}
                {row.isPreferred && <Badge variant="secondary">Preferred</Badge>}
              </div>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <SupplierProductFormModal
          open
          editing={editing}
          canWrite={canWrite}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove supplier product"
        message={`Remove the mapping between ${deleting?.supplierName ?? 'this supplier'} and ${deleting?.productName ?? 'this product'}? Matching will stop resolving their SKU automatically.`}
        confirmLabel="Remove"
        danger
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
