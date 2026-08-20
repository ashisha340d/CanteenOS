import { GstTaxability } from '@menuboard/shared';
import type { SellableRow } from '../repositories/PosRepository';

/**
 * Pure pricing arithmetic shared by the till (PosService), the KDS exchange path, which
 * prices replacement lines on exactly the same rules, and purchasing, which has to arrive at
 * the same CGST/SGST/IGST split for a supplier bill that the till arrives at for a sale.
 * Nothing here touches the database or keeps state, so any caller can use it inside whatever
 * transaction it has open.
 *
 * There is exactly one GST computation in this codebase and it is `applyTax` below. Sales and
 * purchases differ in which direction the money flows and in nothing else, so a second
 * implementation would only ever be a way for the two to disagree.
 */

/** DECIMAL(14,2) — every money value crosses the boundary at this scale, and only here. */
export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface TaxTreatment {
  taxProfileId: string | null;
  rate: number;
  cessRate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  priceIsInclusive: boolean;
  interState: boolean;
}

/** Per-menu catalogue price beats the variant's list price, which beats the item's base. */
export function resolvePrice(sellable: SellableRow): number {
  if (sellable.catalog_price !== null) return Number(sellable.catalog_price);
  if (sellable.variant_price !== null) return Number(sellable.variant_price);
  if (sellable.base_price !== null) return Number(sellable.base_price);
  return 0;
}

/** The tax breakdown of a single line, at DECIMAL(14,2) throughout. */
export interface TaxBreakdown {
  /** The value tax is charged on. Equals `net` when the price excludes tax. */
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  /** CGST + SGST + IGST + CESS. */
  taxAmount: number;
  /** taxableAmount + taxAmount. What the line is actually worth. */
  lineTotal: number;
}

/**
 * Split a net line value into taxable value and its GST components.
 *
 * `net` is gross less discount. When the profile prices inclusive of tax the net already
 * contains the tax and is divided back out; when it prices exclusive the tax is added on top.
 *
 * The parts are derived from the total rather than computed independently and summed, so
 * CGST + SGST + IGST + CESS always adds back to `taxAmount` exactly, even where a headline
 * rate rounds awkwardly. Intra-state splits the GST portion in half and gives the remainder
 * to SGST for the same reason — a 2.5/2.5 split of an odd number of paise must not lose one.
 */
export function applyTax(net: number, treatment: TaxTreatment): TaxBreakdown {
  const combinedRate = treatment.rate + treatment.cessRate;
  const taxableAmount = treatment.priceIsInclusive ? money(net / (1 + combinedRate / 100)) : net;
  const taxAmount = money(
    treatment.priceIsInclusive ? net - taxableAmount : (net * combinedRate) / 100,
  );

  const cessAmount = money((taxableAmount * treatment.cessRate) / 100);
  const gstPortion = money(taxAmount - cessAmount);
  const cgstAmount = treatment.interState ? 0 : money(gstPortion / 2);
  const sgstAmount = treatment.interState ? 0 : money(gstPortion - cgstAmount);
  const igstAmount = treatment.interState ? gstPortion : 0;

  return {
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    cessAmount,
    taxAmount,
    lineTotal: money(taxableAmount + taxAmount),
  };
}

/**
 * Whether a supply crosses a state border, which is the only thing that decides CGST+SGST
 * versus IGST. Absent either state code the supply is treated as intra-state: a canteen
 * buying locally is the overwhelmingly common case, and guessing IGST would wrongly deny the
 * CGST/SGST split on a bill that has simply not had its GSTIN captured yet.
 *
 * The parameters are typed `string | null` but are coerced rather than trusted, because one of
 * them arrives from `settings` and does not reliably obey that type. `settings.value` is
 * JSON-valid text read through an unchecked `getValue<string>()` cast, and a state code stored
 * as the bare JSON number `27` decodes to a *number* — on which `.trim()` throws. GST state
 * codes are two digits, so most real values hit exactly that case. Coercing here rather than at
 * each call site means the till, the KDS and purchasing are all protected by one guard, at the
 * boundary where configuration enters the tax engine.
 */
export function isInterStateSupply(
  ourStateCode: string | null,
  counterpartyStateCode: string | null,
): boolean {
  const ours = normaliseStateCode(ourStateCode);
  const theirs = normaliseStateCode(counterpartyStateCode);
  if (ours === null || theirs === null) return false;
  return ours !== theirs;
}

/**
 * A GST state code as a comparable string, or null when there is nothing usable.
 *
 * Numbers are padded back to two digits: a code stored as `9` means Uttarakhand (`09`), and
 * comparing `"9"` against a supplier's `"09"` would report an inter-state supply between two
 * parties in the same state — charging IGST where CGST+SGST is due.
 */
function normaliseStateCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return String(Math.trunc(value)).padStart(2, '0');
  }
  const text = String(value).trim();
  if (text === '') return null;
  return /^\d$/.test(text) ? text.padStart(2, '0') : text;
}

export function taxTreatmentFrom(sellable: SellableRow, interState: boolean): TaxTreatment {
  if (sellable.tax_profile_id === null) {
    return {
      taxProfileId: null,
      rate: 0,
      cessRate: 0,
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
      priceIsInclusive: true,
      interState,
    };
  }

  // EXEMPT / NIL_RATED / ZERO_RATED / NON_GST all produce no tax; the profile already carries
  // zero rates for those, but reading the taxability makes the intent explicit here too.
  const taxable = sellable.gst_taxability === GstTaxability.TAXABLE;
  return {
    taxProfileId: sellable.tax_profile_id,
    rate: taxable ? Number(sellable.gst_rate ?? 0) : 0,
    cessRate: taxable ? Number(sellable.cess_rate ?? 0) : 0,
    cgstRate: Number(sellable.cgst_rate ?? 0),
    sgstRate: Number(sellable.sgst_rate ?? 0),
    igstRate: Number(sellable.igst_rate ?? 0),
    priceIsInclusive: sellable.price_is_inclusive !== 0,
    interState,
  };
}
