import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IMMEDIATE_PURCHASE_PAYMENT_METHODS,
  PurchasePaymentMethod,
  type PostPurchaseEntryResultDto,
  type PurchaseEntryDto,
  type PurchaseExceptionCode,
} from '@menuboard/shared';
import { MARG_BEVEL_IN, MARG_BEVEL_OUT, MARG_BTN, margAmount, margMoney } from '../Pos/margChrome';
import { usePostPurchaseEntry } from '../../hooks/usePurchaseEntry';
import { readError } from '../../services/errorMessage';
import { notify } from '@/lib/notify';

export interface PurchaseMargPaymentModalProps {
  entry: PurchaseEntryDto;
  acceptedCodes: PurchaseExceptionCode[];
  /** Non-null when a blocking exception forbids the post; shown instead of the confirm button. */
  blockedReason: string | null;
  onClose: () => void;
  onPosted: (result: PostPurchaseEntryResultDto) => void;
}

const INPUT =
  'h-[20px] w-full bg-white px-1 text-right font-mono text-[13px] leading-none font-bold text-black uppercase outline-none focus:bg-[#ffffcc]';
const TEXT_INPUT = `${INPUT} text-left`;

export function PurchaseMargPaymentModal({
  entry,
  acceptedCodes,
  blockedReason,
  onClose,
  onPosted,
}: PurchaseMargPaymentModalProps): JSX.Element {
  const total = entry.totalAmount;
  const immediate = IMMEDIATE_PURCHASE_PAYMENT_METHODS.includes(entry.paymentMethod);

  const [paid, setPaid] = useState(() => (immediate ? total.toFixed(2) : '0.00'));
  const [reference, setReference] = useState(entry.paymentReference ?? '');
  const [overrideNote, setOverrideNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const paidRef = useRef<HTMLInputElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const post = usePostPurchaseEntry();

  useEffect(() => {
    setPaid(immediate ? total.toFixed(2) : '0.00');
    setError(null);
    paidRef.current?.focus();
    paidRef.current?.select();
  }, [entry.id, immediate, total]);

  const paidAmount = margMoney(paid);
  const outstanding = Math.round((total - paidAmount) * 100) / 100;

  const confirm = useCallback(async () => {
    if (post.isPending) return;
    if (blockedReason !== null) {
      setError(blockedReason.toUpperCase());
      return;
    }
    if (paidAmount < 0) {
      setError('PAID AMOUNT CANNOT BE NEGATIVE');
      return;
    }
    if (paidAmount > total) {
      setError(`PAID AMOUNT EXCEEDS THE BILL BY ${margAmount(paidAmount - total)}`);
      return;
    }
    if (acceptedCodes.length > 0 && overrideNote.trim() === '') {
      setError('AN OVERRIDE NEEDS A REASON');
      noteRef.current?.focus();
      return;
    }
    setError(null);
    try {
      const result = await post.mutateAsync({
        entryId: entry.id,
        body: {
          acceptedExceptionCodes: acceptedCodes.length > 0 ? acceptedCodes : undefined,
          overrideNote: overrideNote.trim() === '' ? null : overrideNote.trim(),
          paidAmount,
          paymentReference: reference.trim() === '' ? null : reference.trim(),
        },
      });
      notify.success(
        `PURCHASE ${result.entry.entryNumber} POSTED — ${margAmount(result.entry.totalAmount)}`,
      );
      onPosted(result);
    } catch (err) {
      setError(readError(err).message.toUpperCase());
    }
  }, [
    acceptedCodes,
    blockedReason,
    entry.id,
    onPosted,
    overrideNote,
    paidAmount,
    post,
    reference,
    total,
  ]);

  const jump =
    (target: React.RefObject<HTMLInputElement>) =>
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      target.current?.focus();
      target.current?.select();
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
        aria-label="Purchase settlement"
        className={`w-[34rem] bg-[#a9b8b4] ${MARG_BEVEL_OUT} font-mono text-[13px] text-black`}
      >
        <div className="bg-[#2e6f6a] px-2 py-[2px] font-bold tracking-[0.08em] text-white">
          PURCHASE SETTLEMENT
        </div>

        <div className="flex flex-col gap-[2px] p-3">
          <Row label="Entry No." value={entry.entryNumber} />
          <Row label="Party" value={(entry.supplierName ?? '').toUpperCase()} />
          <Row label="Bill No." value={entry.supplierInvoiceNumber ?? '—'} />
          <div className="my-1 border-t border-[#5f7370]" />
          <Row label="Value of Goods" value={margAmount(entry.subtotalAmount)} />
          <Row label="Discount" value={margAmount(entry.discountAmount)} />
          <Row label="Taxable" value={margAmount(entry.taxableAmount)} />
          <Row label="GST" value={margAmount(entry.taxAmount)} />
          {entry.otherCharges !== 0 && (
            <Row label="Other Charges" value={margAmount(entry.otherCharges)} />
          )}
          {entry.roundOffAmount !== 0 && (
            <Row label="Round Off" value={margAmount(entry.roundOffAmount)} />
          )}
          <Row label="GRAND TOTAL" value={margAmount(total)} />
          <div className="my-1 border-t border-[#5f7370]" />

          <div className="flex items-center gap-2">
            <span className="w-[10rem] font-bold">PAY MODE</span>
            <span className="w-[10rem] px-1 font-bold">{entry.paymentMethod}</span>
            <span className="text-[11px] text-[#3c4b48]">
              {entry.paymentMethod === PurchasePaymentMethod.CREDIT
                ? 'CREDIT — LEAVES A PAYABLE'
                : 'CHANGE ON THE HEADER'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-[10rem] font-bold">PAID NOW</span>
            <span className={`${MARG_BEVEL_IN} w-[10rem]`}>
              <input
                ref={paidRef}
                value={paid}
                inputMode="decimal"
                autoComplete="off"
                className={INPUT}
                onChange={(event) => setPaid(event.target.value)}
                onKeyDown={jump(referenceRef)}
              />
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-[10rem] font-bold">REFERENCE</span>
            <span className={`${MARG_BEVEL_IN} w-[14rem]`}>
              <input
                ref={referenceRef}
                value={reference}
                autoComplete="off"
                className={TEXT_INPUT}
                onChange={(event) => setReference(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (acceptedCodes.length > 0) {
                    noteRef.current?.focus();
                    return;
                  }
                  void confirm();
                }}
              />
            </span>
          </div>

          {acceptedCodes.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-[10rem] font-bold text-[#a06000]">OVERRIDE NOTE</span>
              <span className={`${MARG_BEVEL_IN} flex-1`}>
                <input
                  ref={noteRef}
                  value={overrideNote}
                  autoComplete="off"
                  className={TEXT_INPUT}
                  onChange={(event) => setOverrideNote(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void confirm();
                  }}
                />
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="w-[10rem] font-bold">OUTSTANDING</span>
            <span className="w-[10rem] px-1 text-right font-bold tabular-nums">
              {margAmount(outstanding > 0 ? outstanding : 0)}
            </span>
          </div>

          {acceptedCodes.length > 0 && (
            <p className="mt-1 bg-[#c47f00] px-1 py-[1px] text-[11px] font-bold text-black uppercase">
              ACCEPTING {acceptedCodes.length} OVERRIDABLE EXCEPTION
              {acceptedCodes.length === 1 ? '' : 'S'}: {acceptedCodes.join(', ')}
            </p>
          )}

          {blockedReason !== null && (
            <p role="alert" className="mt-1 bg-[#a80000] px-1 py-[1px] font-bold text-white uppercase">
              {blockedReason}
            </p>
          )}

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
              className={`${MARG_BTN} bg-[#a80000] font-bold text-white disabled:text-[#e0c0c0]`}
              disabled={post.isPending || blockedReason !== null}
              onClick={() => void confirm()}
            >
              {post.isPending ? 'Posting…' : 'Enter Post'}
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
      <span className="w-[10rem]">{label}</span>
      <span className="w-[10rem] px-1 text-right font-bold tabular-nums">{value}</span>
    </div>
  );
}
