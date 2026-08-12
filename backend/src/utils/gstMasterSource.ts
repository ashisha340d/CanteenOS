import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { ERROR_CODES, GST_MASTER_SOURCE, HsnSacCodeType } from '@menuboard/shared';
import { AppError } from './errors';

/**
 * Retrieval and parsing of the official GST/GSTN HSN/SAC classification workbook.
 *
 * GSTN publishes no API for this dataset. GST_MASTER_SOURCE.URL is the file the GST Portal
 * itself serves from "Download HSN Directory in Excel Format", which is why this is an
 * official source and not a third-party mirror. The workbook has two sheets with two columns
 * each — code and description — and carries no rates, no effective dates and no version
 * field. The nearest thing to a version is its own document-modified timestamp, so that plus
 * a SHA-256 of the bytes is what identifies a dataset revision.
 */

export interface ParsedHsnSacRecord {
  code: string;
  codeType: HsnSacCodeType;
  description: string;
  chapter: string | null;
  heading: string | null;
  subHeading: string | null;
}

export interface GstMasterDataset {
  records: ParsedHsnSacRecord[];
  /** Rows present in the file that could not be used, with the reason. */
  rejected: { sheet: string; row: number; reason: string }[];
  checksum: string;
  /** The workbook's own dcterms:modified date (YYYY-MM-DD), when present. */
  sourceVersion: string | null;
  byteLength: number;
}

class GstSourceError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(502, ERROR_CODES.GST_SOURCE_UNAVAILABLE, message, { cause });
  }
}

/** Downloads the official workbook. The portal rejects HEAD, so this is always a GET. */
export async function downloadGstMasterWorkbook(
  url: string = GST_MASTER_SOURCE.URL,
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GST_MASTER_SOURCE.DOWNLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*' },
    });
  } catch (error) {
    throw new GstSourceError(
      'The official GST HSN/SAC dataset could not be reached. Check the server\'s internet access and try again.',
      error,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new GstSourceError(
      `The official GST source returned HTTP ${response.status} for the HSN/SAC workbook`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) throw new GstSourceError('The official GST source returned an empty file');
  if (buffer.byteLength > GST_MASTER_SOURCE.MAX_BYTES) {
    throw new GstSourceError('The official GST source returned an implausibly large file');
  }
  // XLSX is a zip; anything else (an HTML error page, most likely) is not the dataset.
  if (buffer.subarray(0, 2).toString('latin1') !== 'PK') {
    throw new GstSourceError('The official GST source did not return a spreadsheet');
  }
  return buffer;
}

/**
 * HSN codes decompose positionally: the first two digits are the chapter, four the heading,
 * six the sub-heading. SAC codes have no such decomposition, so services get nulls rather
 * than an invented hierarchy.
 */
function classifyHsn(code: string): Pick<ParsedHsnSacRecord, 'chapter' | 'heading' | 'subHeading'> {
  return {
    chapter: code.length >= 2 ? code.slice(0, 2) : null,
    heading: code.length >= 4 ? code.slice(0, 4) : null,
    subHeading: code.length >= 6 ? code.slice(0, 6) : null,
  };
}

/** Collapses internal whitespace; some descriptions carry newlines and doubled spaces. */
function normaliseDescription(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Codes are digits only. The source has stray spaces and the odd apostrophe prefix. */
function normaliseCode(value: string): string {
  return value.replace(/[\s'"]/g, '').trim();
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  if (typeof value === 'object' && 'text' in value) return String(value.text);
  return String(value);
}

export async function parseGstMasterWorkbook(buffer: Buffer): Promise<GstMasterDataset> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (error) {
    throw new GstSourceError('The downloaded GST file is not a readable spreadsheet', error);
  }

  const sheets: { sheet: ExcelJS.Worksheet | undefined; codeType: HsnSacCodeType; name: string }[] = [
    {
      sheet: workbook.getWorksheet(GST_MASTER_SOURCE.HSN_SHEET),
      codeType: HsnSacCodeType.HSN,
      name: GST_MASTER_SOURCE.HSN_SHEET,
    },
    {
      sheet: workbook.getWorksheet(GST_MASTER_SOURCE.SAC_SHEET),
      codeType: HsnSacCodeType.SAC,
      name: GST_MASTER_SOURCE.SAC_SHEET,
    },
  ];

  const missing = sheets.filter((entry) => entry.sheet === undefined).map((entry) => entry.name);
  if (missing.length > 0) {
    throw new GstSourceError(
      `The downloaded GST workbook is missing the expected sheet(s): ${missing.join(', ')}`,
    );
  }

  const records: ParsedHsnSacRecord[] = [];
  const rejected: GstMasterDataset['rejected'] = [];
  // Same code twice within one sheet: keep the first, count the rest as rejected rather than
  // letting the later row silently overwrite the earlier one.
  const seen = new Set<string>();

  for (const { sheet, codeType, name } of sheets) {
    sheet?.eachRow((row, rowNumber) => {
      const rawCode = cellText(row.getCell(1));
      const rawDescription = cellText(row.getCell(2));

      if (rawCode.trim() === '' && rawDescription.trim() === '') return;

      const code = normaliseCode(rawCode);
      // Row 1 is the header ("HSN_CD"/"SAC_CD"); skip it rather than count it as a failure.
      if (rowNumber === 1 && !/^\d/.test(code)) return;
      const description = normaliseDescription(rawDescription);

      if (code === '') {
        rejected.push({ sheet: name, row: rowNumber, reason: 'Missing code' });
        return;
      }
      if (!/^\d{2,20}$/.test(code)) {
        rejected.push({ sheet: name, row: rowNumber, reason: `Code is not numeric: ${code}` });
        return;
      }
      if (description === '') {
        rejected.push({ sheet: name, row: rowNumber, reason: `Missing description for ${code}` });
        return;
      }

      const key = `${codeType}:${code}`;
      if (seen.has(key)) {
        rejected.push({ sheet: name, row: rowNumber, reason: `Duplicate code: ${code}` });
        return;
      }
      seen.add(key);

      records.push({
        code,
        codeType,
        description,
        ...(codeType === HsnSacCodeType.HSN
          ? classifyHsn(code)
          : { chapter: null, heading: null, subHeading: null }),
      });
    });
  }

  if (records.length < GST_MASTER_SOURCE.MIN_EXPECTED_RECORDS) {
    // Refusing a short file is what stops a truncated download from deactivating the master.
    throw new GstSourceError(
      `The downloaded GST dataset contains only ${records.length} usable records, ` +
      `far fewer than the ${GST_MASTER_SOURCE.MIN_EXPECTED_RECORDS} expected. ` +
      'It was rejected rather than applied.',
    );
  }

  const modified = workbook.modified ?? workbook.created;

  return {
    records,
    rejected,
    checksum: createHash('sha256').update(buffer).digest('hex'),
    sourceVersion: modified instanceof Date ? modified.toISOString().slice(0, 10) : null,
    byteLength: buffer.byteLength,
  };
}

export async function fetchGstMasterDataset(url?: string): Promise<GstMasterDataset> {
  return parseGstMasterWorkbook(await downloadGstMasterWorkbook(url));
}
