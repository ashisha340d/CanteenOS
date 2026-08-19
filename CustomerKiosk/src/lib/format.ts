export type KioskLocale = 'en-IN' | 'hi-IN';

/**
 * Rupees. Whole amounts lose the ".00" — a menu that reads "₹40.00" looks like a spreadsheet,
 * and every price in a canteen is a round figure until tax splits it.
 */
export function formatMoney(value: number, locale: KioskLocale = 'en-IN'): string {
  const hasPaise = Math.round(value * 100) % 100 !== 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(value);
}

/** Always two decimals — a GST bill states paise even when they are zero. */
export function formatBillAmount(value: number): string {
  return value.toFixed(2);
}

export function formatClock(date: Date, locale: KioskLocale = 'en-IN'): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** The bill is a tax document and reads in English whatever the menu is set to. */
export function formatBillTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}
