import { useMemo, useState } from 'react';
import { MasterStatus, type MenuItemDto } from '@menuboard/shared';
import { ChefHatIcon } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { BackButton } from '../../components/BackButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { useDeleteMenuItem, useMenuItems, useUpdateMenuItem } from '../../hooks/useMasters';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { MenuItemFormModal } from './MenuItemFormModal';

export function MenuItemsPage(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const categoryId = params.get('categoryId') ?? undefined;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('menu-items');
  const [editing, setEditing] = useState<MenuItemDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<MenuItemDto | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{ item: MenuItemDto; message: string } | null>(
    null,
  );

  const query = useMemo(
    () => ({
      search: search || undefined,
      status: status || undefined,
      categoryId,
      page,
      pageSize,
    }),
    [search, status, categoryId, page, pageSize],
  );
  const { data, isLoading } = useMenuItems(query);
  const del = useDeleteMenuItem();
  const update = useUpdateMenuItem();
  const filtersActive = Boolean(status) || search.trim() !== '';

  const columns: DataTableColumn<MenuItemDto>[] = [
    { field: 'name', headerName: 'Name', width: 220 },
    { field: 'unit', headerName: 'Unit', width: 100 },
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => navigate(`/recipes?menuItemId=${r.id}`)}
                aria-label={`View recipes for ${r.name}`}
              >
                <ChefHatIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View recipes</TooltipContent>
          </Tooltip>
          <EditAction label={r.name} onClick={() => setEditing(r)} />
          <DeleteAction
            label={r.name}
            tooltip="Delete — refused when referenced by orders"
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
      notify.success('Menu item deleted.');
      setDeleting(null);
    } catch (err) {
      const readable = readError(err);
      setDeleting(null);
      // A referenced item cannot be hard-deleted, but deactivating it achieves what the
      // user actually wanted — so offer that rather than just reporting the refusal.
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
      notify.success('Item set to INACTIVE.');
      setDeleteBlocked(null);
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function onRowReorder(orderedIds: string[]): Promise<void> {
    const rows = data?.items ?? [];
    await Promise.all(
      orderedIds.map((id, index) => {
        const row = rows.find((r) => r.id === id);
        if (!row || row.sortOrder === index) return Promise.resolve();
        return update.mutateAsync({ id, body: { sortOrder: index } });
      }),
    );
  }

  return (
    <>
      <PageHeader
        {...(categoryId
          ? {
            leading: <BackButton to="/menu-categories" label="Back to Menu" />,
            eyebrow: 'Filtered by category',
          }
          : {})}
        title="Menu items"
        subtitle="The individual dishes an order is built from, each with the unit it is counted in."
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
        createLabel="New item"
      />

      {view === 'table' ? (
        <DataTable
          gridId="menu-items"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => setEditing(r)}
          rowReorder
          onRowReorder={onRowReorder}
          filtered={filtersActive}
          emptyTitle="No menu items yet"
          emptyMessage="Add the dishes this operation prepares."
          emptyAction={{ label: 'New item', onClick: () => setEditing(null) }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => setEditing(r)}
          filtered={filtersActive}
          emptyTitle="No menu items yet"
          emptyMessage="Add the dishes this operation prepares."
          emptyAction={{ label: 'New item', onClick: () => setEditing(null) }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">{r.name}</p>
                <StatusChip status={r.status} />
              </div>
              <Badge variant="outline" className="self-start">
                Measured in {r.unit}
              </Badge>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <MenuItemFormModal
          open={editing !== undefined}
          editing={editing}
          onClose={() => setEditing(undefined)}
          defaultCategoryId={categoryId}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete menu item"
        message={`Delete "${deleting?.name}"?`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteBlocked)}
        title="Cannot delete this item"
        message={`${deleteBlocked?.message ?? ''}\n\nThis item is referenced by existing orders and cannot be hard-deleted. You can set it to INACTIVE instead, which hides it from new orders while preserving history.`}
        confirmLabel="Set INACTIVE instead"
        loading={update.isPending}
        onConfirm={setInactiveInstead}
        onCancel={() => setDeleteBlocked(null)}
      />
    </>
  );
}
