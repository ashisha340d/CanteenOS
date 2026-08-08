import { useMemo, useState } from 'react';
import { MasterStatus, type IngredientCategoryDto } from '@menuboard/shared';
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
  useDeleteIngredientCategory,
  useIngredientCategories,
  useUpdateIngredientCategory,
} from '../../hooks/useIngredients';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { IngredientCategoryFormModal } from './IngredientCategoryFormModal';

/**
 * Ingredient categories have no dedicated child-list page (docs/AGENTS.md decision rule) —
 * there is no categorized ingredient list view planned — so double-click opens Edit.
 */
export function IngredientCategoriesPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('ingredient-categories');
  const [editing, setEditing] = useState<IngredientCategoryDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<IngredientCategoryDto | null>(null);

  const query = useMemo(
    () => ({ search: search || undefined, status: status || undefined, page, pageSize }),
    [search, status, page, pageSize],
  );
  const { data, isLoading } = useIngredientCategories(query);
  const del = useDeleteIngredientCategory();
  const reorder = useUpdateIngredientCategory();
  const filtersActive = Boolean(status) || search.trim() !== '';

  const columns: DataTableColumn<IngredientCategoryDto>[] = [
    { field: 'name', headerName: 'Name', width: 220 },
    {
      field: 'nameHi',
      headerName: 'Name (Hindi)',
      width: 200,
      valueGetter: (r) => r.nameHi ?? '—',
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
          <DeleteAction label={r.name} onClick={() => setDeleting(r)} />
        </RowActions>
      ),
    },
  ];

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      notify.success('Ingredient category deleted.');
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
        title="Ingredient categories"
        subtitle="Group the recipe-only ingredient master so it stays easy to browse."
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
          gridId="ingredient-categories"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => setEditing(r)}
          rowReorder
          onRowReorder={onRowReorder}
          filtered={filtersActive}
          emptyTitle="No ingredient categories yet"
          emptyMessage="Group ingredients so the recipe builder stays easy to search."
          emptyAction={{ label: 'New category', onClick: () => setEditing(null) }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => setEditing(r)}
          filtered={filtersActive}
          emptyTitle="No ingredient categories yet"
          emptyMessage="Group ingredients so the recipe builder stays easy to search."
          emptyAction={{ label: 'New category', onClick: () => setEditing(null) }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">{r.name}</p>
                <StatusChip status={r.status} />
              </div>
              <p className="text-muted-foreground flex-1 text-sm">{r.nameHi ?? 'No Hindi name'}</p>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <IngredientCategoryFormModal
          open={editing !== undefined}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete ingredient category"
        message={`Delete "${deleting?.name}"? Ingredients keep their reference; this only hides the category from new assignments.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
