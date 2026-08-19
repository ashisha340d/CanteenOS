import { SparklesIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';

export function CleaningPage(): JSX.Element {
  return (
    <>
      <PageHeader
        title="Cleaning"
        subtitle="Cleaning schedules, checklists and area assignments."
      />
      <EmptyState
        icon={<SparklesIcon className="size-6" />}
        title="Cleaning module coming soon"
        description="This module will hold cleaning schedules, area checklists and task assignments."
      />
    </>
  );
}
