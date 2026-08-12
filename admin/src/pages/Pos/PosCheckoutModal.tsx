import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ENTITY_REQUIRED_PAYMENT_METHODS,
  LIMITS,
  PosDiscountType,
  PosPaymentMethod,
  type EntityDto,
  type PosOrderDetailDto,
  type PosPaymentInput,
} from '@menuboard/shared';
import { CheckCircle2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { NumberField, SelectField, TextField } from '@/components/form/fields';
import { Modal } from '../../components/Modal/Modal';
import { useCheckoutPosOrder, useUpdatePosOrder } from '../../hooks/usePos';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { TONE_BG_CLASS, TONE_TEXT_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { formatMoney } from './posFormat';
import { PosEntityPickerModal } from './PosEntityPickerModal';

interface PosCheckoutModalProps {
  open: boolean;
  order: PosOrderDetailDto;
  onClose: () => void;
  onSettled: (order: PosOrderDetailDto) => void;
}

/** One tender leg the operator has added. Amounts stay strings so a half-typed figure survives. */
interface PaymentLeg {
  key: string;
  method: PosPaymentMethod;
  amount: string;
  tendered: string;
  reference: string;
  entityId: string | null;
  entityLabel: string | null;
}

/** A bill discount the operator has pushed to the server, so the total below is authoritative. */
interface AppliedDiscount {
  type: PosDiscountType;
  value: number;
}

const ENTITY_METHODS: readonly string[] = ENTITY_REQUIRED_PAYMENT_METHODS;

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toAmount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? money(parsed) : 0;
}

/**
 * Settling the ticket.
 *
 * Two rules the server enforces and this dialog therefore refuses to fudge. First, the payments
 * must sum to the bill exactly — so Confirm stays disabled until "remaining" is zero rather than
 * letting the operator find out from a rejected request. Second, a bill discount changes the
 * total in ways only the server can compute (the round-off setting lives there), so a discount
 * has to be *applied* — a real write that returns the recalculated ticket — before the tender
 * rows can be trusted. Showing a locally guessed total and calling it the bill would be a lie
 * the customer pays for.
 */
export function PosCheckoutModal({
  open,
  order,
  onClose,
  onSettled,
}: PosCheckoutModalProps): JSX.Element {
  const navigate = useNavigate();
  const legSeq = useRef(0);
  const nextKey = useCallback((): string => {
    legSeq.current += 1;
    return `leg-${legSeq.current}`;
  }, []);

  const [current, setCurrent] = useState<PosOrderDetailDto>(order);
  const [discountType, setDiscountType] = useState<PosDiscountType>(PosDiscountType.NONE);
  const [discountValue, setDiscountValue] = useState('0');
  const [applied, setApplied] = useState<AppliedDiscount | null>(null);
  const [legs, setLegs] = useState<PaymentLeg[]>([]);
  const [settled, setSettled] = useState<PosOrderDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const update = useUpdatePosOrder();
  const checkout = useCheckoutPosOrder();

  const total = current.totalAmount;

  const resetLegs = useCallback(
    (amount: number) => {
      setLegs([
        {
          key: nextKey(),
          method: PosPaymentMethod.CASH,
          amount: amount.toFixed(2),
          tendered: '',
          reference: '',
          entityId: null,
          entityLabel: null,
        },
      ]);
    },
    [nextKey],
  );

  // Re-seed on every open: the ticket may have moved since the dialog was last used, and a
  // half-entered tender from a previous sale must never carry into this one.
  useEffect(() => {
    if (!open) return;
    setCurrent(order);
    setDiscountType(PosDiscountType.NONE);
    setDiscountValue('0');
    setApplied(null);
    setSettled(null);
    setError(null);
    setPickerFor(null);
    resetLegs(order.totalAmount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id]);

  const paid = money(legs.reduce((sum, leg) => sum + toAmount(leg.amount), 0));
  const remaining = money(total - paid);
  const changeDue = money(
    legs.reduce((sum, leg) => {
      if (leg.method !== PosPaymentMethod.CASH || leg.tendered === '') return sum;
      const over = toAmount(leg.tendered) - toAmount(leg.amount);
      return over > 0 ? sum + over : sum;
    }, 0),
  );

  const pendingDiscount: AppliedDiscount = {
    type: discountType,
    value: discountType === PosDiscountType.NONE ? 0 : toAmount(discountValue),
  };
  const discountNeedsApply =
    applied === null
      ? pendingDiscount.type !== PosDiscountType.NONE
      : applied.type !== pendingDiscount.type || applied.value !== pendingDiscount.value;

  const accountLegMissingEntity = legs.some(
    (leg) =>
      ENTITY_METHODS.includes(leg.method) && (leg.entityId ?? current.entityId) === null,
  );

  const blockedReason =
    settled !== null
      ? null
      : discountNeedsApply
        ? 'Apply the discount first — it changes the bill total.'
        : accountLegMissingEntity
          ? 'An account payment needs the account it is charged to.'
          : remaining !== 0
            ? remaining > 0
              ? `${formatMoney(remaining)} still to collect.`
              : `${formatMoney(Math.abs(remaining))} over-collected — the bill must be settled exactly.`
            : null;

  function patchLeg(key: string, patch: Partial<PaymentLeg>): void {
    setLegs((rows) => rows.map((leg) => (leg.key === key ? { ...leg, ...patch } : leg)));
  }

  function addLeg(): void {
    const outstanding = remaining > 0 ? remaining : 0;
    setLegs((rows) => [
      ...rows,
      {
        key: nextKey(),
        method: PosPaymentMethod.CARD,
        amount: outstanding.toFixed(2),
        tendered: '',
        reference: '',
        entityId: null,
        entityLabel: null,
      },
    ]);
  }

  async function applyDiscount(): Promise<void> {
    setError(null);
    try {
      const next = await update.mutateAsync({
        id: current.id,
        body: {
          discountType: pendingDiscount.type,
          discountValue: pendingDiscount.value,
          expectedRevision: current.revision,
        },
      });
      setCurrent(next);
      setApplied(pendingDiscount);
      resetLegs(next.totalAmount);
      notify.success('Bill discount applied.');
    } catch (err) {
      setError(readError(err).message);
      notify.fromError(err);
    }
  }

  async function confirm(): Promise<void> {
    setError(null);
    const payments: PosPaymentInput[] = legs.map((leg) => {
      const amount = toAmount(leg.amount);
      return {
        method: leg.method,
        amount,
        ...(leg.method === PosPaymentMethod.CASH && leg.tendered !== ''
          ? { tenderedAmount: toAmount(leg.tendered) }
          : {}),
        ...(leg.reference.trim() !== '' ? { reference: leg.reference.trim() } : {}),
        ...(ENTITY_METHODS.includes(leg.method) && leg.entityId !== null
          ? { entityId: leg.entityId }
          : {}),
      };
    });

    try {
      const result = await checkout.mutateAsync({
        id: current.id,
        body: {
          payments,
          ...(applied !== null
            ? { discountType: applied.type, discountValue: applied.value }
            : {}),
          expectedRevision: current.revision,
        },
      });
      setSettled(result);
      setCurrent(result);
      const change = money(
        result.payments
          .filter((payment) => !payment.isReversal)
          .reduce((sum, payment) => sum + payment.changeAmount, 0),
      );
      notify.success(
        `Bill ${result.orderNumber} settled — ${formatMoney(result.totalAmount)}.` +
        (change > 0 ? ` Change due: ${formatMoney(change)}.` : ''),
      );
      onSettled(result);
    } catch (err) {
      // The server's wording ("Payments total X but the bill is Y") is the useful one.
      setError(readError(err).message);
      notify.fromError(err);
    }
  }

  /* ------------------------------------------------------------------ settled */

  if (settled !== null) {
    const change = money(
      settled.payments
        .filter((payment) => !payment.isReversal)
        .reduce((sum, payment) => sum + payment.changeAmount, 0),
    );

    return (
      <Modal
        id="pos-checkout"
        title="Sale settled"
        open={open}
        onClose={onClose}
        minWidth={480}
        minHeight={420}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onClose();
                navigate(`/pos/entry?type=${settled.orderType}`);
              }}
            >
              New sale
            </Button>
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <span
            aria-hidden
            className={cn(
              'grid size-14 place-items-center rounded-xl [&_svg]:size-7',
              TONE_BG_CLASS.success,
              TONE_TEXT_CLASS.success,
            )}
          >
            <CheckCircle2Icon />
          </span>
          <div>
            <p className="font-heading text-lg font-semibold">
              {formatMoney(settled.totalAmount)} collected
            </p>
            <p className="text-muted-foreground text-sm">
              Bill <span className="font-mono">{settled.orderNumber}</span> · token{' '}
              {settled.dailySequence}
            </p>
          </div>

          <div className="bg-muted/50 w-full rounded-lg border p-3 text-left">
            {settled.payments
              .filter((payment) => !payment.isReversal)
              .map((payment) => (
                <div key={payment.id} className="flex items-center justify-between gap-3 py-0.5">
                  <span className="text-sm">
                    {payment.method}
                    {payment.reference ? (
                      <span className="text-muted-foreground"> · {payment.reference}</span>
                    ) : null}
                  </span>
                  <span className="text-sm tabular-nums">{formatMoney(payment.amount)}</span>
                </div>
              ))}
          </div>

          <p className={cn('text-base font-semibold', change > 0 && TONE_TEXT_CLASS.progress)}>
            {change > 0 ? `Change due ${formatMoney(change)}` : 'No change due'}
          </p>
        </div>
      </Modal>
    );
  }

  /* ------------------------------------------------------------------- tender */

  return (
    <>
      <Modal
        id="pos-checkout"
        title={`Checkout — ${current.orderNumber}`}
        description="Split the tender across payment methods until the remaining amount reaches zero."
        open={open}
        onClose={onClose}
        minWidth={520}
        minHeight={620}
        footer={
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={checkout.isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={confirm}
              disabled={checkout.isPending || blockedReason !== null}
              title={blockedReason ?? undefined}
            >
              {checkout.isPending && <Spinner data-icon="inline-start" />}
              {checkout.isPending ? 'Settling…' : `Confirm ${formatMoney(total)}`}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Bill summary, straight off the ticket the server returned. */}
          <div className="bg-card rounded-xl border p-3">
            <SummaryRow label="Subtotal" value={current.subtotalAmount} />
            {current.discountAmount !== 0 && (
              <SummaryRow label="Discount" value={-current.discountAmount} />
            )}
            <SummaryRow label="Tax" value={current.taxAmount} />
            {current.roundOffAmount !== 0 && (
              <SummaryRow label="Round off" value={current.roundOffAmount} />
            )}
            <Separator className="my-2" />
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">Total</span>
              <span className="font-heading text-xl font-semibold tabular-nums">
                {formatMoney(total)}
              </span>
            </div>
          </div>

          {/* Bill discount */}
          <section className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-xs font-medium tracking-[0.06em] uppercase">
              Bill discount
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <SelectField
                label="Type"
                value={discountType}
                onChange={(value) => setDiscountType(value as PosDiscountType)}
                options={enumOptions(PosDiscountType)}
              />
              <NumberField
                label={discountType === PosDiscountType.PERCENT ? 'Percent' : 'Amount'}
                disabled={discountType === PosDiscountType.NONE}
                value={discountValue}
                onChange={(event) => setDiscountValue(event.target.value)}
                min={0}
                max={
                  discountType === PosDiscountType.PERCENT
                    ? LIMITS.POS_DISCOUNT_PERCENT_MAX
                    : LIMITS.PRICE_MAX
                }
                step="0.01"
              />
              <Button
                type="button"
                variant={discountNeedsApply ? 'default' : 'outline'}
                onClick={applyDiscount}
                disabled={update.isPending || !discountNeedsApply}
              >
                {update.isPending && <Spinner data-icon="inline-start" />}
                Apply
              </Button>
            </div>
            {discountNeedsApply && (
              <p className="text-muted-foreground text-xs">
                The bill total is recalculated by the server. Apply the discount to see the figure
                the customer pays.
              </p>
            )}
          </section>

          <Separator />

          {/* Split tender */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-muted-foreground text-xs font-medium tracking-[0.06em] uppercase">
                Payment
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLeg}
                disabled={legs.length >= LIMITS.POS_PAYMENTS_PER_ORDER_MAX}
              >
                <PlusIcon data-icon="inline-start" />
                Add payment
              </Button>
            </div>

            {legs.map((leg) => {
              const needsEntity = ENTITY_METHODS.includes(leg.method);
              const resolvedEntityId = leg.entityId ?? current.entityId;
              const change = toAmount(leg.tendered) - toAmount(leg.amount);

              return (
                <div key={leg.key} className="bg-card flex flex-col gap-3 rounded-xl border p-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <SelectField
                      label="Method"
                      value={leg.method}
                      onChange={(value) =>
                        patchLeg(leg.key, { method: value as PosPaymentMethod, tendered: '' })
                      }
                      options={enumOptions(PosPaymentMethod)}
                    />
                    <NumberField
                      label="Amount"
                      value={leg.amount}
                      onChange={(event) => patchLeg(leg.key, { amount: event.target.value })}
                      min={0}
                      max={LIMITS.PRICE_MAX}
                      step="0.01"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove this payment"
                      disabled={legs.length === 1}
                      onClick={() => setLegs((rows) => rows.filter((row) => row.key !== leg.key))}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>

                  {leg.method === PosPaymentMethod.CASH && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
                      <NumberField
                        label="Cash tendered"
                        helperText="Optional — enter what the customer handed over to compute change."
                        value={leg.tendered}
                        onChange={(event) => patchLeg(leg.key, { tendered: event.target.value })}
                        min={0}
                        max={LIMITS.PRICE_MAX}
                        step="0.01"
                      />
                      <p className="text-sm">
                        <span className="text-muted-foreground">Change: </span>
                        <span
                          className={cn('font-medium tabular-nums', change > 0 && TONE_TEXT_CLASS.progress)}
                        >
                          {formatMoney(change > 0 ? change : 0)}
                        </span>
                      </p>
                    </div>
                  )}

                  {leg.method !== PosPaymentMethod.CASH &&
                    leg.method !== PosPaymentMethod.COMPLIMENTARY && (
                      <TextField
                        label="Reference"
                        helperText="Card approval code, UPI reference — whatever reconciles this leg later."
                        value={leg.reference}
                        onChange={(event) => patchLeg(leg.key, { reference: event.target.value })}
                        maxLength={LIMITS.POS_PAYMENT_REFERENCE_MAX}
                      />
                    )}

                  {needsEntity && (
                    <div className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
                      {resolvedEntityId === null ? (
                        <>
                          <span className="text-tone-danger flex-1 text-sm">
                            An account payment needs an account to charge.
                          </span>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setPickerFor(leg.key)}
                          >
                            Choose account
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 text-sm">
                            Charging{' '}
                            <span className="font-medium">
                              {leg.entityLabel ?? current.entityName ?? 'the order’s account'}
                            </span>
                            {leg.entityId === null && current.entityId !== null && (
                              <Badge variant="outline" className="ml-2 text-[0.625rem]">
                                from the ticket
                              </Badge>
                            )}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setPickerFor(leg.key)}
                          >
                            Change
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <Separator />

          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">Remaining</span>
            <span
              className={cn(
                'font-heading text-xl font-semibold tabular-nums',
                remaining === 0 ? TONE_TEXT_CLASS.success : TONE_TEXT_CLASS.danger,
              )}
            >
              {formatMoney(remaining)}
            </span>
          </div>
          {changeDue > 0 && (
            <p className="text-muted-foreground text-sm">
              Change to hand back: <span className="tabular-nums">{formatMoney(changeDue)}</span>
            </p>
          )}
          {blockedReason && <p className="text-muted-foreground text-xs">{blockedReason}</p>}
        </div>
      </Modal>

      {pickerFor !== null && (
        <PosEntityPickerModal
          open
          onClose={() => setPickerFor(null)}
          onSelect={(entity: EntityDto | null) => {
            if (entity === null) return;
            patchLeg(pickerFor, { entityId: entity.id, entityLabel: entity.name });
          }}
        />
      )}
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-sm tabular-nums">{formatMoney(value)}</span>
    </div>
  );
}
