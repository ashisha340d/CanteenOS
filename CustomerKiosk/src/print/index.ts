import {
  ReceiptTransport,
  composeBill,
  encodeBill,
  type BillingIdentity,
  type PosOrderDetailDto,
  type ReceiptColumns,
} from '@menuboard/shared';
import { printBillOnServer } from '../api/kiosk';
import { formatBillTimestamp } from '../lib/format';
import { pairedPrinter, printOverUsb, usbSupported } from './usb';

/**
 * Getting the bill onto paper. ESC/POS, both ways, and nothing else.
 *
 * Two routes, tried in the order they finish in: the printer hanging off this tablet
 * (milliseconds, no dialog) and the counter printer on the network (a round trip). Which one a
 * stand prefers is a field on its row in the Admin Portal; the other is the fallback, so one
 * build serves a hall where one stand has its own printer and another shares the counter's.
 *
 * There used to be a third — the browser's own print dialog over an HTML rendering of the bill.
 * It has been removed rather than demoted. It printed an approximation on whatever paper the
 * tablet's default printer happened to hold, took seconds, and raised a modal a guest could not
 * dismiss; on an unattended device every one of those is a failure, and having it there meant
 * a misconfigured stand looked like it was working while handing out the wrong document.
 *
 * Whichever route runs, the bytes are the same: `composeBill` and `encodeBill` are in
 * `@menuboard/shared`, so a receipt printed here and one reprinted from the Admin Portal are
 * the same document rather than two renderings that happen to agree.
 */

export interface PrintContext {
  order: PosOrderDetailDto;
  identity: BillingIdentity;
  columns: ReceiptColumns;
  /** What this stand's row says to use. Falls onward when the chosen route is unavailable. */
  preferred: ReceiptTransport;
  /** Whether the backend holds a networked printer to fall back to. */
  networkConfigured: boolean;
}

export type PrintResult =
  | { ok: true; transport: ReceiptTransport; bytes: number }
  | { ok: false; message: string };

export function encodeOrderBill(context: PrintContext): Uint8Array {
  const bill = composeBill(context.order, context.identity, formatBillTimestamp);
  return encodeBill(bill, { columns: context.columns });
}

export async function printBill(context: PrintContext): Promise<PrintResult> {
  const chain = routeOrder(context);
  if (chain.length === 0) {
    return { ok: false, message: 'This stand has no printer it can reach' };
  }

  const failures: string[] = [];
  for (const transport of chain) {
    const result = await attempt(transport, context);
    if (result.ok) return result;
    failures.push(result.message);
  }

  return {
    ok: false,
    // The first failure is the informative one — the later route failed because it was never
    // configured, which is not what the operator needs to hear about.
    message: failures[0] ?? 'No printer is available',
  };
}

function routeOrder(context: PrintContext): ReceiptTransport[] {
  const other =
    context.preferred === ReceiptTransport.USB ? ReceiptTransport.NETWORK : ReceiptTransport.USB;
  return [context.preferred, other].filter((transport) =>
    transport === ReceiptTransport.USB ? usbSupported() : context.networkConfigured,
  );
}

async function attempt(transport: ReceiptTransport, context: PrintContext): Promise<PrintResult> {
  try {
    if (transport === ReceiptTransport.USB) {
      const device = await pairedPrinter();
      if (device === null) return { ok: false, message: 'No USB printer is paired' };
      const bytes = await printOverUsb(device, encodeOrderBill(context));
      return { ok: true, transport, bytes };
    }

    const result = await printBillOnServer(context.order.id);
    return { ok: true, transport, bytes: result.bytesSent };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * A slip staff can print from the setup screen to prove a pairing works, without having to
 * sell something first.
 */
export function testSlipBytes(identity: BillingIdentity, columns: ReceiptColumns): Uint8Array {
  return encodeBill(
    {
      outletName: identity.legalName,
      addressLine: identity.addressLine,
      gstin: identity.gstin,
      title: 'PRINTER TEST',
      billNumber: 'TEST',
      billedAt: formatBillTimestamp(new Date().toISOString()),
      token: '0',
      orderType: 'TEST',
      lines: [{ name: 'Printer test slip', quantity: 1, unitPrice: 0, amount: 0 }],
      subtotal: 0,
      discount: 0,
      taxBuckets: [],
      roundOff: 0,
      total: 0,
      paymentMethod: 'NONE',
      tokenQrData: 'MENUBOARD-KIOSK-TEST',
      footerLines: ['If you can read this, the kiosk can print.'],
    },
    { columns },
  );
}

export { describePrinter, pairedPrinter, requestPrinter, usbSupported } from './usb';
