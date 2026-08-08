/**
 * Text folding for Indian-language transliteration.
 *
 * Whisper transcribes Hinglish the way it sounds, and the same dish comes back spelled a
 * dozen ways — "paneer tikka", "panir tika", "paner tikkaa". Comparing raw strings against
 * the menu catalogue would miss almost all of them, so both sides are folded to a coarse
 * phonetic skeleton first and only then compared.
 *
 * The folding is deliberately lossy. It exists to make near-spellings collide, not to
 * preserve meaning, and nothing user-visible is ever derived from a folded string.
 */

/** Devanagari digits, so "४५" and "45" mean the same thing downstream. */
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

export function asciifyDigits(input: string): string {
  return input.replace(/[०-९]/g, (digit) => String(DEVANAGARI_DIGITS.indexOf(digit)));
}

/**
 * Aspirated consonants and long vowels carry no distinguishing weight once a name has been
 * through speech recognition — "makhani" and "makani" are the same dish. Order matters:
 * digraphs must be reduced before doubled letters collapse.
 */
const DIGRAPHS: readonly (readonly [RegExp, string])[] = [
  [/ph/g, 'f'],
  [/kh/g, 'k'],
  [/gh/g, 'g'],
  [/th/g, 't'],
  [/dh/g, 'd'],
  [/bh/g, 'b'],
  [/ch/g, 'c'],
  [/sh/g, 's'],
  [/aa/g, 'a'],
  [/ee/g, 'i'],
  [/ii/g, 'i'],
  [/oo/g, 'u'],
  [/uu/g, 'u'],
];

/** Lowercased, punctuation-free, single-spaced. The mildest normalisation. */
export function normalizeLoose(input: string): string {
  return asciifyDigits(input)
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks so "à" folds to "a"; Devanagari is left alone by design,
    // because Whisper emits it as script rather than transliteration.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The phonetic skeleton used for matching. Never shown to a user. */
export function foldForMatch(input: string): string {
  let value = normalizeLoose(input);
  for (const [pattern, replacement] of DIGRAPHS) {
    value = value.replace(pattern, replacement);
  }
  // Collapse any doubled letter left over: "tikka" → "tika".
  value = value.replace(/(\p{L})\1+/gu, '$1');
  return value.replace(/\s+/g, ' ').trim();
}

/** Levenshtein edit distance, iterative with a single row of state. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] as number) + 1;
      const deletion = (previous[j] as number) + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length] as number;
}

/** 1 for identical, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}
