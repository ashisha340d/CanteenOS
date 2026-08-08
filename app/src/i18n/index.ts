import type { MenuCategoryDto, MenuItemDto, OrderItemDto } from '@menuboard/shared';

/**
 * Interface language.
 *
 * Two different problems live here, and only one of them is translation:
 *
 *   * **Static labels** — "Date", "Guests", "Menu". A fixed vocabulary, so they are simply
 *     listed below in both languages. No engine, no network, no drift.
 *   * **Catalogue names** — "Dal Makhani". These are *not* translated at runtime. Each dish
 *     has one Devanagari spelling the kitchen already uses, stored on the row as `nameHi`.
 *     A translation engine would invent a different one on each call and disagree with what
 *     is written on the counter. `menuItemName` below reads the stored value and falls back
 *     to English when it has not been authored yet.
 */

export type Language = 'en' | 'hi';

export const STRINGS = {
  en: {
    date: 'Date',
    day: 'Day',
    time: 'Time',
    event: 'Event',
    venue: 'Venue',
    pax: 'Guests',
    menu: 'Menu',
    item: 'Item',
    quantity: 'Quantity',
    menuRequirements: 'Menu Requirements',
    note: 'Note',
    customerNote: 'Customer note',
    viewRecipe: 'View Recipe',
    shoppingList: 'Shopping List',
    acknowledge: 'Acknowledge',
    acknowledged: 'Acknowledged',
    thread: 'Thread',
    reply: 'Reply',
    today: 'Today',
    yesterday: 'Yesterday',
    tomorrow: 'Tomorrow',
    newOrder: 'New Order',
    newMessage: 'New Message',
    typeMessage: 'Type a message…',
    send: 'Send',
    recording: 'Recording',
    noOrders: 'No orders yet',
    newOrderPlaced: 'New order placed',
    ingredients: 'Ingredients',
    forPax: 'for {n} guests',
    method: 'Method',
    steps: 'Steps',
    boards: 'Boards',
    orders: 'Orders',
    users: 'Users',
    archive: 'Archive',
    settings: 'Settings',
  },
  hi: {
    date: 'दिनांक',
    day: 'दिन',
    time: 'समय',
    event: 'कार्यक्रम',
    venue: 'स्थान',
    pax: 'मेहमान',
    menu: 'मेन्यू',
    item: 'आइटम',
    quantity: 'मात्रा',
    menuRequirements: 'मेन्यू आवश्यकताएँ',
    note: 'नोट',
    customerNote: 'कस्टमर नोट',
    viewRecipe: 'रेसिपी देखें',
    shoppingList: 'खरीद सूची',
    acknowledge: 'स्वीकार करें',
    acknowledged: 'स्वीकृत',
    thread: 'चर्चा',
    reply: 'उत्तर',
    today: 'आज',
    yesterday: 'कल',
    tomorrow: 'कल',
    newOrder: 'नया ऑर्डर',
    newMessage: 'नया संदेश',
    typeMessage: 'संदेश लिखें…',
    send: 'भेजें',
    recording: 'रिकॉर्डिंग',
    noOrders: 'अभी कोई ऑर्डर नहीं',
    newOrderPlaced: 'नया ऑर्डर',
    ingredients: 'सामग्री',
    forPax: '{n} मेहमानों के लिए',
    method: 'विधि',
    steps: 'चरण',
    boards: 'बोर्ड',
    orders: 'ऑर्डर',
    users: 'उपयोगकर्ता',
    archive: 'संग्रह',
    settings: 'सेटिंग्स',
  },
} as const;

export type StringKey = keyof (typeof STRINGS)['en'];

/** Looks up a static label. Falls back to English when a Hindi string is missing. */
export function t(key: StringKey, language: Language = 'en'): string {
  return STRINGS[language][key] ?? STRINGS.en[key];
}

/** `t` with `{n}` substituted. */
export function tCount(key: StringKey, count: number, language: Language = 'en'): string {
  return t(key, language).replace('{n}', String(count));
}

/**
 * The catalogue's own spelling of a dish, in the requested language.
 *
 * Reads the stored `nameHi`; never translates. An untranslated row shows its English name
 * rather than a blank, so the board stays usable while the catalogue is being filled in.
 */
export function menuItemName(
  item: Pick<MenuItemDto, 'name' | 'nameHi'> | undefined,
  language: Language = 'en',
): string {
  if (item === undefined) return '';
  return language === 'hi' ? (item.nameHi ?? item.name) : item.name;
}

export function menuItemUnit(
  item: Pick<MenuItemDto, 'unit' | 'unitHi'> | undefined,
  language: Language = 'en',
): string {
  if (item === undefined) return '';
  return language === 'hi' ? (item.unitHi ?? item.unit) : item.unit;
}

/**
 * What to print for an order line, whichever way it names its dish.
 *
 * A catalogued line resolves through the master cache so it picks up the Hindi spelling; an
 * ad-hoc line was typed by hand on one board and has no catalogue entry, so it is shown
 * verbatim in whatever language it was written.
 */
export function orderLineName(
  item: Pick<OrderItemDto, 'menuItemId' | 'customItemName' | 'menuItemName'>,
  menuItems: ReadonlyMap<string, MenuItemDto>,
  language: Language = 'en',
  fallback = '—',
): string {
  if (item.customItemName !== null) return item.customItemName;
  const master = item.menuItemId === null ? undefined : menuItems.get(item.menuItemId);
  return menuItemName(master, language) || item.menuItemName || fallback;
}

/** The unit to print for an order line; an ad-hoc line carries its own. */
export function orderLineUnit(
  item: Pick<OrderItemDto, 'menuItemId' | 'unit'>,
  menuItems: ReadonlyMap<string, MenuItemDto>,
  language: Language = 'en',
): string {
  const master = item.menuItemId === null ? undefined : menuItems.get(item.menuItemId);
  return menuItemUnit(master, language) || item.unit;
}

export function menuCategoryName(
  category: Pick<MenuCategoryDto, 'name' | 'nameHi'> | undefined,
  language: Language = 'en',
): string {
  if (category === undefined) return '';
  return language === 'hi' ? (category.nameHi ?? category.name) : category.name;
}

/** Weekday names, for the order card's "12/1/2026, Tuesday" line. */
const WEEKDAYS: Readonly<Record<Language, readonly string[]>> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  hi: ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'],
};

export function weekdayName(isoDate: string, language: Language = 'en'): string {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return WEEKDAYS[language][parsed.getDay()] ?? '';
}
