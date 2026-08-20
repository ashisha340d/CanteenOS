import { useMemo, useState } from 'react';
import {
  CLEANING_RISK_LEVEL_LABELS,
  FOOD_CONTACT_CLASS_LABELS,
  type CleaningComplianceRowDto,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SelectField, TextField } from '@/components/form/fields';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatTile } from '@/components/ui/StatTile';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { useCleaningCompliance, useCleaningSetup } from '../../hooks/useCleaning';
import { FOOD_CONTACT_TONE, RISK_TONE, complianceTone, formatDateTime } from './cleaningTone';

/**
 * The hygiene record — the thing a food-safety auditor actually asks for.
 *
 * Four cuts of one window, plus the list an auditor opens with: which assets fell due and were
 * never cleaned. The totals are computed from the same predicate as the cuts, so a row and the
 * summary can never disagree.
 */
export function CleaningCompliancePage(): JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [areaId, setAreaId] = useState('');
  const [assetTypeId, setAssetTypeId] = useState('');
  const [shiftId, setShiftId] = useState('');

  const { data: setup } = useCleaningSetup();
  const query = useMemo(
    () => ({
      from,
      to,
      ...(areaId !== '' ? { areaId } : {}),
      ...(assetTypeId !== '' ? { assetTypeId } : {}),
      ...(shiftId !== '' ? { shiftId } : {}),
    }),
    [from, to, areaId, assetTypeId, shiftId],
  );
  const { data, isLoading } = useCleaningCompliance(query);

  const totals = data?.totals;

  return (
    <>
      <PageHeader
        title="Hygiene record"
        meta={
          totals && (
            <span
              className={cn(
                'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                TONE_CHIP_CLASS[complianceTone(totals.complianceRate)],
              )}
            >
              {totals.complianceRate}% completed
            </span>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <TextField
          label="From"
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <SelectField
          label="Area"
          value={areaId}
          onChange={setAreaId}
          emptyLabel="Everywhere"
          options={(setup?.areas ?? []).map((area) => ({ value: area.id, label: area.name }))}
        />
        <SelectField
          label="Asset type"
          value={assetTypeId}
          onChange={setAssetTypeId}
          emptyLabel="Any type"
          options={(setup?.assetTypes ?? []).map((type) => ({ value: type.id, label: type.name }))}
        />
        <SelectField
          label="Shift"
          value={shiftId}
          onChange={setShiftId}
          emptyLabel="Any shift"
          options={(setup?.shifts ?? []).map((shift) => ({ value: shift.id, label: shift.name }))}
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center text-sm">Working it out…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            <StatTile label="Fell due" value={totals?.due ?? 0} />
            <StatTile label="Completed" value={totals?.completed ?? 0} tone="success" />
            <StatTile label="On time" value={totals?.onTime ?? 0} tone="success" />
            <StatTile label="Late" value={totals?.late ?? 0} tone="progress" />
            <StatTile
              label="Never done"
              value={totals?.missed ?? 0}
              tone="danger"
              emphasis={(totals?.missed ?? 0) > 0}
            />
            <StatTile
              label="On-time rate"
              value={`${totals?.onTimeRate ?? 100}%`}
              tone={complianceTone(totals?.onTimeRate ?? 100)}
            />
            <StatTile
              label="Check pass rate"
              value={`${totals?.passRate ?? 100}%`}
              tone={complianceTone(totals?.passRate ?? 100)}
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Breakdown title="By area" rows={data?.byArea ?? []} />
            <Breakdown title="By asset type" rows={data?.byAssetType ?? []} />
            <Breakdown title="By shift" rows={data?.byShift ?? []} />
            <Breakdown title="By person" rows={data?.byPerson ?? []} />
          </div>

          <section className="mt-4">
            <h2 className="font-heading mb-1 text-sm font-semibold tracking-tight">
              Fell due and was never cleaned
            </h2>
            <p className="text-muted-foreground mb-2 text-xs">
              The first question an auditor asks, answered before they ask it.
            </p>
            {(data?.missedAssets ?? []).length === 0 ? (
              <Alert>
                <AlertDescription>
                  Nothing in this window fell due without being cleaned.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <Th>Code</Th>
                      <Th>Asset</Th>
                      <Th>Area</Th>
                      <Th>Risk</Th>
                      <Th>Food contact</Th>
                      <Th align="right">Missed</Th>
                      <Th>Last cleaned</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {(data?.missedAssets ?? []).map((asset) => (
                      <tr key={asset.cleanableAssetId}>
                        <Td className="font-mono text-xs">{asset.code}</Td>
                        <Td>{asset.name}</Td>
                        <Td>{asset.areaName}</Td>
                        <Td>
                          <Chip
                            tone={RISK_TONE[asset.riskLevel]}
                            label={CLEANING_RISK_LEVEL_LABELS[asset.riskLevel]}
                          />
                        </Td>
                        <Td>
                          <Chip
                            tone={FOOD_CONTACT_TONE[asset.foodContact]}
                            label={FOOD_CONTACT_CLASS_LABELS[asset.foodContact]}
                          />
                        </Td>
                        <Td align="right" className="tabular-nums">
                          {asset.missed}
                        </Td>
                        <Td>{formatDateTime(asset.lastCleanedAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: CleaningComplianceRowDto[];
}): JSX.Element {
  return (
    <section className="bg-card rounded-xl border p-4">
      <h2 className="font-heading mb-2 text-sm font-semibold tracking-tight">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing fell due in this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <Th></Th>
                <Th align="right">Due</Th>
                <Th align="right">Done</Th>
                <Th align="right">Late</Th>
                <Th align="right">Missed</Th>
                <Th align="right">Rate</Th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((row) => (
                <tr key={row.key}>
                  <Td className="max-w-[12rem] truncate">{row.label}</Td>
                  <Td align="right" className="tabular-nums">
                    {row.due}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {row.completed}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {row.late}
                  </Td>
                  <Td
                    align="right"
                    className={cn('tabular-nums', row.missed > 0 && 'text-tone-danger font-medium')}
                  >
                    {row.missed}
                  </Td>
                  <Td align="right">
                    <Chip
                      tone={complianceTone(row.complianceRate)}
                      label={`${row.complianceRate}%`}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({
  children,
  align,
}: {
  children?: React.ReactNode;
  align?: 'right';
}): JSX.Element {
  return (
    <th
      scope="col"
      className={cn('px-2 py-1.5 text-xs font-medium', align === 'right' && 'text-right')}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: {
  children?: React.ReactNode;
  align?: 'right';
  className?: string;
}): JSX.Element {
  return (
    <td className={cn('px-2 py-1.5', align === 'right' && 'text-right', className)}>{children}</td>
  );
}

function Chip({ tone, label }: { tone: keyof typeof TONE_CHIP_CLASS; label: string }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold whitespace-nowrap',
        TONE_CHIP_CLASS[tone],
      )}
    >
      {label}
    </span>
  );
}
