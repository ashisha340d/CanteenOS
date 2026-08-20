import { useState } from 'react';
import {
  CLEANING_TASK_STATUS_LABELS,
  CLEANING_TRIGGER_EVENT_LABELS,
  Capability,
} from '@menuboard/shared';
import {
  AlertTriangleIcon,
  ClipboardCheckIcon,
  ListChecksIcon,
  MegaphoneIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  SparklesIcon,
  UserXIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatTile } from '@/components/ui/StatTile';
import { EmptyState } from '@/components/ui/EmptyState';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/notify';
import { useAuth } from '../../services/AuthContext';
import { useCleaningDashboard, useRunCleaningSweep } from '../../hooks/useCleaning';
import {
  CLEANING_PRIORITY_TONE,
  CLEANING_TASK_STATUS_TONE,
  complianceTone,
  dueLabel,
  formatDateTime,
} from './cleaningTone';
import { ReportCleaningModal } from './ReportCleaningModal';
import { CleaningTaskDrawer } from './CleaningTaskDrawer';

/**
 * The module's landing screen: what is late, what needs checking, and what people have just
 * reported.
 *
 * The three lists are chosen because they are the three questions a supervisor opens this
 * screen to answer. Everything else — the register, the rules, the record — is a tab away and
 * is not urgent by nature.
 */
export function CleaningOverviewPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canReport = hasCapability(Capability.CLEANING_REPORT_INCIDENT);
  const canSweep = hasCapability(Capability.CLEANING_RULE_MANAGE);

  const { data, isLoading } = useCleaningDashboard();
  const sweep = useRunCleaningSweep();
  const [reporting, setReporting] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const counts = data?.counts;

  async function runSweep(): Promise<void> {
    try {
      const result = await sweep.mutateAsync(undefined);
      notify.success(
        result.tasksCreated > 0
          ? `${result.tasksCreated} cleaning task${result.tasksCreated === 1 ? '' : 's'} raised.`
          : 'Nothing was due. Everything scheduled is already raised.',
      );
    } catch (error) {
      notify.fromError(error);
    }
  }

  return (
    <>
      <PageHeader
        title="Cleaning"
        meta={
          data && (
            <span
              className={cn(
                'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                TONE_CHIP_CLASS[complianceTone(data.complianceRate)],
              )}
            >
              {data.complianceRate}% on time (7 days)
            </span>
          )
        }
        actions={
          <>
            {canSweep && (
              <Button variant="outline" onClick={runSweep} disabled={sweep.isPending}>
                <RefreshCwIcon data-icon="inline-start" />
                Raise what is due
              </Button>
            )}
            {canReport && (
              <Button onClick={() => setReporting(true)}>
                <MegaphoneIcon data-icon="inline-start" />
                Report something
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Open"
          value={counts?.openTasks ?? 0}
          icon={<ListChecksIcon />}
          hint="Cleaning still to do"
        />
        <StatTile
          label="Overdue"
          value={counts?.overdueTasks ?? 0}
          tone="danger"
          emphasis={(counts?.overdueTasks ?? 0) > 0}
          icon={<AlertTriangleIcon />}
          hint="Past their deadline"
        />
        <StatTile
          label="Needs an owner"
          value={counts?.unassignedTasks ?? 0}
          tone="progress"
          emphasis={(counts?.unassignedTasks ?? 0) > 0}
          icon={<UserXIcon />}
          hint="Nobody eligible was on shift"
        />
        <StatTile
          label="Awaiting check"
          value={counts?.awaitingVerification ?? 0}
          tone="info"
          icon={<ClipboardCheckIcon />}
          hint="Done, not yet signed off"
        />
        <StatTile
          label="Critical uncleaned"
          value={counts?.criticalAssetsUncleaned ?? 0}
          tone="danger"
          emphasis={(counts?.criticalAssetsUncleaned ?? 0) > 0}
          icon={<ShieldAlertIcon />}
          hint="High-risk or food-contact"
        />
        <StatTile
          label="Reported today"
          value={counts?.reportsToday ?? 0}
          icon={<MegaphoneIcon />}
          hint="Raised from the floor"
        />
      </div>

      {/* The second row is configuration health rather than daily work: these numbers should
          be zero, and when they are not, nothing else on this page can be trusted. */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="In progress" value={counts?.inProgress ?? 0} tone="progress" />
        <StatTile label="Needs recleaning" value={counts?.recleanRequired ?? 0} tone="danger" />
        <StatTile
          label="Corrective actions"
          value={counts?.openCorrectiveActions ?? 0}
          tone={(counts?.overdueCorrectiveActions ?? 0) > 0 ? 'danger' : 'neutral'}
          hint={`${counts?.overdueCorrectiveActions ?? 0} overdue`}
        />
        <StatTile
          label="Check pass rate"
          value={`${data?.verificationPassRate ?? 100}%`}
          tone={complianceTone(data?.verificationPassRate ?? 100)}
          hint="Last 7 days"
        />
        <StatTile
          label="Assets with no rule"
          value={counts?.assetsWithoutRules ?? 0}
          tone={(counts?.assetsWithoutRules ?? 0) > 0 ? 'progress' : 'muted'}
          hint="Nothing schedules them"
        />
        <StatTile
          label="Expired chemicals"
          value={counts?.expiredChemicals ?? 0}
          tone={(counts?.expiredChemicals ?? 0) > 0 ? 'danger' : 'muted'}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel
          title="Overdue"
          subtitle="Worst first. Every one of these is a hygiene record with a gap in it."
          empty="Nothing is overdue."
          loading={isLoading}
          rows={data?.overdue ?? []}
          renderRow={(task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => setOpenTaskId(task.id)}
              className="hover:bg-accent/50 focus-ring flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{task.taskName}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {task.locationPath} · {task.assignedToName ?? 'Unassigned'}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={cn(
                    'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                    TONE_CHIP_CLASS[CLEANING_PRIORITY_TONE[task.priority]],
                  )}
                >
                  {task.priority}
                </span>
                <span className="text-tone-danger text-xs font-medium">
                  {dueLabel(task.dueAt, task.isOverdue)}
                </span>
              </div>
            </button>
          )}
        />

        <Panel
          title="Waiting to be checked"
          subtitle="Somebody has finished these. Nobody may sign off their own work."
          empty="Nothing is waiting for a check."
          loading={isLoading}
          rows={data?.awaitingVerification ?? []}
          renderRow={(task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => setOpenTaskId(task.id)}
              className="hover:bg-accent/50 focus-ring flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{task.taskName}</p>
                <p className="text-muted-foreground truncate text-xs">
                  Done by {task.completedByName ?? '—'} · {formatDateTime(task.completedAt)}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                  TONE_CHIP_CLASS[CLEANING_TASK_STATUS_TONE[task.status]],
                )}
              >
                {CLEANING_TASK_STATUS_LABELS[task.status]}
              </span>
            </button>
          )}
        />

        <Panel
          title="Just reported"
          subtitle="What people on the floor have said needs cleaning."
          empty="Nobody has reported anything."
          loading={isLoading}
          rows={data?.recentReports ?? []}
          renderRow={(event) => (
            <div
              key={event.id}
              className="flex items-start justify-between gap-3 rounded-md px-2 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {event.note ?? CLEANING_TRIGGER_EVENT_LABELS[event.eventType]}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {event.cleanableAssetName ?? event.areaName ?? '—'} ·{' '}
                  {event.reportedByName ?? 'System'} · {formatDateTime(event.occurredAt)}
                </p>
              </div>
              <span className="text-muted-foreground shrink-0 text-xs">
                {event.tasksCreated === 0
                  ? 'no task'
                  : `${event.tasksCreated} task${event.tasksCreated === 1 ? '' : 's'}`}
              </span>
            </div>
          )}
        />

        <Panel
          title="By area"
          subtitle="Where the work is, and who owns it."
          empty="No areas are set up yet."
          loading={isLoading}
          rows={data?.byArea ?? []}
          renderRow={(area) => (
            <div
              key={area.areaId}
              className="flex items-start justify-between gap-3 rounded-md px-2 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{area.areaName}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {area.assetCount} asset{area.assetCount === 1 ? '' : 's'} ·{' '}
                  {area.responsibleNames.length > 0
                    ? area.responsibleNames.join(', ')
                    : 'nobody responsible'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {area.overdueTasks > 0 && (
                  <span
                    className={cn(
                      'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                      TONE_CHIP_CLASS.danger,
                    )}
                  >
                    {area.overdueTasks} overdue
                  </span>
                )}
                <span
                  className={cn(
                    'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                    TONE_CHIP_CLASS[complianceTone(area.complianceRate)],
                  )}
                >
                  {area.complianceRate}%
                </span>
              </div>
            </div>
          )}
        />
      </div>

      <ReportCleaningModal open={reporting} onClose={() => setReporting(false)} />
      <CleaningTaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </>
  );
}

function Panel<T>({
  title,
  subtitle,
  empty,
  rows,
  renderRow,
  loading,
}: {
  title: string;
  subtitle: string;
  empty: string;
  rows: T[];
  renderRow: (row: T) => JSX.Element;
  loading?: boolean;
}): JSX.Element {
  return (
    <section className="bg-card rounded-xl border p-4">
      <header className="mb-2">
        <h2 className="font-heading text-sm font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-xs">{subtitle}</p>
      </header>
      {loading ? (
        <p className="text-muted-foreground py-6 text-center text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<SparklesIcon className="size-5" />}
          title={empty}
          description=""
        />
      ) : (
        <div className="divide-border -mx-2 divide-y">{rows.map(renderRow)}</div>
      )}
    </section>
  );
}
