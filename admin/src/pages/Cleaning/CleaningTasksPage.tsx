import { useMemo, useState } from 'react';
import {
  CLEANING_TASK_PRIORITY_LABELS,
  CLEANING_TASK_STATUS_LABELS,
  Capability,
  CleaningTaskPriority,
  CleaningTaskStatus,
  type CleaningTaskDto,
} from '@menuboard/shared';
import { MegaphoneIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { useAuth } from '../../services/AuthContext';
import { useCleaningSetup, useCleaningTasks } from '../../hooks/useCleaning';
import {
  CLEANING_PRIORITY_TONE,
  CLEANING_TASK_STATUS_TONE,
  dueLabel,
  formatDateTime,
} from './cleaningTone';
import { CleaningTaskDrawer } from './CleaningTaskDrawer';
import { ReportCleaningModal } from './ReportCleaningModal';

/**
 * Every cleaning occurrence, worst first.
 *
 * The default view is deliberately "open only": a hygiene record is worth keeping forever and
 * worth reading almost never, and a supervisor opening this tab wants the work, not the
 * archive. The Show filter reaches the archive in one click.
 */
export function CleaningTasksPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canReport = hasCapability(Capability.CLEANING_REPORT_INCIDENT);

  const [search, setSearch] = useState('');
  const [show, setShow] = useState('open');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [areaId, setAreaId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('cleaning-tasks');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const { data: setup } = useCleaningSetup();

  const query = useMemo(
    () => ({
      search: search || undefined,
      status: (status || undefined) as CleaningTaskStatus | undefined,
      priority: (priority || undefined) as CleaningTaskPriority | undefined,
      areaId: areaId || undefined,
      openOnly: show === 'open' ? true : undefined,
      overdueOnly: show === 'overdue' ? true : undefined,
      unassignedOnly: show === 'unassigned' ? true : undefined,
      awaitingVerification: show === 'verify' ? true : undefined,
      page,
      pageSize,
    }),
    [search, status, priority, areaId, show, page, pageSize],
  );

  const { data, isLoading } = useCleaningTasks(query);

  const filterCount =
    (status ? 1 : 0) + (priority ? 1 : 0) + (areaId ? 1 : 0) + (show !== 'open' ? 1 : 0);
  const filtersActive = filterCount > 0 || search.trim() !== '';

  const columns: DataTableColumn<CleaningTaskDto>[] = [
    { field: 'taskName', headerName: 'Task', width: 260 },
    {
      field: 'cleanableAssetName',
      headerName: 'What',
      width: 190,
      valueGetter: (row) => row.cleanableAssetName ?? '—',
    },
    {
      field: 'locationPath',
      headerName: 'Where',
      width: 200,
      valueGetter: (row) => row.locationPath ?? '—',
    },
    {
      field: 'priority',
      headerName: 'Priority',
      width: 100,
      renderCell: (row) => <Chip tone={CLEANING_PRIORITY_TONE[row.priority]} label={row.priority} />,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 160,
      renderCell: (row) => (
        <Chip
          tone={CLEANING_TASK_STATUS_TONE[row.status]}
          label={CLEANING_TASK_STATUS_LABELS[row.status]}
        />
      ),
    },
    {
      field: 'assignedToName',
      headerName: 'Who',
      width: 150,
      valueGetter: (row) => row.assignedToName ?? 'Unassigned',
    },
    {
      field: 'dueAt',
      headerName: 'Due',
      width: 150,
      renderCell: (row) => (
        <span className={cn(row.isOverdue && 'text-tone-danger font-medium')}>
          {dueLabel(row.dueAt, row.isOverdue)}
        </span>
      ),
    },
    {
      field: 'completedAt',
      headerName: 'Finished',
      width: 150,
      valueGetter: (row) => formatDateTime(row.completedAt),
    },
  ];

  return (
    <>
      <PageHeader
        title="Cleaning tasks"
        meta={
          data && (
            <span className="text-muted-foreground text-xs">
              {data.meta.total} task{data.meta.total === 1 ? '' : 's'}
            </span>
          )
        }
        actions={
          canReport ? (
            <Button onClick={() => setReporting(true)}>
              <MegaphoneIcon data-icon="inline-start" />
              Report something
            </Button>
          ) : null
        }
      />

      <ListToolbar
        search={search}
        onSearchChange={(next) => {
          setSearch(next);
          setPage(1);
        }}
        activeFilterCount={filterCount}
        onClearFilters={() => {
          setShow('open');
          setStatus('');
          setPriority('');
          setAreaId('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Show"
              value={show}
              onChange={(next) => {
                setShow(next);
                setPage(1);
              }}
              emptyLabel="Everything, including closed"
              options={[
                { value: 'open', label: 'Open work' },
                { value: 'overdue', label: 'Overdue only' },
                { value: 'unassigned', label: 'Needs an owner' },
                { value: 'verify', label: 'Waiting to be checked' },
              ]}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
              emptyLabel="Any status"
              options={Object.values(CleaningTaskStatus).map((value) => ({
                value,
                label: CLEANING_TASK_STATUS_LABELS[value],
              }))}
            />
            <SelectField
              label="Priority"
              value={priority}
              onChange={(next) => {
                setPriority(next);
                setPage(1);
              }}
              emptyLabel="Any priority"
              options={Object.values(CleaningTaskPriority).map((value) => ({
                value,
                label: CLEANING_TASK_PRIORITY_LABELS[value],
              }))}
            />
            <SelectField
              label="Area"
              value={areaId}
              onChange={(next) => {
                setAreaId(next);
                setPage(1);
              }}
              emptyLabel="Everywhere"
              options={(setup?.areas ?? []).map((area) => ({ value: area.id, label: area.name }))}
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
        {...(canReport ? { onCreate: () => setReporting(true), createLabel: 'Report' } : {})}
      />

      {view === 'table' ? (
        <DataTable
          gridId="cleaning-tasks"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtersActive}
          onRowDoubleClick={(row) => setOpenTaskId(row.id)}
          emptyTitle="Nothing to clean"
          emptyMessage="Scheduled rules and reports from the floor both land here."
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtersActive}
          onCardClick={(row) => setOpenTaskId(row.id)}
          emptyTitle="Nothing to clean"
          emptyMessage="Scheduled rules and reports from the floor both land here."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <Chip tone={CLEANING_PRIORITY_TONE[row.priority]} label={row.priority} />
                <span
                  className={cn(
                    'text-xs',
                    row.isOverdue ? 'text-tone-danger font-medium' : 'text-muted-foreground',
                  )}
                >
                  {dueLabel(row.dueAt, row.isOverdue)}
                </span>
              </div>
              <p className="text-[0.9375rem] leading-snug font-semibold">{row.taskName}</p>
              <p className="text-muted-foreground text-xs">{row.locationPath ?? '—'}</p>
              <div className="mt-auto flex items-center justify-between gap-2">
                <Chip
                  tone={CLEANING_TASK_STATUS_TONE[row.status]}
                  label={CLEANING_TASK_STATUS_LABELS[row.status]}
                />
                <span className="text-muted-foreground text-xs">
                  {row.assignedToName ?? 'Unassigned'}
                </span>
              </div>
            </div>
          )}
        />
      )}

      <CleaningTaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      <ReportCleaningModal open={reporting} onClose={() => setReporting(false)} />
    </>
  );
}

function Chip({ tone, label }: { tone: keyof typeof TONE_CHIP_CLASS; label: string }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold whitespace-nowrap',
        TONE_CHIP_CLASS[tone],
      )}
    >
      {label}
    </span>
  );
}
