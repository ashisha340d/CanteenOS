/**
 * A standard UPI intent string — `upi://pay?pa=…` — which is what every UPI app expects to
 * find behind a QR code.
 *
 * This is the whole of the kiosk's payment integration today: it *asks* for money, and cannot
 * *confirm* it, because no gateway or bank callback exists yet (MENUBOARD_SPEC.md §3d). The
 * string itself is the real thing, so wiring a gateway later replaces the confirmation step
 * and not this file.
 */
export interface UpiIntent {
  vpa: string;
  payeeName: string;
  amount: number;
  /** Shown in the payer's app — the bill number, so a query has something to match on. */
  note: string;
  transactionRef: string;
}

export function buildUpiUri(intent: UpiIntent): string {
  const params = new URLSearchParams({
    pa: intent.vpa,
    pn: intent.payeeName,
    am: intent.amount.toFixed(2),
    cu: 'INR',
    tn: intent.note,
    tr: intent.transactionRef,
  });
  return `upi://pay?${params.toString()}`;
}
