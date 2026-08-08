import type { ReactNode } from 'react';
import {
  CalendarDaysIcon,
  CircleAlertIcon,
  CircleCheckBigIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  ReceiptTextIcon,
  UsersIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatGridSkeleton } from '../../components/ui/Skeletons';
import { StatTile } from '../../components/ui/StatTile';
import { useDashboard } from '../../hooks/useAdmin';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const TODAY_LABEL = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** A group of tiles under one heading, so the eye parses the page in three passes not ten. */
function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section>
      <h2 className="text-muted-foreground mb-3 text-xs font-medium tracking-[0.06em] uppercase">
        {title}
      </h2>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        {children}
      </div>
    </section>
  );
}

export function DashboardPage(): JSX.Element {
  const { data, isLoading } = useDashboard();
  const navigate = useNavigate();

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="Overview" subtitle={TODAY_LABEL.format(new Date())} />
        <div className="flex flex-col gap-8">
          <StatGridSkeleton count={4} />
          <StatGridSkeleton count={4} />
        </div>
      </>
    );
  }

  const lastBilling = data.billing.lastGeneratedAt
    ? new Date(data.billing.lastGeneratedAt).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Never';

  return (
    <>
      <PageHeader
        eyebrow={TODAY_LABEL.format(new Date())}
        title={greeting()}
        subtitle="Everything happening across your boards right now."
      />

      <div className="flex flex-col gap-8">
        <Section title="Orders">
          <StatTile
            label="Due today"
            value={data.orders.today}
            hint="Scheduled for today"
            tone="info"
            icon={<CalendarDaysIcon />}
          />
          <StatTile
            label="Open"
            value={data.orders.open}
            hint="Not yet completed"
            tone="progress"
            icon={<ClipboardListIcon />}
          />
          <StatTile
            label="Completed today"
            value={data.orders.completedToday}
            hint="Finished in the last 24h"
            tone="success"
            icon={<CircleCheckBigIcon />}
          />
          {/* Overdue is the only number here that demands an action, so it is the only one
              allowed to shout — and only when it is actually non-zero. */}
          <StatTile
            label="Overdue"
            value={data.orders.overdue}
            hint={data.orders.overdue === 0 ? 'Nothing is late' : 'Past their required time'}
            tone={data.orders.overdue > 0 ? 'danger' : 'success'}
            emphasis={data.orders.overdue > 0}
            icon={<CircleAlertIcon />}
          />
        </Section>

        <Section title="Organisation">
          <StatTile
            label="Boards"
            value={data.boards.active}
            hint={`${data.boards.total} total`}
            tone="neutral"
            icon={<LayoutDashboardIcon />}
            onClick={() => navigate('/boards')}
          />
          <StatTile
            label="Users"
            value={data.users.active}
            hint={`${data.users.total} total`}
            tone="neutral"
            icon={<UsersIcon />}
            onClick={() => navigate('/users')}
          />
          <StatTile
            label="Billing exports"
            value={data.billing.exportsThisMonth}
            hint="This month"
            tone="neutral"
            icon={<ReceiptTextIcon />}
            onClick={() => navigate('/billing')}
          />
          <StatTile
            label="Last export"
            value={lastBilling}
            hint="Most recent snapshot"
            tone="muted"
          />
        </Section>
      </div>
    </>
  );
}
