import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Capability,
  LIMITS,
  MAINTENANCE_FREQUENCY_LABELS,
  MaintenanceFrequency,
  type MaintenanceScheduleDto,
} from '@menuboard/shared';
import { PlayIcon, PlusIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatTile } from '@/components/ui/StatTile';
import { DeleteAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { Modal } from '../../components/Modal/Modal';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';
import {
  useCreateSchedule,
  useDeleteSchedule,
  useEquipmentList,
  useMaintenanceSchedules,
  useRunMaintenanceSweep,
} from '../../hooks/useEquipment';
import { notify } from '@/lib/notify';
import { dueLabel, formatDate } from '../Equipment/equipmentTone';

const FORM_ID = 'maintenance-schedule-form';

/**
 * Preventive maintenance.
 *
 * Presented as a due list rather than a calendar grid: a schedule's only interesting property
 * is how close it is, and "6 days overdue" answers that faster than a square on a month view.
 * The sweep that turns these into tickets runs on the server; the button only asks it to run
 * now instead of on its own timer.
 */
export function MaintenanceSchedulesPage(): JSX.Element {
  const navigate = useNavigate();
  const { hasCapability } = useAuth();
  const canSchedule = hasCapability(Capability.MAINTENANCE_SCHEDULE);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('maintenance-schedules');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<MaintenanceScheduleDto | null>(null);

  const query = useMemo(() => ({ page, pageSize }), [page, pageSize]);
  const { data, isLoading } = useMaintenanceSchedules(query);
  const remove = useDeleteSchedule();
  const sweep = useRunMaintenanceSweep();

  // Searching a due list is a filter over a page a canteen can hold in one hand; asking the
  // server for a text search it does not offer would be worse than filtering here.
  const rows = (data?.items ?? []).filter((row) => {
    if (search.trim() === '') return true;
    const needle = search.trim().toLowerCase();
    return (
      row.title.toLowerCase().includes(needle) ||
      (row.equipmentName ?? '').toLowerCase().includes(needle) ||
      (row.assetId ?? '').toLowerCase().includes(needle)
    );
  });

  const overdue = rows.filter((row) => (row.daysUntilDue ?? 0) < 0).length;
  const dueSoon = rows.filter(
    (row) => (row.daysUntilDue ?? 999) >= 0 && (row.daysUntilDue ?? 999) <= 7,
  ).length;

  const columns: DataTableColumn<MaintenanceScheduleDto>[] = [
    { field: 'title', headerName: 'Schedule', width: 220 },
    {
      field: 'assetId',
      headerName: 'Asset',
      width: 150,
      valueGetter: (row) => row.assetId ?? '—',
    },
    {
      field: 'equipmentName',
      headerName: 'Equipment',
      width: 200,
      valueGetter: (row) => row.equipmentName ?? '—',
    },
    {
      field: 'frequency',
      headerName: 'Every',
      width: 140,
      valueGetter: (row) => MAINTENANCE_FREQUENCY_LABELS[row.frequency],
    },
    {
      field: 'lastPerformedAt',
      headerName: 'Last done',
      width: 140,
      valueGetter: (row) => formatDate(row.lastPerformedAt),
    },
    {
      field: 'nextDueAt',
      headerName: 'Next due',
      width: 170,
      renderCell: (row) => (
        <Badge variant={(row.daysUntilDue ?? 0) < 0 ? 'destructive' : 'outline'}>
          {dueLabel(row.daysUntilDue)}
        </Badge>
      ),
    },
    {
      field: 'assignedToName',
      headerName: 'Owner',
      width: 150,
      valueGetter: (row) => row.assignedToName ?? row.supplierName ?? 'Unassigned',
    },
    ...(canSchedule
      ? [
          {
            field: 'actions',
            headerName: 'Actions',
            width: 90,
            sortable: false,
            align: 'right' as const,
            alwaysVisible: true,
            renderCell: (row: MaintenanceScheduleDto) => (
              <RowActions>
                <DeleteAction label={row.title} onClick={() => setDeleting(row)} />
              </RowActions>
            ),
          },
        ]
      : []),
  ];

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      notify.success('Schedule removed.');
    } catch (err) {
      notify.fromError(err);
    }
    setDeleting(null);
  }

  async function runSweep(): Promise<void> {
    try {
      const result = await sweep.mutateAsync();
      notify.success(
        `Sweep done — ${result.ticketsRaised} ticket(s) raised, ${result.remindersSent} reminder(s) sent.`,
      );
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Equipment"
        title="Maintenance schedules"
        subtitle="Preventive services. The server raises the ticket when one falls due — nobody has to remember."
        actions={
          canSchedule ? (
            <>
              <Button variant="outline" onClick={() => void runSweep()} disabled={sweep.isPending}>
                {sweep.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlayIcon data-icon="inline-start" />
                )}
                Run sweep now
              </Button>
              <Button onClick={() => setCreating(true)}>
                <PlusIcon data-icon="inline-start" />
                New schedule
              </Button>
            </>
          ) : null
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Overdue" value={overdue} tone="danger" emphasis={overdue > 0} />
        <StatTile label="Due within a week" value={dueSoon} tone="progress" />
        <StatTile label="Active schedules" value={data?.meta.total ?? 0} />
      </div>

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
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
        {...(canSchedule ? { onCreate: () => setCreating(true), createLabel: 'New schedule' } : {})}
      />

      {view === 'table' ? (
        <DataTable
          gridId="maintenance-schedules"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={search.trim() !== ''}
          onRowDoubleClick={(row) => navigate(`/equipment/assets/${row.equipmentId}`)}
          emptyTitle="No preventive schedules"
          emptyMessage="Registering an asset in a category with a recommended interval creates one automatically."
        />
      ) : (
        <EntityCardGrid
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={search.trim() !== ''}
          onCardClick={(row) => navigate(`/equipment/assets/${row.equipmentId}`)}
          emptyTitle="No preventive schedules"
          emptyMessage="Registering an asset in a category with a recommended interval creates one automatically."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold">{row.title}</p>
                <Badge variant={(row.daysUntilDue ?? 0) < 0 ? 'destructive' : 'outline'}>
                  {dueLabel(row.daysUntilDue)}
                </Badge>
              </div>
              <p className="text-muted-foreground text-xs">
                {row.assetId} · {row.equipmentName}
              </p>
              <p className="text-muted-foreground mt-auto text-xs">
                Every {MAINTENANCE_FREQUENCY_LABELS[row.frequency].toLowerCase()} · last done{' '}
                {formatDate(row.lastPerformedAt)}
              </p>
            </div>
          )}
        />
      )}

      <ScheduleFormModal open={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove schedule"
        message={`Stop scheduling "${deleting?.title}"? Tickets it already raised are untouched.`}
        confirmLabel="Remove"
        danger
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function ScheduleFormModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const [equipmentId, setEquipmentId] = useState('');
  const [equipmentSearch, setEquipmentSearch] = useState('');
  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState<MaintenanceFrequency>(MaintenanceFrequency.MONTHLY);
  const [intervalDays, setIntervalDays] = useState('');
  const [anchorDate, setAnchorDate] = useState('');
  const [reminderDays, setReminderDays] = useState('7');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useCreateSchedule();
  const { data: equipment } = useEquipmentList({
    search: equipmentSearch || undefined,
    page: 1,
    pageSize: 25,
  });

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (equipmentId === '') {
      setError('Choose which asset this services.');
      return;
    }

    try {
      await create.mutateAsync({
        equipmentId,
        frequency,
        ...(title.trim() === '' ? {} : { title: title.trim() }),
        intervalDays:
          frequency === MaintenanceFrequency.CUSTOM && intervalDays !== ''
            ? Number(intervalDays)
            : null,
        ...(anchorDate === '' ? {} : { anchorDate }),
        reminderDays: reminderDays === '' ? 7 : Number(reminderDays),
        instructions: instructions || null,
      });
      notify.success('Schedule created.');
      setTitle('');
      setInstructions('');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="maintenance-schedule"
      title="New maintenance schedule"
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={create.isPending}
          saveLabel="Create"
        />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <TextField
            label="Find equipment"
            placeholder="Name, asset id or serial"
            value={equipmentSearch}
            onChange={(event) => setEquipmentSearch(event.target.value)}
          />

          <SelectField
            label="Equipment"
            required
            value={equipmentId}
            onChange={setEquipmentId}
            placeholder="Choose the asset"
            options={(equipment?.items ?? []).map((row) => ({
              value: row.id,
              label: `${row.assetId} · ${row.name}`,
            }))}
          />

          <TextField
            label="Title"
            placeholder="Quarterly service"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={LIMITS.MAINTENANCE_TITLE_MAX}
          />

          <SelectField
            label="Frequency"
            required
            value={frequency}
            onChange={(next) => setFrequency(next as MaintenanceFrequency)}
            options={Object.values(MaintenanceFrequency).map((value) => ({
              value,
              label: MAINTENANCE_FREQUENCY_LABELS[value],
            }))}
          />

          {frequency === MaintenanceFrequency.CUSTOM && (
            <NumberField
              label="Interval (days)"
              required
              value={intervalDays}
              onChange={(event) => setIntervalDays(event.target.value)}
              min={1}
              max={LIMITS.MAINTENANCE_INTERVAL_DAYS_MAX}
            />
          )}

          <TextField
            label="Count from"
            type="date"
            helperText="Defaults to the asset's installation or purchase date."
            value={anchorDate}
            onChange={(event) => setAnchorDate(event.target.value)}
          />

          <NumberField
            label="Remind this many days ahead"
            value={reminderDays}
            onChange={(event) => setReminderDays(event.target.value)}
            min={0}
            max={LIMITS.MAINTENANCE_REMINDER_DAYS_MAX}
          />

          <TextField
            label="Instructions"
            multiline
            rows={3}
            helperText="Copied onto every ticket this schedule raises."
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            maxLength={2000}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
