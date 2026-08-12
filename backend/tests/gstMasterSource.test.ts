import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { GST_MASTER_SOURCE } from '@menuboard/shared';
import { parseGstMasterWorkbook } from '../src/utils/gstMasterSource';

/**
 * Builds a workbook shaped like the official one: two sheets, a header row, and two columns
 * (code, description). `hsnCount` filler rows keep the dataset above the minimum-size guard so
 * a test can exercise parsing without tripping the truncated-download rejection.
 */
async function buildWorkbook(options: {
  hsn?: [string | number, string][];
  sac?: [string | number, string][];
  hsnCount?: number;
  omitSacSheet?: boolean;
  header?: boolean;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const hsnSheet = workbook.addWorksheet(GST_MASTER_SOURCE.HSN_SHEET);
  if (options.header !== false) hsnSheet.addRow(['HSN_CD', 'HSN_Description']);
  for (const row of options.hsn ?? []) hsnSheet.addRow(row);
  for (let i = 0; i < (options.hsnCount ?? 0); i += 1) {
    hsnSheet.addRow([String(100000 + i), `Filler goods ${i}`]);
  }

  if (options.omitSacSheet !== true) {
    const sacSheet = workbook.addWorksheet(GST_MASTER_SOURCE.SAC_SHEET);
    if (options.header !== false) sacSheet.addRow(['SAC_CD', 'SAC_Description']);
    for (const row of options.sac ?? []) sacSheet.addRow(row);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const FILLER = GST_MASTER_SOURCE.MIN_EXPECTED_RECORDS;

describe('parseGstMasterWorkbook', () => {
  it('parses HSN and SAC sheets into typed records', async () => {
    const buffer = await buildWorkbook({
      hsn: [['01012100', 'Pure-bred breeding horses']],
      sac: [['996331', 'Services provided by restaurants']],
      hsnCount: FILLER,
    });
    const dataset = await parseGstMasterWorkbook(buffer);

    const horse = dataset.records.find((r) => r.code === '01012100');
    expect(horse).toEqual({
      code: '01012100',
      codeType: 'HSN',
      description: 'Pure-bred breeding horses',
      chapter: '01',
      heading: '0101',
      subHeading: '010121',
    });

    const restaurant = dataset.records.find((r) => r.code === '996331');
    expect(restaurant?.codeType).toBe('SAC');
    // SAC has no positional hierarchy, so no chapter/heading is invented for it.
    expect(restaurant?.chapter).toBeNull();
    expect(restaurant?.heading).toBeNull();
  });

  it('skips the header row without counting it as a failure', async () => {
    const dataset = await parseGstMasterWorkbook(
      await buildWorkbook({ hsn: [['0101', 'Live horses']], hsnCount: FILLER }),
    );
    expect(dataset.rejected).toHaveLength(0);
    expect(dataset.records.some((r) => r.code === 'HSN_CD')).toBe(false);
  });

  it('keeps the first of a duplicated code and reports the rest', async () => {
    const dataset = await parseGstMasterWorkbook(
      await buildWorkbook({
        hsn: [
          ['230700', 'Wine lees'],
          ['230700', 'A later duplicate'],
        ],
        hsnCount: FILLER,
      }),
    );

    expect(dataset.records.filter((r) => r.code === '230700')).toHaveLength(1);
    expect(dataset.records.find((r) => r.code === '230700')?.description).toBe('Wine lees');
    expect(dataset.rejected).toContainEqual(
      expect.objectContaining({ reason: 'Duplicate code: 230700' }),
    );
  });

  it('rejects non-numeric codes and rows with no description', async () => {
    const dataset = await parseGstMasterWorkbook(
      await buildWorkbook({
        hsn: [
          ['NOT-A-CODE', 'Nonsense'],
          ['0202', ''],
        ],
        hsnCount: FILLER,
      }),
    );

    expect(dataset.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'Code is not numeric: NOT-A-CODE' }),
        expect.objectContaining({ reason: 'Missing description for 0202' }),
      ]),
    );
  });

  it('normalises whitespace in codes and descriptions', async () => {
    const dataset = await parseGstMasterWorkbook(
      await buildWorkbook({
        hsn: [[' 0101 ', '  Live   horses\nand asses  ']],
        hsnCount: FILLER,
      }),
    );
    const row = dataset.records.find((r) => r.code === '0101');
    expect(row?.description).toBe('Live horses and asses');
  });

  it('accepts a numeric cell, which Excel produces for codes without leading zeros', async () => {
    const dataset = await parseGstMasterWorkbook(
      await buildWorkbook({ hsn: [[996331, 'Numeric cell']], hsnCount: FILLER }),
    );
    expect(dataset.records.find((r) => r.code === '996331')?.description).toBe('Numeric cell');
  });

  it('refuses a short dataset rather than letting it deactivate the master', async () => {
    await expect(
      parseGstMasterWorkbook(await buildWorkbook({ hsn: [['0101', 'Live horses']] })),
    ).rejects.toThrow(/far fewer than/);
  });

  it('refuses a workbook that is missing an expected sheet', async () => {
    await expect(
      parseGstMasterWorkbook(await buildWorkbook({ hsnCount: FILLER, omitSacSheet: true })),
    ).rejects.toThrow(/missing the expected sheet/);
  });

  it('refuses a file that is not a spreadsheet at all', async () => {
    await expect(parseGstMasterWorkbook(Buffer.from('<html>error</html>'))).rejects.toThrow(
      /not a readable spreadsheet/,
    );
  });

  it('derives a checksum that changes with the content', async () => {
    const a = await parseGstMasterWorkbook(
      await buildWorkbook({ hsn: [['0101', 'Live horses']], hsnCount: FILLER }),
    );
    const b = await parseGstMasterWorkbook(
      await buildWorkbook({ hsn: [['0101', 'Live horses, amended']], hsnCount: FILLER }),
    );
    expect(a.checksum).toHaveLength(64);
    expect(a.checksum).not.toBe(b.checksum);
  });
});
