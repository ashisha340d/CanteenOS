/**
 * "black cardamom" -> "Black Cardamom".
 *
 * Splits on whitespace and capitalises the first letter of each word, lower-casing the rest —
 * but leaves a word untouched if it contains a digit or is already all upper-case and longer
 * than one letter, so "GST", "5kg" and "pH" pass through rather than getting mangled into
 * "Gst", "5Kg" or "Ph". Collapses incidental double spaces along the way.
 */
export function toProperCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => {
      if (word.length === 0) return word;
      if (/[0-9]/.test(word)) return word;
      if (word.length > 1 && word === word.toUpperCase()) return word;
      return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}
