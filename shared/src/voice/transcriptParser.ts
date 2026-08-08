import { matchMenuItem, type MenuCandidate, type MenuMatch } from './menuNormalizer';
import { digitizeNumberWords } from './numbers';
import { normalizeLoose } from './text';

/**
 * Turns a spoken order into a draft the user can review.
 *
 * The strategy is subtractive. Date, time, pax and notes each occupy a recognisable phrase;
 * every phrase found is *removed* from the sentence, and whatever survives is the menu. This
 * beats trying to match items positionally, because Hindi and English put the same clauses
 * in different places — "kal 1 baje 45 pax ke liye" and "45 pax tomorrow at 1" have to
 * reduce to the same residue.
 *
 * Nothing here decides anything final. Every field comes back with what it was derived from
 * so the UI can highlight it, and an unparsed remainder is surfaced rather than discarded.
 */

export interface ParsedOrderItem {
  /** The name exactly as spoken, kept so the user can see what was heard. */
  spokenName: string;
  quantity: number | null;
  /** Resolved against the catalogue, or null when nothing was confident enough. */
  match: MenuMatch<MenuCandidate> | null;
}

export interface ParsedOrderTranscript {
  eventName: string | null;
  /** ISO date, resolved against `now`. */
  requiredDate: string | null;
  /** 24-hour HH:MM. */
  requiredTime: string | null;
  pax: number | null;
  items: ParsedOrderItem[];
  notes: string | null;
  /** Text that matched nothing. Shown to the user rather than dropped. */
  unparsed: string;
  /** Which fields the parser filled, so the UI can tint exactly those. */
  filledFields: readonly (keyof ParsedOrderTranscript)[];
}

export interface ParseOptions {
  catalogue?: readonly MenuCandidate[];
  /** Reference point for "today"/"kal". Injected so the parser stays deterministic in tests. */
  now?: Date;
}

/* ------------------------------------------------------------------ helpers */

function isoDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

const WEEKDAYS: Readonly<Record<string, number>> = {
  sunday: 0, ravivar: 0, monday: 1, somvar: 1, tuesday: 2, mangalvar: 2,
  wednesday: 3, budhvar: 3, thursday: 4, guruvar: 4, brihaspativar: 4,
  friday: 5, shukravar: 5, saturday: 6, shanivar: 6,
};

/** Removes a matched span and records it, so later passes never see it again. */
interface Consumer {
  text: string;
}

function consume(state: Consumer, pattern: RegExp): RegExpMatchArray | null {
  const match = state.text.match(pattern);
  if (match === null || match.index === undefined) return null;
  state.text = `${state.text.slice(0, match.index)} ${state.text.slice(match.index + match[0].length)}`;
  return match;
}

/* --------------------------------------------------------------- extractors */

function extractDate(state: Consumer, now: Date): string | null {
  // Relative days first — they are unambiguous and the most common in speech.
  // "parso" is both "day after tomorrow" and "day before yesterday"; an order is always
  // ahead, so the forward reading is the only sensible one.
  const relative: readonly (readonly [RegExp, number])[] = [
    [/\b(aaj|आज|today)\b/i, 0],
    [/\b(kal|कल|tomorrow)\b/i, 1],
    [/\b(parso|parson|परसों|day after tomorrow)\b/i, 2],
  ];
  for (const [pattern, offset] of relative) {
    if (consume(state, pattern) !== null) return isoDate(addDays(now, offset));
  }

  // Explicit calendar date: 2026-08-12, 12/08/2026, 12-8-26.
  const numeric = consume(state, /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (numeric !== null) {
    const [, year, month, day] = numeric;
    return isoDate(new Date(Number(year), Number(month) - 1, Number(day)));
  }
  // Day-first, matching Indian convention.
  const slashed = consume(state, /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slashed !== null) {
    const [, day, month, year] = slashed;
    const resolvedYear =
      year === undefined
        ? now.getFullYear()
        : Number(year) < 100
          ? 2000 + Number(year)
          : Number(year);
    return isoDate(new Date(resolvedYear, Number(month) - 1, Number(day)));
  }

  // "12 August", "August 12", "12 tarikh".
  const monthNames = Object.keys(MONTHS).join('|');
  const dayMonth = consume(
    state,
    new RegExp(`\\b(\\d{1,2})\\s*(?:st|nd|rd|th|tarikh|तारीख)?\\s+(${monthNames})\\b`, 'i'),
  );
  if (dayMonth !== null) {
    const [, day, month] = dayMonth;
    return isoDate(
      new Date(now.getFullYear(), MONTHS[(month as string).toLowerCase()] as number, Number(day)),
    );
  }
  const monthDay = consume(state, new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})\\b`, 'i'));
  if (monthDay !== null) {
    const [, month, day] = monthDay;
    return isoDate(
      new Date(now.getFullYear(), MONTHS[(month as string).toLowerCase()] as number, Number(day)),
    );
  }

  // A weekday name always means the next one — an order is never for the past.
  const weekdayNames = Object.keys(WEEKDAYS).join('|');
  const weekday = consume(state, new RegExp(`\\b(${weekdayNames})\\b`, 'i'));
  if (weekday !== null) {
    const target = WEEKDAYS[(weekday[1] as string).toLowerCase()] as number;
    const delta = (target - now.getDay() + 7) % 7 || 7;
    return isoDate(addDays(now, delta));
  }

  return null;
}

/**
 * Resolves a bare hour against the part of day that was said, then against kitchen reality.
 *
 * "1 baje" with no qualifier is one in the afternoon — nobody caters at 01:00 — so hours
 * 1 through 10 are read as PM by default. 11 and 12 are left alone, since "11 baje" and
 * "12 baje" overwhelmingly mean late morning and noon.
 */
const MORNING_MARKERS = new Set(['am', 'a.m.', 'subah', 'savere', 'सुबह', 'morning']);
const EVENING_MARKERS = new Set([
  'pm', 'p.m.', 'shaam', 'sham', 'raat', 'rat', 'evening', 'night', 'शाम', 'रात',
  'dopahar', 'afternoon', 'noon', 'दोपहर',
]);

function resolveHour(hour: number, meridiem: string | null): number {
  // Matched as whole tokens, never as substrings: "shaam" contains "am", and reading an
  // evening order as breakfast is exactly the kind of silent error this feature cannot afford.
  const marker = meridiem?.toLowerCase().trim() ?? '';

  if (MORNING_MARKERS.has(marker)) return hour === 12 ? 0 : hour;
  if (EVENING_MARKERS.has(marker)) return hour >= 12 ? hour : hour + 12;
  if (hour >= 1 && hour <= 10) return hour + 12;
  return hour;
}

function extractTime(state: Consumer): string | null {
  // Explicit clock time, with or without a meridiem.
  const clock = consume(
    state,
    /\b(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.|baje|बजे|subah|shaam|sham|raat|evening|morning|night|afternoon|dopahar)?\b/i,
  );
  if (clock !== null) {
    const [, rawHour, minutes, meridiem] = clock;
    const hour = resolveHour(Number(rawHour), meridiem ?? null);
    return `${`${hour}`.padStart(2, '0')}:${minutes}`;
  }

  // Bare hour with an explicit time marker — "1 baje", "7 pm", "shaam 6 baje".
  const bare = consume(
    state,
    /\b(?:(subah|savere|shaam|sham|raat|dopahar|morning|evening|night|afternoon)\s+)?(\d{1,2})\s*(baje|बजे|am|pm|a\.m\.|p\.m\.|o'?clock)\b/i,
  );
  if (bare !== null) {
    const [, prefix, rawHour, suffix] = bare;
    // A leading part-of-day wins over the trailing marker: in "shaam 6 baje", "baje" is
    // just "o'clock" and carries no meridiem of its own.
    const meridiem = prefix ?? suffix ?? null;
    const hour = resolveHour(Number(rawHour), meridiem);
    return `${`${hour}`.padStart(2, '0')}:00`;
  }

  return null;
}

function extractPax(state: Consumer): number | null {
  // A count with an explicit "people" word on either side. Requiring the word is what keeps
  // item quantities from being mistaken for the guest count.
  const patterns: readonly RegExp[] = [
    /\b(\d{1,6})\s*(?:pax|pex|packs?|guests?|people|persons?|log|logo|logon|aadmi|admi|mehmaan|mehman|vyakti|लोग|मेहमान)\b/i,
    /\b(?:pax|guests?|people|persons?|log|logon|mehmaan|मेहमान)\s*(?:[-:=]|hai|hain|is|are|for)?\s*(\d{1,6})\b/i,
    /\bfor\s+(\d{1,6})\s*(?:pax|guests?|people|persons?)\b/i,
  ];
  for (const pattern of patterns) {
    const match = consume(state, pattern);
    if (match !== null) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

function extractNotes(state: Consumer): string | null {
  // Longest alternatives first, so "special instructions" is consumed whole rather than
  // leaving "instructions" behind in the captured note.
  const match = consume(
    state,
    /\b(?:special instructions?|special note|instructions?|dhyaan? rakhna|yaad rakhna|note ki|notes?|nota)\b\s*[:\-]?\s*(.+)$/i,
  );
  if (match === null) return null;
  const note = (match[1] ?? '').trim().replace(/[.,;]+$/, '');
  return note === '' ? null : note;
}

/**
 * Splits the residue into item phrases.
 *
 * Conjunctions and commas are the only reliable separators in both languages. "ke liye"
 * ("for") is also a boundary, because it introduces the menu after a pax or event clause.
 */
function splitItemPhrases(residue: string): string[] {
  return residue
    .split(/\s*(?:,|;|\band\b|\baur\b|\bor\b|\+|\n|और|\bke li[ye]e?\b|\bkelie\b|\bfor\b)\s*/i)
    // Sentence-final punctuation would otherwise ride along on the last phrase and hide the
    // quantity in "Tandoori Roti 90." — but only trailing, so "1.5 kg" survives intact.
    .map((phrase) => phrase.trim().replace(/[.!?।]+$/, '').trim())
    .filter((phrase) => phrase.length > 0);
}

/** Pulls a quantity off either end of an item phrase — "paneer tikka 45" or "45 roti". */
function splitQuantity(phrase: string): { name: string; quantity: number | null } {
  const trailing = phrase.match(
    /^(.*?)\s*[-:x×]?\s*(\d+(?:\.\d+)?)\s*(?:plates?|pcs?|pieces?|nos?|kg|gm|grams?|ltr|litres?|liters?|ml|cups?|thali|thaal|प्लेट)?\s*$/i,
  );
  if (trailing !== null && (trailing[1] ?? '').trim() !== '') {
    return { name: (trailing[1] as string).trim(), quantity: Number(trailing[2]) };
  }

  const leading = phrase.match(
    /^\s*(\d+(?:\.\d+)?)\s*(?:plates?|pcs?|pieces?|nos?|kg|gm|grams?|ltr|litres?|liters?|ml|cups?|thali|thaal|प्लेट)?\s+(.*)$/i,
  );
  if (leading !== null && (leading[2] ?? '').trim() !== '') {
    return { name: (leading[2] as string).trim(), quantity: Number(leading[1]) };
  }

  return { name: phrase.trim(), quantity: null };
}

/** Filler that survives subtraction and would otherwise look like a dish. */
const RESIDUE_NOISE =
  /^(?:aur|and|ke|ki|ka|liye|lie|for|please|plz|order|orders|karo|kar do|chahiye|chahie|banao|bana do|de do|dena|hai|hain|is|are|the|a|an|of|with|me|mein|par|pe|at|on|to)$/i;

function isNoise(phrase: string): boolean {
  const words = normalizeLoose(phrase).split(' ').filter((word) => word !== '');
  return words.length === 0 || words.every((word) => RESIDUE_NOISE.test(word));
}

/* -------------------------------------------------------------------- parse */

export function parseOrderTranscript(
  transcript: string,
  options: ParseOptions = {},
): ParsedOrderTranscript {
  const catalogue = options.catalogue ?? [];
  const now = options.now ?? new Date();

  // Spelled-out numbers become digits first, so every extractor below only has to deal with
  // one representation of a count.
  const state: Consumer = { text: digitizeNumberWords(transcript).replace(/\s+/g, ' ').trim() };

  // Notes first: the clause runs to the end of the sentence, so leaving it in would let its
  // contents be mistaken for menu items.
  const notes = extractNotes(state);
  const requiredDate = extractDate(state, now);
  const requiredTime = extractTime(state);
  const pax = extractPax(state);

  const residue = state.text.replace(/\s+/g, ' ').trim();

  const items: ParsedOrderItem[] = [];
  const leftovers: string[] = [];

  for (const phrase of splitItemPhrases(residue)) {
    if (isNoise(phrase)) continue;

    const { name, quantity } = splitQuantity(phrase);
    if (name === '' || isNoise(name)) continue;

    const match = matchMenuItem(name, catalogue);

    // A phrase with no quantity and no catalogue match is not a dish — it is almost always
    // the event name ("morning picnic"). Held back rather than forced into the item list.
    if (match === null && quantity === null) {
      leftovers.push(name);
      continue;
    }

    items.push({ spokenName: name, quantity, match });
  }

  // The longest leftover reads as the event name; anything else is genuinely unparsed.
  let eventName: string | null = null;
  let unparsed = '';
  if (leftovers.length > 0) {
    const sorted = [...leftovers].sort((a, b) => b.length - a.length);
    eventName = titleCase(sorted[0] as string);
    unparsed = sorted.slice(1).join(' ').trim();
  }

  const filledFields: (keyof ParsedOrderTranscript)[] = [];
  if (eventName !== null) filledFields.push('eventName');
  if (requiredDate !== null) filledFields.push('requiredDate');
  if (requiredTime !== null) filledFields.push('requiredTime');
  if (pax !== null) filledFields.push('pax');
  if (items.length > 0) filledFields.push('items');
  if (notes !== null) filledFields.push('notes');

  return { eventName, requiredDate, requiredTime, pax, items, notes, unparsed, filledFields };
}

function titleCase(value: string): string {
  return value
    .split(' ')
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
