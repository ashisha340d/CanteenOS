import { useMemo, useState } from 'react';
import { MasterStatus, type MenuItemDto } from '@menuboard/shared';
import { ChefHatIcon, EyeIcon, ImageIcon } from 'lucide-react';
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
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { useDeleteMenuItem, useMenuItems, useUpdateMenuItem } from '../../hooks/useMasters';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';

/**
 * The item's primary media-library image, falling back to the legacy `imagePath` column that
 * predates the media library, and to a placeholder tile when the dish has no photo at all.
 */
export function ItemThumbnail({
  item,
  className,
}: {
  item: MenuItemDto;
  className?: string;
}): JSX.Element {
  const src = item.primaryMediaUrl ?? item.imagePath;
  return (
    <div
      className={cn(
        'bg-muted text-muted-foreground flex items-center justify-center overflow-hidden rounded-md border',
        className,
      )}
    >
      {src ? (
        <img src={src} alt={item.name} className="h-full w-full object-cover" />
      ) : (
        <ImageIcon className="size-4 opacity-50" />
      )}
    </div>
  );
}

export function MenuItemsPage(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const categoryId = params.get('categoryId') ?? undefined;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('menu-items');
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
    {
      field: 'imagePath',
      headerName: 'Image',
      width: 64,
      sortable: false,
      renderCell: (r) => <ItemThumbnail item={r} className="size-10" />,
    },
    {
      field: 'name',
      headerName: 'Item Name',
      width: 220,
      renderCell: (r) => (
        <div className="flex flex-col">
          <span className="font-medium">{r.name}</span>
          {r.nameHi && <span className="text-muted-foreground text-xs">{r.nameHi}</span>}
        </div>
      ),
    },
    { field: 'unit', headerName: 'Unit', width: 100 },
    {
      field: 'basePrice',
      headerName: 'Base Price',
      width: 110,
      align: 'right',
      renderCell: (r) => (r.basePrice === null ? '—' : `₹${r.basePrice}`),
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => navigate(`/menu-items/${r.id}`)}
                aria-label={`View ${r.name}`}
              >
                <EyeIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View details</TooltipContent>
          </Tooltip>
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
          <EditAction label={r.name} onClick={() => navigate(`/menu-items/${r.id}/edit`)} />
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
        eyebrow="Menu"
        title="Menu Master File"
        subtitle="Every item the kitchen can produce, defined once. Menus decide which of them are offered and at what price."
        {...(categoryId
          ? { leading: <BackButton to="/menu-categories" label="Back to Menu" /> }
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
        total={data?.meta.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onCreate={() => navigate('/menu-items/new')}
        createLabel="New item"
      />

      {view === 'table' ? (
        <DataTable
          gridId="menu-items"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => navigate(`/menu-items/${r.id}/edit`)}
          rowReorder
          onRowReorder={onRowReorder}
          filtered={filtersActive}
          emptyTitle="No menu items yet"
          emptyMessage="Add the dishes this operation prepares."
          emptyAction={{ label: 'New item', onClick: () => navigate('/menu-items/new') }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => navigate(`/menu-items/${r.id}/edit`)}
          filtered={filtersActive}
          emptyTitle="No menu items yet"
          emptyMessage="Add the dishes this operation prepares."
          emptyAction={{ label: 'New item', onClick: () => navigate('/menu-items/new') }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <ItemThumbnail item={r} className="aspect-[4/3] w-full" />
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
