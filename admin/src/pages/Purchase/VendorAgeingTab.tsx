import { useMemo, useState } from 'react';
import { Capability, type VendorAgeingRowDto } from '@menuboard/shared';
import { TableSkeleton } from '@/components/ui/Skeletons';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListToolbar } from '../../components/ListToolbar';
import { useVendorAgeing } from '../../hooks/useVendorAccounting';
import { useAuth } from '../../services/AuthContext';
import { TONE_TEXT_CLASS } from '@/lib/tones';
import { dash, formatDate, money } from '../Stock/stockFormat';
import { VendorStatementDrawer } from './VendorStatementDrawer';
import { LoadError, NotPermitted, SupplierPicker, ageingTone } from './vendorAccountingShared';

type Bucket = 'notDue' | 'days0to30' | 'days31to60' | 'days61to90' | 'over90';

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'notDue', label: 'Not due' },
  { key: 'days0to30', label: '0–30' },
  { key: 'days31to60', label: '31–60' },
  { key: 'days61to90', label: '61–90' },
  { key: 'over90', label: '90+' },
];

/**
 * Outstanding by age, one row per supplier. The whole point is the shape of the row: money
 * drifting rightwards is money the business is losing goodwill over, so the older buckets
 * carry the louder tone.
 */
export function VendorAgeingTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canRead = hasCapability(Capability.VENDOR_LEDGER_READ);

  const [supplierId, setSupplierId] = useState('');
  const [supplierLabel, setSupplierLabel] = useState('');
  const [statementFor, setStatementFor] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading, isError, refetch } = useVendorAgeing(
    supplierId === '' ? {} : { supplierId },
    canRead,
  );

  const rows = useMemo(() => data ?? [], [data]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          notDue: sum.notDue + row.notDue,
          days0to30: sum.days0to30 + row.days0to30,
          days31to60: sum.days31to60 + row.days31to60,
          days61to90: sum.days61to90 + row.days61to90,
          over90: sum.over90 + row.over90,
          total: sum.total + row.total,
        }),
        { notDue: 0, days0to30: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 },
      ),
    [rows],
  );

  if (!canRead) {
    return <NotPermitted what="Vendor ageing" capability="the vendor ledger read capability" />;
  }

  return (
    <>
      <p className="text-muted-foreground mb-3 text-xs">
        Outstanding by age, per supplier, at today&apos;s date. Open a row for the full statement
        behind the numbers.
      </p>

      <ListToolbar
        search=""
        onSearchChange={() => undefined}
        hideSearch
        activeFilterCount={supplierId ? 1 : 0}
        onClearFilters={() => {
          setSupplierId('');
          setSupplierLabel('');
        }}
        filters={
          <SupplierPicker
            id="ageing-supplier"
            value={supplierId}
            displayValue={supplierLabel}
            onChange={(choice) => {
              setSupplierId(choice?.id ?? '');
              setSupplierLabel(choice?.label ?? '');
            }}
          />
        }
        view="table"
        onViewChange={() => undefined}
        hideView
        page={1}
        pageSize={rows.length === 0 ? 1 : rows.length}
        total={rows.length}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
      />

      {isError ? (
        <LoadError what="Vendor ageing" onRetry={() => void refetch()} />
      ) : isLoading ? (
        <TableSkeleton columns={8} />
      ) : rows.length === 0 ? (
        <div className="bg-card rounded-xl border">
          <EmptyState
            variant={supplierId === '' ? 'empty' : 'no-results'}
            title={supplierId === '' ? 'Nothing outstanding' : 'Nothing outstanding here'}
            description="A supplier appears here only while something they billed is still unpaid."
          />
        </div>
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-xs">
                <th className="px-2 py-2 text-left font-normal">Supplier</th>
                <th className="px-2 py-2 text-left font-normal">Code</th>
                {BUCKETS.map((bucket) => (
                  <th key={bucket.key} className="px-2 py-2 text-right font-normal">
                    {bucket.label}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-normal">Total</th>
                <th className="px-2 py-2 text-left font-normal">Oldest due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AgeingRow
                  key={row.supplierId}
                  row={row}
                  onOpen={() =>
                    setStatementFor({ id: row.supplierId, name: row.supplierName })
                  }
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 border-t font-semibold">
                <td className="px-2 py-2" colSpan={2}>
                  {rows.length} {rows.length === 1 ? 'supplier' : 'suppliers'}
                </td>
                {BUCKETS.map((bucket) => (
                  <td
                    key={bucket.key}
                    className={`px-2 py-2 text-right tabular-nums ${
                      totals[bucket.key] > 0 ? TONE_TEXT_CLASS[ageingTone(bucket.key)] : 'text-muted-foreground'
                    }`}
                  >
                    {totals[bucket.key] > 0 ? money(totals[bucket.key]) : '—'}
                  </td>
                ))}
                <td className="px-2 py-2 text-right tabular-nums">{money(totals.total)}</td>
                <td className="px-2 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <VendorStatementDrawer
        supplierId={statementFor?.id ?? null}
        supplierName={statementFor?.name ?? ''}
        onClose={() => setStatementFor(null)}
      />
    </>
  );
}

function AgeingRow({
  row,
  onOpen,
}: {
  row: VendorAgeingRowDto;
  onOpen: () => void;
}): JSX.Element {
  return (
    <tr
      className="hover:bg-muted/40 focus-ring cursor-pointer border-b align-middle"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen();
      }}
    >
      <td className="px-2 py-1.5 font-medium">{dash(row.supplierName)}</td>
      <td className="text-muted-foreground px-2 py-1.5">{dash(row.supplierCode)}</td>
      {BUCKETS.map((bucket) => (
        <td
          key={bucket.key}
          className={`px-2 py-1.5 text-right tabular-nums ${
            row[bucket.key] > 0 ? TONE_TEXT_CLASS[ageingTone(bucket.key)] : 'text-muted-foreground'
          }`}
        >
          {row[bucket.key] > 0 ? money(row[bucket.key]) : '—'}
        </td>
      ))}
      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{money(row.total)}</td>
      <td className="text-muted-foreground px-2 py-1.5 whitespace-nowrap tabular-nums">
        {formatDate(row.oldestDueDate)}
      </td>
    </tr>
  );
}
