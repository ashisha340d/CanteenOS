import { GstTaxability } from '@menuboard/shared';
import type { SellableRow } from '../repositories/PosRepository';

/**
 * Pure pricing arithmetic shared by the till (PosService) and the KDS exchange path, which
 * prices replacement lines on exactly the same rules. Nothing here touches the database or
 * keeps state, so either service can call it inside whatever transaction it has open.
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
