import { useMemo, useState } from 'react';
import { BoardStatus, Capability, type BoardDto } from '@menuboard/shared';
import { ArchiveIcon, UsersIcon } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SelectField } from '@/components/form/fields';
import { EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { IfCapable } from '../../services/CapabilityGate';
import { useArchiveBoard, useBoards } from '../../hooks/useBoards';
import { useStations } from '../../hooks/useMasters';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { BoardFormModal } from './BoardFormModal';

export function BoardsPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<BoardStatus | ''>('');
  // Arriving from Stations ("view boards at this station") pre-selects the filter.
  const [stationId, setStationId] = useState(searchParams.get('stationId') ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [view, setView] = useViewMode('boards');
  const [editing, setEditing] = useState<BoardDto | null | undefined>(undefined);
  const [archiving, setArchiving] = useState<BoardDto | null>(null);

  // A board is never a station: this filter narrows boards to one station, it never
  // substitutes for one.
  const { data: stationPage } = useStations({ page: 1, pageSize: 100 });
  const stationOptions = (stationPage?.items ?? []).map((station) => ({
    value: station.id,
    label: station.name,
  }));

  const query = useMemo(
    () => ({
      search: search || undefined,
      status: status || undefined,
      stationId: stationId || undefined,
      withCounts: true,
      page,
      pageSize,
      sortBy,
      sortDir,
    }),
    [search, status, stationId, page, pageSize, sortBy, sortDir],
  );
  const { data, isLoading } = useBoards(query);
  const archive = useArchiveBoard();
  const filtersActive = Boolean(status) || Boolean(stationId) || search.trim() !== '';

  const columns: DataTableColumn<BoardDto>[] = [
    {
      field: 'name',
      headerName: 'Name',
      width: 220,
      renderCell: (r) => (
        <div className="flex items-center gap-2">
          <span
            className="size-3 shrink-0 rounded-full border border-border"
            style={{ backgroundColor: r.color ?? undefined }}
            aria-hidden="true"
          />
          <span className="truncate">{r.name}</span>
        </div>
      ),
    },
    {
      field: 'stationName',
      headerName: 'Station',
      width: 160,
      sortable: false,
      valueGetter: (r) => r.stationName ?? '—',
    },
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
      width: 120,
      renderCell: (r) => <StatusChip status={r.status} />,
    },
    {
      field: 'created_at',
      headerName: 'Created',
      width: 170,
      valueGetter: (r) => new Date(r.createdAt).toLocaleDateString(),
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
                onClick={() => navigate(`/boards/${r.id}/members`)}
                aria-label={`View members of ${r.name}`}
              >
                <UsersIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Members</TooltipContent>
          </Tooltip>

          <IfCapable capability={Capability.BOARD_UPDATE}>
            <EditAction label={r.name} onClick={() => setEditing(r)} />
          </IfCapable>

          <IfCapable capability={Capability.BOARD_ARCHIVE}>
            <Tooltip>
              {/* The span keeps the trigger hoverable once the button goes disabled. */}
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={r.status === BoardStatus.ARCHIVED}
                    onClick={() => setArchiving(r)}
                    aria-label={`Archive ${r.name}`}
                  >
                    <ArchiveIcon />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {r.status === BoardStatus.ARCHIVED ? 'Already archived' : 'Archive'}
              </TooltipContent>
            </Tooltip>
          </IfCapable>
        </RowActions>
      ),
    },
  ];

  async function confirmArchive(): Promise<void> {
    if (!archiving) return;
    try {
      await archive.mutateAsync(archiving.id);
      notify.success('Board archived.');
      setArchiving(null);
    } catch (err) {
      notify.fromError(err);
      setArchiving(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Boards"
        subtitle="Each board is a place where a team coordinates its orders."
      />
      <ListToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        activeFilterCount={(status ? 1 : 0) + (stationId ? 1 : 0)}
        onClearFilters={() => {
          setStatus('');
          setStationId('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Station"
              value={stationId}
              onChange={(v) => {
                setStationId(v);
                setPage(1);
              }}
              emptyLabel="All stations"
              options={stationOptions}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(v) => {
                setStatus(v as BoardStatus | '');
                setPage(1);
              }}
              emptyLabel="All statuses"
              options={enumOptions(BoardStatus)}
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
        createLabel="New board"
      />

      {view === 'table' ? (
        <DataTable
          gridId="boards"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={(field, dir) => {
            setSortBy(field);
            setSortDir(dir);
          }}
          onRowDoubleClick={(r) => navigate(`/boards/${r.id}/members`)}
          filtered={filtersActive}
          emptyTitle="No boards yet"
          emptyMessage="A board groups the people and orders for one operation."
          emptyAction={{ label: 'New board', onClick: () => setEditing(null) }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => navigate(`/boards/${r.id}/members`)}
          filtered={filtersActive}
          emptyTitle="No boards yet"
          emptyMessage="A board groups the people and orders for one operation."
          emptyAction={{ label: 'New board', onClick: () => setEditing(null) }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-full border border-border"
                    style={{ backgroundColor: r.color ?? undefined }}
                    aria-hidden="true"
                  />
                  <p className="min-w-0 truncate text-[0.9375rem] leading-snug font-semibold">
                    {r.name}
                  </p>
                </div>
                <StatusChip status={r.status} />
              </div>
              {r.stationName && (
                <p className="text-muted-foreground text-xs font-medium">{r.stationName}</p>
              )}
              <p className="text-muted-foreground line-clamp-2 flex-1 text-sm">
                {r.description ?? 'No description'}
              </p>
              <p className="text-muted-foreground text-xs">
                Created {new Date(r.createdAt).toLocaleDateString()}
              </p>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <BoardFormModal
          open={editing !== undefined}
          editing={editing}
          defaultStationId={stationId || undefined}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(archiving)}
        title="Archive board"
        message={`Archive "${archiving?.name}"? This is refused while the board has open orders.`}
        confirmLabel="Archive"
        danger
        loading={archive.isPending}
        onConfirm={confirmArchive}
        onCancel={() => setArchiving(null)}
      />
    </>
  );
}
