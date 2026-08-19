import { MonitorIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';

export function KDSPage(): JSX.Element {
  return (
    <>
      <PageHeader
        title="Kitchen Display System"
        subtitle="Live order tickets for the kitchen. Connect a screen to start showing tickets."
      />
      <EmptyState
        icon={<MonitorIcon className="size-6" />}
        title="Kitchen Display"
        description="Open /kiosk or mount a dedicated screen on the kitchen wall to display live tickets."
      />
    </>
  );
}
