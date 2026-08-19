import type { PosOrderDetailDto, PosOrderItemDto } from '../dto/domain';
import type { EscPosBill, EscPosTaxBucket } from './index';

/**
 * A settled ticket, read as a bill.
 *
 * This lives beside the encoder rather than in either client because both of them need it and
 * they must agree: the kiosk composes a bill to send over USB, the backend composes the same
 * bill to send over the network, and a guest who takes the USB copy and a counter that
 * reprints the network copy are holding the same tax document.
 *
 * Nothing here computes money. Every figure is read off the ticket `PosService` returned —
 * the tax split included — because the amounts the guest paid and the amounts the bill states
 * have to be the same numbers, and there is exactly one authority for them.
 */

export interface BillingIdentity {
  /** Registered name of the seller. Organisation-level, never per device. */
  legalName: string;
  addressLine: string;
  gstin: string;
  /** Closing line under the token. */
  footer: string;
}

export function composeBill(
  order: PosOrderDetailDto,
  identity: BillingIdentity,
  formatTimestamp: (iso: string) => string,
): EscPosBill {
  const lines = order.items.filter((item) => item.status !== 'CANCELLED');
  const taxBuckets = summariseByRate(lines);
  const payment = order.payments.find((row) => !row.isReversal) ?? null;

  return {
    outletName: identity.legalName,
    addressLine: identity.addressLine,
    gstin: identity.gstin,
    // A supplier charging no tax on anything may not call the document a tax invoice.
    title: taxBuckets.some((bucket) => bucket.rate > 0) ? 'TAX INVOICE' : 'BILL OF SUPPLY',
    billNumber: order.orderNumber,
    billedAt: formatTimestamp(order.completedAt ?? order.createdAt),
    token: String(order.dailySequence),
    orderType: order.orderType.replace(/_/g, ' '),
    lines: lines.map((line) => ({
      name: line.itemName,
      variantName: line.variantName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.lineTotal,
    })),
    subtotal: order.subtotalAmount,
    discount: order.discountAmount,
    taxBuckets,
    roundOff: order.roundOffAmount,
    total: order.totalAmount,
    paymentMethod: payment?.method ?? 'UPI',
    paymentReference: payment?.reference ?? null,
    tokenQrData: order.orderNumber,
    footerLines: [
      'Please collect at the counter when your token is called.',
      ...(identity.footer.trim() === '' ? [] : [identity.footer]),
    ],
  };
}

/** Rate-wise summary, as a GST bill is required to carry — grouped, never re-derived. */
export function summariseByRate(lines: PosOrderItemDto[]): EscPosTaxBucket[] {
  const byRate = new Map<number, EscPosTaxBucket>();
  for (const line of lines) {
    const bucket = byRate.get(line.taxRate) ?? {
      rate: line.taxRate,
      taxable: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      cess: 0,
    };
    bucket.taxable += line.taxableAmount;
    bucket.cgst += line.cgstAmount;
    bucket.sgst += line.sgstAmount;
    bucket.igst += line.igstAmount;
    bucket.cess += line.cessAmount;
    byRate.set(line.taxRate, bucket);
  }
  return [...byRate.values()].sort((a, b) => a.rate - b.rate);
}
