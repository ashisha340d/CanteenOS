import { useMemo, useState } from 'react';
import { MasterStatus, type ModifierGroupDto } from '@menuboard/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { useDeleteModifierGroup, useModifierGroups, useUpdateModifierGroup } from '../../hooks/useMenuMaster';
import { enumOptions, humanise } from '@/lib/options';
import { notify } from '@/lib/notify';
import { ModifierGroupFormModal } from './ModifierGroupFormModal';
import { ModifiersModal } from './ModifiersModal';

export function ModifierGroupsPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('modifier-groups');
  const [editing, setEditing] = useState<ModifierGroupDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ModifierGroupDto | null>(null);
  const [managing, setManaging] = useState<ModifierGroupDto | null>(null);

  const query = useMemo(
    () => ({ search: search || undefined, status: status || undefined, page, pageSize }),
    [search, status, page, pageSize],
  );
  const { data, isLoading } = useModifierGroups(query);
  const del = useDeleteModifierGroup();
  const reorder = useUpdateModifierGroup();
  const filtersActive = Boolean(status) || search.trim() !== '';

  const managingLive = managing ? (data?.items.find((g) => g.id === managing.id) ?? managing) : null;

  const columns: DataTableColumn<ModifierGroupDto>[] = [
    { field: 'name', headerName: 'Name', width: 200 },
    {
      field: 'selectionType',
      headerName: 'Selection',
      width: 110,
      renderCell: (r) => humanise(r.selectionType),
    },
    { field: 'sortOrder', headerName: 'Order', width: 90, align: 'right' },
    {
      field: 'modifiers',
      headerName: 'Modifiers',
      width: 130,
      sortable: false,
      renderCell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => setManaging(r)}>
          {r.modifiers?.length ?? 0} item{r.modifiers?.length === 1 ? '' : 's'}
        </Button>
      ),
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
          <DeleteAction label={r.name} onClick={() => setDeleting(r)} />
        </RowActions>
      ),
    },
  ];

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      notify.success('Modifier group deleted.');
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
        title="Menu Modifiers"
        subtitle="Choices offered on top of an item — extra cheese, no onion, size upgrade — grouped by the question they answer."
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
        createLabel="New modifier group"
      />

      {view === 'table' ? (
        <DataTable
          gridId="modifier-groups"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => setManaging(r)}
          rowReorder
          onRowReorder={onRowReorder}
          filtered={filtersActive}
          emptyTitle="No modifier groups yet"
          emptyMessage="e.g. Extra Cheese, No Onion, Toppings, Size Upgrade — assignable to a menu item or variant."
          emptyAction={{ label: 'New modifier group', onClick: () => setEditing(null) }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => setManaging(r)}
          filtered={filtersActive}
          emptyTitle="No modifier groups yet"
          emptyMessage="e.g. Extra Cheese, No Onion, Toppings, Size Upgrade — assignable to a menu item or variant."
          emptyAction={{ label: 'New modifier group', onClick: () => setEditing(null) }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">{r.name}</p>
                <StatusChip status={r.status} />
              </div>
              <p className="text-muted-foreground flex-1 text-sm">
                {r.description ?? 'No description'}
              </p>
              <Badge variant="outline" className="self-start">
                {r.modifiers?.length ?? 0} modifier{r.modifiers?.length === 1 ? '' : 's'}
              </Badge>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <ModifierGroupFormModal
          open={editing !== undefined}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ModifiersModal open={Boolean(managing)} group={managingLive} onClose={() => setManaging(null)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete modifier group"
        message={`Delete "${deleting?.name}"? Its modifiers are removed with it.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
