import { TONE_CHIP_CLASS, TONE_DOT_CLASS, type StatusToneName } from '@/lib/tones';
import { cn } from '@/lib/utils';

/**
 * Statuses map onto four meanings — waiting, moving, done, stopped — rather than getting a
 * colour each. A reader learns four colours; they never learn thirteen.
 */
const TONE_MAP: Record<string, StatusToneName> = {
  /* waiting */
  PENDING: 'progress',
  INVITED: 'progress',
  QUEUED: 'progress',
  SCHEDULED: 'progress',
  UNPAID: 'progress',
  SUBMITTED: 'progress',
  /* moving */
  ACKNOWLEDGED: 'info',
  COUNTING: 'info',
  APPROVED: 'info',
  WORK_IN_PROGRESS: 'info',
  GENERATED: 'info',
  DOWNLOADING: 'info',
  TRANSCRIBING: 'info',
  OCR: 'info',
  ANALYZING: 'info',
  OPEN: 'info',
  PARTIAL: 'info',
  /* done / healthy */
  ACTIVE: 'success',
  COMPLETED: 'success',
  FINALIZED: 'success',
  READY: 'success',
  PAID: 'success',
  POSTED: 'success',
  /* stopped */
  CANCELLED: 'danger',
  SUSPENDED: 'danger',
  FAILED: 'danger',
  VOIDED: 'danger',
  /* dormant */
  INACTIVE: 'muted',
  ARCHIVED: 'muted',
  REMOVED: 'muted',
  SAVED: 'muted',
  DRAFT: 'muted',
};

/** Statuses that describe a live, moving thing get a pulsing dot; settled ones stay still. */
const LIVE_STATUSES = new Set([
  'WORK_IN_PROGRESS',
  'PENDING',
  'QUEUED',
  'DOWNLOADING',
  'TRANSCRIBING',
  'OCR',
  'ANALYZING',
  // A ticket on the counter is the definition of a live thing.
  'OPEN',
]);

export function StatusChip({ status, className }: { status: string; className?: string }): JSX.Element {
  const tone = TONE_MAP[status] ?? 'neutral';
  const isLive = LIVE_STATUSES.has(status);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 whitespace-nowrap',
        'text-[0.7188rem] leading-none font-semibold tracking-[0.01em]',
        TONE_CHIP_CLASS[tone],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-[5px] shrink-0 rounded-full',
          TONE_DOT_CLASS[tone],
          // motion-safe so the OS "reduce motion" setting silences it.
          isLive && 'motion-safe:animate-pulse',
        )}
      />
      {status.replace(/_/g, ' ')}
    </span>
  );
}
