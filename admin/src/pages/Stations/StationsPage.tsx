import { useMemo, useState } from 'react';
import { MasterStatus, type StationDto } from '@menuboard/shared';
import { LayoutGridIcon } from 'lucide-react';
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
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { useDeleteStation, useStations } from '../../hooks/useMasters';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { StationFormModal } from './StationFormModal';

/**
 * Stations are the top of the hierarchy: Station -> Board. A station is never a board — it
 * never carries membership, capabilities, orders or a feed of its own. This page only manages
 * the site itself; boards inside it are managed from Boards, filtered to this station.
 */
export function StationsPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('stations');
  const [editing, setEditing] = useState<StationDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<StationDto | null>(null);

  const query = useMemo(
    () => ({ search: search || undefined, status: status || undefined, page, pageSize }),
    [search, status, page, pageSize],
  );
  const { data, isLoading } = useStations(query);
  const del = useDeleteStation();
  const filtersActive = Boolean(status) || search.trim() !== '';

  function viewBoards(station: StationDto): void {
    navigate(`/boards?stationId=${station.id}`);
  }

  const columns: DataTableColumn<StationDto>[] = [
    { field: 'name', headerName: 'Name', width: 200 },
    { field: 'code', headerName: 'Code', width: 120, valueGetter: (r) => r.code ?? '—' },
    {
      field: 'description',
      headerName: 'Description',
      width: 280,
      sortable: false,
      valueGetter: (r) => r.description ?? '—',
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
                onClick={() => viewBoards(r)}
                aria-label={`View boards at ${r.name}`}
              >
                <LayoutGridIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Boards</TooltipContent>
          </Tooltip>
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
      notify.success('Station deleted.');
      setDeleting(null);
    } catch (err) {
      notify.fromError(err);
      setDeleting(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Stations"
        subtitle="The physical sites boards operate at. A station never carries membership, orders or a feed of its own — those belong to the boards inside it."
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
        createLabel="New station"
      />

      {view === 'table' ? (
        <DataTable
          gridId="stations"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => viewBoards(r)}
          filtered={filtersActive}
          emptyTitle="No stations yet"
          emptyMessage="Add the physical sites boards operate at, e.g. Barsana, Mangarh."
          emptyAction={{ label: 'New station', onClick: () => setEditing(null) }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => viewBoards(r)}
          filtered={filtersActive}
          emptyTitle="No stations yet"
          emptyMessage="Add the physical sites boards operate at, e.g. Barsana, Mangarh."
          emptyAction={{ label: 'New station', onClick: () => setEditing(null) }}
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
        <StationFormModal
          open={editing !== undefined}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete station"
        message={`Delete "${deleting?.name}"? Refused while it still has any boards.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
