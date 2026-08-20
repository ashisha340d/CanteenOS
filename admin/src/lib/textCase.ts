/**
 * "black cardamom" -> "Black Cardamom".
 *
 * Mirrors `backend/src/utils/textCase.ts` exactly, so a name looks the same the moment it is
 * typed as it will once the server has normalised and stored it — capitalises the first letter
 * of each word and lower-cases the rest, but leaves a word alone if it contains a digit or is
 * already all upper-case and longer than one letter, so "GST" or "5kg" survive untouched.
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
