import { useMemo, useState } from 'react';
import { MasterStatus, type MenuDto } from '@menuboard/shared';
import { useNavigate } from 'react-router-dom';
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
import {
  useDeleteMenu,
  useMenus,
  usePublishMenu,
  useUnpublishMenu,
  useUpdateMenu,
} from '../../hooks/useMenuMaster';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { MenuFormModal } from './MenuFormModal';

export function MenusPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('menus');
  const [editing, setEditing] = useState<MenuDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<MenuDto | null>(null);

  const query = useMemo(
    () => ({ search: search || undefined, status: status || undefined, page, pageSize }),
    [search, status, page, pageSize],
  );
  const { data, isLoading } = useMenus(query);
  const del = useDeleteMenu();
  const reorder = useUpdateMenu();
  const publish = usePublishMenu();
  const unpublish = useUnpublishMenu();
  const filtersActive = Boolean(status) || search.trim() !== '';

  async function togglePublish(menu: MenuDto): Promise<void> {
    try {
      if (menu.publishedAt) {
        await unpublish.mutateAsync(menu.id);
        notify.success(`${menu.name} unpublished.`);
      } else {
        await publish.mutateAsync(menu.id);
        notify.success(`${menu.name} published.`);
      }
    } catch (err) {
      notify.fromError(err);
    }
  }

  const columns: DataTableColumn<MenuDto>[] = [
    { field: 'code', headerName: 'Code', width: 140 },
    { field: 'name', headerName: 'Name', width: 200 },
    {
      field: 'description',
      headerName: 'Description',
      width: 260,
      valueGetter: (r) => r.description ?? '—',
    },
    { field: 'priority', headerName: 'Priority', width: 90, align: 'right' },
    {
      field: 'publishedAt',
      headerName: 'Published',
      width: 110,
      renderCell: (r) => (
        <Badge variant={r.publishedAt ? 'secondary' : 'outline'}>
          {r.publishedAt ? 'Published' : 'Draft'}
        </Badge>
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
      width: 170,
      sortable: false,
      align: 'right',
      alwaysVisible: true,
      renderCell: (r) => (
        <RowActions>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/menus/${r.id}`)}>
            Manage
          </Button>
          <Button variant="ghost" size="sm" onClick={() => togglePublish(r)}>
            {r.publishedAt ? 'Unpublish' : 'Publish'}
          </Button>
          <EditAction label={r.name} onClick={() => setEditing(r)} />
          <DeleteAction
            label={r.name}
            tooltip="Delete — refused while categories or items are assigned"
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
      notify.success('Menu deleted.');
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
        title="Menu Catalogue"
        subtitle="Published menus and what each one prices. An item lives in the master file once; a menu decides whether it is offered and at what price."
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
        createLabel="New menu"
      />

      {view === 'table' ? (
        <DataTable
          gridId="menus"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => navigate(`/menus/${r.id}`)}
          rowReorder
          onRowReorder={onRowReorder}
          filtered={filtersActive}
          emptyTitle="No menus yet"
          emptyMessage="Create a menu (e.g. VSK, PUBLIC, SATSANGEE) to start assigning categories and items to it."
          emptyAction={{ label: 'New menu', onClick: () => setEditing(null) }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => navigate(`/menus/${r.id}`)}
          filtered={filtersActive}
          emptyTitle="No menus yet"
          emptyMessage="Create a menu (e.g. VSK, PUBLIC, SATSANGEE) to start assigning categories and items to it."
          emptyAction={{ label: 'New menu', onClick: () => setEditing(null) }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="min-w-0 truncate text-[0.9375rem] leading-snug font-semibold">
                    {r.name}
                  </p>
                  <p className="text-muted-foreground text-xs">{r.code}</p>
                </div>
                <StatusChip status={r.status} />
              </div>
              <p className="text-muted-foreground flex-1 text-sm">
                {r.description ?? 'No description'}
              </p>
              <Badge variant={r.publishedAt ? 'secondary' : 'outline'} className="self-start">
                {r.publishedAt ? 'Published' : 'Draft'}
              </Badge>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <MenuFormModal
          open={editing !== undefined}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete menu"
        message={`Delete "${deleting?.name}"? This is refused while it still has categories or items assigned.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
