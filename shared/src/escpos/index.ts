/**
 * ESC/POS receipt encoding.
 *
 * One definition of what a MenuBoard bill looks like on a thermal roll, shared by the two
 * things that can reach a printer: the kiosk (WebUSB, straight to the device hanging off the
 * tablet) and the backend (a TCP socket to a networked counter printer). If each rendered its
 * own bytes the same sale would come out differently depending on which path took it, and the
 * one printed artefact a guest carries out of the hall is a tax document.
 *
 * Pure and dependency-free by design: it produces a `Uint8Array` and knows nothing about
 * sockets, USB, React or Express.
 *
 * Encoding is single-byte (code page 437). A thermal printer has no Devanagari glyphs and no
 * way to be taught them at run time, so the receipt is Latin — which matches the rule the GST
 * bill already followed on screen: an invoice must be readable by an officer, not only by the
 * guest who ordered it.
 */

/* ------------------------------------------------------------------ raw commands */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const Justify = { LEFT: 0, CENTER: 1, RIGHT: 2 } as const;
export type Justify = (typeof Justify)[keyof typeof Justify];

/** `GS !` character magnification. Both axes are 1..8; the printer stores them in one byte. */
function sizeByte(width: number, height: number): number {
  const w = Math.min(8, Math.max(1, Math.round(width))) - 1;
  const h = Math.min(8, Math.max(1, Math.round(height))) - 1;
  return (w << 4) | h;
}

/**
 * Accumulates the byte stream. Everything a receipt needs is appended in one pass so the
 * result can leave in a single bulk write — the whole reason this path exists rather than a
 * browser print dialog.
 */
export class EscPosBuffer {
  private readonly bytes: number[] = [];

  raw(...values: number[]): this {
    this.bytes.push(...values);
    return this;
  }

  /** Resets every mode the last job may have left set. Always the first command. */
  init(): this {
    return this.raw(ESC, 0x40).raw(ESC, 0x74, 0x00);
  }

  text(value: string): this {
    for (const code of encodeCp437(value)) this.bytes.push(code);
    return this;
  }

  line(value = ''): this {
    return this.text(value).raw(LF);
  }

  feed(lines = 1): this {
    return this.raw(ESC, 0x64, Math.min(255, Math.max(0, lines)));
  }

  justify(mode: Justify): this {
    return this.raw(ESC, 0x61, mode);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  underline(on: boolean): this {
    return this.raw(ESC, 0x2d, on ? 1 : 0);
  }

  size(width: number, height: number): this {
    return this.raw(GS, 0x21, sizeByte(width, height));
  }

  /**
   * QR code, model 2, printed by the printer itself rather than sent as a bitmap: a raster
   * image of the same code is roughly a hundred times the bytes and is the difference between
   * a receipt that appears instantly and one the guest watches being drawn.
   */
  qr(data: string, moduleSize = 6): this {
    const payload = encodeCp437(data);
    const length = payload.length + 3;
    return this
      .raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00)
      .raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.min(16, Math.max(1, moduleSize)))
      .raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31)
      .raw(GS, 0x28, 0x6b, length & 0xff, (length >> 8) & 0xff, 0x31, 0x50, 0x30, ...payload)
      .raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
  }

  /** Feed clear of the tear bar, then a partial cut that leaves the roll joined by a nib. */
  cut(feedLines = 4): this {
    return this.raw(GS, 0x56, 0x42, Math.min(255, Math.max(0, feedLines)));
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/* ------------------------------------------------------------------ text fitting */

/** Printable columns at Font A: 32 on a 58 mm roll, 48 on an 80 mm one. */
export type ReceiptColumns = 32 | 42 | 48;

export function padRight(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + ' '.repeat(width - value.length);
}

export function padLeft(value: string, width: number): string {
  return value.length >= width ? value.slice(value.length - width) : ' '.repeat(width - value.length) + value;
}

/** A label on the left and a figure on the right, with the gap between them doing the work. */
export function twoColumn(left: string, right: string, columns: number): string {
  const room = Math.max(0, columns - right.length - 1);
  return `${padRight(left, room)} ${right}`;
}

/**
 * The same pair, but never at the cost of the label.
 *
 * On a 58 mm roll "Reference" beside a full order number leaves eight characters for the word
 * and prints "Referenc". Where the two cannot share a line the value drops to its own, still
 * right-aligned — which is how a hand-written receipt would have done it.
 */
export function pairLines(left: string, right: string, columns: number): string[] {
  if (left.length + right.length + 1 <= columns) return [twoColumn(left, right, columns)];
  return [left, padLeft(right, columns)];
}

export function wrap(value: string, columns: number): string[] {
  const words = value.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [''];

  const rows: string[] = [];
  let current = '';
  for (const word of words) {
    // A single word longer than the roll is hard-split rather than allowed to overflow into
    // the printer's own wrap, which breaks mid-glyph on some models.
    if (word.length > columns) {
      if (current !== '') {
        rows.push(current);
        current = '';
      }
      for (let index = 0; index < word.length; index += columns) {
        rows.push(word.slice(index, index + columns));
      }
      continue;
    }
    if (current === '') current = word;
    else if (current.length + 1 + word.length <= columns) current += ` ${word}`;
    else {
      rows.push(current);
      current = word;
    }
  }
  if (current !== '') rows.push(current);
  return rows;
}

/* ------------------------------------------------------------------ code page 437 */

/**
 * Characters worth keeping that CP437 spells differently, plus the ones a Menu Master row
 * routinely carries because it was typed in a word processor.
 */
const CP437_SPECIALS: Record<string, number> = {
  ' ': 0x20,
  '‘': 0x27,
  '’': 0x27,
  '“': 0x22,
  '”': 0x22,
  '–': 0x2d,
  '—': 0x2d,
  '…': 0x2e,
  'é': 0x82,
  'è': 0x8a,
  'ü': 0x81,
  'ö': 0x94,
  'ä': 0x84,
  'ñ': 0xa4,
  '°': 0xf8,
  '½': 0xab,
  '¼': 0xac,
};

/**
 * The rupee sign has no CP437 code point and prints as garbage on every roll it is sent to,
 * so it becomes `Rs.` — the form Indian thermal receipts have always used.
 */
export function toReceiptText(value: string): string {
  return value
    .replace(/₹\s?/g, 'Rs.')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function encodeCp437(value: string): number[] {
  const bytes: number[] = [];
  for (const character of toReceiptText(value)) {
    const code = character.codePointAt(0) ?? 0x20;
    if (code >= 0x20 && code <= 0x7e) {
      bytes.push(code);
      continue;
    }
    if (code === 0x0a) {
      bytes.push(LF);
      continue;
    }
    const special = CP437_SPECIALS[character];
    // Anything else — Devanagari above all — has no glyph in the printer's ROM. A space is a
    // better receipt than a column of black boxes.
    bytes.push(special ?? 0x20);
  }
  return bytes;
}

/* ------------------------------------------------------------------ the bill */

export interface EscPosBillLine {
  name: string;
  variantName?: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface EscPosTaxBucket {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

export interface EscPosBill {
  outletName: string;
  addressLine?: string | null;
  gstin?: string | null;
  /** `TAX INVOICE` when anything on the ticket is taxed, `BILL OF SUPPLY` when nothing is. */
  title: string;
  billNumber: string;
  /** Already formatted for the audience — this module does no locale work. */
  billedAt: string;
  token: string;
  orderType: string;
  lines: EscPosBillLine[];
  subtotal: number;
  discount: number;
  taxBuckets: EscPosTaxBucket[];
  roundOff: number;
  total: number;
  paymentMethod: string;
  paymentReference?: string | null;
  /** Encoded into a printer-drawn QR so the counter can pull the ticket up by scanning it. */
  tokenQrData?: string | null;
  footerLines?: string[];
}

export interface EscPosOptions {
  columns?: ReceiptColumns;
  /** Off for printers without a cutter; the roll is then torn by hand. */
  cut?: boolean;
  copies?: number;
}

function money(value: number): string {
  return value.toFixed(2);
}

/** The whole receipt as one contiguous byte stream, ready for a single write. */
export function encodeBill(bill: EscPosBill, options: EscPosOptions = {}): Uint8Array {
  const columns = options.columns ?? 48;
  const cut = options.cut ?? true;
  const copies = Math.min(5, Math.max(1, options.copies ?? 1));
  const buffer = new EscPosBuffer();

  for (let copy = 0; copy < copies; copy += 1) {
    writeBill(buffer, bill, columns);
    if (cut) buffer.cut();
    else buffer.feed(5);
  }

  return buffer.build();
}

function writeBill(buffer: EscPosBuffer, bill: EscPosBill, columns: number): void {
  const rule = '-'.repeat(columns);

  buffer.init().justify(Justify.CENTER);

  buffer.size(1, 2).bold(true);
  for (const row of wrap(bill.outletName.toUpperCase(), columns)) buffer.line(row);
  buffer.bold(false).size(1, 1);

  if (bill.addressLine) for (const row of wrap(bill.addressLine, columns)) buffer.line(row);
  if (bill.gstin) buffer.line(`GSTIN: ${bill.gstin}`);

  buffer.feed(1).bold(true).line(bill.title).bold(false);
  buffer.justify(Justify.LEFT).line(rule);

  buffer.line(twoColumn('Bill No', bill.billNumber, columns));
  buffer.line(twoColumn('Date', bill.billedAt, columns));
  buffer.line(twoColumn('Type', bill.orderType, columns));
  buffer.line(rule);

  for (const line of bill.lines) {
    const name = line.variantName ? `${line.name} (${line.variantName})` : line.name;
    for (const row of wrap(name, columns)) buffer.line(row);
    // Quantity and rate sit under the name rather than beside it: dish names in a canteen are
    // long, and a four-column table on a 32-column roll truncates the one thing a guest reads.
    buffer.line(twoColumn(`  ${line.quantity} x ${money(line.unitPrice)}`, money(line.amount), columns));
  }

  buffer.line(rule);
  buffer.line(twoColumn('Subtotal', money(bill.subtotal), columns));
  if (bill.discount !== 0) buffer.line(twoColumn('Discount', money(-bill.discount), columns));

  for (const bucket of bill.taxBuckets) {
    if (bucket.rate === 0) continue;
    const half = bucket.rate / 2;
    if (bucket.cgst > 0) buffer.line(twoColumn(`CGST ${half}%`, money(bucket.cgst), columns));
    if (bucket.sgst > 0) buffer.line(twoColumn(`SGST ${half}%`, money(bucket.sgst), columns));
    if (bucket.igst > 0) buffer.line(twoColumn(`IGST ${bucket.rate}%`, money(bucket.igst), columns));
    if (bucket.cess > 0) buffer.line(twoColumn('Cess', money(bucket.cess), columns));
  }

  if (bill.roundOff !== 0) buffer.line(twoColumn('Round off', money(bill.roundOff), columns));

  buffer.bold(true).size(1, 2);
  buffer.line(twoColumn('TOTAL', `Rs.${money(bill.total)}`, columns));
  buffer.size(1, 1).bold(false);

  const taxed = bill.taxBuckets.some((bucket) => bucket.rate > 0);
  if (taxed) {
    buffer.line(rule);
    // The rate-wise summary a GST bill is required to carry. The four columns are divided out
    // of whatever width the roll has rather than fixed, because a fixed table sized for 80 mm
    // paper wraps into unreadable rubbish the moment somebody loads a 58 mm roll.
    const rateWidth = Math.max(5, Math.floor(columns * 0.16));
    const figure = Math.floor((columns - rateWidth) / 3);
    const heading =
      padRight('GST%', rateWidth) +
      padLeft('Taxable', figure) +
      padLeft('CGST', figure) +
      padLeft('SGST', figure);
    buffer.line(heading);
    for (const bucket of bill.taxBuckets) {
      if (bucket.rate === 0) continue;
      buffer.line(
        padRight(`${bucket.rate}%`, rateWidth) +
          padLeft(money(bucket.taxable), figure) +
          padLeft(money(bucket.cgst), figure) +
          padLeft(money(bucket.sgst), figure),
      );
    }
  }

  buffer.line(rule);
  for (const row of pairLines('Paid by', bill.paymentMethod, columns)) buffer.line(row);
  if (bill.paymentReference) {
    for (const row of pairLines('Reference', bill.paymentReference, columns)) buffer.line(row);
  }

  buffer.feed(1).justify(Justify.CENTER);
  buffer.size(2, 2).bold(true).line(`TOKEN ${bill.token}`).bold(false).size(1, 1);

  if (bill.tokenQrData) buffer.feed(1).qr(bill.tokenQrData).raw(LF);

  buffer.feed(1);
  // Centring is the printer's job here — `justify(CENTER)` is still in force, and padding the
  // string as well would centre each line twice and push it off to the right.
  for (const footer of bill.footerLines ?? []) {
    for (const row of wrap(footer, columns)) buffer.line(row);
  }
  buffer.justify(Justify.LEFT);
}

export { composeBill, summariseByRate, type BillingIdentity } from './bill';
