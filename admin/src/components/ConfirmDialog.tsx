import { CircleHelpIcon, TriangleAlertIcon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Spinner } from '@/components/ui/spinner';
import { buttonVariants } from '@/components/ui/button';
import { TONE_BG_CLASS, TONE_TEXT_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A plain, non-draggable confirmation — deliberately not the record-editing Modal. The mark
 * carries the severity so the wording does not have to shout, and destructive confirmations
 * look visibly different from routine ones before the text is read.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  const tone = danger ? 'danger' : 'info';

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !loading && onCancel()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-md [&_svg]:size-5',
                TONE_BG_CLASS[tone],
                TONE_TEXT_CLASS[tone],
              )}
            >
              {danger ? <TriangleAlertIcon /> : <CircleHelpIcon />}
            </span>
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="whitespace-pre-line sm:pl-12">
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Confirming is asynchronous here; letting the dialog auto-close would unmount
              // the spinner and hide that anything is happening.
              event.preventDefault();
              onConfirm();
            }}
            disabled={loading}
            className={cn(danger && buttonVariants({ variant: 'destructive' }))}
          >
            {loading && <Spinner data-icon="inline-start" />}
            {loading ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
