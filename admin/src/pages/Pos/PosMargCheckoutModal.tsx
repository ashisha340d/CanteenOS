import { useCallback, useEffect, useRef, useState } from 'react';
import { PosPaymentMethod, type PosOrderDetailDto } from '@menuboard/shared';
import { useCheckoutPosOrder } from '../../hooks/usePos';
import { readError } from '../../services/errorMessage';
import { notify } from '@/lib/notify';
import {
  MARG_BEVEL_IN,
  MARG_BEVEL_OUT,
  MARG_BTN,
  margAmount,
  margMoney,
} from './margChrome';

interface PosMargCheckoutModalProps {
  order: PosOrderDetailDto;
  onClose: () => void;
  onSettled: (order: PosOrderDetailDto) => void;
}

const INPUT =
  'h-[20px] w-full bg-white px-1 text-right font-mono text-[13px] leading-none font-bold text-black outline-none focus:bg-[#ffffcc]';

export function PosMargCheckoutModal({
  order,
  onClose,
  onSettled,
}: PosMargCheckoutModalProps): JSX.Element {
  const total = order.totalAmount;
  const [amount, setAmount] = useState(total.toFixed(2));
  const [cash, setCash] = useState('');
  const [error, setError] = useState<string | null>(null);

  const amountRef = useRef<HTMLInputElement>(null);
  const cashRef = useRef<HTMLInputElement>(null);
  const checkout = useCheckoutPosOrder();

  useEffect(() => {
    setAmount(total.toFixed(2));
    setCash('');
    setError(null);
    cashRef.current?.focus();
    cashRef.current?.select();
  }, [order.id, total]);

  const tendered = margMoney(cash);
  const payable = margMoney(amount);
  const balance = cash.trim() === '' ? 0 : tendered - payable;

  const confirm = useCallback(async () => {
    if (checkout.isPending) return;
    setError(null);
    try {
      const result = await checkout.mutateAsync({
        id: order.id,
        body: {
          payments: [
            {
              method: PosPaymentMethod.CASH,
              amount: total,
              tenderedAmount: margMoney(cash) > total ? margMoney(cash) : total,
            },
          ],
          expectedRevision: order.revision,
        },
      });
      const change = result.payments
        .filter((payment) => !payment.isReversal)
        .reduce((sum, payment) => sum + payment.changeAmount, 0);
      notify.success(
        `BILL ${result.orderNumber} SAVED — ${margAmount(result.totalAmount)}` +
          (change > 0 ? ` · CHANGE ${margAmount(change)}` : ''),
      );
      onSettled(result);
    } catch (err) {
      setError(readError(err).message.toUpperCase());
    }
  }, [cash, checkout, onSettled, order.id, order.revision, total]);

  const onAmountKey = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (margMoney(amount) !== total) {
      setError(`AMOUNT MUST BE ${margAmount(total)} — THE BILL CANNOT BE PART SETTLED HERE`);
      return;
    }
    setError(null);
    cashRef.current?.focus();
    cashRef.current?.select();
  };

  const onCashKey = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (cash.trim() === '') {
      setError('ENTER CASH TENDERED');
      return;
    }
    if (!Number.isFinite(Number(cash.trim()))) {
      setError('CASH TENDERED IS NOT A VALID FIGURE');
      return;
    }
    if (tendered < payable) {
      setError(`CASH TENDERED IS SHORT BY ${margAmount(payable - tendered)}`);
      return;
    }
    setError(null);
    void confirm();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-label="Cash receipt"
        className={`w-[30rem] bg-[#a9b8b4] ${MARG_BEVEL_OUT} font-mono text-[13px] text-black`}
      >
        <div className="bg-[#2e6f6a] px-2 py-[2px] font-bold tracking-[0.08em] text-white">
          CASH RECEIPT
        </div>

        <div className="flex flex-col gap-[2px] p-3">
          <Row label="Bill No." value={order.orderNumber} />
          <Row label="Party" value={order.entityName ?? 'WALK-IN'} />
          <div className="my-1 border-t border-[#5f7370]" />
          <Row label="Value of Goods" value={margAmount(order.subtotalAmount)} />
          <Row label="Discount" value={margAmount(order.discountAmount)} />
          <Row label="GST" value={margAmount(order.taxAmount)} />
          {order.roundOffAmount !== 0 && (
            <Row label="Round Off" value={margAmount(order.roundOffAmount)} />
          )}
          <div className="my-1 border-t border-[#5f7370]" />

          <div className="flex items-center gap-2">
            <span className="w-[9rem] font-bold">AMOUNT</span>
            <span className={`${MARG_BEVEL_IN} w-[9rem]`}>
              <input
                ref={amountRef}
                value={amount}
                inputMode="decimal"
                autoComplete="off"
                className={INPUT}
                onChange={(event) => setAmount(event.target.value)}
                onKeyDown={onAmountKey}
              />
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-[9rem] font-bold">CASH TENDERED</span>
            <span className={`${MARG_BEVEL_IN} w-[9rem]`}>
              <input
                ref={cashRef}
                value={cash}
                inputMode="decimal"
                autoComplete="off"
                className={INPUT}
                onChange={(event) => setCash(event.target.value)}
                onKeyDown={onCashKey}
              />
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-[9rem] font-bold">BALANCE / CHANGE</span>
            <span className="w-[9rem] px-1 text-right font-bold tabular-nums">
              {margAmount(balance > 0 ? balance : 0)}
            </span>
          </div>

          {error !== null && (
            <p role="alert" className="mt-1 bg-[#a80000] px-1 py-[1px] font-bold text-white">
              {error}
            </p>
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" className={MARG_BTN} onClick={onClose}>
              Esc Cancel
            </button>
            <button
              type="button"
              className={`${MARG_BTN} font-bold`}
              disabled={checkout.isPending}
              onClick={() => {
                if (cash.trim() === '') {
                  setError('ENTER CASH TENDERED');
                  cashRef.current?.focus();
                  return;
                }
                if (tendered < payable) {
                  setError(`CASH TENDERED IS SHORT BY ${margAmount(payable - tendered)}`);
                  cashRef.current?.focus();
                  return;
                }
                void confirm();
              }}
            >
              {checkout.isPending ? 'Saving…' : 'Enter Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[9rem]">{label}</span>
      <span className="w-[9rem] px-1 text-right font-bold tabular-nums">{value}</span>
    </div>
  );
}
