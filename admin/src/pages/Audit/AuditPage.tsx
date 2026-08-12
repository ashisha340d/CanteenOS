import { useMemo, useState } from 'react';
import type { AuditLogDto } from '@menuboard/shared';
import { EyeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TextField } from '@/components/form/fields';
import { RowActions } from '@/components/RowActions';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuditList } from '../../hooks/useAdmin';
import { DiffViewerModal } from './DiffViewerModal';

export function AuditPage(): JSX.Element {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('audit');
  const [viewing, setViewing] = useState<AuditLogDto | null>(null);

  const query = useMemo(
    () => ({
      action: action || undefined,
      entityType: entityType || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      pageSize,
    }),
    [action, entityType, dateFrom, dateTo, page, pageSize],
  );
  const { data, isLoading } = useAuditList(query);
  const filtersActive = Boolean(action || entityType || dateFrom || dateTo);

  const columns: DataTableColumn<AuditLogDto>[] = [
    {
      field: 'createdAt',
      headerName: 'When',
      width: 170,
      valueGetter: (r) => new Date(r.createdAt).toLocaleString(),
    },
    {
      field: 'actorName',
      headerName: 'Actor',
      width: 160,
      valueGetter: (r) => r.actorName ?? r.actorId ?? 'System',
    },
    { field: 'action', headerName: 'Action', width: 200 },
    { field: 'entityType', headerName: 'Entity type', width: 150 },
    { field: 'entityId', headerName: 'Entity id', width: 220, valueGetter: (r) => r.entityId ?? '—' },
    { field: 'boardId', headerName: 'Board', width: 220, valueGetter: (r) => r.boardId ?? '—' },
    { field: 'ip', headerName: 'IP', width: 140, valueGetter: (r) => r.ip ?? '—' },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 90,
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
                onClick={() => setViewing(r)}
                aria-label={`View details for ${r.action}`}
              >
                <EyeIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View before/after</TooltipContent>
          </Tooltip>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Audit log"
        subtitle="Who changed what, and when. Append-only — entries are never edited or removed."
      />

      <ListToolbar
        search={action}
        onSearchChange={(v) => {
          setAction(v);
          setPage(1);
        }}
        activeFilterCount={(entityType ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)}
        onClearFilters={() => {
          setEntityType('');
          setDateFrom('');
          setDateTo('');
          setPage(1);
        }}
        filters={
          <>
            <TextField
              label="Entity type"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(1);
              }}
            />
            <TextField
              label="From"
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
            <TextField
              label="To"
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
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
      />

      {view === 'table' ? (
        <DataTable
          gridId="audit"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => setViewing(r)}
          filtered={filtersActive}
          emptyTitle="Nothing recorded yet"
          emptyMessage="Changes made in the portal and the app will appear here."
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => setViewing(r)}
          filtered={filtersActive}
          emptyTitle="Nothing recorded yet"
          emptyMessage="Changes made in the portal and the app will appear here."
          renderCard={(r) => (
            <div className="flex flex-col gap-1.5">
              <p className="truncate font-mono text-[0.8125rem] font-semibold">{r.action}</p>
              <p className="truncate text-sm">{r.actorName ?? r.actorId ?? 'System'}</p>
              <p className="text-muted-foreground text-xs">
                {r.entityType} · {new Date(r.createdAt).toLocaleString()}
              </p>
            </div>
          )}
        />
      )}

      <DiffViewerModal entry={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
