import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Capability,
  TASK_SOURCE_LABELS,
  TaskKind,
  TaskPriority,
  TaskStatus,
  type TaskDto,
} from '@menuboard/shared';
import { PlusIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatTile } from '@/components/ui/StatTile';
import { DeleteAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { usersApi } from '../../api/users';
import { useAuth } from '../../services/AuthContext';
import { useCancelTask, useDeleteTask, useTasks, useTeamActivity } from '../../hooks/useTasks';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { AssignTaskModal } from './AssignTaskModal';

function formatWhen(value: string | null): string {
  if (value === null) return '—';
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_VARIANT: Record<TaskStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  PENDING: 'outline',
  IN_PROGRESS: 'default',
  COMPLETED: 'secondary',
  CANCELLED: 'destructive',
};

/**
 * Task assignment. The administrator's half of the volunteers' "My Tasks" screen: hand work
 * out, see who is on what, and stand down work that is no longer needed.
 *
 * Deliberately not a scheduler — there is no calendar and no deadline field. A task's only
 * deadline comes from the order it was derived from, which is set on the order itself.
 */
export function TasksPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canAssign = hasCapability(Capability.TASK_ASSIGN);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [assignedTo, setAssignedTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('tasks');
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState<TaskDto | null>(null);
  const [deleting, setDeleting] = useState<TaskDto | null>(null);

  const query = useMemo(
    () => ({
      search: search || undefined,
      status: status || undefined,
      assignedTo: assignedTo || undefined,
      page,
      pageSize,
    }),
    [search, status, assignedTo, page, pageSize],
  );

  const { data, isLoading } = useTasks(query);
  const activity = useTeamActivity();
  const cancel = useCancelTask();
  const del = useDeleteTask();

  const { data: users } = useQuery({
    queryKey: ['task-assignee-options'],
    queryFn: () => usersApi.list({ page: 1, pageSize: 200 }),
  });

  const working = activity.data?.filter((m) => m.status === 'WORKING').length ?? 0;
  const free = activity.data?.filter((m) => m.status === 'FREE').length ?? 0;
  const off = activity.data?.filter((m) => m.status === 'OFF').length ?? 0;
  const filtersActive = Boolean(status) || Boolean(assignedTo) || search.trim() !== '';

  const columns: DataTableColumn<TaskDto>[] = [
    { field: 'title', headerName: 'Task', width: 260 },
    {
      field: 'assignedToName',
      headerName: 'Volunteer',
      width: 170,
      valueGetter: (r) => r.assignedToName ?? '—',
    },
    {
      field: 'source',
      headerName: 'Source',
      width: 140,
      renderCell: (r) => <Badge variant="outline">{TASK_SOURCE_LABELS[r.source]}</Badge>,
    },
    {
      field: 'kind',
      headerName: 'Type',
      width: 110,
      valueGetter: (r) => (r.kind === TaskKind.OFF_TIME ? 'Off time' : 'Work'),
    },
    {
      field: 'orderNumber',
      headerName: 'Order',
      width: 150,
      valueGetter: (r) => r.orderNumber ?? '—',
    },
    { field: 'dueAt', headerName: 'Deadline', width: 150, valueGetter: (r) => formatWhen(r.dueAt) },
    {
      field: 'priority',
      headerName: 'Priority',
      width: 100,
      renderCell: (r) =>
        r.priority === TaskPriority.HIGH ? <Badge variant="destructive">High</Badge> : <>Normal</>,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 130,
      renderCell: (r) => <Badge variant={STATUS_VARIANT[r.status]}>{r.status.replace('_', ' ')}</Badge>,
    },
    {
      field: 'startedAt',
      headerName: 'Started',
      width: 150,
      valueGetter: (r) => formatWhen(r.startedAt),
    },
    ...(canAssign
      ? [
          {
            field: 'actions',
            headerName: 'Actions',
            width: 110,
            sortable: false,
            align: 'right' as const,
            alwaysVisible: true,
            renderCell: (r: TaskDto) => (
              <RowActions>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={r.status === TaskStatus.COMPLETED || r.status === TaskStatus.CANCELLED}
                  onClick={() => setCancelling(r)}
                >
                  Stand down
                </Button>
                <DeleteAction label={r.title} onClick={() => setDeleting(r)} />
              </RowActions>
            ),
          },
        ]
      : []),
  ];

  async function confirmCancel(): Promise<void> {
    if (!cancelling) return;
    try {
      await cancel.mutateAsync(cancelling.id);
      notify.success('Task stood down.');
    } catch (err) {
      notify.fromError(err);
    }
    setCancelling(null);
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      notify.success('Task deleted.');
    } catch (err) {
      notify.fromError(err);
    }
    setDeleting(null);
  }

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Tasks"
        subtitle="Work handed to volunteers. Assigning an order already creates its task automatically."
        actions={
          canAssign ? (
            <Button onClick={() => setAssigning(true)}>
              <PlusIcon />
              Assign task
            </Button>
          ) : null
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Working now" value={working} />
        <StatTile label="Free" value={free} />
        <StatTile label="Off time" value={off} />
      </div>

      <ListToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        activeFilterCount={(status ? 1 : 0) + (assignedTo ? 1 : 0)}
        onClearFilters={() => {
          setStatus('');
          setAssignedTo('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Status"
              value={status}
              onChange={(v) => {
                setStatus(v as TaskStatus | '');
                setPage(1);
              }}
              emptyLabel="All statuses"
              options={enumOptions(TaskStatus)}
            />
            <SelectField
              label="Volunteer"
              value={assignedTo}
              onChange={(v) => {
                setAssignedTo(v);
                setPage(1);
              }}
              emptyLabel="Everyone"
              options={(users?.items ?? []).map((u) => ({ value: u.id, label: u.name }))}
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
        {...(canAssign ? { onCreate: () => setAssigning(true), createLabel: 'Assign task' } : {})}
      />

      {view === 'table' ? (
        <DataTable
          gridId="tasks"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          filtered={filtersActive}
          emptyTitle="No tasks yet"
          emptyMessage="Assign work to a volunteer, or assign an order to somebody — that creates their task automatically."
          {...(canAssign
            ? { emptyAction: { label: 'Assign task', onClick: () => setAssigning(true) } }
            : {})}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          filtered={filtersActive}
          emptyTitle="No tasks yet"
          emptyMessage="Assign work to a volunteer, or assign an order to somebody."
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">{r.title}</p>
                <Badge variant={STATUS_VARIANT[r.status]}>{r.status.replace('_', ' ')}</Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {r.assignedToName ?? '—'} · {TASK_SOURCE_LABELS[r.source]}
              </p>
              <p className="text-muted-foreground flex-1 text-xs">
                {r.orderNumber !== null && r.orderNumber !== undefined
                  ? `Order ${r.orderNumber} · due ${formatWhen(r.dueAt)}`
                  : 'No deadline'}
              </p>
            </div>
          )}
        />
      )}

      <AssignTaskModal
        open={assigning}
        onClose={() => setAssigning(false)}
        users={users?.items ?? []}
      />

      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Stand down task"
        message={`Cancel "${cancelling?.title}"? It disappears from the volunteer's list; nothing they have already done is lost.`}
        confirmLabel="Stand down"
        loading={cancel.isPending}
        onConfirm={confirmCancel}
        onCancel={() => setCancelling(null)}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete task"
        message={`Delete "${deleting?.title}" entirely? Standing it down is usually the better record.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
