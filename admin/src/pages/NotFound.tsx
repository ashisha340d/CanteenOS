import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/ui/EmptyState';

export function NotFoundPage(): JSX.Element {
  const navigate = useNavigate();

  return (
    <EmptyState
      variant="no-results"
      title="Page not found"
      description="That address does not match anything in the portal. It may have been moved or removed."
      action={{ label: 'Back to Overview', onClick: () => navigate('/') }}
    />
  );
}
