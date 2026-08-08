import { ArrowLeftIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

/** Explicit Back control required on every drill-down page (docs/AGENTS.md Grid Standard). */
export function BackButton({ to, label = 'Back' }: { to: string; label?: string }): JSX.Element {
  const navigate = useNavigate();
  return (
    <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(to)}>
      <ArrowLeftIcon data-icon="inline-start" />
      {label}
    </Button>
  );
}
