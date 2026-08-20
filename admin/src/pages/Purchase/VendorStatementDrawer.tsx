import { useEffect, useState } from 'react';
import { LockIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { TextField } from '@/components/form/fields';
import { useVendorStatement } from '../../hooks/useVendorAccounting';
import { humanise } from '@/lib/options';
import { dash, formatDate, formatDateTime, money } from '../Stock/stockFormat';

/**
 * One supplier's account: what they were owed at the start of the window, what moved, and
 * what is owed now. The four figures at the top are the ones that get read out on the phone.
 */
export function VendorStatementDrawer({
  supplierId,
  supplierName,
  onClose,
}: {
  supplierId: string | null;
  supplierName?: string;
  onClose: () => void;
}): JSX.Element {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // A different supplier is a different statement; the window must not carry over silently.
  useEffect(() => {
    setDateFrom('');
    setDateTo('');
  }, [supplierId]);

  const { data, isLoading, isError, refetch } = useVendorStatement(supplierId, {
    ...(dateFrom === '' ? {} : { dateFrom }),
    ...(dateTo === '' ? {} : { dateTo }),
  });

  const entries = [...(data?.entries ?? [])].sort((a, b) => a.entrySeq - b.entrySeq);

  return (
    <Sheet open={supplierId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-[860px] sm:max-w-[860px]">
        <SheetHeader>
          <SheetTitle>{data?.supplierName ?? supplierName ?? 'Vendor statement'}</SheetTitle>
          <SheetDescription>
            {data === undefined
              ? 'Account statement'
              : `${data.supplierCode} · ${data.fromDate === null ? 'from the beginning' : formatDate(data.fromDate)} to ${
                  data.toDate === null ? 'today' : formatDate(data.toDate)
                }`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="From"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
            <TextField
              label="To"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 8 }, (_unused, index) => (
                <Skeleton key={index} className="h-8 rounded-md" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <p className="text-sm font-medium">The statement could not be loaded.</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          ) : data === undefined ? null : (
            <>
              <section className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border p-3 sm:grid-cols-4">
                <Figure label="Opening balance" value={money(data.openingBalance)} />
                <Figure label="Total debits" value={money(data.totalDebits)} />
                <Figure label="Total credits" value={money(data.totalCredits)} />
                <Figure label="Closing balance" value={money(data.closingBalance)} strong />
              </section>

              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <LockIcon className="size-3.5 shrink-0" aria-hidden />
                Kept from the supplier&apos;s point of view: a credit increases what we owe them,
                a debit reduces it. Ordered by sequence, and never edited.
              </p>

              {entries.length === 0 ? (
                <p className="text-muted-foreground py-4 text-sm">
                  No entries fall inside this window.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead>
                      <tr className="text-muted-foreground text-xs">
                        <th className="pb-2 text-right font-normal">Seq</th>
                        <th className="pb-2 text-left font-normal">Date</th>
                        <th className="pb-2 text-left font-normal">Type</th>
                        <th className="pb-2 text-left font-normal">Document</th>
                        <th className="pb-2 text-right font-normal">Debit</th>
                        <th className="pb-2 text-right font-normal">Credit</th>
                        <th className="pb-2 text-right font-normal">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.id} className="border-t">
                          <td className="text-muted-foreground py-1.5 pr-2 text-right tabular-nums">
                            {entry.entrySeq}
                          </td>
                          <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">
                            {formatDateTime(entry.occurredAt)}
                          </td>
                          <td className="py-1.5 pr-2">
                            <Badge variant="outline">{humanise(entry.transactionType)}</Badge>
                          </td>
                          <td className="py-1.5 pr-2">{dash(entry.documentNumber)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {entry.debitAmount > 0 ? money(entry.debitAmount) : '—'}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {entry.creditAmount > 0 ? money(entry.creditAmount) : '—'}
                          </td>
                          <td className="py-1.5 text-right font-medium tabular-nums">
                            {money(entry.runningBalance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs font-medium tracking-[0.06em] uppercase">
        {label}
      </span>
      <span className={strong === true ? 'text-base font-bold tabular-nums' : 'text-sm font-semibold tabular-nums'}>
        {value}
      </span>
    </div>
  );
}
