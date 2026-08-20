import { useMemo, useState } from 'react';
import {
  CLEANING_TRIGGER_EVENT_LABELS,
  Capability,
  CleaningEventSource,
  CleaningTriggerEvent,
  type CleaningCorrectiveActionDto,
  type CleaningEventDto,
} from '@menuboard/shared';
import { MegaphoneIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { ListToolbar } from '../../components/ListToolbar';
import { useViewMode } from '../../components/DataTable/gridState';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { useAuth } from '../../services/AuthContext';
import { useCleaningEvents, useCorrectiveActions } from '../../hooks/useCleaning';
import { CORRECTIVE_STATUS_TONE, formatDateTime } from './cleaningTone';
import { CorrectiveActionModal } from './CorrectiveActionModal';
import { ReportCleaningModal } from './ReportCleaningModal';

/**
 * What people reported, and what came of it — beside the corrective actions that failed checks
 * produced.
 *
 * The `tasksCreated` column is the one that matters: a report that produced nothing means a
 * gap in the rules, and it is the only place that gap is visible.
 */
export function CleaningReportsPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canReport = hasCapability(Capability.CLEANING_REPORT_INCIDENT);
  const [reporting, setReporting] = useState(false);

  return (
    <>
      <PageHeader
        title="Reports and corrective actions"
        actions={
          canReport ? (
            <Button onClick={() => setReporting(true)}>
              <MegaphoneIcon data-icon="inline-start" />
              Report something
            </Button>
          ) : null
        }
      />
      <Tabs defaultValue="reports" className="flex min-h-0 flex-col gap-3">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="corrective">Corrective actions</TabsTrigger>
        </TabsList>
        <TabsContent value="reports" className="mt-0">
          <ReportsTab />
        </TabsContent>
        <TabsContent value="corrective" className="mt-0">
          <CorrectiveTab />
        </TabsContent>
      </Tabs>
      <ReportCleaningModal open={reporting} onClose={() => setReporting(false)} />
    </>
  );
}

function ReportsTab(): JSX.Element {
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('cleaning-events');

  const query = useMemo(
    () => ({
      search: search || undefined,
      eventType: (eventType || undefined) as CleaningTriggerEvent | undefined,
      source: (source || undefined) as CleaningEventSource | undefined,
      page,
      pageSize,
    }),
    [search, eventType, source, page, pageSize],
  );
  const { data, isLoading } = useCleaningEvents(query);

  const columns: DataTableColumn<CleaningEventDto>[] = [
    {
      field: 'occurredAt',
      headerName: 'When',
      width: 160,
      valueGetter: (row) => formatDateTime(row.occurredAt),
    },
    {
      field: 'eventType',
      headerName: 'What',
      width: 190,
      valueGetter: (row) => CLEANING_TRIGGER_EVENT_LABELS[row.eventType],
    },
    { field: 'note', headerName: 'Said', width: 280, valueGetter: (row) => row.note ?? '—' },
    {
      field: 'cleanableAssetName',
      headerName: 'About',
      width: 190,
      valueGetter: (row) => row.cleanableAssetName ?? row.areaName ?? '—',
    },
    {
      field: 'reportedByName',
      headerName: 'Who',
      width: 150,
      valueGetter: (row) => row.reportedByName ?? 'System',
    },
    { field: 'source', headerName: 'From', width: 120 },
    {
      field: 'tasksCreated',
      headerName: 'Raised',
      width: 120,
      renderCell: (row) =>
        row.tasksCreated === 0 ? (
          <Chip tone="progress" label="nothing" />
        ) : (
          <span className="tabular-nums">{row.tasksCreated}</span>
        ),
    },
  ];

  return (
    <>
      <ListToolbar
        search={search}
        onSearchChange={(next) => {
          setSearch(next);
          setPage(1);
        }}
        activeFilterCount={(eventType ? 1 : 0) + (source ? 1 : 0)}
        onClearFilters={() => {
          setEventType('');
          setSource('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="What happened"
              value={eventType}
              onChange={(next) => {
                setEventType(next);
                setPage(1);
              }}
              emptyLabel="Anything"
              options={Object.values(CleaningTriggerEvent).map((value) => ({
                value,
                label: CLEANING_TRIGGER_EVENT_LABELS[value],
              }))}
            />
            <SelectField
              label="Raised from"
              value={source}
              onChange={(next) => {
                setSource(next);
                setPage(1);
              }}
              emptyLabel="Anywhere"
              options={Object.values(CleaningEventSource).map((value) => ({
                value,
                label: value,
              }))}
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
      <DataTable
        gridId="cleaning-events"
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        filtered={search.trim() !== '' || eventType !== '' || source !== ''}
        emptyTitle="Nothing has been reported"
        emptyMessage="Every cleaning task in the system was raised by one of these."
      />
    </>
  );
}

function CorrectiveTab(): JSX.Element {
  const [show, setShow] = useState('open');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('cleaning-corrective');
  const [editing, setEditing] = useState<CleaningCorrectiveActionDto | null>(null);

  const query = useMemo(
    () => ({
      openOnly: show === 'open' ? true : undefined,
      overdueOnly: show === 'overdue' ? true : undefined,
      page,
      pageSize,
    }),
    [show, page, pageSize],
  );
  const { data, isLoading } = useCorrectiveActions(query);

  const columns: DataTableColumn<CleaningCorrectiveActionDto>[] = [
    { field: 'failureSummary', headerName: 'What went wrong', width: 280 },
    {
      field: 'cleanableAssetName',
      headerName: 'Asset',
      width: 190,
      valueGetter: (row) => row.cleanableAssetName ?? '—',
    },
    {
      field: 'areaName',
      headerName: 'Area',
      width: 150,
      valueGetter: (row) => row.areaName ?? '—',
    },
    {
      field: 'assignedToName',
      headerName: 'Owner',
      width: 150,
      valueGetter: (row) => row.assignedToName ?? 'Unassigned',
    },
    {
      field: 'rootCause',
      headerName: 'Root cause',
      width: 240,
      valueGetter: (row) => row.rootCause ?? '—',
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 150,
      renderCell: (row) => (
        <Chip
          tone={row.isOverdue ? 'danger' : CORRECTIVE_STATUS_TONE[row.status]}
          label={row.isOverdue ? `${row.status} · overdue` : row.status}
        />
      ),
    },
    {
      field: 'dueAt',
      headerName: 'Due',
      width: 160,
      valueGetter: (row) => formatDateTime(row.dueAt),
    },
  ];

  return (
    <>
      <ListToolbar
        search=""
        onSearchChange={() => undefined}
        hideSearch
        activeFilterCount={show === 'open' ? 0 : 1}
        onClearFilters={() => {
          setShow('open');
          setPage(1);
        }}
        filters={
          <SelectField
            label="Show"
            value={show}
            onChange={(next) => {
              setShow(next);
              setPage(1);
            }}
            emptyLabel="Everything, including closed"
            options={[
              { value: 'open', label: 'Still open' },
              { value: 'overdue', label: 'Overdue only' },
            ]}
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
      />
      <DataTable
        gridId="cleaning-corrective"
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        filtered={show !== 'open'}
        onRowDoubleClick={(row) => setEditing(row)}
        emptyTitle="Nothing has failed a check"
        emptyMessage="A failed hygiene check raises a corrective action here automatically."
      />
      {editing !== null && (
        <CorrectiveActionModal action={editing} onClose={() => setEditing(null)} />
      )}
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
