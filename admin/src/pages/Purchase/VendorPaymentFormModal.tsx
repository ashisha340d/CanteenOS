import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LIMITS,
  PayableStatus,
  PurchasePaymentMethod,
  type AccountsPayableDto,
  type CreateVendorPaymentRequest,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FieldGroup, FieldRow, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePayables, useCreateVendorPayment } from '../../hooks/useVendorAccounting';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { Chip, dash, formatDate, money } from '../Stock/stockFormat';
import { OverdueCell, SupplierPicker } from './vendorAccountingShared';

const FORM_ID = 'vendor-payment-form';
const PAYABLE_PAGE_SIZE = 100;

/** Methods that were paid with an instrument somebody will later have to reconcile. */
const INSTRUMENT_METHODS: readonly PurchasePaymentMethod[] = [
  PurchasePaymentMethod.CHEQUE,
  PurchasePaymentMethod.BANK,
];

function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const num = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Paise-level rounding, so a sum of two-decimal figures never fails an equality by 1e-13. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

export interface VendorPaymentFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selected supplier, when the modal was opened from a row that already names one. */
  supplierId?: string;
  supplierLabel?: string;
  /** Payables to pre-load as allocations — the payment queue's whole purpose. */
  preselectedPayableIds?: string[];
}

/**
 * Paying a supplier.
 *
 * The allocation grid is the substance: a payment that names no bill is an advance, which is
 * legitimate, so the remainder is shown as money on account rather than treated as an error.
 * Only over-allocation — promising more to bills than the payment is worth — is refused.
 */
export function VendorPaymentFormModal({
  open,
  onClose,
  supplierId: initialSupplierId,
  supplierLabel: initialSupplierLabel,
  preselectedPayableIds,
}: VendorPaymentFormModalProps): JSX.Element {
  const create = useCreateVendorPayment();

  const [supplierId, setSupplierId] = useState('');
  const [supplierLabel, setSupplierLabel] = useState('');
  const [paymentDate, setPaymentDate] = useState(today);
  const [method, setMethod] = useState<PurchasePaymentMethod>(PurchasePaymentMethod.BANK);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [instrumentNumber, setInstrumentNumber] = useState('');
  const [instrumentDate, setInstrumentDate] = useState('');
  const [bankName, setBankName] = useState('');
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  const payablesQuery = usePayables(
    {
      page: 1,
      pageSize: PAYABLE_PAGE_SIZE,
      ...(supplierId === '' ? {} : { supplierId }),
    },
    open && supplierId !== '',
  );

  /** Only bills with something left on them are worth allocating against. */
  const openPayables = useMemo(
    () =>
      (payablesQuery.data?.items ?? []).filter(
        (payable) =>
          payable.outstandingAmount > 0 && payable.status !== PayableStatus.CANCELLED,
      ),
    [payablesQuery.data?.items],
  );

  // Reset on every open so a previous payment never bleeds into the next one.
  useEffect(() => {
    if (!open) {
      hydratedRef.current = false;
      return;
    }
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setSupplierId(initialSupplierId ?? '');
    setSupplierLabel(initialSupplierLabel ?? '');
    setPaymentDate(today());
    setMethod(PurchasePaymentMethod.BANK);
    setAmount('');
    setReference('');
    setInstrumentNumber('');
    setInstrumentDate('');
    setBankName('');
    setNotes('');
    setAllocations({});
    setError(null);
  }, [open, initialSupplierId, initialSupplierLabel]);

  // The queue hands over a set of bills; fill each one in full and total them into the amount.
  const preselectKey = (preselectedPayableIds ?? []).join(',');
  useEffect(() => {
    if (!open || preselectKey === '' || openPayables.length === 0) return;
    const wanted = new Set(preselectKey.split(','));
    const picked = openPayables.filter((payable) => wanted.has(payable.id));
    if (picked.length === 0) return;
    setAllocations((current) => {
      if (Object.keys(current).length > 0) return current;
      const next: Record<string, string> = {};
      for (const payable of picked) next[payable.id] = String(payable.outstandingAmount);
      return next;
    });
    setAmount((current) =>
      current === ''
        ? String(round2(picked.reduce((sum, payable) => sum + payable.outstandingAmount, 0)))
        : current,
    );
  }, [open, preselectKey, openPayables]);

  const allocatedTotal = useMemo(
    () => round2(Object.values(allocations).reduce((sum, value) => sum + num(value), 0)),
    [allocations],
  );
  const paymentAmount = round2(num(amount));
  const unallocated = round2(paymentAmount - allocatedTotal);
  const overAllocated = unallocated < 0;
  const showsInstrument = INSTRUMENT_METHODS.includes(method);

  function setAllocation(payableId: string, value: string): void {
    setAllocations((current) => {
      const next = { ...current };
      if (value === '') delete next[payableId];
      else next[payableId] = value;
      return next;
    });
  }

  function fillPayable(payable: AccountsPayableDto): void {
    setAllocation(payable.id, String(payable.outstandingAmount));
  }

  function validate(): string | null {
    if (supplierId === '') return 'Choose the supplier being paid.';
    if (!(paymentAmount > 0)) return 'The payment amount must be above zero.';
    if (overAllocated) {
      return `Allocations come to ${money(allocatedTotal)}, which is more than the ${money(paymentAmount)} being paid.`;
    }
    for (const payable of openPayables) {
      const value = allocations[payable.id];
      if (value === undefined || value === '') continue;
      const allocated = num(value);
      if (allocated <= 0) return `${payable.documentNumber}: an allocation must be above zero.`;
      if (round2(allocated) > payable.outstandingAmount) {
        return `${payable.documentNumber}: only ${money(payable.outstandingAmount)} is outstanding on that bill.`;
      }
    }
    return null;
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem !== null) return;

    const lines = Object.entries(allocations)
      .filter(([, value]) => value !== '' && num(value) > 0)
      .map(([accountsPayableId, value]) => ({
        accountsPayableId,
        allocatedAmount: round2(num(value)),
      }));

    const body: CreateVendorPaymentRequest = {
      supplierId,
      method,
      amount: paymentAmount,
      ...(paymentDate === '' ? {} : { paymentDate }),
      reference: reference === '' ? null : reference,
      notes: notes === '' ? null : notes,
      ...(showsInstrument
        ? {
            instrumentNumber: instrumentNumber === '' ? null : instrumentNumber,
            instrumentDate: instrumentDate === '' ? null : instrumentDate,
            bankName: bankName === '' ? null : bankName,
          }
        : {}),
      ...(lines.length === 0 ? {} : { allocations: lines }),
    };

    try {
      const payment = await create.mutateAsync(body);
      notify.success(
        payment.unallocatedAmount > 0
          ? `${payment.paymentNumber} recorded · ${money(payment.unallocatedAmount)} left on account.`
          : `${payment.paymentNumber} recorded.`,
      );
      onClose();
    } catch (err) {
      setError(readError(err).message);
      notify.fromError(err);
    }
  }

  return (
    <Modal
      id="vendor-payment-form"
      title="Pay a supplier"
      open={open}
      onClose={onClose}
      minWidth={940}
      minHeight={560}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={create.isPending}
          disabled={overAllocated}
          saveLabel="Record payment"
          savingLabel="Recording…"
        />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-5">
        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <FieldGroup>
          <FieldRow>
            <SupplierPicker
              id="payment-supplier"
              required
              value={supplierId}
              displayValue={supplierLabel}
              onChange={(choice) => {
                setSupplierId(choice?.id ?? '');
                setSupplierLabel(choice?.label ?? '');
                // The old allocations point at another supplier's bills.
                setAllocations({});
              }}
            />
            <TextField
              label="Payment date"
              type="date"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
            />
          </FieldRow>

          <FieldRow>
            <SelectField
              label="Method"
              required
              value={method}
              onChange={(next) => setMethod(next as PurchasePaymentMethod)}
              options={enumOptions(PurchasePaymentMethod)}
            />
            <NumberField
              label="Amount"
              required
              min={0}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              helperText="What actually leaves the business."
            />
          </FieldRow>

          <FieldRow>
            <TextField
              label="Reference"
              value={reference}
              maxLength={120}
              onChange={(event) => setReference(event.target.value)}
              helperText="UTR, UPI reference, voucher number."
            />
            <TextField
              label="Notes"
              value={notes}
              maxLength={LIMITS.PURCHASE_LINE_NOTES_MAX}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FieldRow>

          {showsInstrument && (
            <FieldRow>
              <TextField
                label="Instrument number"
                value={instrumentNumber}
                maxLength={60}
                onChange={(event) => setInstrumentNumber(event.target.value)}
                helperText="Cheque or transfer number."
              />
              <TextField
                label="Instrument date"
                type="date"
                value={instrumentDate}
                onChange={(event) => setInstrumentDate(event.target.value)}
              />
              <TextField
                label="Bank"
                value={bankName}
                maxLength={120}
                onChange={(event) => setBankName(event.target.value)}
              />
            </FieldRow>
          )}
        </FieldGroup>

        <section className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3 border-b pb-1.5">
            <div>
              <h3 className="font-heading text-sm font-semibold">Allocate against open bills</h3>
              <p className="text-muted-foreground text-xs">
                Leave every box empty to record an advance. Anything unallocated is money on
                account, not a mistake.
              </p>
            </div>
          </div>

          {supplierId === '' ? (
            <p className="text-muted-foreground py-4 text-sm">
              Choose a supplier to see their open bills.
            </p>
          ) : payablesQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }, (_unused, index) => (
                <Skeleton key={index} className="h-8 rounded-md" />
              ))}
            </div>
          ) : payablesQuery.isError ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <p className="text-sm font-medium">Their open bills could not be loaded.</p>
              <Button variant="outline" size="sm" onClick={() => void payablesQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : openPayables.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">
              This supplier has no open bills. The whole payment will sit on account.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs">
                    <th className="pb-2 text-left font-normal">Our doc no</th>
                    <th className="pb-2 text-left font-normal">Their bill no</th>
                    <th className="pb-2 text-left font-normal">Due</th>
                    <th className="pb-2 text-right font-normal">Outstanding</th>
                    <th className="pb-2 text-right font-normal">Allocate</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {openPayables.map((payable) => (
                    <tr key={payable.id} className="border-t align-middle">
                      <td className="py-1.5 pr-2 font-medium">{payable.documentNumber}</td>
                      <td className="text-muted-foreground py-1.5 pr-2">
                        {dash(payable.supplierInvoiceNumber)}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className="tabular-nums">{formatDate(payable.dueDate)}</span>
                          <OverdueCell days={payable.daysOverdue} />
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {money(payable.outstandingAmount)}
                      </td>
                      <td className="py-1.5 pr-2 text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          className="ml-auto h-8 w-[130px] text-right tabular-nums"
                          aria-label={`Allocate to ${payable.documentNumber}`}
                          value={allocations[payable.id] ?? ''}
                          onWheel={(event) => (event.target as HTMLInputElement).blur()}
                          onChange={(event) => setAllocation(payable.id, event.target.value)}
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => fillPayable(payable)}
                        >
                          Full
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 rounded-xl border px-3 py-2">
            <span className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground text-xs">Payment</span>
              <span className="text-sm font-semibold tabular-nums">{money(paymentAmount)}</span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground text-xs">Allocated</span>
              <span className="text-sm tabular-nums">{money(allocatedTotal)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs">
                {overAllocated ? 'Over-allocated by' : 'On account'}
              </span>
              <Chip tone={overAllocated ? 'danger' : unallocated > 0 ? 'info' : 'muted'}>
                {money(Math.abs(unallocated))}
              </Chip>
            </span>
          </div>
        </section>
      </form>
    </Modal>
  );
}
