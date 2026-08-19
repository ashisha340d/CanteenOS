import { useEffect, useRef, useState } from 'react';
import {
  PosOrderStatus,
  PosOrderType,
  PosPaymentMethod,
  type KioskDeviceDto,
  type PosOrderDetailDto,
} from '@menuboard/shared';
import { useLanguage } from '../i18n';
import { useCart, toOrderItems, type CartLine } from '../state/cart';
import { checkoutOrder, createOrder } from '../api/kiosk';
import { readErrorMessage } from '../api/client';
import { DEMO_PAYMENT } from '../config/device';
import { formatMoney } from '../lib/format';
import { buildUpiUri } from '../lib/upi';
import { LottieMark } from '../lottie/Lottie';
import { ActionLabel } from '../components/Buttons';
import { Bilingual } from '../components/Bilingual';
import { QrCode } from '../components/QrCode';
import { Loading, Notice } from '../components/States';

export interface KioskDraft {
  order: PosOrderDetailDto;
  /** What the cart looked like when the ticket was raised. */
  signature: string;
}

interface PaymentScreenProps {
  menuId: string;
  /** This stand's row: the station its tickets belong to, and the payee its QR names. */
  device: KioskDeviceDto;
  /** A ticket already raised for this same cart, kept across a cancel-and-return. */
  draft: KioskDraft | null;
  onDraft: (draft: KioskDraft) => void;
  onSettled: (order: PosOrderDetailDto) => void;
  onCancel: () => void;
}

type Phase = 'placing' | 'awaiting' | 'settling' | 'failed';

/** Identifies a cart by what is in it, so an unchanged cart keeps its ticket. */
export function cartSignature(lines: CartLine[]): string {
  return lines
    .map((line) => `${line.key}:${line.quantity}`)
    .sort()
    .join('|');
}

/**
 * Payment.
 *
 * The ticket is raised first, as a DRAFT, for one reason: the amount on the QR has to be the
 * amount the server will charge, and only `PosService` can say what that is. A guest who walks
 * away leaves a parked draft — the same thing an operator leaves when they abandon a ticket
 * mid-entry — rather than an unpaid open sale, and the kiosk needs no power to cancel it.
 *
 * The confirmation step is the honest one: with no gateway integrated there is nothing to
 * verify a payment against, so the kiosk says so on screen instead of pretending.
 */
export function PaymentScreen({
  menuId,
  device,
  draft,
  onDraft,
  onSettled,
  onCancel,
}: PaymentScreenProps): JSX.Element {
  const { t, locale } = useLanguage();
  const { lines } = useCart();
  const signature = cartSignature(lines);
  const reusable = draft !== null && draft.signature === signature ? draft.order : null;

  const [phase, setPhase] = useState<Phase>(reusable === null ? 'placing' : 'awaiting');
  const [order, setOrder] = useState<PosOrderDetailDto | null>(reusable);
  const [error, setError] = useState<string | null>(null);
  const placed = useRef(reusable !== null);

  useEffect(() => {
    // Strict-mode double invocation would otherwise raise two tickets for one guest, and a
    // guest who steps back to the cart and returns unchanged reuses the ticket they already
    // have rather than leaving an abandoned draft behind on the counter's dashboard.
    if (placed.current) return;
    placed.current = true;

    void (async () => {
      try {
        const ticket = await createOrder({
          orderType: PosOrderType.TAKEAWAY,
          status: PosOrderStatus.DRAFT,
          stationId: device.stationId,
          menuId,
          pax: 1,
          notes: 'Self-service kiosk',
          items: toOrderItems(lines),
        });
        setOrder(ticket);
        onDraft({ order: ticket, signature });
        setPhase('awaiting');
      } catch (caught) {
        setError(readErrorMessage(caught, t('error.offline')));
        setPhase('failed');
      }
    })();
  }, [device.stationId, lines, menuId, onDraft, signature, t]);

  const settle = async (): Promise<void> => {
    if (order === null) return;
    setPhase('settling');
    setError(null);
    try {
      const settled = await checkoutOrder(order.id, {
        payments: [
          {
            method: PosPaymentMethod.UPI,
            amount: order.totalAmount,
            reference: `KIOSK-${order.orderNumber}`,
          },
        ],
        expectedRevision: order.revision,
      });
      onSettled(settled);
    } catch (caught) {
      setError(readErrorMessage(caught, t('error.offline')));
      setPhase('failed');
    }
  };

  if (phase === 'placing') return <Loading k="pay.placing" />;
  if (phase === 'settling') return <Loading k="pay.settling" />;

  if (phase === 'failed' || order === null) {
    return (
      <main className="flex flex-1 flex-col">
        <Notice title="pay.failed" body="error.generic" detail={error} />
        <div className="safe-bottom flex justify-center gap-3 px-7">
          <ActionLabel k="pay.cancel" variant="quiet" size="lg" onClick={onCancel} />
          {order !== null && <ActionLabel k="pay.retry" size="lg" onClick={settle} />}
        </div>
      </main>
    );
  }

  const upiUri = buildUpiUri({
    vpa: device.upiVpa,
    payeeName: device.upiPayeeName,
    amount: order.totalAmount,
    note: order.orderNumber,
    transactionRef: order.orderNumber.replace(/[^A-Za-z0-9]/g, ''),
  });

  return (
    <main className="animate-stage flex flex-1 flex-col items-center justify-center overflow-y-auto px-7 py-6">
      <div className="w-full max-w-md text-center">
        <p className="numeric text-2xs text-ink-faint uppercase">{order.orderNumber}</p>
        <Bilingual
          k="pay.title"
          as="h2"
          className="mt-2 font-display text-3xl tracking-[-0.02em]"
          secondaryClassName="mt-1 block text-[0.6em] font-normal text-ink-soft"
        />
        <Bilingual
          k="pay.body"
          as="p"
          className="mt-2 text-base text-ink-soft"
          secondaryClassName="mt-0.5 block text-[0.9em] text-ink-faint"
        />

        <div className="mt-6 inline-flex flex-col items-center rounded-lg border border-trim-soft bg-surface p-5 shadow-[var(--shadow-card)]">
          <span className="relative grid place-items-center">
            <QrCode value={upiUri} size={244} alt={t('pay.title')} />
            {/* A scan line over the plaque, so a guest holding a phone up can see the code is
                live rather than a printed sticker somebody taped to the screen. */}
            <LottieMark
              name="scan"
              size={244}
              className="pointer-events-none absolute inset-0 text-accent"
            />
          </span>
          <p className="mt-4 text-2xs text-ink-faint uppercase">{t('pay.amount')}</p>
          <p className="numeric font-display text-4xl tracking-[-0.02em]">
            {formatMoney(order.totalAmount, locale)}
          </p>
          <p className="mt-1 text-xs text-ink-faint">{device.upiVpa}</p>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3">
          <LottieMark name="diya" size={44} className="shrink-0 text-accent" />
          <Bilingual
            k="pay.waiting"
            as="p"
            className="text-base text-ink-soft"
            secondaryClassName="mt-0.5 block text-[0.9em] text-ink-faint"
          />
        </div>

        {DEMO_PAYMENT ? (
          <div className="mt-6 rounded-md border border-dashed border-accent/45 bg-accent-tint/60 px-5 py-4">
            <Bilingual
              k="pay.demoBanner"
              as="p"
              className="text-xs text-ink-soft"
              secondaryClassName="mt-0.5 block"
            />
            <ActionLabel k="pay.demoConfirm" size="lg" onClick={settle} className="mt-3 w-full" />
          </div>
        ) : (
          <Bilingual
            k="pay.waiting"
            as="p"
            className="mt-6 rounded-md border border-line bg-surface px-5 py-4 text-xs text-ink-soft"
            secondaryClassName="mt-0.5 block"
          />
        )}

        <ActionLabel k="pay.cancel" variant="ghost" onClick={onCancel} className="mt-4" />
      </div>
    </main>
  );
}
