import net from 'node:net';
import {
  PosOrderStatus,
  ReceiptTransport,
  composeBill,
  encodeBill,
  type EscPosBill,
  type PosOrderDetailDto,
  type PrintPosBillResultDto,
  type ReceiptColumns,
} from '@menuboard/shared';
import { config } from '../config';
import { getPool } from '../db/pool';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { posService } from './PosService';
import { settingsService } from './SettingsService';

/**
 * The bill as an artefact: what it says, and how it reaches paper.
 *
 * Two things had to be true before this could exist. The figures are never recomputed — every
 * amount is read off the settled ticket `PosService` produced, because the money a guest paid
 * and the money the bill states have to be the same numbers and there is only one authority
 * for them. And the *identity* on the bill — legal name, address, GSTIN — is read from the
 * organisation's own settings rather than from whichever device asked for the print: a GSTIN
 * is a registration, not a device preference, and four kiosks in one hall must not be able to
 * carry four different ones.
 */
export class ReceiptService {
  /** Everything the ESC/POS encoder needs, resolved from the ticket and the organisation. */
  async buildBill(order: PosOrderDetailDto): Promise<EscPosBill> {
    const [organisationName, legalName, addressLine, gstin, footer] = await Promise.all([
      settingsService.get<string>('organisation.name'),
      settingsService.get<string>('organisation.legal_name'),
      settingsService.get<string>('organisation.address_line'),
      settingsService.get<string>('organisation.gstin'),
      settingsService.get<string>('kiosk.receipt_footer'),
    ]);

    return composeBill(
      order,
      {
        legalName: legalName.trim() === '' ? organisationName : legalName,
        addressLine,
        gstin,
        footer,
      },
      formatTimestamp,
    );
  }

  /**
   * Prints a settled bill on the networked counter printer.
   *
   * The caller never names the device. Accepting a host and port from a tablet standing in a
   * public hall would turn this endpoint into an arbitrary outbound TCP connection with the
   * server's own network position — so the destination comes from settings only, and a
   * deployment that has not configured one simply cannot print this way.
   */
  async printToNetwork(
    posOrderId: string,
    copies: number,
    actor: AuditActor,
  ): Promise<PrintPosBillResultDto> {
    const [host, port, columns] = await Promise.all([
      settingsService.get<string>('pos.printer_host'),
      settingsService.get<number>('pos.printer_port'),
      settingsService.get<number>('kiosk.receipt_columns'),
    ]);

    if (host.trim() === '') {
      throw new ValidationError('No network receipt printer is configured', [
        { path: 'pos.printer_host', message: 'Set a printer host in Settings before printing' },
      ]);
    }

    const order = await posService.getDetail(posOrderId);
    if (order.status !== PosOrderStatus.COMPLETED) {
      throw new ValidationError('Only a settled sale can be printed as a bill', [
        { path: 'status', message: `The ticket is ${order.status}, not COMPLETED` },
      ]);
    }

    const bytes = encodeBill(await this.buildBill(order), {
      columns: columns as ReceiptColumns,
      copies,
    });

    const target = `${host.trim()}:${port}`;
    await writeToPrinter(host.trim(), port, Buffer.from(bytes));

    await auditService.record(getPool(), actor, {
      action: AuditAction.POS_BILL_PRINTED,
      entityType: 'pos_order',
      entityId: order.id,
      after: { transport: ReceiptTransport.NETWORK, target, copies, bytes: bytes.byteLength },
    });

    return {
      transport: ReceiptTransport.NETWORK,
      bytesSent: bytes.byteLength,
      target,
      printedAt: new Date().toISOString(),
    };
  }

  async networkPrinterConfigured(): Promise<boolean> {
    return (await settingsService.get<string>('pos.printer_host')).trim() !== '';
  }
}

/**
 * One connection, one write, one close.
 *
 * RAW/JetDirect printers say nothing back — there is no acknowledgement to wait for and no
 * status to read — so the socket is considered successful once the kernel has taken the bytes
 * and the peer has closed cleanly. Anything else (refused, unreachable, silent) surfaces as a
 * failure the operator can act on rather than a receipt that never appeared.
 */
function writeToPrinter(host: string, port: number, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    // A printer that is powered off answers a TCP SYN with nothing at all, so the only thing
    // separating "printing" from "hung" is this timer.
    socket.setTimeout(8_000, () => finish(new Error(`Printer at ${host}:${port} did not respond`)));

    socket.on('error', (error) => {
      logger.warn('Receipt printer write failed', { host, port }, error);
      finish(error instanceof Error ? error : new Error(String(error)));
    });

    socket.on('connect', () => {
      socket.end(payload, () => finish());
    });
  });
}

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: config.displayTimeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export const receiptService = new ReceiptService();
