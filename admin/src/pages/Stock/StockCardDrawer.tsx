import { useEffect, useState } from 'react';
import { Capability, type StockBalanceDto } from '@menuboard/shared';
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
import { useStockLedger } from '../../hooks/useStock';
import { useAuth } from '../../services/AuthContext';
import { humanise } from '@/lib/options';
import { ExpiryCell, dash, formatDateTime, money, qty, quantityClass } from './stockFormat';

const PAGE_SIZE = 20;

/**
 * The stock card: one product at one location, with the movements that produced its balance.
 *
 * Opened from a balance row rather than being a screen of its own, because the question it
 * answers ("why is this number what it is?") is always asked about a row already on screen.
 */
export function StockCardDrawer({
  balance,
  onClose,
}: {
  balance: StockBalanceDto | null;
  onClose: () => void;
}): JSX.Element {
  const { hasCapability } = useAuth();
  const canReadLedger = hasCapability(Capability.STOCK_LEDGER_READ);
  const [page, setPage] = useState(1);

  // A different row is a different card; paging must not carry over to it.
  useEffect(() => {
    setPage(1);
  }, [balance?.id]);

  const { data, isLoading, isError, refetch, isFetching } = useStockLedger(
    {
      productId: balance?.productId,
      locationId: balance?.locationId,
      page,
      pageSize: PAGE_SIZE,
      sortBy: 'ledgerSeq',
      sortDir: 'desc',
    },
    balance !== null && canReadLedger,
  );

  const rows = [...(data?.items ?? [])].sort((a, b) => b.ledgerSeq - a.ledgerSeq);
  const total = data?.meta.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Sheet open={balance !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-[780px] sm:max-w-[780px]">
        <SheetHeader>
          <SheetTitle>{dash(balance?.productName)}</SheetTitle>
          <SheetDescription>
            {dash(balance?.productCode)} · {dash(balance?.locationName)}
            {balance?.batchNumber ? ` · batch ${balance.batchNumber}` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {balance && (
            <section className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border p-3 sm:grid-cols-3">
              <Figure label="On hand" value={`${qty(balance.quantity)} ${balance.productUnit ?? ''}`} />
              <Figure label="Reserved" value={qty(balance.reservedQuantity)} />
              <Figure label="Available" value={qty(balance.availableQuantity)} />
              <Figure label="Average cost" value={money(balance.averageCost)} />
              <Figure label="Stock value" value={money(balance.stockValue)} />
              <Figure label="Last movement" value={formatDateTime(balance.lastMovementAt)} />
              {balance.expiryDate ? (
                <div className="col-span-2 flex flex-col gap-1 sm:col-span-3">
                  <span className="text-muted-foreground text-xs font-medium tracking-[0.06em] uppercase">
                    Expiry
                  </span>
                  <ExpiryCell expiryDate={balance.expiryDate} daysToExpiry={balance.daysToExpiry} />
                </div>
              ) : null}
            </section>
          )}

          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-sm font-semibold">Movements</h3>
            <span className="text-muted-foreground text-xs">
              Newest first, by ledger sequence. History, not a worklist — it is never edited.
            </span>
          </div>

          {!canReadLedger ? (
            <p className="text-muted-foreground text-sm">
              Movement history is not visible to your role.
            </p>
          ) : isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }, (_unused, index) => (
                <Skeleton key={index} className="h-8 rounded-md" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <p className="text-sm font-medium">Movement history could not be loaded.</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">
              No movements recorded for this product at this location yet.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs">
                      <th className="pb-2 text-right font-normal">Seq</th>
                      <th className="pb-2 text-left font-normal">When</th>
                      <th className="pb-2 text-left font-normal">Movement</th>
                      <th className="pb-2 text-right font-normal">In</th>
                      <th className="pb-2 text-right font-normal">Out</th>
                      <th className="pb-2 text-right font-normal">Balance</th>
                      <th className="pb-2 text-left font-normal">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="text-muted-foreground py-1.5 pr-2 text-right tabular-nums">
                          {row.ledgerSeq}
                        </td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          {formatDateTime(row.occurredAt)}
                        </td>
                        <td className="py-1.5 pr-2">
                          <Badge variant="outline">{humanise(row.movementType)}</Badge>
                        </td>
                        <td
                          className={`py-1.5 pr-2 text-right tabular-nums ${row.quantityIn > 0 ? quantityClass('IN') : 'text-muted-foreground'
                            }`}
                        >
                          {row.quantityIn > 0 ? qty(row.quantityIn) : '—'}
                        </td>
                        <td
                          className={`py-1.5 pr-2 text-right tabular-nums ${row.quantityOut > 0 ? quantityClass('OUT') : 'text-muted-foreground'
                            }`}
                        >
                          {row.quantityOut > 0 ? qty(row.quantityOut) : '—'}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                          {qty(row.balanceQuantity)}
                        </td>
                        <td className="text-muted-foreground py-1.5">
                          {dash(row.sourceDocumentNumber ?? humanise(row.sourceType))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs tabular-nums">
                    Page {page} of {lastPage} · {total.toLocaleString()} movements
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || isFetching}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                    >
                      Newer
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= lastPage || isFetching}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Older
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

        </div>
      </SheetContent>
    </Sheet>
  );
}

function Figure({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs font-medium tracking-[0.06em] uppercase">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
