import { foldForMatch, normalizeLoose, similarity } from './text';

/**
 * Resolves a spoken dish name to a real menu item.
 *
 * The catalogue is the authority: whatever Whisper heard, the order must end up pointing at
 * a `menu_items` row. Matching runs in widening circles — exact, folded-exact, token
 * containment, then fuzzy — and stops at the first circle that produces a single confident
 * answer. Anything below the threshold is returned unmatched rather than guessed, because a
 * silently wrong dish is far more damaging than a line the user has to pick themselves.
 */

export interface MenuCandidate {
  id: string;
  name: string;
  unit?: string;
}

export interface MenuMatch<T extends MenuCandidate = MenuCandidate> {
  item: T;
  /** 0–1. 1 is an exact match on the folded form. */
  score: number;
  /** How the match was reached, for debugging and for the UI's confidence hint. */
  strategy: 'exact' | 'folded' | 'contains' | 'fuzzy';
}

/**
 * Below this, a fuzzy match is not trustworthy enough to fill in for the user. Chosen so
 * that one or two letters of drift in a short dish name still lands ("makni" → "makhani")
 * while genuinely different dishes do not collide ("dal" vs "dahi").
 */
export const MATCH_THRESHOLD = 0.72;

/** Words that carry no identifying weight and would otherwise inflate a token overlap. */
const STOP_WORDS = new Set([
  'aur', 'and', 'ke', 'ki', 'ka', 'liye', 'plate', 'plates', 'pcs', 'piece', 'pieces',
  'nos', 'no', 'kg', 'gm', 'gram', 'litre', 'liter', 'ltr', 'ml', 'cup', 'cups',
  'the', 'a', 'of', 'with',
]);

function contentTokens(value: string): string[] {
  return foldForMatch(value)
    .split(' ')
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

/**
 * Best match for a spoken name, or null when nothing clears {@link MATCH_THRESHOLD}.
 *
 * @param spoken    the name as transcribed
 * @param catalogue every menu item the board can order
 */
export function matchMenuItem<T extends MenuCandidate>(
  spoken: string,
  catalogue: readonly T[],
): MenuMatch<T> | null {
  const query = normalizeLoose(spoken);
  if (query === '' || catalogue.length === 0) return null;

  const folded = foldForMatch(spoken);
  if (folded === '') return null;

  let best: MenuMatch<T> | null = null;
  const consider = (candidate: MenuMatch<T>): void => {
    if (best === null || candidate.score > best.score) best = candidate;
  };

  for (const item of catalogue) {
    const itemLoose = normalizeLoose(item.name);
    const itemFolded = foldForMatch(item.name);

    if (itemLoose === query) return { item, score: 1, strategy: 'exact' };
    if (itemFolded === folded) {
      consider({ item, score: 1, strategy: 'folded' });
      continue;
    }

    // "paneer tikka masala" spoken as "tikka masala" — every content word of one side is
    // present in the other. Scored by how much of the longer name was actually said, so a
    // one-word fragment of a four-word dish stays weak.
    const queryTokens = contentTokens(spoken);
    const itemTokens = contentTokens(item.name);
    if (queryTokens.length > 0 && itemTokens.length > 0) {
      const itemSet = new Set(itemTokens);
      const overlap = queryTokens.filter((token) => itemSet.has(token)).length;
      if (overlap > 0 && (overlap === queryTokens.length || overlap === itemTokens.length)) {
        const coverage = overlap / Math.max(queryTokens.length, itemTokens.length);
        // Capped below 1 so a genuine folded match always outranks a containment.
        consider({ item, score: Math.min(0.95, 0.6 + coverage * 0.35), strategy: 'contains' });
      }
    }

    const score = similarity(folded, itemFolded);
    if (score >= MATCH_THRESHOLD) consider({ item, score, strategy: 'fuzzy' });
  }

  if (best === null) return null;
  return (best as MenuMatch<T>).score >= MATCH_THRESHOLD ? best : null;
}

/**
 * Convenience wrapper for display: the catalogue's spelling of a spoken name, or the spoken
 * name unchanged when nothing matched.
 */
export function normalizeMenuName(
  spoken: string,
  catalogue: readonly MenuCandidate[],
): string {
  return matchMenuItem(spoken, catalogue)?.item.name ?? spoken.trim();
}
