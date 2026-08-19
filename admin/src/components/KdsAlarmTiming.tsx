import { useEffect, useState } from 'react';
import { CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSettings, useUpdateSetting } from '../hooks/useAdmin';
import { notify } from '@/lib/notify';

interface NumberSetting {
  key: string;
  label: string;
  hint: string;
  suffix: string;
  min: number;
  max: number;
}

const TIMINGS: NumberSetting[] = [
  {
    key: 'kds.default_prep_seconds',
    label: 'Default prep time',
    hint: 'A line is due this many seconds after the order is placed, unless its menu item states its own prep time.',
    suffix: 'seconds',
    min: 30,
    max: 86400,
  },
  {
    key: 'kds.due_soon_seconds',
    label: 'Attention alarm fires',
    hint: 'How long before a line’s due time the attention buzzer calls the counter.',
    suffix: 'seconds before due',
    min: 0,
    max: 7200,
  },
  {
    key: 'kds.overdue_repeat_seconds',
    label: 'Critical repeats every',
    hint: 'Once a line is past due, the critical buzzer keeps sounding at this interval until it is served.',
    suffix: 'seconds',
    min: 10,
    max: 3600,
  },
  {
    key: 'kds.alarm_volume',
    label: 'Alarm volume',
    hint: 'Loudness of every board alarm. Counter screens cannot change it.',
    suffix: '% (0–100)',
    min: 0,
    max: 100,
  },
  {
    key: 'kds.revert_window',
    label: 'Undo window',
    hint: 'How many of a counter’s most recent serves the board offers to take back.',
    suffix: 'serves',
    min: 1,
    max: 100,
  },
  {
    key: 'kds.cds_bill_hold_seconds',
    label: 'Customer display holds a bill',
    hint: 'How long the settled bill — and its UPI pay QR — stays on the customer screen after checkout.',
    suffix: 'seconds',
    min: 10,
    max: 1800,
  },
];

function readSetting<T>(settings: { key: string; value: unknown }[] | undefined, key: string, fallback: T): T {
  const found = settings?.find((setting) => setting.key === key);
  return found === undefined ? fallback : (found.value as T);
}

/** The five board-wide knobs: prep fallback, attention lead, critical cadence, volume, undo. */
export function KdsAlarmTiming(): JSX.Element {
  const { data: settings } = useSettings();
  const update = useUpdateSetting();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    setDraft(
      Object.fromEntries(
        TIMINGS.map(({ key }) => [key, String(readSetting<number>(settings, key, 0) || '')]),
      ),
    );
  }, [settings]);

  async function save(key: string, value: unknown): Promise<void> {
    try {
      await update.mutateAsync({ key, value });
      setSavedKey(key);
      window.setTimeout(() => setSavedKey(null), 2000);
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {TIMINGS.map(({ key, label, hint, suffix, min, max }) => (
        <div key={key} className="flex items-center gap-3">
          <div className="w-56 shrink-0">
            <p className="text-sm font-medium">{label}</p>
            <p className="text-muted-foreground text-xs">{hint}</p>
          </div>
          <Input
            type="number"
            min={min}
            max={max}
            className="w-28"
            value={draft[key] ?? ''}
            onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
          />
          <span className="text-muted-foreground text-sm">{suffix}</span>
          <Button
            size="sm"
            variant={savedKey === key ? 'secondary' : 'outline'}
            disabled={update.isPending || draft[key] === ''}
            onClick={() => {
              const value = Number(draft[key]);
              if (!Number.isInteger(value) || value < min || value > max) {
                notify.error(`${label} must be a whole number between ${min} and ${max}.`);
                return;
              }
              void save(key, value);
            }}
          >
            {savedKey === key && <CheckIcon data-icon="inline-start" />}
            Save
          </Button>
        </div>
      ))}
    </div>
  );
}
