import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const TOOLTIP_KEY = 'pos-show-tooltips';
const TOOLTIP_EVENT = 'pos-prefs-change';

function readTooltipPref(): boolean {
  try {
    return localStorage.getItem(TOOLTIP_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function usePosTooltipPref(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(readTooltipPref);

  useEffect(() => {
    const sync = (): void => setEnabled(readTooltipPref());
    window.addEventListener(TOOLTIP_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(TOOLTIP_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const update = useCallback((next: boolean) => {
    localStorage.setItem(TOOLTIP_KEY, String(next));
    setEnabled(next);
    window.dispatchEvent(new Event(TOOLTIP_EVENT));
  }, []);

  return [enabled, update];
}

export function PosTooltip({
  content,
  children,
  asChild = true,
}: {
  content: ReactNode;
  children: ReactNode;
  asChild?: boolean;
}): JSX.Element {
  const [enabled] = usePosTooltipPref();
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}
