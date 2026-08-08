import { useEffect, useState } from 'react';
import { OrderPriority } from '@menuboard/shared';
import { CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatGridSkeleton } from '../../components/ui/Skeletons';
import { useSettings, useUpdateSetting } from '../../hooks/useAdmin';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';

/**
 * The six closed keys from SETTING_DEFINITIONS (backend/src/services/SettingsService.ts).
 * The key set is closed server-side; this page must not invent a seventh.
 */
const GROUPS: { title: string; description: string; keys: string[] }[] = [
  {
    title: 'Orders',
    description: 'Defaults applied when an order is created.',
    keys: ['orders.default_priority', 'orders.require_acknowledgement'],
  },
  {
    title: 'Notifications & sync',
    description: 'How the mobile app is kept up to date.',
    keys: ['notifications.push_enabled', 'sync.pull_limit'],
  },
  {
    title: 'Organisation',
    description: 'Identity and housekeeping.',
    keys: ['organisation.name', 'media.orphan_sweep_hours'],
  },
];

/** Keys read better as a sentence than as the dotted key the server stores them under. */
const LABELS: Record<string, string> = {
  'orders.default_priority': 'Default priority',
  'orders.require_acknowledgement': 'Require acknowledgement',
  'notifications.push_enabled': 'Push notifications',
  'sync.pull_limit': 'Sync page size',
  'organisation.name': 'Organisation name',
  'media.orphan_sweep_hours': 'Orphan media sweep',
};

export function SettingsPage(): JSX.Element {
  const { data, isLoading } = useSettings();
  const update = useUpdateSetting();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    if (data) setValues(Object.fromEntries(data.map((setting) => [setting.key, setting.value])));
  }, [data]);

  async function save(key: string): Promise<void> {
    try {
      await update.mutateAsync({ key, value: values[key] });
      // Confirmation lands on the row that changed, not in a corner of the screen.
      setSavedKey(key);
      window.setTimeout(() => setSavedKey((current) => (current === key ? null : current)), 2000);
    } catch (err) {
      notify.fromError(err);
    }
  }

  if (isLoading || !data) {
    return (
      <>
        <PageHeader
          title="Settings"
          subtitle="Server-side configuration for the whole workspace."
        />
        <StatGridSkeleton count={3} />
      </>
    );
  }

  const byKey = new Map(data.map((setting) => [setting.key, setting]));

  function control(key: string): JSX.Element | null {
    const value = values[key];
    switch (key) {
      case 'orders.default_priority':
        return (
          <Select
            value={typeof value === 'string' ? value : ''}
            onValueChange={(next) => setValues({ ...values, [key]: next })}
          >
            <SelectTrigger size="sm" className="w-[190px]" aria-label={LABELS[key]}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.values(OrderPriority).map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {priority}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        );
      case 'orders.require_acknowledgement':
      case 'notifications.push_enabled':
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={Boolean(value)}
              onCheckedChange={(checked) => setValues({ ...values, [key]: checked })}
              aria-label={LABELS[key]}
            />
            <span className="text-muted-foreground text-sm">
              {value ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        );
      case 'sync.pull_limit':
      case 'media.orphan_sweep_hours':
        return (
          <Input
            type="number"
            inputMode="numeric"
            aria-label={LABELS[key]}
            className="w-[150px]"
            value={typeof value === 'number' ? value : 0}
            onWheel={(event) => (event.target as HTMLInputElement).blur()}
            onChange={(e) => setValues({ ...values, [key]: Number(e.target.value) })}
          />
        );
      case 'organisation.name':
        return (
          <Input
            aria-label={LABELS[key]}
            className="w-[240px]"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          />
        );
      default:
        return null;
    }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Server-side configuration for the whole workspace." />

      <div className="flex max-w-[880px] flex-col gap-8">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="font-heading text-base font-semibold">{group.title}</h2>
            <p className="text-muted-foreground mt-0.5 mb-3 text-sm">{group.description}</p>

            <div className="bg-card overflow-hidden rounded-xl border">
              {group.keys.map((key, index) => {
                const setting = byKey.get(key);
                if (!setting) return null;
                const dirty = JSON.stringify(values[key]) !== JSON.stringify(setting.value);
                const justSaved = savedKey === key;

                return (
                  <div
                    key={key}
                    className={cn(
                      'flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4',
                      index > 0 && 'border-t',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{LABELS[key] ?? key}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs">{setting.description}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {control(key)}
                      {/* The save button only exists once there is something to save, so the
                          row is quiet until the operator has actually changed something. */}
                      <div className="flex w-[74px] justify-end">
                        {justSaved ? (
                          <span className="text-tone-success flex items-center gap-1 text-xs font-medium motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95">
                            <CheckIcon className="size-4" />
                            Saved
                          </span>
                        ) : (
                          dirty && (
                            <Button size="sm" onClick={() => save(key)} disabled={update.isPending}>
                              Save
                            </Button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
