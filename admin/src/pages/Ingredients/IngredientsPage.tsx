import { useMemo, useState } from 'react';
import { MasterStatus, type IngredientDto } from '@menuboard/shared';
import { useQuery } from '@tanstack/react-query';
import { SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { ingredientCategoriesApi } from '../../api/ingredients';
import {
  useDeleteIngredient,
  useIngredients,
  useUpdateIngredient,
} from '../../hooks/useIngredients';
import { readError } from '../../services/errorMessage';
import { enumOptions, toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { IngredientFormModal } from './IngredientFormModal';

export function IngredientsPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('ingredients');
  const [editing, setEditing] = useState<IngredientDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<IngredientDto | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{ item: IngredientDto; message: string } | null>(
    null,
  );

  const { data: categoryOptions } = useQuery({
    queryKey: ['ingredient-category-filter-options'],
    queryFn: () => ingredientCategoriesApi.list({ page: 1, pageSize: 100 }),
  });

  const query = useMemo(
    () => ({
      search: search || undefined,
      status: status || undefined,
      categoryId: categoryId || undefined,
      page,
      pageSize,
    }),
    [search, status, categoryId, page, pageSize],
  );
  const { data, isLoading } = useIngredients(query);
  const del = useDeleteIngredient();
  const update = useUpdateIngredient();
  const filtersActive = Boolean(status) || Boolean(categoryId) || search.trim() !== '';

  const columns: DataTableColumn<IngredientDto>[] = [
    { field: 'name', headerName: 'Name', width: 200 },
    { field: 'nameHi', headerName: 'Name (Hindi)', width: 180, valueGetter: (r) => r.nameHi ?? '—' },
    { field: 'unit', headerName: 'Unit', width: 90 },
    {
      field: 'categoryName',
      headerName: 'Category',
      width: 180,
      valueGetter: (r) => r.categoryName ?? '—',
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
            tooltip="Delete — refused when referenced by recipes"
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
      notify.success('Ingredient deleted.');
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
      notify.success('Ingredient set to INACTIVE.');
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
        eyebrow="Catalogue/Collection"
        title="Ingredients"
        subtitle="The raw materials recipes are written against, each with the unit it is measured in."
      />

      <ListToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        activeFilterCount={(status ? 1 : 0) + (categoryId ? 1 : 0)}
        onClearFilters={() => {
          setStatus('');
          setCategoryId('');
          setPage(1);
        }}
        filters={
          <>
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
            <SelectField
              label="Category"
              value={categoryId}
              onChange={(v) => {
                setCategoryId(v);
                setPage(1);
              }}
              emptyLabel="All categories"
              options={toOptions(
                categoryOptions?.items ?? [],
                (c) => c.id,
                (c) => c.name,
              )}
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
        onCreate={() => setEditing(null)}
        createLabel="New ingredient"
      />

      {view === 'table' ? (
        <DataTable
          gridId="ingredients"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => setEditing(r)}
          rowReorder
          onRowReorder={onRowReorder}
          filtered={filtersActive}
          emptyTitle="No ingredients yet"
          emptyMessage="Add the ingredients recipes are built from."
          emptyAction={{ label: 'New ingredient', onClick: () => setEditing(null) }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => setEditing(r)}
          filtered={filtersActive}
          emptyTitle="No ingredients yet"
          emptyMessage="Add the ingredients recipes are built from."
          emptyAction={{ label: 'New ingredient', onClick: () => setEditing(null) }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">{r.name}</p>
                <StatusChip status={r.status} />
              </div>
              <p className="text-muted-foreground text-sm">{r.categoryName ?? 'Uncategorised'}</p>
              <p className="text-primary text-xs font-medium">Measured in {r.unit}</p>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <IngredientFormModal
          open={editing !== undefined}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete ingredient"
        message={`Delete "${deleting?.name}"?`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteBlocked)}
        title="Cannot delete this ingredient"
        message={`${deleteBlocked?.message ?? ''}\n\nThis ingredient is used by one or more recipes and cannot be hard-deleted. You can set it to INACTIVE instead, which hides it from new recipes while preserving history.`}
        confirmLabel="Set INACTIVE instead"
        loading={update.isPending}
        onConfirm={setInactiveInstead}
        onCancel={() => setDeleteBlocked(null)}
      />
    </>
  );
}
