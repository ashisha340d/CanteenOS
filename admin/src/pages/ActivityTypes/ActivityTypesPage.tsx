import { useMemo, useState } from 'react';
import { MasterStatus, type ActivityTypeDto } from '@menuboard/shared';
import { LockIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import {
  useActivityTypes,
  useDeleteActivityType,
  useUpdateActivityType,
} from '../../hooks/useMasters';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { ActivityTypeFormModal } from './ActivityTypeFormModal';

function SystemBadge(): JSX.Element {
  return (
    <Badge variant="secondary" className="whitespace-nowrap">
      <LockIcon data-icon="inline-start" />
      System
    </Badge>
  );
}

export function ActivityTypesPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('activity-types');
  const [editing, setEditing] = useState<ActivityTypeDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ActivityTypeDto | null>(null);

  const query = useMemo(
    () => ({ search: search || undefined, status: status || undefined, page, pageSize }),
    [search, status, page, pageSize],
  );
  const { data, isLoading } = useActivityTypes(query);
  const del = useDeleteActivityType();
  const reorder = useUpdateActivityType();
  const filtersActive = Boolean(status) || search.trim() !== '';

  const columns: DataTableColumn<ActivityTypeDto>[] = [
    { field: 'name', headerName: 'Name', width: 200 },
    {
      field: 'description',
      headerName: 'Description',
      width: 260,
      valueGetter: (r) => r.description ?? '—',
    },
    { field: 'sortOrder', headerName: 'Order', width: 90, align: 'right' },
    {
      field: 'isSystem',
      headerName: 'System',
      width: 100,
      renderCell: (r) => (r.isSystem ? <SystemBadge /> : '—'),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 110,
      renderCell: (r) => <StatusChip status={r.status} />,
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 100,
      sortable: false,
      align: 'right',
      alwaysVisible: true,
      renderCell: (r) => (
        <RowActions>
          <EditAction label={r.name} onClick={() => setEditing(r)} />
          <DeleteAction
            label={r.name}
            disabled={r.isSystem}
            tooltip={
              r.isSystem
                ? 'System-seeded types cannot be deleted — deactivate instead'
                : 'Delete'
            }
            onClick={() => setDeleting(r)}
          />
        </RowActions>
      ),
    },
  ];

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      notify.success('Activity type deleted.');
      setDeleting(null);
    } catch (err) {
      notify.fromError(err);
      setDeleting(null);
    }
  }

  async function onRowReorder(orderedIds: string[]): Promise<void> {
    const rows = data?.items ?? [];
    await Promise.all(
      orderedIds.map((id, index) => {
        const row = rows.find((r) => r.id === id);
        if (!row || row.sortOrder === index) return Promise.resolve();
        return reorder.mutateAsync({ id, body: { sortOrder: index } });
      }),
    );
  }

  return (
    <>
      <PageHeader
        title="Activity types"
        subtitle="The kinds of service an order can be for — breakfast, lunch, a function."
      />
      <ListToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        activeFilterCount={status ? 1 : 0}
        onClearFilters={() => {
          setStatus('');
          setPage(1);
        }}
        filters={
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
        onCreate={() => setEditing(null)}
        createLabel="New activity type"
      />

      {view === 'table' ? (
        <DataTable
          gridId="activity-types"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => setEditing(r)}
          rowReorder
          onRowReorder={onRowReorder}
          filtered={filtersActive}
          emptyTitle="No activity types yet"
          emptyMessage="Define the kinds of service your operation runs."
          emptyAction={{ label: 'New activity type', onClick: () => setEditing(null) }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => setEditing(r)}
          filtered={filtersActive}
          emptyTitle="No activity types yet"
          emptyMessage="Define the kinds of service your operation runs."
          emptyAction={{ label: 'New activity type', onClick: () => setEditing(null) }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">{r.name}</p>
                <StatusChip status={r.status} />
              </div>
              <p className="text-muted-foreground flex-1 text-sm">
                {r.description ?? 'No description'}
              </p>
              {r.isSystem && (
                <div className="self-start">
                  <SystemBadge />
                </div>
              )}
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <ActivityTypeFormModal
          open={editing !== undefined}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete activity type"
        message={`Delete "${deleting?.name}"?`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
