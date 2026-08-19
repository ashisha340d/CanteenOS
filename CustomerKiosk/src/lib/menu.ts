import {
  AvailabilityStatus,
  applyCategoryOrder,
  type MenuTreeDto,
  type ResolvedMenuCategoryDto,
  type ResolvedMenuItemDto,
  type ResolvedMenuVariantDto,
} from '@menuboard/shared';
import type { CartLine } from '../state/cart';

/**
 * Reading the resolved menu tree the way a guest sees it.
 *
 * Three rules: the kiosk shows what the Admin Portal published for this channel and nothing
 * else, it never invents a price — a dish with no variant and no base price is a catalogue
 * entry somebody has not finished, so it is not drawn — and it never offers what the counter
 * does not have.
 *
 * That last rule is why nothing is greyed out here. A self-service stand has nobody to explain
 * a struck-through line to the guest: a dish the counter has finished simply leaves the menu,
 * the same way it leaves the Digital Menu Board, and returns when the shift resets or the
 * counter puts it back. A queue reading a board of half-dimmed dishes is a queue asking staff
 * what is actually available, which is the one job the kiosk exists to remove.
 */

/** The sizes a guest may actually order: neither withdrawn nor run out. */
export function sellableVariants(item: ResolvedMenuItemDto): ResolvedMenuVariantDto[] {
  return item.variants
    .filter((variant) => variant.availability === AvailabilityStatus.AVAILABLE)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.price - b.price);
}

export function isVisible(item: ResolvedMenuItemDto): boolean {
  // `qr_visible` is the guest-facing channel flag in the Menu Master (§3a); the kiosk is the
  // same audience as a table QR — someone who is not staff, reading the menu themselves.
  if (!item.qrVisible) return false;
  // Withdrawn or sold out: off the menu entirely, not dimmed on it.
  if (item.availability !== AvailabilityStatus.AVAILABLE) return false;
  // A dish that sells by portion is only orderable while a portion is; one that sells by
  // itself needs a price of its own.
  return item.variants.length > 0 ? sellableVariants(item).length > 0 : item.basePrice !== null;
}

/**
 * Whether a dish already on screen has since become unorderable.
 *
 * `isVisible` keeps sold-out dishes off the menu in the first place, so this is now only about
 * the gap between two menu refreshes: a dish that ran out while a guest was reading it. It
 * still matters — the card must refuse the tap rather than put an unavailable line in the cart.
 */
export function isSoldOut(item: ResolvedMenuItemDto): boolean {
  if (item.availability !== AvailabilityStatus.AVAILABLE) return true;
  return item.variants.length > 0 && sellableVariants(item).length === 0;
}

export function priceOf(item: ResolvedMenuItemDto, variant: ResolvedMenuVariantDto | null): number {
  return variant?.price ?? item.basePrice ?? 0;
}

/** The figure on the card: one price, or the cheapest with a "from". */
export function cardPrice(item: ResolvedMenuItemDto): { amount: number; from: boolean } {
  const variants = sellableVariants(item);
  if (variants.length === 0) return { amount: item.basePrice ?? 0, from: false };
  const prices = variants.map((variant) => variant.price);
  const min = Math.min(...prices);
  return { amount: min, from: new Set(prices).size > 1 };
}

export function lineKeyFor(item: ResolvedMenuItemDto, variant: ResolvedMenuVariantDto | null): string {
  return variant?.id ?? item.foodItemId;
}

export function toCartLine(
  item: ResolvedMenuItemDto,
  variant: ResolvedMenuVariantDto | null,
  categoryKey: string,
): Omit<CartLine, 'quantity'> {
  return {
    key: lineKeyFor(item, variant),
    foodItemId: item.foodItemId,
    variantId: variant?.id ?? null,
    name: item.name,
    nameHi: item.nameHi,
    variantName: variant?.portionName ?? variant?.name ?? null,
    variantNameHi: variant?.nameHi ?? null,
    unitPrice: priceOf(item, variant),
    imageUrl: variant?.primaryMediaUrl ?? item.primaryMediaUrl,
    preparationTimeMinutes: variant?.preparationTimeMinutes ?? item.preparationTimeMinutes,
    categoryKey,
  };
}

export interface MenuGroup {
  category: ResolvedMenuCategoryDto;
  items: ResolvedMenuItemDto[];
}

/**
 * A suggestion added without opening the size chooser — the cheapest variant, or the dish
 * itself. Used by the drink/sweet prompt, where asking a second question would undo the
 * point of asking the first.
 */
export function quickAddLine(
  item: ResolvedMenuItemDto,
  categoryKey: string,
): { key: string; line: Omit<CartLine, 'quantity'> } {
  const variant = sellableVariants(item)[0] ?? null;
  return { key: lineKeyFor(item, variant), line: toCartLine(item, variant, categoryKey) };
}

/**
 * Every group that has something to sell, in the order this stand shows them.
 *
 * Two orders, layered. The menu carries its own `sortOrder`, which is right for a printed board
 * and for the counter's till. On top of it sits the stand's own arrangement, dragged in the
 * Admin Portal — because what a queue should meet first depends on the hour and the hall, and
 * renumbering the Menu Master to move sweets above rice at one kiosk would move them everywhere.
 *
 * `applyCategoryOrder` treats the stand's list as a preference rather than a replacement, so a
 * category added to the menu after somebody last dragged this list still appears, at the end.
 */
export function visibleGroups(tree: MenuTreeDto, categoryOrder: readonly string[] = []): MenuGroup[] {
  const groups = tree.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({ category, items: category.items.filter(isVisible) }))
    .filter((group) => group.items.length > 0);

  return applyCategoryOrder(groups, (group) => group.category.id, categoryOrder);
}
