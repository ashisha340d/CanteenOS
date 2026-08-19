import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/form/fields';
import { KdsAlarmSoundsCard } from '@/components/KdsAlarmSounds';
import { KdsAlarmTiming } from '@/components/KdsAlarmTiming';
import { useSettings, useUpdateSetting } from '../../hooks/useAdmin';
import { useCounters } from '../../hooks/useMenuMaster';
import { kdsApi } from '../../api/kds';
import { notify } from '@/lib/notify';

function readSetting<T>(settings: { key: string; value: unknown }[] | undefined, key: string, fallback: T): T {
  const found = settings?.find((setting) => setting.key === key);
  return found === undefined ? fallback : (found.value as T);
}

/**
 * Front-desk control for the wall screens: how long a line gets, when the alarms speak, how
 * many serves a counter can take back, and whose UPI the customer QR pays.
 */
export function KdsPanel(): JSX.Element {
  const { data: settings } = useSettings();
  const update = useUpdateSetting();
  const [upiId, setUpiId] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    setUpiId(readSetting<string>(settings, 'payments.upi_id', ''));
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
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="font-heading text-base font-semibold">Board alarms</h2>
        <p className="text-muted-foreground mt-0.5 mb-3 text-sm">
          The three voices every Service KDS plays, in the order a line meets them. These are the
          boards’ own sounds — separate from the phone buzzers on the Alerts page — and a counter
          screen can neither change nor silence them. Also on the desktop under Settings →
          KDS/CDS Sounds.
        </p>
        <KdsAlarmSoundsCard />
      </section>

      <section>
        <h2 className="font-heading text-base font-semibold">Alarm timing</h2>
        <p className="text-muted-foreground mt-0.5 mb-3 text-sm">
          A line is due at its order time plus its prep time — set per item on the Menu Master
          File, with the default below as the fallback.
        </p>
        <KdsAlarmTiming />
      </section>

      <section>
        <h2 className="font-heading text-base font-semibold">Customer display QR</h2>
        <p className="text-muted-foreground mt-0.5 mb-3 text-sm">
          The UPI id the CDS QR pays into. Empty hides the QR on the customer screen.
        </p>
        <div className="flex items-center gap-3">
          <Input
            className="w-72"
            placeholder="name@bank"
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
          />
          <Button
            size="sm"
            variant={savedKey === 'payments.upi_id' ? 'secondary' : 'outline'}
            disabled={update.isPending}
            onClick={() => void save('payments.upi_id', upiId.trim())}
          >
            {savedKey === 'payments.upi_id' && <CheckIcon data-icon="inline-start" />}
            Save
          </Button>
        </div>
      </section>

      <RecentServesSection />
    </div>
  );
}

/** What the counters have just served — the same undo list the wall screen works from. */
function RecentServesSection(): JSX.Element {
  const { data: counters } = useCounters({ page: 1, pageSize: 100 });
  const [counterId, setCounterId] = useState('');

  const options = (counters?.items ?? []).map((counter) => ({ value: counter.id, label: counter.name }));
  const activeCounterId = counterId || options[0]?.value || '';

  const recent = useQuery({
    queryKey: ['kds', 'recent', activeCounterId],
    queryFn: () => kdsApi.recentActions(activeCounterId),
    enabled: activeCounterId !== '',
    refetchInterval: 15_000,
  });
  const metrics = useQuery({
    queryKey: ['kds', 'metrics', activeCounterId],
    queryFn: () => kdsApi.metrics(activeCounterId),
    enabled: activeCounterId !== '',
    refetchInterval: 15_000,
  });

  return (
    <section>
      <h2 className="font-heading text-base font-semibold">Recently served</h2>
      <p className="text-muted-foreground mt-0.5 mb-3 text-sm">
        The undo list each counter screen is working from — use it to verify a mistake was
        actually taken back.
      </p>

      <div className="mb-3 max-w-xs">
        <SelectField
          label="Counter"
          value={activeCounterId}
          onChange={setCounterId}
          emptyLabel="Choose a counter"
          options={options}
        />
      </div>

      {metrics.data && (
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <span className="rounded-md border px-2 py-1 tabular-nums">
            Pending: {metrics.data.pendingOrders} orders / {metrics.data.pendingLines} items
          </span>
          <span className="rounded-md border px-2 py-1 tabular-nums">
            Served today: {metrics.data.servedTodayOrders} orders / {metrics.data.servedTodayLines} items
          </span>
          <span className="rounded-md border px-2 py-1 tabular-nums">
            Avg serve time: {metrics.data.avgServeSeconds === null ? '—' : `${Math.round(metrics.data.avgServeSeconds / 60)}m`}
          </span>
          <span className="rounded-md border px-2 py-1 tabular-nums">
            Late now: {metrics.data.overdueLines}
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/60 text-left">
              <th className="px-3 py-2 font-medium">Bill</th>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Served by</th>
              <th className="px-3 py-2 font-medium">At</th>
            </tr>
          </thead>
          <tbody>
            {(recent.data ?? []).map((action) => (
              <tr key={action.lineId} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">#{action.orderNumber}</td>
                <td className="px-3 py-2">
                  {action.itemName}
                  {action.variantName ? ` (${action.variantName})` : ''}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{action.quantity}</td>
                <td className="px-3 py-2">{action.servedByName ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums">
                  {new Date(action.servedAt).toLocaleTimeString()}
                </td>
              </tr>
            ))}
            {recent.data !== undefined && recent.data.length === 0 && (
              <tr className="border-t">
                <td colSpan={5} className="text-muted-foreground px-3 py-6 text-center">
                  Nothing served at this counter yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
