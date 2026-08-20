import { useMemo, useState } from 'react';
import {
  Capability,
  MasterStatus,
  UomDimension,
  type UomDto,
} from '@menuboard/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { StatusChip } from '../../components/StatusChip';
import { useAuth } from '../../services/AuthContext';
import { useDeleteUom, useUoms } from '../../hooks/usePurchase';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { UomFormModal } from './UomFormModal';

/** Dimensions read in a fixed order so the grouped list never reshuffles between pages. */
const DIMENSION_ORDER: UomDimension[] = [
  UomDimension.WEIGHT,
  UomDimension.VOLUME,
  UomDimension.COUNT,
  UomDimension.LENGTH,
  UomDimension.PACK,
];

export function UomsTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canWrite = hasCapability(Capability.UOM_MANAGE);

  const [search, setSearch] = useState('');
  const [dimension, setDimension] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('purchase-uoms');
  const [editing, setEditing] = useState<UomDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<UomDto | null>(null);

  const query = useMemo(
    () => ({
      search: search || undefined,
      dimension: (dimension || undefined) as UomDimension | undefined,
      status: (status || undefined) as MasterStatus | undefined,
      page,
      pageSize,
    }),
    [search, dimension, status, page, pageSize],
  );

  const { data, isLoading, isError, refetch } = useUoms(query);
  const remove = useDeleteUom();

  const filterCount = (dimension ? 1 : 0) + (status ? 1 : 0);
  const filtered = filterCount > 0 || search.trim() !== '';

  /** Grouped by dimension, base unit first — the order somebody reads a unit table in. */
  const rows = useMemo(() => {
    const items = data?.items ?? [];
    return [...items].sort((a, b) => {
      const byDimension =
        DIMENSION_ORDER.indexOf(a.dimension) - DIMENSION_ORDER.indexOf(b.dimension);
      if (byDimension !== 0) return byDimension;
      if (a.isBase !== b.isBase) return a.isBase ? -1 : 1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.code.localeCompare(b.code);
    });
  }, [data?.items]);

  const columns: DataTableColumn<UomDto>[] = [
    { field: 'code', headerName: 'Code', width: 110 },
    { field: 'name', headerName: 'Name', width: 200 },
    {
      field: 'dimension',
      headerName: 'Dimension',
      width: 130,
      valueGetter: (row) => row.dimension,
    },
    {
      field: 'isBase',
      headerName: 'Base',
      width: 90,
      renderCell: (row) =>
        row.isBase ? (
          <Badge variant="secondary">Base</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      field: 'factorToBase',
      headerName: 'Factor to base',
      width: 130,
      align: 'right',
      valueGetter: (row) => row.factorToBase,
    },
    {
      field: 'decimalPlaces',
      headerName: 'Decimals',
      width: 100,
      align: 'right',
      valueGetter: (row) => row.decimalPlaces,
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
            renderCell: (row: UomDto) => (
              <RowActions>
                <EditAction label={row.code} onClick={() => setEditing(row)} />
                <DeleteAction
                  label={row.code}
                  tooltip="Delete — refused when a product is measured in this unit"
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
      notify.success('Unit deleted.');
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
          setDimension('');
          setStatus('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Dimension"
              value={dimension}
              onChange={(next) => {
                setDimension(next);
                setPage(1);
              }}
              emptyLabel="All dimensions"
              options={enumOptions(UomDimension)}
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
        {...(canWrite ? { onCreate: () => setEditing(null), createLabel: 'New unit' } : {})}
      />

      {isError ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
          <p className="text-sm font-medium">Units of measure could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : view === 'table' ? (
        <DataTable
          gridId="purchase-uoms"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onRowDoubleClick={canWrite ? (row) => setEditing(row) : undefined}
          emptyTitle="No units of measure yet"
          emptyMessage="Add the units goods are bought and stocked in, one base unit per dimension."
          {...(canWrite ? { emptyAction: { label: 'New unit', onClick: () => setEditing(null) } } : {})}
        />
      ) : (
        <EntityCardGrid
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onCardDoubleClick={canWrite ? (row) => setEditing(row) : undefined}
          emptyTitle="No units of measure yet"
          emptyMessage="Add the units goods are bought and stocked in."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold">{row.code}</p>
                <StatusChip status={row.status} />
              </div>
              <p className="text-muted-foreground truncate text-sm">{row.name}</p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{row.dimension}</Badge>
                {row.isBase ? (
                  <Badge variant="secondary">Base</Badge>
                ) : (
                  <Badge variant="outline">× {row.factorToBase}</Badge>
                )}
                <Badge variant="outline">{row.decimalPlaces} dp</Badge>
              </div>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <UomFormModal
          open
          editing={editing}
          canWrite={canWrite}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete unit of measure"
        message={`Delete "${deleting?.code}"? A unit already used by a product cannot be removed — deactivate it instead.`}
        confirmLabel="Delete"
        danger
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
