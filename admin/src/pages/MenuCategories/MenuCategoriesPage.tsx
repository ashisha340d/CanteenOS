import { useMemo, useState } from 'react';
import { MasterStatus, type MenuCategoryDto } from '@menuboard/shared';
import { UtensilsIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  useDeleteMenuCategory,
  useMenuCategories,
  useUpdateMenuCategory,
} from '../../hooks/useMasters';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { MenuCategoryFormModal } from './MenuCategoryFormModal';

/**
 * Master of Menu Items (docs/AGENTS.md decision rule): a category has a related child list,
 * so double-click drills down to its items instead of opening Edit. Edit stays available as
 * a row action.
 */
export function MenuCategoriesPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('menu-categories');
  const [editing, setEditing] = useState<MenuCategoryDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<MenuCategoryDto | null>(null);

  const query = useMemo(
    () => ({ search: search || undefined, status: status || undefined, page, pageSize }),
    [search, status, page, pageSize],
  );
  const { data, isLoading } = useMenuCategories(query);
  const del = useDeleteMenuCategory();
  const reorder = useUpdateMenuCategory();
  const filtersActive = Boolean(status) || search.trim() !== '';

  const columns: DataTableColumn<MenuCategoryDto>[] = [
    { field: 'name', headerName: 'Name', width: 220 },
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
      width: 140,
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
                onClick={() => navigate(`/menu-items?categoryId=${r.id}`)}
                aria-label={`View items in ${r.name}`}
              >
                <UtensilsIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View items</TooltipContent>
          </Tooltip>
          <EditAction label={r.name} onClick={() => setEditing(r)} />
          <DeleteAction
            label={r.name}
            tooltip="Delete — refused while items exist"
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
      notify.success('Category deleted.');
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
        title="Menu"
        subtitle="Categories group the items an order can be built from. Open one to edit its items."
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
        createLabel="New category"
      />

      {view === 'table' ? (
        <DataTable
          gridId="menu-categories"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => navigate(`/menu-items?categoryId=${r.id}`)}
          rowReorder
          onRowReorder={onRowReorder}
          filtered={filtersActive}
          emptyTitle="No categories yet"
          emptyMessage="Group your menu items so they are quick to find when building an order."
          emptyAction={{ label: 'New category', onClick: () => setEditing(null) }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => navigate(`/menu-items?categoryId=${r.id}`)}
          filtered={filtersActive}
          emptyTitle="No categories yet"
          emptyMessage="Group your menu items so they are quick to find when building an order."
          emptyAction={{ label: 'New category', onClick: () => setEditing(null) }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">{r.name}</p>
                <StatusChip status={r.status} />
              </div>
              <p className="text-muted-foreground flex-1 text-sm">
                {r.description ?? 'No description'}
              </p>
              <p className="text-primary text-xs font-medium">Open items →</p>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <MenuCategoryFormModal
          open={editing !== undefined}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete category"
        message={`Delete "${deleting?.name}"? This is refused while it still has menu items.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
