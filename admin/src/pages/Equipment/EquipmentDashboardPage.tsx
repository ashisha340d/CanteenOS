import { useNavigate } from 'react-router-dom';
import {
  Capability,
  EQUIPMENT_STATUS_LABELS,
  MAINTENANCE_TICKET_STATUS_LABELS,
  WarrantyStatus,
} from '@menuboard/shared';
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  PackageSearchIcon,
  PhoneCallIcon,
  PlusIcon,
  ShieldAlertIcon,
  WrenchIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatTile } from '@/components/ui/StatTile';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/Skeletons';
import { useAuth } from '../../services/AuthContext';
import { useEquipmentDashboard } from '../../hooks/useEquipment';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { dueLabel, formatDate, PRIORITY_TONE, TICKET_STATUS_TONE } from './equipmentTone';

/**
 * The module's landing screen.
 *
 * Leads with problems rather than statistics: the counters exist to be clicked through to a
 * filtered list, and the two lists below them are the actual content. A manager opening this
 * page should be able to answer "what is broken and what is coming" without scrolling.
 */
export function EquipmentDashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const { hasCapability } = useAuth();
  const canRegister = hasCapability(Capability.EQUIPMENT_CREATE);
  const { data, isLoading } = useEquipmentDashboard();

  if (isLoading || data === undefined) return <PageSkeleton />;

  const { counts } = data;

  return (
    <>
      <PageHeader
        eyebrow="Equipment"
        title="Equipment & Maintenance"
        subtitle="What is running, what has stopped, and what falls due next."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/equipment/assets')}>
              <PackageSearchIcon data-icon="inline-start" />
              All equipment
            </Button>
            {canRegister && (
              <Button onClick={() => navigate('/equipment/assets?register=1')}>
                <PlusIcon data-icon="inline-start" />
                Register equipment
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Open problems"
          value={counts.openProblems}
          hint={`${counts.criticalProblems} critical`}
          tone="danger"
          emphasis={counts.criticalProblems > 0}
          icon={<AlertTriangleIcon />}
          onClick={() => navigate('/maintenance?openOnly=1')}
        />
        <StatTile
          label="Maintenance overdue"
          value={counts.maintenanceOverdue}
          hint={`${counts.maintenanceDue} due within a week`}
          tone="progress"
          emphasis={counts.maintenanceOverdue > 0}
          icon={<CalendarClockIcon />}
          onClick={() => navigate('/maintenance/schedules')}
        />
        <StatTile
          label="Out of service"
          value={counts.outOfService}
          hint={`${counts.operational} of ${counts.totalEquipment} operational`}
          tone="danger"
          emphasis={counts.outOfService > 0}
          icon={<WrenchIcon />}
          onClick={() => navigate('/equipment/assets?status=OUT_OF_SERVICE')}
        />
        <StatTile
          label="Warranty expiring"
          value={counts.warrantyExpiring}
          hint="Within 60 days"
          tone="info"
          icon={<ShieldAlertIcon />}
          onClick={() => navigate(`/equipment/assets?warrantyStatus=${WarrantyStatus.EXPIRING_SOON}`)}
        />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open tickets" value={counts.openTickets} onClick={() => navigate('/maintenance')} />
        <StatTile
          label="Technician visits pending"
          value={counts.technicianVisitsPending}
          onClick={() => navigate('/maintenance?status=TECHNICIAN_SCHEDULED')}
        />
        <StatTile
          label="Waiting for parts"
          value={counts.partsRequired}
          onClick={() => navigate('/maintenance?status=WAITING_FOR_PARTS')}
        />
        <StatTile
          label="Supplier follow-ups"
          value={counts.supplierFollowUps}
          icon={<PhoneCallIcon />}
          onClick={() => navigate('/equipment-suppliers')}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="bg-card rounded-xl border p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-heading text-base font-semibold">Recent problems</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/maintenance')}>
              View all
            </Button>
          </div>

          {data.recentProblems.length === 0 ? (
            <EmptyState
              title="Nothing is broken"
              description="Every asset is running. Problems reported from the floor land here first."
            />
          ) : (
            <ul className="divide-border divide-y">
              {data.recentProblems.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/maintenance/tickets/${ticket.id}`)}
                    className="focus-ring hover:bg-accent/50 flex w-full items-start gap-3 rounded-md px-1 py-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground font-mono text-xs">
                          {ticket.ticketNumber}
                        </span>
                        <span
                          className={cn(
                            'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                            TONE_CHIP_CLASS[PRIORITY_TONE[ticket.priority]],
                          )}
                        >
                          {ticket.priority}
                        </span>
                        <span
                          className={cn(
                            'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                            TONE_CHIP_CLASS[TICKET_STATUS_TONE[ticket.status]],
                          )}
                        >
                          {MAINTENANCE_TICKET_STATUS_LABELS[ticket.status]}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-sm font-medium">{ticket.title}</span>
                      <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                        {ticket.assetId} · {ticket.locationPath ?? 'No location'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-card rounded-xl border p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-heading text-base font-semibold">Upcoming maintenance</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/maintenance/schedules')}>
              View all
            </Button>
          </div>

          {data.upcomingMaintenance.length === 0 ? (
            <EmptyState
              title="Nothing scheduled"
              description="Preventive schedules created against an asset show their next service here."
            />
          ) : (
            <ul className="divide-border divide-y">
              {data.upcomingMaintenance.map((schedule) => (
                <li key={schedule.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{schedule.title}</p>
                    <p className="text-muted-foreground mt-0.5 truncate text-xs">
                      {schedule.assetId} · {schedule.equipmentName}
                    </p>
                  </div>
                  <Badge variant={(schedule.daysUntilDue ?? 0) < 0 ? 'destructive' : 'outline'}>
                    {dueLabel(schedule.daysUntilDue)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {data.warrantyExpiring.length > 0 && (
        <section className="bg-card mt-6 rounded-xl border p-4">
          <h2 className="font-heading mb-3 text-base font-semibold">Warranties expiring soon</h2>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.warrantyExpiring.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/equipment/assets/${asset.id}`)}
                  className="focus-ring hover:bg-accent/50 flex w-full items-center gap-3 rounded-md border p-2 text-left"
                >
                  <span className="bg-muted size-10 shrink-0 overflow-hidden rounded-md">
                    {asset.imageUrl !== null && (
                      <img src={asset.imageUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{asset.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {asset.assetId} · expires {formatDate(asset.warrantyExpiry)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-muted-foreground mt-6 text-xs">
        Statuses shown here are set by people and by the maintenance workflow —{' '}
        {EQUIPMENT_STATUS_LABELS.OPERATIONAL.toLowerCase()} means somebody said so, not that a
        sensor reported it.
      </p>
    </>
  );
}
