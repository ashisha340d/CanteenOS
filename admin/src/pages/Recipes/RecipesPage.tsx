import { useMemo, useState } from 'react';
import { MasterStatus, type RecipeDto } from '@menuboard/shared';
import { StarIcon } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { BackButton } from '../../components/BackButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { useDeleteRecipe, useRecipes, useSetDefaultRecipe } from '../../hooks/useRecipes';
import { enumOptions, humanise } from '@/lib/options';
import { notify } from '@/lib/notify';

export function RecipesPage(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const menuItemId = params.get('menuItemId') ?? undefined;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [view, setView] = useViewMode('recipes');
  const [deleting, setDeleting] = useState<RecipeDto | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const query = useMemo(
    () => ({ q: search || undefined, status: status || undefined, menuItemId }),
    [search, status, menuItemId],
  );
  const { data: allRows = [], isLoading } = useRecipes(query);
  const del = useDeleteRecipe();
  const setDefault = useSetDefaultRecipe();
  const filtersActive = Boolean(status) || search.trim() !== '';
  const rows = useMemo(
    () => allRows.slice((page - 1) * pageSize, page * pageSize),
    [allRows, page, pageSize],
  );

  const columns: DataTableColumn<RecipeDto>[] = [
    { field: 'menuItemName', headerName: 'Menu item', width: 220, valueGetter: (r) => r.menuItemName ?? '—' },
    {
      field: 'descriptionEn',
      headerName: 'Variant',
      width: 220,
      valueGetter: (r) => r.descriptionEn ?? '—',
    },
    { field: 'basePax', headerName: 'Base pax', width: 100, align: 'right' },
    {
      field: 'difficulty',
      headerName: 'Difficulty',
      width: 110,
      valueGetter: (r) => (r.difficulty ? humanise(r.difficulty) : '—'),
    },
    {
      field: 'isDefault',
      headerName: 'Default',
      width: 100,
      renderCell: (r) =>
        r.isDefault ? (
          <Badge variant="secondary">
            <StarIcon data-icon="inline-start" />
            Default
          </Badge>
        ) : (
          '—'
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
      width: 150,
      sortable: false,
      align: 'right',
      alwaysVisible: true,
      renderCell: (r) => (
        <RowActions>
          {!r.isDefault && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onSetDefault(r)}
                  aria-label={`Set ${r.menuItemName ?? 'recipe'} variant as default`}
                >
                  <StarIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Set as default</TooltipContent>
            </Tooltip>
          )}
          <EditAction
            label={r.descriptionEn ?? r.menuItemName ?? 'recipe'}
            onClick={() => navigate(`/recipes/${r.id}/edit`)}
          />
          <DeleteAction
            label={r.descriptionEn ?? r.menuItemName ?? 'recipe'}
            tooltip="Delete recipe variant"
            onClick={() => setDeleting(r)}
          />
        </RowActions>
      ),
    },
  ];

  async function onSetDefault(row: RecipeDto): Promise<void> {
    try {
      await setDefault.mutateAsync(row.id);
      notify.success('Default variant updated.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      notify.success('Recipe variant deleted.');
      setDeleting(null);
    } catch (err) {
      notify.fromError(err);
      setDeleting(null);
    }
  }

  const newRecipeHref = menuItemId ? `/recipes/new?menuItemId=${menuItemId}` : '/recipes/new';

  return (
    <>
      <PageHeader
        eyebrow="Catalogue/Collection"
        title="Recipes"
        subtitle="Method and quantities per menu item variant, stated for a base serving count and scaled automatically to the pax an order asks for."
        {...(menuItemId
          ? { leading: <BackButton to="/menu-items" label="Back to menu items" /> }
          : {})}
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
        total={allRows.length}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onCreate={() => navigate(newRecipeHref)}
        createLabel="New recipe"
      />

      {view === 'table' ? (
        <DataTable
          gridId="recipes"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => navigate(`/recipes/${r.id}/edit`)}
          filtered={filtersActive}
          emptyTitle="No recipes yet"
          emptyMessage="Author a recipe variant so this dish's ingredients and method are on record."
          emptyAction={{ label: 'New recipe', onClick: () => navigate(newRecipeHref) }}
        />
      ) : (
        <EntityCardGrid
          rows={rows}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => navigate(`/recipes/${r.id}/edit`)}
          filtered={filtersActive}
          emptyTitle="No recipes yet"
          emptyMessage="Author a recipe variant so this dish's ingredients and method are on record."
          emptyAction={{ label: 'New recipe', onClick: () => navigate(newRecipeHref) }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">
                  {r.menuItemName ?? 'Menu item'}
                </p>
                <StatusChip status={r.status} />
              </div>
              <p className="text-muted-foreground text-sm">{r.descriptionEn ?? 'Default variant'}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{r.basePax} pax</Badge>
                {r.difficulty && <Badge variant="outline">{humanise(r.difficulty)}</Badge>}
                {r.isDefault && (
                  <Badge variant="secondary">
                    <StarIcon data-icon="inline-start" />
                    Default
                  </Badge>
                )}
              </div>
            </div>
          )}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete recipe variant"
        message={`Delete this variant of "${deleting?.menuItemName ?? 'this menu item'}"? ${deleting?.isDefault
          ? 'It is the default variant — another variant will be promoted automatically if one exists.'
          : ''
          }`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
