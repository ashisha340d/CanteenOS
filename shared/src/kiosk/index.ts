/**
 * Reading a menu category the way a guest does.
 *
 * A category in the Menu Master is a name and a sort order; it carries no "this is a beverage"
 * flag and no icon, and inventing columns for either would put a second catalogue in the
 * database that somebody has to remember to keep true. So the kiosk's category rail derives its
 * glyph from the name a canteen already typed, using the same principle the drink prompt in
 * `CustomerKiosk/src/lib/nudge.ts` uses: match on the words a hall actually writes.
 *
 * The result is a *glyph name*, not an icon. Both the kiosk and the Admin Portal draw their own
 * component from it, so the two surfaces agree on what a category is without this module
 * needing to know that either of them uses React.
 */

export const KioskGlyph = {
  /** Everything, and the default state of the rail. */
  ALL: 'ALL',
  DRINK: 'DRINK',
  SWEET: 'SWEET',
  RICE: 'RICE',
  BREAD: 'BREAD',
  SOUP: 'SOUP',
  SNACK: 'SNACK',
  THALI: 'THALI',
  FRUIT: 'FRUIT',
  /** Nothing matched; the rail falls back to a neutral mark rather than guessing. */
  DISH: 'DISH',
} as const;
export type KioskGlyph = (typeof KioskGlyph)[keyof typeof KioskGlyph];

/**
 * Word lists, in the order they are tested. Order matters where a name could match twice —
 * "sweet lassi" is a drink, so DRINK is tested before SWEET, and a "thali" is a thali even
 * though it contains rice.
 */
const GLYPH_WORDS: { glyph: KioskGlyph; words: readonly string[] }[] = [
  {
    glyph: KioskGlyph.THALI,
    words: ['thali', 'combo', 'platter', 'meal', 'prasad', 'bhog', 'थाली', 'प्रसाद', 'भोग'],
  },
  {
    glyph: KioskGlyph.DRINK,
    words: [
      'drink',
      'beverage',
      'juice',
      'tea',
      'chai',
      'coffee',
      'lassi',
      'shake',
      'sharbat',
      'chaas',
      'water',
      'milk',
      'पेय',
      'चाय',
      'कॉफी',
      'जूस',
      'लस्सी',
      'दूध',
    ],
  },
  {
    glyph: KioskGlyph.SWEET,
    words: [
      'sweet',
      'dessert',
      'pastry',
      'bakery',
      'cake',
      'mithai',
      'halwa',
      'ice cream',
      'kheer',
      'laddu',
      'barfi',
      'मिठाई',
      'मिष्ठान',
      'हलवा',
      'पेस्ट्री',
      'खीर',
    ],
  },
  {
    glyph: KioskGlyph.BREAD,
    words: ['roti', 'bread', 'naan', 'paratha', 'puri', 'chapati', 'kulcha', 'रोटी', 'पूरी', 'पराठा'],
  },
  {
    glyph: KioskGlyph.RICE,
    words: ['rice', 'biryani', 'pulao', 'khichdi', 'fried rice', 'चावल', 'बिरयानी', 'पुलाव', 'खिचड़ी'],
  },
  {
    glyph: KioskGlyph.SOUP,
    words: ['soup', 'dal', 'daal', 'curry', 'sabzi', 'gravy', 'kadhi', 'दाल', 'सब्ज़ी', 'सब्जी', 'कढ़ी'],
  },
  {
    glyph: KioskGlyph.FRUIT,
    words: ['fruit', 'salad', 'raita', 'फल', 'सलाद', 'रायता'],
  },
  {
    glyph: KioskGlyph.SNACK,
    words: [
      'snack',
      'chaat',
      'starter',
      'samosa',
      'pakora',
      'tikki',
      'roll',
      'sandwich',
      'नाश्ता',
      'चाट',
      'समोसा',
      'पकौड़ा',
    ],
  },
];

/**
 * Anchored at a word start rather than anywhere in the string.
 *
 * A plain substring test reads "Steamed Snacks" as a drinks category, because "tea" sits inside
 * "steam". Devanagari is matched as a substring because JavaScript's word boundary is ASCII-only
 * and those words are distinctive enough not to need one.
 */
function matchesWord(haystack: string, word: string): boolean {
  if (!/^[\x20-\x7e]+$/.test(word)) return haystack.includes(word);
  return new RegExp(`(^|[^a-z])${word}`, 'i').test(haystack);
}

export function glyphForCategory(name: string, nameHi?: string | null): KioskGlyph {
  const haystack = `${name} ${nameHi ?? ''}`.toLowerCase();
  for (const entry of GLYPH_WORDS) {
    if (entry.words.some((word) => matchesWord(haystack, word))) return entry.glyph;
  }
  return KioskGlyph.DISH;
}

/**
 * Applies a stand's own category order to whatever the menu currently holds.
 *
 * The two failure modes this exists to prevent are the obvious ones and both are silent: a
 * category the operator dragged and the Menu Master has since dropped must not leave a hole,
 * and a category added since the operator last sorted must not vanish. So the preference is a
 * filter over reality rather than a replacement for it — listed ids first, in the operator's
 * order, then everything else in the menu's own.
 */
export function applyCategoryOrder<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  preferred: readonly string[],
): T[] {
  if (preferred.length === 0) return [...items];
  const rank = new Map(preferred.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const left = rank.get(idOf(a));
    const right = rank.get(idOf(b));
    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return left - right;
  });
}
