import { useMemo, useState } from 'react';
import {
  Capability,
  InventoryLocationKind,
  MasterStatus,
  STOCK_HOLDING_LOCATION_KINDS,
  type InventoryLocationDto,
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
import {
  useDeleteInventoryLocation,
  useInventoryLocations,
} from '../../hooks/usePurchase';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { enumOptions, humanise, toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { InventoryLocationFormModal } from './InventoryLocationFormModal';

/**
 * Direct consumption is the one kind that never carries a balance, so it is drawn apart from
 * the stores rather than reading as one more shelf in the list.
 */
function KindChip({ kind }: { kind: InventoryLocationKind }): JSX.Element {
  const holdsStock = STOCK_HOLDING_LOCATION_KINDS.includes(kind);
  return (
    <span
      title={holdsStock ? undefined : 'Expensed on arrival — never holds a balance'}
      className={cn(
        'inline-flex items-center rounded-sm border px-1.5 py-0.5 whitespace-nowrap',
        'text-[0.7188rem] leading-none font-semibold tracking-[0.01em]',
        holdsStock ? TONE_CHIP_CLASS.neutral : TONE_CHIP_CLASS.progress,
      )}
    >
      {humanise(kind)}
    </span>
  );
}

function YesNo({ on, label }: { on: boolean; label: string }): JSX.Element {
  return on ? (
    <Badge variant="secondary">{label}</Badge>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

export function InventoryLocationsTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canWrite = hasCapability(Capability.INVENTORY_LOCATION_MANAGE);

  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [parentId, setParentId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('purchase-locations');
  const [editing, setEditing] = useState<InventoryLocationDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<InventoryLocationDto | null>(null);

  const query = useMemo(
    () => ({
      search: search || undefined,
      kind: (kind || undefined) as InventoryLocationKind | undefined,
      parentId: parentId || undefined,
      status: (status || undefined) as MasterStatus | undefined,
      page,
      pageSize,
    }),
    [search, kind, parentId, status, page, pageSize],
  );

  const { data, isLoading, isError, refetch } = useInventoryLocations(query);
  const { data: parentOptions } = useInventoryLocations({ page: 1, pageSize: 100 });
  const remove = useDeleteInventoryLocation();

  const filterCount = (kind ? 1 : 0) + (parentId ? 1 : 0) + (status ? 1 : 0);
  const filtered = filterCount > 0 || search.trim() !== '';

  const columns: DataTableColumn<InventoryLocationDto>[] = [
    { field: 'code', headerName: 'Code', width: 120 },
    { field: 'name', headerName: 'Name', width: 220 },
    {
      field: 'kind',
      headerName: 'Kind',
      width: 170,
      renderCell: (row) => <KindChip kind={row.kind} />,
    },
    {
      field: 'parentName',
      headerName: 'Parent',
      width: 180,
      valueGetter: (row) => row.parentName ?? '—',
    },
    {
      field: 'department',
      headerName: 'Department',
      width: 150,
      valueGetter: (row) => row.department ?? '—',
    },
    {
      field: 'isDefaultReceiving',
      headerName: 'Default receiving',
      width: 150,
      renderCell: (row) => <YesNo on={row.isDefaultReceiving} label="Default" />,
    },
    {
      field: 'allowsNegativeStock',
      headerName: 'Allows negative',
      width: 150,
      renderCell: (row) => <YesNo on={row.allowsNegativeStock} label="Allowed" />,
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
            renderCell: (row: InventoryLocationDto) => (
              <RowActions>
                <EditAction label={row.name} onClick={() => setEditing(row)} />
                <DeleteAction
                  label={row.name}
                  tooltip="Delete — refused once stock has moved through this location"
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
      notify.success('Location deleted.');
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
          setKind('');
          setParentId('');
          setStatus('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Kind"
              value={kind}
              onChange={(next) => {
                setKind(next);
                setPage(1);
              }}
              emptyLabel="All kinds"
              options={enumOptions(InventoryLocationKind)}
            />
            <SelectField
              label="Parent location"
              value={parentId}
              onChange={(next) => {
                setParentId(next);
                setPage(1);
              }}
              emptyLabel="Any parent"
              options={toOptions(
                parentOptions?.items ?? [],
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
        {...(canWrite ? { onCreate: () => setEditing(null), createLabel: 'New location' } : {})}
      />

      {isError ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
          <p className="text-sm font-medium">Inventory locations could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : view === 'table' ? (
        <DataTable
          gridId="purchase-locations"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onRowDoubleClick={canWrite ? (row) => setEditing(row) : undefined}
          emptyTitle="No inventory locations yet"
          emptyMessage="Add the warehouses, day stores and kitchens goods are received into and issued from."
          {...(canWrite
            ? { emptyAction: { label: 'New location', onClick: () => setEditing(null) } }
            : {})}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtered}
          onCardDoubleClick={canWrite ? (row) => setEditing(row) : undefined}
          emptyTitle="No inventory locations yet"
          emptyMessage="Add the warehouses, day stores and kitchens goods move through."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold">{row.name}</p>
                <StatusChip status={row.status} />
              </div>
              <p className="text-muted-foreground text-xs">
                {row.code}
                {row.parentName ? ` · under ${row.parentName}` : ''}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <KindChip kind={row.kind} />
                {row.isDefaultReceiving && <Badge variant="secondary">Default receiving</Badge>}
                {row.allowsNegativeStock && <Badge variant="outline">Negative allowed</Badge>}
              </div>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <InventoryLocationFormModal
          open
          editing={editing}
          canWrite={canWrite}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete inventory location"
        message={`Delete "${deleting?.name}"? A location that stock has already moved through cannot be removed — deactivate it instead.`}
        confirmLabel="Delete"
        danger
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
