import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, LogOut, RefreshCw, Settings } from 'lucide-react';
import QRCode from 'qrcode';
import { KDS_SOCKET_EVENTS, type CdsLiveDto } from '@menuboard/shared';
import { fetchCdsBill } from '../api/kds';
import { readErrorMessage } from '../api/client';
import { getAccessToken } from '../api/session';
import type { StationSelection } from '../config/station';
import { connectSocket, disconnectSocket, onSocketEvent, subscribeCds } from '../socket';
import { useT } from '../i18n';
import '../board/board.css';

/** `cds:bill` arrives on every change to the ticket; the timer is the missed-event net. */
const BILL_REFETCH_MS = 15_000;
/** A till that stops pushing has been abandoned mid-cart; the mirror must not freeze forever. */
const LIVE_STALE_MS = 90_000;
const MONEY = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

interface Props {
  station: StationSelection;
  onChangeStation: () => void;
  onSignOut: () => void;
}

/** The customer's own bill view. No controls, no staff chrome — just what they are paying for. */
export function CdsPage({ station, onChangeStation, onSignOut }: Props): JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const [live, setLive] = useState<CdsLiveDto | null>(null);
  const [liveAt, setLiveAt] = useState(0);
  const [chromeOpen, setChromeOpen] = useState(false);

  const bill = useQuery({
    queryKey: ['cds', 'bill', station.id],
    queryFn: () => fetchCdsBill(station.id),
    refetchInterval: BILL_REFETCH_MS,
  });

  useEffect(() => {
    const token = getAccessToken();
    if (token === null) return;

    connectSocket(token);
    subscribeCds(station.id);

    const offBill = onSocketEvent(KDS_SOCKET_EVENTS.CDS_BILL, () => {
      void queryClient.invalidateQueries({ queryKey: ['cds', 'bill', station.id] });
    });
    const offLive = onSocketEvent(KDS_SOCKET_EVENTS.CDS_LIVE, (payload) => {
      setLive((payload as CdsLiveDto | null) ?? null);
      setLiveAt(Date.now());
    });

    return () => {
      offBill();
      offLive();
      disconnectSocket();
    };
  }, [queryClient, station.id]);

  // Drop a stale mirror rather than showing a cart nobody is working on.
  useEffect(() => {
    if (live === null) return;
    const timer = window.setTimeout(() => setLive(null), LIVE_STALE_MS);
    return () => window.clearTimeout(timer);
  }, [live, liveAt]);

  const data = bill.data ?? null;
  // A settled bill is the final word: the cashier is done, so any cart mirror is history.
  const settled = data !== null && data.isSettled;
  const showLive = live !== null && !settled;

  return (
    <div className="cds">
      <header className="cds__head">
        <div>
          <h1>{station.name}</h1>
          <p>{settled ? t.thankYou : t.welcome}</p>
        </div>
        {/* Staff controls stay out of the customer's way behind one quiet button. */}
        <div className="cds__chrome">
          <button
            type="button"
            className="cds__chrome-toggle"
            onClick={() => setChromeOpen((open) => !open)}
            aria-label={t.displaySettings}
          >
            <Settings className="size-4" />
          </button>
          {chromeOpen && (
            <div className="cds__chrome-menu">
              <button type="button" onClick={onChangeStation}>
                <RefreshCw className="size-4" /> {t.changeStation}
              </button>
              <button type="button" onClick={onSignOut}>
                <LogOut className="size-4" /> {t.signOut}
              </button>
            </div>
          )}
        </div>
      </header>

      {settled && data.upiLink !== null ? (
        <PayScreen
          orderNumber={data.orderNumber}
          amount={data.totalAmount}
          upiLink={data.upiLink}
          lineCount={data.lines.length}
        />
      ) : settled ? (
        <SettledScreen orderNumber={data.orderNumber} amount={data.totalAmount} />
      ) : showLive ? (
        <BillBody
          heading={live.orderNumber !== null ? t.billNo(live.orderNumber) : t.yourOrder}
          lines={live.lines.map((line) => ({
            itemName: line.itemName,
            variantName: line.variantName,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
          }))}
          subtotalAmount={live.subtotalAmount}
          discountAmount={live.discountAmount}
          totalAmount={live.totalAmount}
          totalLabel={t.runningTotal}
        />
      ) : data !== null ? (
        <BillBody
          heading={t.billNo(data.orderNumber)}
          lines={data.lines}
          subtotalAmount={data.subtotalAmount}
          discountAmount={data.discountAmount}
          taxAmount={data.taxAmount}
          totalAmount={data.totalAmount}
          totalLabel={t.toPay}
        />
      ) : (
        <div className="cds__idle">
          {bill.error !== null ? (
            <p>{readErrorMessage(bill.error, t.billLoadFailed)}</p>
          ) : (
            <>
              <h2>{t.betweenBills}</h2>
              <p>{t.stepUpToCounter}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The cart or the bill, itemised. Large type: the customer reads this from a metre away. */
function BillBody({
  heading,
  lines,
  subtotalAmount,
  discountAmount,
  taxAmount,
  totalAmount,
  totalLabel,
}: {
  heading: string;
  lines: { itemName: string; variantName: string | null; quantity: number; lineTotal: number }[];
  subtotalAmount: number;
  discountAmount: number;
  taxAmount?: number;
  totalAmount: number;
  totalLabel: string;
}): JSX.Element {
  const t = useT();
  return (
    <div className="cds__body">
      <div className="cds__lines">
        <p className="cds__heading">{heading}</p>
        {lines.length === 0 && <p className="cds__empty">{t.itemsAppearHere}</p>}
        {lines.map((line, index) => (
          <div key={index} className="cds-line">
            <span className="cds-line__qty">{line.quantity}×</span>
            <span className="cds-line__name">
              {line.itemName}
              {line.variantName !== null ? <small>{line.variantName}</small> : null}
            </span>
            <span className="cds-line__amount">{MONEY.format(line.lineTotal)}</span>
          </div>
        ))}
      </div>

      <aside className="cds__side">
        <dl className="cds__summary">
          <div>
            <dt>{t.subtotal}</dt>
            <dd>{MONEY.format(subtotalAmount)}</dd>
          </div>
          {discountAmount !== 0 && (
            <div>
              <dt>{t.discount}</dt>
              <dd>−{MONEY.format(discountAmount)}</dd>
            </div>
          )}
          {taxAmount !== undefined && taxAmount !== 0 && (
            <div>
              <dt>{t.tax}</dt>
              <dd>{MONEY.format(taxAmount)}</dd>
            </div>
          )}
        </dl>
        <div className="cds__total">
          <p>{totalLabel}</p>
          <strong>{MONEY.format(totalAmount)}</strong>
        </div>
      </aside>
    </div>
  );
}

/** The pay screen: the bill is settled to UPI, so the QR is the only thing that matters. */
function PayScreen({
  orderNumber,
  amount,
  upiLink,
  lineCount,
}: {
  orderNumber: string;
  amount: number;
  upiLink: string;
  lineCount: number;
}): JSX.Element {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current === null) return;
    void QRCode.toCanvas(canvasRef.current, upiLink, {
      width: 420,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0d1015', light: '#ffffff' },
    }).catch(() => undefined);
  }, [upiLink]);

  return (
    <div className="cds__pay">
      <p className="cds__pay-eyebrow">{t.scanToPay}</p>
      <div className="cds__pay-qr">
        <canvas ref={canvasRef} />
      </div>
      <div className="cds__pay-amount">
        <p>{t.amount}</p>
        <strong>{MONEY.format(amount)}</strong>
      </div>
      <p className="cds__pay-note">
        {t.billNo(orderNumber)} · {t.itemsCount(lineCount)} · {t.anyUpiApp}
      </p>
    </div>
  );
}

/** Settled by cash, card or account — no QR, just confirmation and the amount. */
function SettledScreen({ orderNumber, amount }: { orderNumber: string; amount: number }): JSX.Element {
  const t = useT();
  return (
    <div className="cds__settled">
      <CheckCircle2 className="cds__settled-tick" />
      <p className="cds__pay-eyebrow">{t.billSettled}</p>
      <strong>{MONEY.format(amount)}</strong>
      <p className="cds__pay-note">
        {t.billNo(orderNumber)} · {t.collectReceipt}
      </p>
    </div>
  );
}
