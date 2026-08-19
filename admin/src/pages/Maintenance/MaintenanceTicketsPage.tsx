import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Capability,
  MAINTENANCE_TICKET_STATUS_LABELS,
  MaintenancePriority,
  MaintenanceRequestKind,
  MaintenanceTicketStatus,
  PROBLEM_CATEGORY_LABELS,
  type MaintenanceTicketDto,
} from '@menuboard/shared';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { useAuth } from '../../services/AuthContext';
import { useMaintenanceTickets } from '../../hooks/useEquipment';
import { enumOptions } from '@/lib/options';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { formatDateTime, PRIORITY_TONE, TICKET_STATUS_TONE } from '../Equipment/equipmentTone';
import { ReportProblemModal } from './ReportProblemModal';

/**
 * Every maintenance ticket, ordered by priority then by where it sits on the ladder — so a
 * critical fault nobody has acknowledged is the first row on the screen.
 */
export function MaintenanceTicketsPage(): JSX.Element {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { hasCapability } = useAuth();
  const canCreate = hasCapability(Capability.MAINTENANCE_CREATE);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [priority, setPriority] = useState('');
  const [kind, setKind] = useState('');
  const [openOnly, setOpenOnly] = useState(params.get('openOnly') === '1' ? 'open' : '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('maintenance-tickets');
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    if (params.size > 0) setParams({}, { replace: true });
  }, [params, setParams]);

  const query = useMemo(
    () => ({
      search: search || undefined,
      status: (status || undefined) as MaintenanceTicketStatus | undefined,
      priority: (priority || undefined) as MaintenancePriority | undefined,
      kind: (kind || undefined) as MaintenanceRequestKind | undefined,
      openOnly: openOnly === 'open' ? true : undefined,
      page,
      pageSize,
    }),
    [search, status, priority, kind, openOnly, page, pageSize],
  );

  const { data, isLoading } = useMaintenanceTickets(query);

  const filterCount =
    (status ? 1 : 0) + (priority ? 1 : 0) + (kind ? 1 : 0) + (openOnly ? 1 : 0);
  const filtersActive = filterCount > 0 || search.trim() !== '';

  const columns: DataTableColumn<MaintenanceTicketDto>[] = [
    { field: 'ticketNumber', headerName: 'Ticket', width: 170 },
    { field: 'title', headerName: 'Problem', width: 260 },
    {
      field: 'assetId',
      headerName: 'Asset',
      width: 150,
      valueGetter: (row) => row.assetId ?? '—',
    },
    {
      field: 'locationPath',
      headerName: 'Location',
      width: 210,
      valueGetter: (row) => row.locationPath ?? '—',
    },
    {
      field: 'priority',
      headerName: 'Priority',
      width: 110,
      renderCell: (row) => (
        <span
          className={cn(
            'inline-flex rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
            TONE_CHIP_CLASS[PRIORITY_TONE[row.priority]],
          )}
        >
          {row.priority}
        </span>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 170,
      renderCell: (row) => (
        <span
          className={cn(
            'inline-flex rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold whitespace-nowrap',
            TONE_CHIP_CLASS[TICKET_STATUS_TONE[row.status]],
          )}
        >
          {MAINTENANCE_TICKET_STATUS_LABELS[row.status]}
        </span>
      ),
    },
    {
      field: 'assignedToName',
      headerName: 'Assigned to',
      width: 160,
      valueGetter: (row) => row.assignedToName ?? row.supplierName ?? '—',
    },
    {
      field: 'reportedAt',
      headerName: 'Reported',
      width: 160,
      valueGetter: (row) => formatDateTime(row.reportedAt),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Equipment"
        title="Maintenance"
        subtitle="Problems, faults and services. Critical and unacknowledged first."
        actions={
          canCreate ? (
            <Button onClick={() => setReporting(true)}>
              <PlusIcon data-icon="inline-start" />
              Report problem
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
          setStatus('');
          setPriority('');
          setKind('');
          setOpenOnly('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Show"
              value={openOnly}
              onChange={(next) => {
                setOpenOnly(next);
                setPage(1);
              }}
              emptyLabel="Everything"
              options={[{ value: 'open', label: 'Open tickets only' }]}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
              emptyLabel="All statuses"
              options={Object.values(MaintenanceTicketStatus).map((value) => ({
                value,
                label: MAINTENANCE_TICKET_STATUS_LABELS[value],
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
              options={enumOptions(MaintenancePriority)}
            />
            <SelectField
              label="Type"
              value={kind}
              onChange={(next) => {
                setKind(next);
                setPage(1);
              }}
              emptyLabel="Any type"
              options={enumOptions(MaintenanceRequestKind)}
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
        {...(canCreate ? { onCreate: () => setReporting(true), createLabel: 'Report' } : {})}
      />

      {view === 'table' ? (
        <DataTable
          gridId="maintenance-tickets"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtersActive}
          onRowDoubleClick={(row) => navigate(`/maintenance/tickets/${row.id}`)}
          emptyTitle="Nothing is broken"
          emptyMessage="Problems reported from the floor or raised by the preventive sweep appear here."
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtersActive}
          onCardClick={(row) => navigate(`/maintenance/tickets/${row.id}`)}
          emptyTitle="Nothing is broken"
          emptyMessage="Problems reported from the floor or raised by the preventive sweep appear here."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground font-mono text-xs">{row.ticketNumber}</span>
                <span
                  className={cn(
                    'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                    TONE_CHIP_CLASS[PRIORITY_TONE[row.priority]],
                  )}
                >
                  {row.priority}
                </span>
              </div>
              <p className="text-[0.9375rem] leading-snug font-semibold">{row.title}</p>
              <p className="text-muted-foreground text-xs">
                {row.assetId} · {row.locationPath ?? 'No location'}
              </p>
              {row.problemCategory !== null && (
                <p className="text-muted-foreground text-xs">
                  {PROBLEM_CATEGORY_LABELS[row.problemCategory]}
                </p>
              )}
              <div className="mt-auto flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                    TONE_CHIP_CLASS[TICKET_STATUS_TONE[row.status]],
                  )}
                >
                  {MAINTENANCE_TICKET_STATUS_LABELS[row.status]}
                </span>
                <span className="text-muted-foreground text-xs">
                  {row.assignedToName ?? row.supplierName ?? 'Unassigned'}
                </span>
              </div>
            </div>
          )}
        />
      )}

      <ReportProblemModal open={reporting} onClose={() => setReporting(false)} />
    </>
  );
}
