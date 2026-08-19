import {
  KioskRecommendationMode,
  type MenuTreeDto,
  type ResolvedMenuCategoryDto,
} from '@menuboard/shared';
import type { CartLine } from '../state/cart';
import { isSoldOut, isVisible } from './menu';

/**
 * The forgotten-drink prompt.
 *
 * Which categories count as drinks or sweets is decided from the category's own name, because
 * categories are ordinary data rows (MENUBOARD_SPEC.md §3a) — there is no "is a beverage" flag
 * to read, and inventing one in kiosk code would put a second, contradictory catalogue in the
 * tablet. Matching on the words a canteen actually uses keeps the rule where the data is.
 */
const DRINK_WORDS = [
  'drink',
  'beverage',
  'juice',
  'tea',
  'coffee',
  'lassi',
  'shake',
  'sharbat',
  'chaas',
  'water',
  'पेय',
  'चाय',
  'कॉफी',
  'जूस',
  'लस्सी',
];

const SWEET_WORDS = [
  'sweet',
  'dessert',
  'pastry',
  'bakery',
  'cake',
  'mithai',
  'halwa',
  'ice cream',
  'kheer',
  'मिठाई',
  'मिष्ठान',
  'हलवा',
  'पेस्ट्री',
];

export type NudgeKind = 'drinks' | 'sweets';

/**
 * Anchored at a word start rather than anywhere in the string.
 *
 * A plain substring test reads "Steamed Snacks" as a drinks category, because "tea" sits
 * inside "steam" — and a guest who has just ordered momos is then asked whether they would
 * like a drink, with momos offered as the suggestion. Anchoring keeps the useful half of the
 * loose match ("drink" still catches "Drinks", "Cold Drinks", "Drinks & Shakes") without the
 * accidental half. Devanagari is matched as a substring because JavaScript's word boundary is
 * ASCII-only and those words are distinctive enough not to need one.
 */
function matchesWord(haystack: string, word: string): boolean {
  if (!/^[\x20-\x7e]+$/.test(word)) return haystack.includes(word);
  return new RegExp(`(^|[^a-z])${word}`, 'i').test(haystack);
}

function matches(category: ResolvedMenuCategoryDto, words: readonly string[]): boolean {
  const haystack = `${category.name} ${category.nameHi ?? ''}`.toLowerCase();
  return words.some((word) => matchesWord(haystack, word));
}

export function categoriesFor(tree: MenuTreeDto, kind: NudgeKind): ResolvedMenuCategoryDto[] {
  const words = kind === 'drinks' ? DRINK_WORDS : SWEET_WORDS;
  return tree.categories.filter((category) => matches(category, words));
}

/** Which kinds the operator has allowed. `OFF` is the empty set, and short-circuits. */
function allowed(mode: KioskRecommendationMode): NudgeKind[] {
  if (mode === KioskRecommendationMode.DRINKS) return ['drinks'];
  if (mode === KioskRecommendationMode.SWEETS) return ['sweets'];
  if (mode === KioskRecommendationMode.BOTH) return ['drinks', 'sweets'];
  return [];
}

/**
 * The first prompt worth showing, or null. Only one is ever shown — a guest who has already
 * declined a drink will not thank the kiosk for asking about a sweet on the next tap.
 *
 * Whether the kiosk may ask at all is the operator's decision, not this module's: a hall
 * serving free prasad turns it off, and one running a paid canteen with a drinks counter
 * leaves it on. `mode` comes from `kiosk.recommendations` in the Admin Portal.
 */
export function pendingNudge(
  tree: MenuTreeDto,
  lines: CartLine[],
  declined: NudgeKind[],
  mode: KioskRecommendationMode,
): NudgeKind | null {
  if (lines.length === 0) return null;

  for (const kind of allowed(mode)) {
    if (declined.includes(kind)) continue;
    const categories = categoriesFor(tree, kind);
    // Nothing sellable left in the category is the same as not having one: asking a guest
    // about drinks and then showing an empty sheet would strand them before payment.
    const hasSuggestion = categories.some((category) =>
      category.items.some((item) => isVisible(item) && !isSoldOut(item)),
    );
    if (!hasSuggestion) continue;
    const categoryKeys = new Set(categories.map((category) => category.id));
    const alreadyChosen = lines.some((line) => categoryKeys.has(line.categoryKey));
    if (!alreadyChosen) return kind;
  }
  return null;
}
