import { PURCHASE_DOCUMENT_NUMBER, type PurchaseDocumentPrefix } from '@menuboard/shared';
import { selectOne, type Db, type RowDataPacket } from '../db/types';

/**
 * Allocates human-countable document numbers: `GRN-20260811-0001`.
 *
 * Same reasoning as POS bill numbers, and deliberately the same shape and pad. A store keeper
 * reads these out over the phone and writes them on a delivery note, so they have to be short,
 * unambiguous and obviously sequential within the day.
 *
 * The sequence is allocated with `SELECT MAX(...) FOR UPDATE` inside the caller's transaction,
 * exactly as `PosRepository.nextDailySequence` does. That is what makes two receipts booked in
 * the same second get 0001 and 0002 rather than both getting 0001 and one of them failing on
 * the unique index. It also means a rolled-back transaction returns its number to the pool,
 * which is the right trade: a gap-free sequence is not worth serialising every purchase behind
 * a global counter, and nobody audits a canteen on contiguous GRN numbers.
 *
 * Callers must be inside a transaction. Allocating on the pool would take the row lock and
 * release it immediately, which defeats the point.
 */

/** Each document type keeps its own daily counter, so GRN and PI do not share a series. */
interface DocumentSeries {
  table: string;
  numberColumn: string;
  sequenceColumn: string;
  dateColumn: string;
  prefix: PurchaseDocumentPrefix;
}

const SERIES = {
  STOCK_ADJUSTMENT: {
    table: 'stock_adjustments',
    numberColumn: 'adjustment_number',
    sequenceColumn: 'daily_sequence',
    dateColumn: 'business_date',
    prefix: PURCHASE_DOCUMENT_NUMBER.PREFIX.STOCK_ADJUSTMENT,
  },
  STOCK_COUNT: {
    table: 'stock_counts',
    numberColumn: 'count_number',
    sequenceColumn: 'daily_sequence',
    dateColumn: 'business_date',
    prefix: PURCHASE_DOCUMENT_NUMBER.PREFIX.STOCK_COUNT,
  },
  PURCHASE_ENTRY: {
    table: 'purchase_entries',
    numberColumn: 'entry_number',
    sequenceColumn: 'daily_sequence',
    dateColumn: 'business_date',
    prefix: PURCHASE_DOCUMENT_NUMBER.PREFIX.PURCHASE_ENTRY,
  },
  GOODS_RECEIPT: {
    table: 'goods_receipts',
    numberColumn: 'grn_number',
    sequenceColumn: 'daily_sequence',
    dateColumn: 'business_date',
    prefix: PURCHASE_DOCUMENT_NUMBER.PREFIX.GOODS_RECEIPT,
  },
  PURCHASE_INVOICE: {
    table: 'purchase_invoices',
    numberColumn: 'invoice_number',
    sequenceColumn: 'daily_sequence',
    dateColumn: 'business_date',
    prefix: PURCHASE_DOCUMENT_NUMBER.PREFIX.PURCHASE_INVOICE,
  },
  VENDOR_PAYMENT: {
    table: 'vendor_payments',
    numberColumn: 'payment_number',
    sequenceColumn: 'daily_sequence',
    dateColumn: 'business_date',
    prefix: PURCHASE_DOCUMENT_NUMBER.PREFIX.VENDOR_PAYMENT,
  },
} as const satisfies Record<string, DocumentSeries>;

export type DocumentSeriesName = keyof typeof SERIES;

export interface AllocatedNumber {
  documentNumber: string;
  dailySequence: number;
}

/**
 * Table and column names are interpolated, not bound — SQL cannot parameterise an identifier.
 * They come exclusively from the frozen `SERIES` map above and never from a request, so there
 * is no path from user input to this string. The guard below makes that structural rather
 * than merely true today.
 */
function assertKnownSeries(name: string): asserts name is DocumentSeriesName {
  if (!Object.prototype.hasOwnProperty.call(SERIES, name)) {
    throw new Error(`Unknown document series ${name}`);
  }
}

export class DocumentNumberService {
  /**
   * Reserve the next number in a series for a business date.
   *
   * @param db  must be a connection with an open transaction; the row lock has to outlive
   *            this call or two concurrent callers will both read the same maximum.
   */
  async next(
    db: Db,
    seriesName: DocumentSeriesName,
    businessDate: string,
  ): Promise<AllocatedNumber> {
    assertKnownSeries(seriesName);
    const series: DocumentSeries = SERIES[seriesName];

    const row = await selectOne<RowDataPacket & { highest: string | null }>(
      db,
      `SELECT MAX(\`${series.sequenceColumn}\`) AS highest
         FROM \`${series.table}\`
        WHERE \`${series.dateColumn}\` = ?
        FOR UPDATE`,
      [businessDate],
    );

    const dailySequence = (row === null || row.highest === null ? 0 : Number(row.highest)) + 1;
    return {
      dailySequence,
      documentNumber: format(series.prefix, businessDate, dailySequence),
    };
  }
}

/** `PREFIX-YYYYMMDD-NNNN`, zero-padded so a day's documents sort lexically. */
export function format(
  prefix: PurchaseDocumentPrefix,
  businessDate: string,
  sequence: number,
): string {
  const compactDate = businessDate.replace(/-/g, '');
  const padded = String(sequence).padStart(PURCHASE_DOCUMENT_NUMBER.SEQUENCE_PAD, '0');
  return `${prefix}-${compactDate}-${padded}`;
}

export const documentNumberService = new DocumentNumberService();
