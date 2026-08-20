import { useMemo, useState } from 'react';
import { MasterStatus, type CounterDto } from '@menuboard/shared';
import { SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { useCounters, useDeleteCounter, useUpdateCounter } from '../../hooks/useMenuMaster';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { CounterFormModal } from './CounterFormModal';

export function CountersPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('counters');
  const [editing, setEditing] = useState<CounterDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<CounterDto | null>(null);

  const query = useMemo(
    () => ({ search: search || undefined, status: status || undefined, page, pageSize }),
    [search, status, page, pageSize],
  );
  const { data, isLoading } = useCounters(query);
  const del = useDeleteCounter();
  const reorder = useUpdateCounter();
  const filtersActive = Boolean(status) || search.trim() !== '';

  const columns: DataTableColumn<CounterDto>[] = [
    { field: 'name', headerName: 'Name', width: 220 },
    { field: 'code', headerName: 'Code', width: 120, valueGetter: (r) => r.code ?? '—' },
    {
      field: 'description',
      headerName: 'Description',
      width: 280,
      valueGetter: (r) => r.description ?? '—',
    },
    { field: 'sortOrder', headerName: 'Order', width: 90, align: 'right' },
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
            tooltip="Delete counter and clear its menu assignments"
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
      notify.success('Counter deleted.');
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
        eyebrow="Menu"
        title="Service Counters"
        subtitle="The points an order is collected from, used to route service and pickup."
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
        createLabel="New counter"
      />

      {view === 'table' ? (
        <DataTable
          gridId="counters"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => setEditing(r)}
          rowReorder
          onRowReorder={onRowReorder}
          filtered={filtersActive}
          emptyTitle="No counters yet"
          emptyMessage="Counters are where a menu item or variant routes for service — e.g. VSK Counter, Main Counter."
          emptyAction={{ label: 'New counter', onClick: () => setEditing(null) }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => setEditing(r)}
          filtered={filtersActive}
          emptyTitle="No counters yet"
          emptyMessage="Counters are where a menu item or variant routes for service — e.g. VSK Counter, Main Counter."
          emptyAction={{ label: 'New counter', onClick: () => setEditing(null) }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">{r.name}</p>
                <StatusChip status={r.status} />
              </div>
              <p className="text-muted-foreground flex-1 text-sm">
                {r.description ?? 'No description'}
              </p>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <CounterFormModal open={editing !== undefined} editing={editing} onClose={() => setEditing(undefined)} />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete counter"
        message={`Delete "${deleting?.name}"? Its menu item and variant assignments will also be removed.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
