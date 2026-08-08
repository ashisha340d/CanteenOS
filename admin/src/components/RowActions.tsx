import type { ReactNode } from 'react';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The edit/delete pair at the end of a row. Wrapping them here keeps the accessible names
 * ("Edit Kitchen", not "Edit") and the disabled-with-explanation pattern consistent — a
 * disabled button swallows pointer events, so the tooltip has to wrap a live element for the
 * reason to be readable at all.
 */
export function RowActions({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex items-center justify-end gap-0.5">{children}</div>;
}

interface ActionProps {
  onClick: () => void;
  /** Names the record so the control reads as "Edit Kitchen" to a screen reader. */
  label: string;
  disabled?: boolean;
  /** Shown instead of the default tooltip — use it to say *why* it is disabled. */
  tooltip?: string;
}

export function EditAction({ onClick, label, disabled, tooltip }: ActionProps): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          disabled={disabled}
          aria-label={`Edit ${label}`}
        >
          <PencilIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? 'Edit'}</TooltipContent>
    </Tooltip>
  );
}

export function DeleteAction({ onClick, label, disabled, tooltip }: ActionProps): JSX.Element {
  return (
    <Tooltip>
      {/* The span keeps the trigger hoverable once the button inside it goes disabled. */}
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClick}
            disabled={disabled}
            aria-label={`Delete ${label}`}
            className="hover:text-destructive"
          >
            <Trash2Icon />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? 'Delete'}</TooltipContent>
    </Tooltip>
  );
}
