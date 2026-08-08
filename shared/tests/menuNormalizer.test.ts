import { describe, expect, it } from 'vitest';
import {
  MATCH_THRESHOLD,
  matchMenuItem,
  normalizeMenuName,
} from '../src/voice/menuNormalizer';
import { editDistance, foldForMatch, similarity } from '../src/voice/text';
import { digitizeNumberWords, numberFromWord } from '../src/voice/numbers';

const CATALOGUE = [
  { id: '1', name: 'Paneer Tikka', unit: 'PLATE' },
  { id: '2', name: 'Dal Makhani', unit: 'KG' },
  { id: '3', name: 'Tandoori Roti', unit: 'NOS' },
  { id: '4', name: 'Gulab Jamun', unit: 'NOS' },
  { id: '5', name: 'Masala Chai', unit: 'CUP' },
  { id: '6', name: 'Veg Biryani', unit: 'KG' },
  { id: '7', name: 'Fresh Fruit Platter', unit: 'TRAY' },
  { id: '8', name: 'Dahi Bhalla', unit: 'PLATE' },
];

describe('phonetic folding', () => {
  it('collapses aspirates, long vowels and doubled letters', () => {
    expect(foldForMatch('Paneer Tikka')).toBe('panir tika');
    expect(foldForMatch('paneer tika')).toBe('panir tika');
    expect(foldForMatch('Dal Makhani')).toBe('dal makani');
    expect(foldForMatch('Tandoori Roti')).toBe('tanduri roti');
  });

  it('strips punctuation and case without losing word boundaries', () => {
    expect(foldForMatch('  Gulab-Jamun!  ')).toBe('gulab jamun');
  });

  it('measures edit distance and similarity consistently', () => {
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('abc', 'abd')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('', '')).toBe(1);
  });
});

describe('menu item normalization', () => {
  it('resolves the misspellings from the specification', () => {
    expect(normalizeMenuName('paneer tika', CATALOGUE)).toBe('Paneer Tikka');
    expect(normalizeMenuName('dal makni', CATALOGUE)).toBe('Dal Makhani');
    expect(normalizeMenuName('tandoori roti', CATALOGUE)).toBe('Tandoori Roti');
  });

  it('is insensitive to case, spacing and punctuation', () => {
    expect(normalizeMenuName('  GULAB   JAMUN ', CATALOGUE)).toBe('Gulab Jamun');
    expect(normalizeMenuName('masala-chai', CATALOGUE)).toBe('Masala Chai');
  });

  it('handles further transliteration drift', () => {
    expect(normalizeMenuName('panir tikka', CATALOGUE)).toBe('Paneer Tikka');
    expect(normalizeMenuName('daal makhani', CATALOGUE)).toBe('Dal Makhani');
    expect(normalizeMenuName('tanduri roti', CATALOGUE)).toBe('Tandoori Roti');
    expect(normalizeMenuName('veg biriyani', CATALOGUE)).toBe('Veg Biryani');
  });

  it('matches a fragment of a longer name', () => {
    expect(normalizeMenuName('fruit platter', CATALOGUE)).toBe('Fresh Fruit Platter');
  });

  it('reports an exact match as the strongest possible score', () => {
    const match = matchMenuItem('Paneer Tikka', CATALOGUE);
    expect(match?.score).toBe(1);
    expect(match?.strategy).toBe('exact');
  });

  it('refuses to guess when nothing is close enough', () => {
    expect(matchMenuItem('chicken biryani pizza', CATALOGUE)).toBeNull();
    expect(matchMenuItem('xyzzy', CATALOGUE)).toBeNull();
  });

  it('does not confuse two genuinely different dishes', () => {
    // "dal" and "dahi" are one edit apart once folded; neither may win the other's line.
    expect(matchMenuItem('dal makhani', CATALOGUE)?.item.name).toBe('Dal Makhani');
    expect(matchMenuItem('dahi bhalla', CATALOGUE)?.item.name).toBe('Dahi Bhalla');
  });

  it('leaves an unmatched name untouched rather than substituting a wrong one', () => {
    expect(normalizeMenuName('sushi platter roll', CATALOGUE)).toBe('sushi platter roll');
  });

  it('never returns a match below the threshold', () => {
    for (const spoken of ['a', 'zzz', 'random words here']) {
      const match = matchMenuItem(spoken, CATALOGUE);
      if (match !== null) expect(match.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    }
  });

  it('copes with an empty catalogue or empty input', () => {
    expect(matchMenuItem('paneer tikka', [])).toBeNull();
    expect(matchMenuItem('', CATALOGUE)).toBeNull();
    expect(matchMenuItem('   ', CATALOGUE)).toBeNull();
  });
});

describe('spoken numbers', () => {
  it('reads English and Hindi number words', () => {
    expect(numberFromWord('forty')).toBe(40);
    expect(numberFromWord('paintalis')).toBe(45);
    expect(numberFromWord('sau')).toBe(100);
    expect(numberFromWord('paneer')).toBeNull();
  });

  it('composes English tens with units', () => {
    expect(digitizeNumberWords('forty five plates')).toBe('45 plates');
    expect(digitizeNumberWords('twenty one')).toBe('21');
  });

  it('applies multipliers in both languages', () => {
    expect(digitizeNumberWords('two hundred')).toBe('200');
    expect(digitizeNumberWords('do sau')).toBe('200');
  });

  it('converts Devanagari digits', () => {
    expect(digitizeNumberWords('४५ pax')).toBe('45 pax');
  });

  it('preserves trailing punctuation on a converted number', () => {
    expect(digitizeNumberWords('paneer tikka forty five, dal makhani')).toBe(
      'paneer tikka 45, dal makhani',
    );
  });

  it('leaves ordinary words alone', () => {
    expect(digitizeNumberWords('Paneer Tikka aur Dal Makhani')).toBe(
      'Paneer Tikka aur Dal Makhani',
    );
  });
});
