import { ClipboardListIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

export function SopModulePlaceholder(): JSX.Element {
  return (
    <EmptyState
      icon={<ClipboardListIcon className="size-6" />}
      title="SOP"
      description="Standard operating procedures module. Details to be discussed and implemented."
    />
  );
}
