import { MonitorPlayIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';

export function CDSPage(): JSX.Element {
  return (
    <>
      <PageHeader
        title="Customer Display System"
        subtitle="Guest-facing order summary and payment screen."
      />
      <EmptyState
        icon={<MonitorPlayIcon className="size-6" />}
        title="Customer Display"
        description="Connect a customer-facing screen at the counter to show order totals and payment status."
      />
    </>
  );
}
