import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Capability,
  EQUIPMENT_STATUS_LABELS,
  EquipmentStatus,
  WarrantyStatus,
  type EquipmentDto,
} from '@menuboard/shared';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { PageHeader } from '@/components/ui/PageHeader';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { useAuth } from '../../services/AuthContext';
import {
  useDeleteEquipment,
  useEquipmentCategories,
  useEquipmentList,
  useEquipmentFloors,
} from '../../hooks/useEquipment';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { dueLabel, EQUIPMENT_STATUS_TONE, formatDate, WARRANTY_TONE } from './equipmentTone';
import { EquipmentFormModal } from './EquipmentFormModal';

function StatusPill({ status }: { status: EquipmentStatus }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold whitespace-nowrap',
        TONE_CHIP_CLASS[EQUIPMENT_STATUS_TONE[status]],
      )}
    >
      {EQUIPMENT_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The asset register.
 *
 * Ordered most-broken-first by the server, so the row that needs somebody is the row at the
 * top. Retired assets are excluded unless a status filter asks for them.
 */
export function EquipmentListPage(): JSX.Element {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { hasCapability } = useAuth();
  const canCreate = hasCapability(Capability.EQUIPMENT_CREATE);
  const canEdit = hasCapability(Capability.EQUIPMENT_EDIT);
  const canDelete = hasCapability(Capability.EQUIPMENT_DELETE);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>(params.get('status') ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [warrantyStatus, setWarrantyStatus] = useState<string>(params.get('warrantyStatus') ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('equipment');
  const [editing, setEditing] = useState<EquipmentDto | null>(null);
  const [formOpen, setFormOpen] = useState(params.get('register') === '1');
  const [deleting, setDeleting] = useState<EquipmentDto | null>(null);

  // The dashboard links here with a filter already chosen; consuming it once keeps the URL
  // shareable without it fighting the local state afterwards.
  useEffect(() => {
    if (params.size > 0) setParams({}, { replace: true });
  }, [params, setParams]);

  const query = useMemo(
    () => ({
      search: search || undefined,
      status: (status || undefined) as EquipmentStatus | undefined,
      categoryId: categoryId || undefined,
      floorId: floorId || undefined,
      warrantyStatus: (warrantyStatus || undefined) as WarrantyStatus | undefined,
      page,
      pageSize,
    }),
    [search, status, categoryId, floorId, warrantyStatus, page, pageSize],
  );

  const { data, isLoading } = useEquipmentList(query);
  const { data: categories } = useEquipmentCategories();
  const { data: floors } = useEquipmentFloors();
  const remove = useDeleteEquipment();

  const filterCount =
    (status ? 1 : 0) + (categoryId ? 1 : 0) + (floorId ? 1 : 0) + (warrantyStatus ? 1 : 0);
  const filtersActive = filterCount > 0 || search.trim() !== '';

  const columns: DataTableColumn<EquipmentDto>[] = [
    { field: 'assetId', headerName: 'Asset ID', width: 160 },
    { field: 'name', headerName: 'Equipment', width: 220 },
    {
      field: 'categoryName',
      headerName: 'Category',
      width: 150,
      valueGetter: (row) => row.categoryName ?? '—',
    },
    {
      field: 'locationPath',
      headerName: 'Location',
      width: 240,
      valueGetter: (row) => row.locationPath ?? '—',
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 150,
      renderCell: (row) => <StatusPill status={row.status} />,
    },
    {
      field: 'openTicketCount',
      headerName: 'Open',
      width: 90,
      align: 'right',
      valueGetter: (row) => row.openTicketCount,
    },
    {
      field: 'nextMaintenanceAt',
      headerName: 'Next service',
      width: 160,
      valueGetter: (row) => dueLabel(row.maintenanceDaysUntilDue),
    },
    {
      field: 'warrantyStatus',
      headerName: 'Warranty',
      width: 150,
      renderCell: (row) => (
        <span
          className={cn(
            'inline-flex rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
            TONE_CHIP_CLASS[WARRANTY_TONE[row.warrantyStatus]],
          )}
        >
          {row.warrantyStatus === 'UNKNOWN' ? 'Not recorded' : formatDate(row.warrantyExpiry)}
        </span>
      ),
    },
    ...(canEdit || canDelete
      ? [
          {
            field: 'actions',
            headerName: 'Actions',
            width: 100,
            sortable: false,
            align: 'right' as const,
            alwaysVisible: true,
            renderCell: (row: EquipmentDto) => (
              <RowActions>
                {canEdit && (
                  <EditAction
                    label={row.name}
                    onClick={() => {
                      setEditing(row);
                      setFormOpen(true);
                    }}
                  />
                )}
                {canDelete && (
                  <DeleteAction
                    label={row.name}
                    disabled={row.openTicketCount > 0}
                    tooltip={
                      row.openTicketCount > 0
                        ? 'Close its open tickets first'
                        : 'Delete — erases its maintenance history'
                    }
                    onClick={() => setDeleting(row)}
                  />
                )}
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
      notify.success('Equipment deleted.');
    } catch (err) {
      notify.fromError(err);
    }
    setDeleting(null);
  }

  return (
    <>
      <PageHeader
        eyebrow="Equipment"
        title="Equipment"
        subtitle="Every asset on site, worst first. Retired equipment is hidden until you filter for it."
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <PlusIcon data-icon="inline-start" />
              Register equipment
            </Button>
          ) : null
        }
      />

      <ListToolbar
        search={search}
        onSearchChange={(next) => {
          setSearch(next);
          setPage(1);
        }}
        activeFilterCount={filterCount}
        onClearFilters={() => {
          setStatus('');
          setCategoryId('');
          setFloorId('');
          setWarrantyStatus('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Status"
              value={status}
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
              emptyLabel="All statuses"
              options={enumOptions(EquipmentStatus)}
            />
            <SelectField
              label="Category"
              value={categoryId}
              onChange={(next) => {
                setCategoryId(next);
                setPage(1);
              }}
              emptyLabel="All categories"
              options={(categories ?? []).map((category) => ({
                value: category.id,
                label: category.name,
              }))}
            />
            <SelectField
              label="Floor"
              value={floorId}
              onChange={(next) => {
                setFloorId(next);
                setPage(1);
              }}
              emptyLabel="Every floor"
              options={(floors ?? []).map((floor) => ({ value: floor.id, label: floor.name }))}
            />
            <SelectField
              label="Warranty"
              value={warrantyStatus}
              onChange={(next) => {
                setWarrantyStatus(next);
                setPage(1);
              }}
              emptyLabel="Any warranty state"
              options={enumOptions(WarrantyStatus)}
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
        {...(canCreate
          ? {
              onCreate: () => {
                setEditing(null);
                setFormOpen(true);
              },
              createLabel: 'Register',
            }
          : {})}
      />

      {view === 'table' ? (
        <DataTable
          gridId="equipment"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtersActive}
          onRowDoubleClick={(row) => navigate(`/equipment/assets/${row.id}`)}
          emptyTitle="No equipment registered"
          emptyMessage="Photograph a machine's rating plate and the server reads the make, model and serial off it."
          {...(canCreate
            ? {
                emptyAction: {
                  label: 'Register equipment',
                  onClick: () => {
                    setEditing(null);
                    setFormOpen(true);
                  },
                },
              }
            : {})}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtersActive}
          onCardClick={(row) => navigate(`/equipment/assets/${row.id}`)}
          emptyTitle="No equipment registered"
          emptyMessage="Photograph a machine's rating plate and the server reads the make, model and serial off it."
          renderCard={(row) => (
            <div className="flex h-full gap-3">
              <div className="bg-muted size-16 shrink-0 overflow-hidden rounded-md">
                {row.imageUrl !== null && (
                  <img src={row.imageUrl} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-[0.9375rem] font-semibold">{row.name}</p>
                  <StatusPill status={row.status} />
                </div>
                <p className="text-muted-foreground font-mono text-xs">{row.assetId}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {row.locationPath ?? 'No location'}
                </p>
                <p className="text-muted-foreground mt-auto text-xs">
                  {row.openTicketCount > 0
                    ? `${row.openTicketCount} open ticket${row.openTicketCount === 1 ? '' : 's'}`
                    : dueLabel(row.maintenanceDaysUntilDue)}
                </p>
              </div>
            </div>
          )}
        />
      )}

      <EquipmentFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        editing={editing}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete equipment"
        message={`Delete ${deleting?.assetId} — ${deleting?.name}? Its maintenance history, documents and timeline go with it. Setting the status to Retired keeps the record.`}
        confirmLabel="Delete"
        danger
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
