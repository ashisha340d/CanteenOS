import { useState } from 'react';
import { MasterStatus } from '@menuboard/shared';
import { LockIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchPickerField } from '../../components/SearchPickerField';
import { useVendors } from '../../hooks/usePurchase';
import type { StatusToneName } from '@/lib/tones';
import { Chip } from '../Stock/stockFormat';

/**
 * The pieces every vendor-accounting screen needs: the same supplier picker, the same
 * not-permitted and failed-to-load panels, and one definition of what "overdue" looks like.
 * Five tabs asking the same questions should not ask them five different ways.
 */

export interface SupplierChoice {
  id: string;
  label: string;
}

export function SupplierPicker({
  id,
  value,
  displayValue,
  onChange,
  label = 'Supplier',
  required,
  disabled,
}: {
  id: string;
  value: string;
  displayValue: string;
  onChange: (choice: SupplierChoice | null) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useVendors({
    page: 1,
    pageSize: 20,
    status: MasterStatus.ACTIVE,
    ...(search === '' ? {} : { search }),
  });

  return (
    <SearchPickerField
      id={id}
      label={label}
      value={value === '' ? null : value}
      displayValue={displayValue}
      loading={isFetching}
      required={required}
      disabled={disabled}
      onSearchChange={setSearch}
      options={(data?.items ?? []).map((vendor) => ({
        id: vendor.id,
        label: vendor.name,
        sublabel: [vendor.code, vendor.gstin].filter(Boolean).join(' · '),
      }))}
      onSelect={(option) => onChange({ id: option.id, label: option.label })}
      onClear={() => onChange(null)}
    />
  );
}

export function NotPermitted({ what, capability }: { what: string; capability: string }): JSX.Element {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center">
      <LockIcon className="text-muted-foreground size-5" aria-hidden />
      <p className="text-sm font-medium">{what} is not visible to your role.</p>
      <p className="text-muted-foreground text-sm">Ask an administrator for {capability}.</p>
    </div>
  );
}

export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }): JSX.Element {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
      <p className="text-sm font-medium">{what} could not be loaded.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** How close a bill is to hurting: quiet until a week out, loud once the date has passed. */
const DUE_SOON_DAYS = 7;

export function overdueTone(days: number | null | undefined): StatusToneName {
  if (days === null || days === undefined) return 'muted';
  if (days > 0) return 'danger';
  if (days >= -DUE_SOON_DAYS) return 'progress';
  return 'muted';
}

export function OverdueCell({ days }: { days: number | null | undefined }): JSX.Element {
  if (days === null || days === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  const label =
    days > 0
      ? `${days}d overdue`
      : days === 0
        ? 'Due today'
        : `${Math.abs(days)}d to go`;
  return <Chip tone={overdueTone(days)}>{label}</Chip>;
}

/** Ageing buckets get louder as they get older, using the existing six tones and nothing else. */
export function ageingTone(bucket: 'notDue' | 'days0to30' | 'days31to60' | 'days61to90' | 'over90'): StatusToneName {
  switch (bucket) {
    case 'notDue':
      return 'muted';
    case 'days0to30':
      return 'info';
    case 'days31to60':
      return 'progress';
    default:
      return 'danger';
  }
}

/**
 * A footer of column sums. The API exposes no aggregate over the whole filtered set, so this
 * is deliberately labelled as covering only the rows on screen rather than quietly implying
 * it is the total liability.
 */
export function TotalsBar({
  caption,
  figures,
}: {
  caption: string;
  figures: { label: string; value: string; strong?: boolean }[];
}): JSX.Element {
  return (
    <div className="bg-card sticky bottom-0 z-10 mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border px-3 py-2">
      <span className="text-muted-foreground text-xs font-medium tracking-[0.06em] uppercase">
        {caption}
      </span>
      <div className="flex flex-1 flex-wrap items-center justify-end gap-x-6 gap-y-1">
        {figures.map((figure) => (
          <span key={figure.label} className="flex items-baseline gap-1.5">
            <span className="text-muted-foreground text-xs">{figure.label}</span>
            <span
              className={
                figure.strong === true
                  ? 'text-sm font-semibold tabular-nums'
                  : 'text-sm tabular-nums'
              }
            >
              {figure.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
