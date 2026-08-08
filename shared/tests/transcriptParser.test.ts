import { describe, expect, it } from 'vitest';
import { parseOrderTranscript } from '../src/voice/transcriptParser';

const CATALOGUE = [
  { id: '1', name: 'Paneer Tikka', unit: 'PLATE' },
  { id: '2', name: 'Dal Makhani', unit: 'KG' },
  { id: '3', name: 'Tandoori Roti', unit: 'NOS' },
  { id: '4', name: 'Gulab Jamun', unit: 'NOS' },
  { id: '5', name: 'Masala Chai', unit: 'CUP' },
  { id: '6', name: 'Poha', unit: 'PLATE' },
  { id: '7', name: 'Jalebi', unit: 'KG' },
  { id: '8', name: 'Samosa', unit: 'NOS' },
];

/** A Thursday, so weekday resolution has a stable reference. */
const NOW = new Date(2026, 7, 6, 9, 0, 0);

function parse(transcript: string) {
  return parseOrderTranscript(transcript, { catalogue: CATALOGUE, now: NOW });
}

describe('the specification example', () => {
  const TRANSCRIPT =
    'Kal 1 baje 45 pax ke liye Paneer Tikka 45, Dal Makhani 45 aur Tandoori Roti 90.';

  it('extracts every field', () => {
    const result = parse(TRANSCRIPT);

    expect(result.requiredDate).toBe('2026-08-07');
    // "1 baje" is one in the afternoon — nobody caters at 01:00.
    expect(result.requiredTime).toBe('13:00');
    expect(result.pax).toBe(45);
    expect(result.items).toHaveLength(3);
  });

  it('resolves each item to the catalogue with its quantity', () => {
    const result = parse(TRANSCRIPT);
    expect(
      result.items.map((item) => [item.match?.item.name, item.quantity]),
    ).toEqual([
      ['Paneer Tikka', 45],
      ['Dal Makhani', 45],
      ['Tandoori Roti', 90],
    ]);
  });

  it('does not mistake the pax count for an item quantity', () => {
    const result = parse(TRANSCRIPT);
    expect(result.pax).toBe(45);
    expect(result.items.every((item) => item.match !== null)).toBe(true);
  });
});

describe('dates', () => {
  it('reads relative days in both languages', () => {
    expect(parse('aaj 50 pax poha 50').requiredDate).toBe('2026-08-06');
    expect(parse('kal 50 pax poha 50').requiredDate).toBe('2026-08-07');
    expect(parse('today 50 pax poha 50').requiredDate).toBe('2026-08-06');
    expect(parse('tomorrow 50 pax poha 50').requiredDate).toBe('2026-08-07');
  });

  it('reads "parso" as the day after tomorrow, since an order is always ahead', () => {
    expect(parse('parso 50 pax poha 50').requiredDate).toBe('2026-08-08');
  });

  it('reads explicit calendar dates day-first', () => {
    expect(parse('12/08/2026 poha 50').requiredDate).toBe('2026-08-12');
    expect(parse('2026-08-12 poha 50').requiredDate).toBe('2026-08-12');
    expect(parse('12 August poha 50').requiredDate).toBe('2026-08-12');
    expect(parse('August 12 poha 50').requiredDate).toBe('2026-08-12');
  });

  it('reads a weekday as the next occurrence, never the past', () => {
    // NOW is a Thursday; the coming Monday is the 10th.
    expect(parse('monday poha 50').requiredDate).toBe('2026-08-10');
    // The same weekday means a week out, not today.
    expect(parse('thursday poha 50').requiredDate).toBe('2026-08-13');
  });

  it('returns null when no date was spoken', () => {
    expect(parse('poha 50 aur jalebi 20').requiredDate).toBeNull();
  });
});

describe('times', () => {
  it('reads an explicit clock time', () => {
    expect(parse('12:30 pm poha 50').requiredTime).toBe('12:30');
    expect(parse('8:15 am poha 50').requiredTime).toBe('08:15');
  });

  it('defaults a bare afternoon-ish hour to PM', () => {
    expect(parse('1 baje poha 50').requiredTime).toBe('13:00');
    expect(parse('7 baje poha 50').requiredTime).toBe('19:00');
  });

  it('honours an explicit part of day over the default', () => {
    expect(parse('subah 8 baje poha 50').requiredTime).toBe('08:00');
    expect(parse('shaam 6 baje poha 50').requiredTime).toBe('18:00');
    expect(parse('raat 9 baje poha 50').requiredTime).toBe('21:00');
    expect(parse('8 am poha 50').requiredTime).toBe('08:00');
  });

  it('leaves late-morning hours alone', () => {
    expect(parse('11 baje poha 50').requiredTime).toBe('11:00');
    expect(parse('12 baje poha 50').requiredTime).toBe('12:00');
  });

  it('reads 12 am as midnight', () => {
    expect(parse('12 am poha 50').requiredTime).toBe('00:00');
  });
});

describe('pax', () => {
  it('reads a count with any of the people words', () => {
    for (const phrase of [
      '45 pax',
      '45 guests',
      '45 people',
      '45 log',
      '45 mehmaan',
      'for 45 pax',
    ]) {
      expect(parse(`${phrase} poha 50`).pax).toBe(45);
    }
  });

  it('reads a label-first form', () => {
    expect(parse('PAX - 100 poha 50').pax).toBe(100);
    expect(parse('pax 100 poha 50').pax).toBe(100);
  });

  it('reads a spelled-out count', () => {
    expect(parse('forty five pax poha 50').pax).toBe(45);
    expect(parse('paintalis pax poha 50').pax).toBe(45);
  });

  it('requires a people word, so an item quantity is never taken as pax', () => {
    expect(parse('poha 50 aur jalebi 20').pax).toBeNull();
  });
});

describe('items', () => {
  it('accepts the quantity on either side of the name', () => {
    expect(parse('poha 50').items[0]?.quantity).toBe(50);
    expect(parse('50 poha').items[0]?.quantity).toBe(50);
  });

  it('splits on commas and on both conjunctions', () => {
    const result = parse('poha 50, jalebi 20 aur samosa 100');
    expect(result.items.map((item) => item.match?.item.name)).toEqual([
      'Poha',
      'Jalebi',
      'Samosa',
    ]);
  });

  it('keeps an unmatched item rather than dropping it, when a quantity was given', () => {
    const result = parse('sushi rolls 30');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.match).toBeNull();
    expect(result.items[0]?.spokenName).toBe('sushi rolls');
    expect(result.items[0]?.quantity).toBe(30);
  });

  it('normalizes misspelled names through the catalogue', () => {
    const result = parse('panir tika 45 aur dal makni 45');
    expect(result.items.map((item) => item.match?.item.name)).toEqual([
      'Paneer Tikka',
      'Dal Makhani',
    ]);
  });

  it('ignores unit words attached to a quantity', () => {
    expect(parse('poha 50 plates').items[0]?.quantity).toBe(50);
    expect(parse('masala chai 30 cups').items[0]?.quantity).toBe(30);
  });

  it('reads a spelled-out quantity', () => {
    expect(parse('poha forty five').items[0]?.quantity).toBe(45);
  });
});

describe('event name and notes', () => {
  it('treats an unmatched, unquantified phrase as the event name', () => {
    const result = parse('morning picnic ke liye poha 50 aur jalebi 20');
    expect(result.eventName).toBe('Morning Picnic');
    expect(result.items).toHaveLength(2);
  });

  it('captures a trailing note clause', () => {
    const result = parse('poha 50 note pyaaz nahi dalna');
    expect(result.notes).toBe('pyaaz nahi dalna');
    // The note must not leak into the menu.
    expect(result.items).toHaveLength(1);
  });

  it('captures an English note clause', () => {
    expect(parse('poha 50 special instructions no onion').notes).toBe('no onion');
  });
});

describe('reporting', () => {
  it('lists exactly the fields it filled', () => {
    const result = parse('kal 1 baje 45 pax poha 50');
    expect(result.filledFields).toContain('requiredDate');
    expect(result.filledFields).toContain('requiredTime');
    expect(result.filledFields).toContain('pax');
    expect(result.filledFields).toContain('items');
    expect(result.filledFields).not.toContain('notes');
  });

  it('returns an empty, non-throwing result for junk input', () => {
    const result = parse('');
    expect(result.items).toEqual([]);
    expect(result.pax).toBeNull();
    expect(result.filledFields).toEqual([]);
  });

  it('never throws on unexpected input', () => {
    for (const input of ['...', '   ', '???', '1', 'aur aur aur']) {
      expect(() => parse(input)).not.toThrow();
    }
  });

  it('works with no catalogue supplied', () => {
    const result = parseOrderTranscript('kal 45 pax poha 50', { now: NOW });
    expect(result.pax).toBe(45);
    expect(result.items[0]?.quantity).toBe(50);
    expect(result.items[0]?.match).toBeNull();
  });
});
