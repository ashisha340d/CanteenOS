import { useMemo, useState } from 'react';
import { Capability, EntityType, MasterStatus, type EntityDto } from '@menuboard/shared';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { StatusChip } from '../../components/StatusChip';
import { useAuth } from '../../services/AuthContext';
import { useDeleteEntity, useEntities, useUpdateEntity } from '../../hooks/useEntities';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { EntityFormModal } from './EntityFormModal';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const discountLabel = (value: number): string =>
  value > 0 ? `${Number(value).toFixed(2).replace(/\.00$/, '')}%` : '—';

export function EntitiesPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canWrite = hasCapability(Capability.ENTITY_WRITE);

  const [search, setSearch] = useState('');
  const [type, setType] = useState<EntityType | ''>('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('entities');
  const [editing, setEditing] = useState<EntityDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<EntityDto | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{ item: EntityDto; message: string } | null>(
    null,
  );

  const query = useMemo(
    () => ({
      search: search || undefined,
      type: type || undefined,
      status: status || undefined,
      page,
      pageSize,
    }),
    [search, type, status, page, pageSize],
  );
  const { data, isLoading } = useEntities(query);
  const del = useDeleteEntity();
  const update = useUpdateEntity();
  const filtersActive = Boolean(type) || Boolean(status) || search.trim() !== '';

  const columns: DataTableColumn<EntityDto>[] = [
    {
      field: 'code',
      headerName: 'Code',
      width: 130,
      renderCell: (r) => <span className="font-mono text-sm">{r.code}</span>,
    },
    { field: 'name', headerName: 'Name', width: 220 },
    {
      field: 'type',
      headerName: 'Type',
      width: 130,
      renderCell: (r) => (
        <Badge variant="outline" className="text-[0.625rem]">
          {r.type}
        </Badge>
      ),
    },
    { field: 'phone', headerName: 'Phone', width: 150, valueGetter: (r) => r.phone ?? '—' },
    {
      field: 'department',
      headerName: 'Department',
      width: 170,
      valueGetter: (r) => r.department ?? '—',
    },
    {
      field: 'discountPercent',
      headerName: 'Discount %',
      width: 120,
      align: 'right',
      valueGetter: (r) => discountLabel(r.discountPercent),
    },
    {
      field: 'creditLimit',
      headerName: 'Credit limit',
      width: 140,
      align: 'right',
      valueGetter: (r) => currency.format(r.creditLimit),
    },
    {
      field: 'accountBalance',
      headerName: 'Account balance',
      width: 160,
      align: 'right',
      renderCell: (r) => (
        <span
          className={cn(
            'tabular-nums',
            // A positive balance is money owed to the operation, not a neutral figure.
            r.accountBalance > 0 ? 'text-tone-danger font-medium' : 'text-muted-foreground',
          )}
        >
          {currency.format(r.accountBalance)}
        </span>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 110,
      renderCell: (r) => <StatusChip status={r.status} />,
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
            renderCell: (r: EntityDto) => (
              <RowActions>
                <EditAction label={r.name} onClick={() => setEditing(r)} />
                <DeleteAction
                  label={r.name}
                  tooltip="Delete — refused once a POS order has been raised in this name"
                  onClick={() => setDeleting(r)}
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
      await del.mutateAsync(deleting.id);
      notify.success('Entity deleted.');
      setDeleting(null);
    } catch (err) {
      const readable = readError(err);
      setDeleting(null);
      if (readable.code === 'CONFLICT') {
        setDeleteBlocked({ item: deleting, message: readable.message });
      } else {
        notify.error(readable.message);
      }
    }
  }

  async function setInactiveInstead(): Promise<void> {
    if (!deleteBlocked) return;
    try {
      await update.mutateAsync({
        id: deleteBlocked.item.id,
        body: { status: MasterStatus.INACTIVE },
      });
      notify.success('Entity set to INACTIVE.');
      setDeleteBlocked(null);
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <>
      {/* Creation lives in the toolbar below, beside the list controls it applies to, the same
          as every other listing page — it used to be duplicated here as well. */}
      <PageHeader
        eyebrow="Counter"
        title="Entities"
        subtitle="Customers, employees, vendors and anyone else a bill is raised for, held in one master — the same person can be an employee taking a subsidised meal and a customer at the counter."
      />

      <ListToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        activeFilterCount={(type ? 1 : 0) + (status ? 1 : 0)}
        onClearFilters={() => {
          setType('');
          setStatus('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Type"
              value={type}
              onChange={(v) => {
                setType(v as EntityType | '');
                setPage(1);
              }}
              emptyLabel="All types"
              options={enumOptions(EntityType)}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(v) => {
                setStatus(v as MasterStatus | '');
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
        {...(canWrite ? { onCreate: () => setEditing(null), createLabel: 'New entity' } : {})}
      />

      {view === 'table' ? (
        <DataTable
          gridId="entities"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={canWrite ? (r) => setEditing(r) : undefined}
          filtered={filtersActive}
          emptyTitle="No entities yet"
          emptyMessage="An entity is any party the operation deals with — a customer at the counter, an employee taking a subsidised meal, a vendor being paid out. Register one so orders can be raised in their name."
          {...(canWrite ? { emptyAction: { label: 'New entity', onClick: () => setEditing(null) } } : {})}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={canWrite ? (r) => setEditing(r) : undefined}
          filtered={filtersActive}
          emptyTitle="No entities yet"
          emptyMessage="An entity is any party the operation deals with — a customer, an employee, a vendor. Register one so orders can be raised in their name."
          {...(canWrite ? { emptyAction: { label: 'New entity', onClick: () => setEditing(null) } } : {})}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">{r.name}</p>
                <StatusChip status={r.status} />
              </div>
              <p className="text-muted-foreground text-sm">
                <span className="font-mono">{r.code}</span> · {r.type}
              </p>
              <p className="text-muted-foreground flex-1 text-sm">{r.phone ?? 'No phone'}</p>
              <p className="text-xs">
                <span className="text-muted-foreground">
                  Discount {discountLabel(r.discountPercent)} · Balance{' '}
                </span>
                <span
                  className={cn(
                    'tabular-nums',
                    r.accountBalance > 0
                      ? 'text-tone-danger font-medium'
                      : 'text-muted-foreground',
                  )}
                >
                  {currency.format(r.accountBalance)}
                </span>
              </p>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <EntityFormModal
          open={editing !== undefined}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete entity"
        message={`Delete "${deleting?.name}"? This is refused once a POS order has been raised in their name — deactivate them instead so the order history keeps resolving.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteBlocked)}
        title="Cannot delete this entity"
        message={`${deleteBlocked?.message ?? ''}\n\nThis entity appears on one or more POS orders and cannot be hard-deleted. You can set it to INACTIVE instead, which keeps it off the counter's pickers while preserving the order history.`}
        confirmLabel="Set INACTIVE instead"
        loading={update.isPending}
        onConfirm={setInactiveInstead}
        onCancel={() => setDeleteBlocked(null)}
      />
    </>
  );
}
