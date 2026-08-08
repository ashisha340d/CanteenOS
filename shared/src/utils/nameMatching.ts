/**
 * Name matching for master-data lookups (ingredients, etc.) where the same real-world thing
 * can arrive spelled slightly differently — "Green Cardamon", "GreenCardamon" and "Green
 * Cardamom" should not become three separate Ingredient Master records.
 */

/**
 * Case/space/punctuation-insensitive comparison key. "Green Cardamom", "green-cardamom" and
 * "GreenCardamon" all normalize to the same key, without touching the stored display name —
 * this is safe to auto-match on, since it is still exactly the same sequence of letters.
 */
export function normalizeNameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Levenshtein edit distance between two strings. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow.push(
        Math.min(
          (currentRow[j - 1] as number) + 1, // insertion
          (previousRow[j] as number) + 1, // deletion
          (previousRow[j - 1] as number) + cost, // substitution
        ),
      );
    }
    previousRow = currentRow;
  }
  return previousRow[b.length] as number;
}

/**
 * True when two names are close enough to be the *same* thing mistyped ("Cardamon" vs
 * "Cardamom"), not merely formatted differently (that is `normalizeNameKey` equality,
 * checked first) and not two genuinely different names. Deliberately conservative — short
 * names never fuzzy-match (a single-letter difference in a 4-letter word, e.g. "Salt" vs
 * "Malt", is very often a different word, not a typo), and the allowed edit distance grows
 * only slowly with length.
 */
export function isLikelyTypoOf(a: string, b: string): boolean {
  const x = normalizeNameKey(a);
  const y = normalizeNameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const maxLen = Math.max(x.length, y.length);
  if (maxLen < 6) return false;
  const distance = levenshteinDistance(x, y);
  return distance <= (maxLen <= 8 ? 1 : 2);
}
