import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, MessageCircleIcon, PrinterIcon, XIcon } from 'lucide-react';
import type {
  BillingIdentity,
  KioskDeviceDto,
  KioskProfileDto,
  PosOrderDetailDto,
  ReceiptColumns,
} from '@menuboard/shared';
import { useLanguage } from '../i18n';
import { sendBillOnWhatsApp } from '../api/kiosk';
import { readErrorMessage } from '../api/client';
import { RECEIPT_HOLD_MS } from '../config/device';
import { formatMoney } from '../lib/format';
import { printBill } from '../print';
import { LottieMark } from '../lottie/Lottie';
import { Action, ActionLabel } from '../components/Buttons';
import { Bilingual } from '../components/Bilingual';
import { Greeting } from '../components/Greeting';
import { Divider } from '../components/Marks';
import { NumberPad, PhoneDisplay } from '../components/NumberPad';
import { Sheet } from '../components/Sheet';

interface DoneScreenProps {
  order: PosOrderDetailDto;
  identity: BillingIdentity;
  profile: KioskProfileDto;
  /** This stand's row — read for the printer route its operator chose. */
  device: KioskDeviceDto;
  onFinish: () => void;
}

type PrintState = { status: 'working' } | { status: 'done' } | { status: 'failed'; detail: string };
type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; phone: string }
  | { status: 'failed'; detail: string };

const PHONE_DIGITS = 10;

/**
 * The token, and the bill.
 *
 * The number a guest has to remember is the largest thing on the screen; everything else is
 * confirmation. Printing starts on its own — a guest who has to find a print button will walk
 * away without the bill — and takes the fastest route the tablet has: ESC/POS over USB if a
 * printer is paired, the counter's networked printer if not, and the browser's dialog only if
 * neither exists. The first of those puts paper in a guest's hand before they have looked up
 * from the token.
 *
 * The screen returns itself to the menu so the next person finds a kiosk that is ready rather
 * than one showing somebody else's order — but it stops counting while the guest is typing a
 * phone number, because resetting the hall's kiosk out from under somebody mid-keystroke is
 * exactly the kind of small cruelty an unattended device is prone to.
 */
export function DoneScreen({
  order,
  identity,
  profile,
  device,
  onFinish,
}: DoneScreenProps): JSX.Element {
  const { t, locale } = useLanguage();
  const [print, setPrint] = useState<PrintState>({ status: 'working' });
  const [remaining, setRemaining] = useState(Math.round(RECEIPT_HOLD_MS / 1000));

  const [askingPhone, setAskingPhone] = useState(false);
  const [phone, setPhone] = useState('');
  const [send, setSend] = useState<SendState>({ status: 'idle' });

  const run = useCallback(async (): Promise<void> => {
    setPrint({ status: 'working' });
    const result = await printBill({
      order,
      identity,
      columns: profile.receiptColumns as ReceiptColumns,
      preferred: device.receiptTransport,
      networkConfigured: profile.networkPrinterConfigured,
    });
    setPrint(result.ok ? { status: 'done' } : { status: 'failed', detail: result.message });
  }, [device.receiptTransport, identity, order, profile]);

  // Fired once, from a ref set before the await. The previous version scheduled the print on a
  // timer and cleared it on cleanup, which under React's development double-invoke meant the
  // guard was already set when the second pass ran and the bill never printed at all.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  const holding = askingPhone || send.status === 'sending';

  useEffect(() => {
    if (holding) return;
    const tick = window.setInterval(() => setRemaining((value) => value - 1), 1000);
    const done = window.setTimeout(onFinish, remaining * 1000);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
    // `remaining` is deliberately absent: including it would restart the timeout every second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding, onFinish]);

  const submitPhone = async (): Promise<void> => {
    if (phone.length !== PHONE_DIGITS) return;
    setSend({ status: 'sending' });
    try {
      const result = await sendBillOnWhatsApp(order.id, phone);
      setSend({ status: 'sent', phone: result.phone });
      setAskingPhone(false);
    } catch (caught) {
      setSend({ status: 'failed', detail: readErrorMessage(caught, t('error.offline')) });
    }
  };

  return (
    <>
      <main className="animate-stage flex flex-1 flex-col items-center justify-center overflow-y-auto px-7 py-6 text-center">
        <LottieMark name="bloom" size={104} loop={false} className="text-veg" />

        <Bilingual
          k="done.thanks"
          as="h2"
          className="mt-3 font-display text-4xl tracking-[-0.02em]"
          secondaryClassName="mt-1 block text-[0.5em] font-normal text-ink-soft"
        />
        <Bilingual
          k="done.blessing"
          as="p"
          className="mt-2 text-lg text-ink-soft"
          secondaryClassName="mt-0.5 block text-[0.88em] text-ink-faint"
        />

        <div className="mt-7 w-full max-w-sm rounded-lg border border-trim-soft bg-surface px-8 py-6 shadow-[var(--shadow-card)]">
          <p className="text-2xs text-ink-faint uppercase">{t('done.token')}</p>
          <p className="numeric font-display text-token tracking-[-0.03em] text-accent">
            {order.dailySequence}
          </p>
          <Divider className="my-4" />
          <dl className="flex items-center justify-between text-sm">
            <dt className="numeric text-ink-faint">{order.orderNumber}</dt>
            <dd className="numeric font-medium">{formatMoney(order.totalAmount, locale)}</dd>
          </dl>
        </div>

        <Bilingual
          k="done.collect"
          as="p"
          className="mt-5 max-w-sm text-base text-ink-soft"
          secondaryClassName="mt-0.5 block text-[0.9em] text-ink-faint"
        />

        {/* The hall's own words, said back as the guest leaves. Without the mark: the bloom
            above is already this screen's one animation, and two would be a celebration. */}
        <Greeting
          greeting={profile.greeting}
          greetingHi={profile.greetingHi}
          mark={false}
          className="mt-5"
        />

        <PrintStatus state={print} onRetry={() => void run()} />

        {profile.whatsappBillEnabled && (
          <WhatsAppOffer
            state={send}
            onOpen={() => {
              setSend({ status: 'idle' });
              setAskingPhone(true);
            }}
          />
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <ActionLabel k="done.newOrder" size="lg" onClick={onFinish} />
        </div>

        <p className="numeric mt-4 text-xs text-ink-faint">
          {holding ? ' ' : t('done.returning', { seconds: Math.max(0, remaining) })}
        </p>
      </main>

      <Sheet
        open={askingPhone}
        onClose={() => setAskingPhone(false)}
        title="wa.offer"
        description="wa.offerBody"
      >
        <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="order-2 sm:order-1">
            <NumberPad value={phone} onChange={setPhone} maxLength={PHONE_DIGITS} />
          </div>

          <div className="order-1 flex flex-col gap-4 sm:order-2 sm:w-64">
            <div className="rounded-md border border-line bg-surface px-5 py-4 text-center">
              <p className="text-2xs text-ink-faint uppercase">{t('wa.number')}</p>
              <span className="mt-1 block">
                <PhoneDisplay value={phone} length={PHONE_DIGITS} />
              </span>
            </div>

            {send.status === 'failed' && (
              <div className="rounded-sm border border-danger/30 bg-danger-tint px-4 py-3 text-danger">
                <Bilingual
                  k="wa.failed"
                  as="p"
                  className="text-sm font-medium"
                  secondaryClassName="mt-0.5 block text-[0.9em] opacity-80"
                />
                {/* The provider's own wording, untranslated: it is what a staff member needs
                    to act on, and a generic sentence in the right language is not. */}
                <p className="mt-1.5 text-xs opacity-80">{send.detail}</p>
              </div>
            )}

            <ActionLabel
              k={send.status === 'sending' ? 'wa.sending' : 'wa.send'}
              size="lg"
              disabled={phone.length !== PHONE_DIGITS || send.status === 'sending'}
              onClick={() => void submitPhone()}
              icon={<MessageCircleIcon className="size-5" />}
            />
            <ActionLabel
              k="wa.skip"
              variant="ghost"
              onClick={() => setAskingPhone(false)}
              icon={<XIcon className="size-4" />}
            />
          </div>
        </div>
      </Sheet>

    </>
  );
}

/**
 * What the printer is doing, stated rather than assumed. The old screen said "Printing your
 * GST bill" and then said it forever, whether or not anything had come out.
 */
function PrintStatus({
  state,
  onRetry,
}: {
  state: PrintState;
  onRetry: () => void;
}): JSX.Element {
  const { t } = useLanguage();

  if (state.status === 'working') {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-ink-faint">
        <PrinterIcon className="size-4 animate-pulse" />
        {t('print.working')}
      </p>
    );
  }

  if (state.status === 'done') {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-veg">
        <CheckIcon className="size-4" />
        {t('print.done')}
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      <p className="text-xs text-danger">{t('print.failed')}</p>
      <Action variant="quiet" onClick={onRetry}>
        <PrinterIcon className="size-4" />
        {t('print.again')}
      </Action>
    </div>
  );
}

function WhatsAppOffer({
  state,
  onOpen,
}: {
  state: SendState;
  onOpen: () => void;
}): JSX.Element {
  const { t } = useLanguage();

  if (state.status === 'sent') {
    return (
      <p className="mt-5 flex items-center gap-2 rounded-pill border border-veg/40 bg-veg-tint px-5 py-2.5 text-sm text-veg">
        <CheckIcon className="size-4" />
        {t('wa.sent', { phone: state.phone })}
      </p>
    );
  }

  return (
    <ActionLabel
      k="wa.offer"
      variant="quiet"
      size="lg"
      onClick={onOpen}
      icon={<MessageCircleIcon className="size-5" />}
      className="mt-5"
    />
  );
}
