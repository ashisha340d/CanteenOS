import { asciifyDigits } from './text';

/**
 * Spoken-number handling for Hindi, English and the Hinglish mixture in between.
 *
 * Whisper writes what it hears, so a count arrives as "45", "४५", "forty five" or
 * "paintalis" depending on how the speaker said it and which script the model settled on.
 * Everything downstream wants an integer, so the conversion happens once, here.
 */

const ENGLISH_UNITS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const ENGLISH_TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/**
 * Hindi numerals are irregular all the way to a hundred — there is no "twenty + five"
 * structure to exploit, so 1–100 is simply enumerated. Common romanisations are folded in
 * as alternates rather than left to fuzzy matching, because a wrong quantity is worse than
 * an unrecognised one.
 */
const HINDI_NUMBERS: Readonly<Record<string, number>> = {
  // Deliberately omitted: "no", "so", "sat", "tin", "che", "ath". Each is a real English
  // word that appears in ordinary order text ("no onion", "so many"), and turning one into
  // a digit corrupts the sentence far more often than it helps. The unambiguous spellings
  // below cover the same numbers.
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5,
  chah: 6, chhah: 6, saat: 7, aath: 8, nau: 9,
  das: 10, dus: 10, gyarah: 11, gyara: 11, barah: 12, bara: 12, terah: 13, tera: 13,
  chaudah: 14, chauda: 14, pandrah: 15, pandra: 15, solah: 16, sola: 16,
  satrah: 17, satra: 17, atharah: 18, athara: 18, unnis: 19, unis: 19,
  bees: 20, bis: 20, ikkis: 21, bais: 22, teis: 23, chaubis: 24, pachis: 25,
  chhabbis: 26, sattais: 27, atthais: 28, untis: 29,
  tees: 30, tis: 30, ikattis: 31, battis: 32, taintis: 33, chauntis: 34, paintis: 35,
  chhattis: 36, saintis: 37, adtis: 38, untalis: 39,
  chalis: 40, chalees: 40, iktalis: 41, bayalis: 42, taintalis: 43, chavalis: 44,
  paintalis: 45, chhiyalis: 46, saintalis: 47, adtalis: 48, unchas: 49,
  pachas: 50, pachaas: 50, ikyavan: 51, bavan: 52, tirpan: 53, chauvan: 54, pachpan: 55,
  chhappan: 56, sattavan: 57, atthavan: 58, unsath: 59,
  saath: 60, sath: 60, iksath: 61, basath: 62, tirsath: 63, chausath: 64, painsath: 65,
  chhiyasath: 66, sarsath: 67, adsath: 68, unhattar: 69,
  sattar: 70, ikhattar: 71, bahattar: 72, tihattar: 73, chauhattar: 74, pichhattar: 75,
  chhihattar: 76, sathattar: 77, athhattar: 78, unasi: 79,
  assi: 80, ikyasi: 81, bayasi: 82, tirasi: 83, chaurasi: 84, pachasi: 85,
  chhiyasi: 86, sattasi: 87, atthasi: 88, navasi: 89,
  nabbe: 90, navve: 90, ikyanve: 91, banve: 92, tiranve: 93, chauranve: 94, panchanve: 95,
  chhiyanve: 96, sattanve: 97, atthanve: 98, ninyanve: 99,
  sau: 100,
};

const MULTIPLIERS: Readonly<Record<string, number>> = {
  hundred: 100,
  sau: 100,
  thousand: 1000,
  hazar: 1000,
  hazaar: 1000,
};

/** A single token that stands for a number, or null when it is an ordinary word. */
export function numberFromWord(word: string): number | null {
  const key = word.toLowerCase();
  if (key in ENGLISH_UNITS) return ENGLISH_UNITS[key] as number;
  if (key in ENGLISH_TENS) return ENGLISH_TENS[key] as number;
  if (key in HINDI_NUMBERS) return HINDI_NUMBERS[key] as number;
  return null;
}

/**
 * Rewrites spelled-out numbers in a sentence as digits, leaving everything else alone.
 *
 * Handles the two compositional patterns that actually occur — English "forty five" and
 * "two hundred", Hindi "do sau" — and stops there. Deeper grammar (fractions, ordinals)
 * would add failure modes without covering a real utterance.
 */
export function digitizeNumberWords(input: string): string {
  const tokens = asciifyDigits(input).split(/(\s+)/);
  const output: string[] = [];

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] as string;

    if (/^\s+$/.test(token) || token === '') {
      output.push(token);
      index += 1;
      continue;
    }

    const stripped = token.replace(/[^\p{L}\p{N}]/gu, '');
    const value = numberFromWord(stripped);
    if (value === null) {
      output.push(token);
      index += 1;
      continue;
    }

    let total = value;
    let consumedTo = index;

    // Look ahead across whitespace for a continuation: a multiplier ("two hundred") or, for
    // an English tens word, a trailing unit ("forty five").
    let lookahead = index + 1;
    while (lookahead < tokens.length && /^\s*$/.test(tokens[lookahead] as string)) lookahead += 1;

    if (lookahead < tokens.length) {
      const nextWord = (tokens[lookahead] as string).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      const multiplier = MULTIPLIERS[nextWord];

      if (multiplier !== undefined && total < multiplier) {
        total *= multiplier;
        consumedTo = lookahead;
      } else if (stripped.toLowerCase() in ENGLISH_TENS) {
        const unit = ENGLISH_UNITS[nextWord];
        if (unit !== undefined && unit < 10) {
          total += unit;
          consumedTo = lookahead;
        }
      }
    }

    // Preserve whatever punctuation was riding on the last consumed token ("45," stays "45,").
    const lastToken = tokens[consumedTo] as string;
    const trailing = lastToken.replace(/^[\p{L}\p{N}]*/u, '');
    output.push(`${total}${trailing}`);
    index = consumedTo + 1;
  }

  return output.join('');
}
