import { useMemo, useState } from 'react';
import {
  Capability,
  PurchasePaymentMethod,
  VendorPaymentStatus,
  type VendorPaymentDto,
  type VendorPaymentListQuery,
} from '@menuboard/shared';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/Skeletons';
import { EmptyState } from '@/components/ui/EmptyState';
import { SelectField, TextField } from '@/components/form/fields';
import { ListToolbar } from '../../components/ListToolbar';
import { StatusChip } from '../../components/StatusChip';
import { useVendorPayment, useVendorPayments } from '../../hooks/useVendorAccounting';
import { useAuth } from '../../services/AuthContext';
import { enumOptions, humanise } from '@/lib/options';
import { Chip, dash, formatDate, money } from '../Stock/stockFormat';
import { VendorPaymentFormModal } from './VendorPaymentFormModal';
import { LoadError, NotPermitted, SupplierPicker, TotalsBar } from './vendorAccountingShared';

/**
 * Money that has left the business, and what each payment settled.
 *
 * A row expands rather than opening a drawer, because the question asked of a payment ("which
 * bills did this cover?") is a follow-up to the row above it, not a new subject.
 */
export function VendorPaymentsTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canRead = hasCapability(Capability.PAYABLE_READ);
  const canPay = hasCapability(Capability.VENDOR_PAYMENT_CREATE);

  const [supplierId, setSupplierId] = useState('');
  const [supplierLabel, setSupplierLabel] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const query = useMemo<VendorPaymentListQuery>(() => {
    const built: VendorPaymentListQuery = { page, pageSize };
    if (supplierId !== '') built.supplierId = supplierId;
    if (status !== '') built.status = status as VendorPaymentStatus;
    if (method !== '') built.method = method as PurchasePaymentMethod;
    if (dateFrom !== '') built.dateFrom = dateFrom;
    if (dateTo !== '') built.dateTo = dateTo;
    return built;
  }, [supplierId, status, method, dateFrom, dateTo, page, pageSize]);

  const { data, isLoading, isError, refetch } = useVendorPayments(query, canRead);
  const rows = useMemo(() => data?.items ?? [], [data?.items]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          paid: sum.paid + row.amount,
          onAccount: sum.onAccount + row.unallocatedAmount,
        }),
        { paid: 0, onAccount: 0 },
      ),
    [rows],
  );

  const filterCount =
    (supplierId ? 1 : 0) +
    (status ? 1 : 0) +
    (method ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  function resetFilters(): void {
    setSupplierId('');
    setSupplierLabel('');
    setStatus('');
    setMethod('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  if (!canRead) {
    return <NotPermitted what="Vendor payments" capability="the payable read capability" />;
  }

  return (
    <>
      <ListToolbar
        search=""
        onSearchChange={() => undefined}
        hideSearch
        activeFilterCount={filterCount}
        onClearFilters={resetFilters}
        filters={
          <>
            <SupplierPicker
              id="payments-supplier"
              value={supplierId}
              displayValue={supplierLabel}
              onChange={(choice) => {
                setSupplierId(choice?.id ?? '');
                setSupplierLabel(choice?.label ?? '');
                setPage(1);
              }}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
              emptyLabel="Any status"
              options={enumOptions(VendorPaymentStatus)}
            />
            <SelectField
              label="Method"
              value={method}
              onChange={(next) => {
                setMethod(next);
                setPage(1);
              }}
              emptyLabel="Any method"
              options={enumOptions(PurchasePaymentMethod)}
            />
            <TextField
              label="From"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
            />
            <TextField
              label="To"
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
            />
          </>
        }
        view="table"
        onViewChange={() => undefined}
        hideView
        page={page}
        pageSize={pageSize}
        total={data?.meta.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        {...(canPay ? { onCreate: () => setFormOpen(true), createLabel: 'New payment' } : {})}
      />

      {isError ? (
        <LoadError what="Vendor payments" onRetry={() => void refetch()} />
      ) : isLoading ? (
        <TableSkeleton columns={7} />
      ) : rows.length === 0 ? (
        <div className="bg-card rounded-xl border">
          <EmptyState
            variant={filterCount > 0 ? 'no-results' : 'empty'}
            title={filterCount > 0 ? 'No matches' : 'No payments yet'}
            description={
              filterCount > 0
                ? 'Nothing matches the current filters. Try widening them.'
                : 'A payment appears here as soon as one is recorded against a supplier.'
            }
          />
        </div>
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-xs">
                <th className="w-9 py-2" />
                <th className="px-2 py-2 text-left font-normal">Payment no</th>
                <th className="px-2 py-2 text-left font-normal">Date</th>
                <th className="px-2 py-2 text-left font-normal">Supplier</th>
                <th className="px-2 py-2 text-left font-normal">Method</th>
                <th className="px-2 py-2 text-left font-normal">Instrument</th>
                <th className="px-2 py-2 text-right font-normal">Amount</th>
                <th className="px-2 py-2 text-right font-normal">On account</th>
                <th className="px-2 py-2 text-left font-normal">Status</th>
                <th className="px-2 py-2 text-left font-normal">Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PaymentRow
                  key={row.id}
                  payment={row}
                  expanded={expanded === row.id}
                  onToggle={() => setExpanded((current) => (current === row.id ? null : row.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <TotalsBar
          caption={`Visible total · ${rows.length} of ${(data?.meta.total ?? 0).toLocaleString()} payments on this page`}
          figures={[
            { label: 'Paid', value: money(totals.paid), strong: true },
            { label: 'On account', value: money(totals.onAccount) },
          ]}
        />
      )}

      <VendorPaymentFormModal open={formOpen} onClose={() => setFormOpen(false)} />
    </>
  );
}

function PaymentRow({
  payment,
  expanded,
  onToggle,
}: {
  payment: VendorPaymentDto;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  // The list endpoint omits allocations (loading them per row would be an N+1), so the detail
  // is fetched only once a row is actually opened.
  const detail = useVendorPayment(expanded ? payment.id : null);
  const allocations = detail.data?.allocations ?? payment.allocations;
  const allocatedTotal = Math.round((payment.amount - payment.unallocatedAmount) * 100) / 100;

  return (
    <>
      <tr className="border-b align-middle">
        <td className="py-1.5 pl-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={expanded ? `Collapse ${payment.paymentNumber}` : `Expand ${payment.paymentNumber}`}
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </Button>
        </td>
        <td className="px-2 py-1.5 font-medium">{payment.paymentNumber}</td>
        <td className="text-muted-foreground px-2 py-1.5 whitespace-nowrap tabular-nums">
          {formatDate(payment.paymentDate)}
        </td>
        <td className="px-2 py-1.5">{dash(payment.supplierName)}</td>
        <td className="px-2 py-1.5">
          <Badge variant="outline">{humanise(payment.method)}</Badge>
        </td>
        <td className="text-muted-foreground px-2 py-1.5">
          {payment.instrumentNumber === null && payment.bankName === null
            ? '—'
            : [payment.instrumentNumber, payment.bankName, formatDateOrNull(payment.instrumentDate)]
              .filter((part) => part !== null && part !== '')
              .join(' · ')}
        </td>
        <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
          {money(payment.amount)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {payment.unallocatedAmount > 0 ? (
            <Chip tone="info">{money(payment.unallocatedAmount)}</Chip>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-2 py-1.5">
          <StatusChip status={payment.status} />
        </td>
        <td className="text-muted-foreground px-2 py-1.5">{dash(payment.reference)}</td>
      </tr>

      {expanded && (
        <tr className="bg-muted/30 border-b">
          <td />
          <td colSpan={9} className="px-2 py-3">
            <p className="text-muted-foreground mb-2 text-xs">
              {money(allocatedTotal)} settled against bills · {money(payment.unallocatedAmount)}{' '}
              left on account.
            </p>
            {allocations === undefined ? (
              <p className="text-muted-foreground text-xs">
                {detail.isPending
                  ? 'Loading which bills this settled…'
                  : detail.isError
                    ? 'Could not load the per-bill allocation detail for this payment.'
                    : 'No allocation detail is available for this payment.'}
              </p>
            ) : allocations.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                An advance: this payment names no bill and sits entirely on account.
              </p>
            ) : (
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs">
                    <th className="pb-1 text-left font-normal">Our doc no</th>
                    <th className="pb-1 text-left font-normal">Their bill no</th>
                    <th className="pb-1 text-left font-normal">Invoice date</th>
                    <th className="pb-1 text-right font-normal">Invoice total</th>
                    <th className="pb-1 text-right font-normal">Allocated</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((allocation) => (
                    <tr key={allocation.id} className="border-t">
                      <td className="py-1 pr-2 font-medium">{dash(allocation.documentNumber)}</td>
                      <td className="text-muted-foreground py-1 pr-2">
                        {dash(allocation.supplierInvoiceNumber)}
                      </td>
                      <td className="text-muted-foreground py-1 pr-2 tabular-nums">
                        {formatDate(allocation.invoiceDate)}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">
                        {money(allocation.invoiceTotal)}
                      </td>
                      <td className="py-1 text-right font-medium tabular-nums">
                        {money(allocation.allocatedAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function formatDateOrNull(value: string | null): string | null {
  return value === null ? null : formatDate(value);
}
