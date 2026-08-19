import fs from 'node:fs/promises';
import {
  MaintenancePriority,
  ProblemCategory,
  type DocumentExtractionDraft,
  type DocumentExtractionDto,
  type EquipmentDocumentType,
  type EquipmentIdentificationDraft,
  type EquipmentSpecificationsDto,
  type ProblemClassificationDraft,
  type ProblemClassifyRequest,
} from '@menuboard/shared';
import { config } from '../config';
import { getPool } from '../db/pool';
import type { Db } from '../db/types';
import {
  EquipmentCategoryRepository,
  EquipmentRepository,
} from '../repositories/EquipmentRepository';
import { mediaAssetRepository } from '../repositories/MediaRepository';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { resolveMediaPath, signMenuMediaUrl } from '../utils/mediaStorage';
import { extractJson, generateGeminiText, transcribeAudio } from './GeminiService';

/**
 * The optional AI layer: photograph -> equipment draft, document -> extracted fields, and a
 * sentence (typed or spoken) -> a classified problem.
 *
 * Two rules, both non-negotiable:
 *
 *  - **AI proposes, the user disposes.** Every method here returns a `*Draft`. Nothing is
 *    persisted; the draft is shown, edited if wrong, and only then submitted through the
 *    ordinary create endpoints. An automatic technical diagnosis nobody confirmed is exactly
 *    what a maintenance system must not produce.
 *  - **The module must stay fully usable with AI off.** With `GEMINI_API_KEY` unset these
 *    three endpoints refuse with a clear message and everything else — registration, reporting,
 *    scheduling, supplier contact — works exactly as before.
 */

/** A vision call on a photograph of a machine plate is slower than a text completion. */
const VISION_TIMEOUT_MS = 40_000;

const CATEGORY_HINT_LIMIT = 40;

function requireAi(): void {
  if (!config.gemini.apiKey) {
    throw new ValidationError(
      'AI assistance is not configured on this server (GEMINI_API_KEY is unset). Enter the details manually instead.',
    );
  }
}

/** Anything between 0 and 1; a model that returns 87 means 0.87 and a model that lies means 0. */
function confidenceOf(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const scaled = parsed > 1 ? parsed / 100 : parsed;
  return Math.min(1, Math.max(0, scaled));
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'unknown' ? null : trimmed;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDateOrNull(value: unknown): string | null {
  const text = textOrNull(value);
  if (text === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(extractJson(raw)) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    logger.warn('AI response was not valid JSON', { length: raw.length }, error);
  }
  throw new ValidationError(
    'The AI response could not be read. Enter the details manually, or try again with a clearer photo.',
  );
}

export class EquipmentAiService {
  /**
   * Photograph of a machine (ideally its rating plate) -> a draft equipment record.
   *
   * Every field is nullable on purpose: a blurry plate that yields only a brand is a useful
   * result, not a failure, and the confirmation screen shows what the model was unsure about
   * rather than pretending it knew.
   */
  async identifyFromPhoto(mediaId: string, userId: string): Promise<EquipmentIdentificationDraft> {
    requireAi();
    const pool = getPool();
    const { buffer, mimeType } = await this.loadMedia(pool, mediaId);

    const categories = await EquipmentCategoryRepository.list(pool, false);
    const categoryList = categories
      .slice(0, CATEGORY_HINT_LIMIT)
      .map((category) => category.name)
      .join(', ');

    const prompt = `You are helping a canteen manager register a piece of commercial kitchen equipment from a photograph.

Read whatever is legible in the image, especially the rating/serial plate.

Reply with ONLY a JSON object of this exact shape:
{
  "name": string|null,            // what a cook would call it, e.g. "Deck Oven"
  "equipmentType": string|null,   // more specific type if visible
  "brand": string|null,
  "model": string|null,
  "serialNumber": string|null,
  "manufacturer": string|null,
  "category": string|null,        // one of: ${categoryList}
  "specifications": {
    "capacity": string|null, "voltage": string|null, "powerRating": string|null,
    "dimensions": string|null, "weight": string|null, "fuelType": string|null,
    "temperatureRange": string|null
  },
  "confidence": number,           // 0..1 for the reading as a whole
  "uncertainFields": string[]     // field names you guessed rather than read
}

Use null for anything you cannot actually see. Do not invent a serial number.`;

    const raw = await generateGeminiText(
      prompt,
      [{ inlineData: { mimeType, data: buffer.toString('base64') } }],
      { timeoutMs: VISION_TIMEOUT_MS },
    );
    const parsed = parseJsonObject(raw);

    const categoryName = textOrNull(parsed.category);
    const category =
      categoryName === null
        ? null
        : await EquipmentCategoryRepository.findByNameLike(pool, categoryName);

    return {
      name: textOrNull(parsed.name),
      equipmentType: textOrNull(parsed.equipmentType),
      brand: textOrNull(parsed.brand),
      model: textOrNull(parsed.model),
      serialNumber: textOrNull(parsed.serialNumber),
      manufacturer: textOrNull(parsed.manufacturer),
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? categoryName,
      specifications: specificationsOf(parsed.specifications),
      confidence: confidenceOf(parsed.confidence),
      uncertainFields: Array.isArray(parsed.uncertainFields)
        ? parsed.uncertainFields.filter((field): field is string => typeof field === 'string')
        : [],
      mediaId,
      imageUrl: signMenuMediaUrl(mediaId, userId),
    };
  }

  /**
   * Warranty card, invoice or purchase bill -> the handful of fields that matter.
   *
   * The raw text is returned alongside the parse so the user can check a value the model
   * mangled instead of having to open the file again.
   */
  async extractDocument(
    mediaId: string,
    docType: EquipmentDocumentType,
    userId: string,
  ): Promise<DocumentExtractionDraft> {
    requireAi();
    const { buffer, mimeType } = await this.loadMedia(getPool(), mediaId);

    const prompt = `You are reading a ${docType.toLowerCase().replace(/_/g, ' ')} for a piece of commercial kitchen equipment.

Reply with ONLY a JSON object of this exact shape:
{
  "purchaseDate": "YYYY-MM-DD"|null,
  "supplierName": string|null,
  "invoiceNumber": string|null,
  "warrantyMonths": number|null,
  "warrantyExpiry": "YYYY-MM-DD"|null,
  "purchasePrice": number|null,     // plain number, no currency symbol or separators
  "serialNumber": string|null,
  "notes": string|null,             // warranty terms worth remembering, one short line
  "confidence": number,             // 0..1
  "rawText": string                 // all text you could read, as printed
}

Use null for anything not present on the page. Dates must be ISO (YYYY-MM-DD).`;

    const raw = await generateGeminiText(
      prompt,
      [{ inlineData: { mimeType, data: buffer.toString('base64') } }],
      { timeoutMs: VISION_TIMEOUT_MS },
    );
    const parsed = parseJsonObject(raw);

    const extracted: DocumentExtractionDto = {
      purchaseDate: isoDateOrNull(parsed.purchaseDate),
      supplierName: textOrNull(parsed.supplierName),
      invoiceNumber: textOrNull(parsed.invoiceNumber),
      warrantyMonths: numberOrNull(parsed.warrantyMonths),
      warrantyExpiry: isoDateOrNull(parsed.warrantyExpiry),
      purchasePrice: numberOrNull(parsed.purchasePrice),
      serialNumber: textOrNull(parsed.serialNumber),
      notes: textOrNull(parsed.notes),
    };

    return {
      docType,
      extracted: withDerivedExpiry(extracted),
      confidence: confidenceOf(parsed.confidence),
      mediaId,
      url: signMenuMediaUrl(mediaId, userId),
      rawText: textOrNull(parsed.rawText),
    };
  }

  /**
   * "Oven is not heating" -> a ticket, minus the confirmation tap.
   *
   * Accepts typed text, a voice clip (transcribed first, with the transcript returned so the
   * user can correct it) or a photograph of the fault. Never submits anything.
   */
  async classifyProblem(
    input: ProblemClassifyRequest,
    userId: string,
  ): Promise<ProblemClassificationDraft> {
    requireAi();
    const pool = getPool();

    const equipment =
      input.equipmentId === undefined || input.equipmentId === null
        ? null
        : await EquipmentRepository.findById(pool, input.equipmentId);
    if (input.equipmentId !== undefined && input.equipmentId !== null && equipment === null) {
      throw new NotFoundError('Equipment', input.equipmentId);
    }

    let transcript: string | null = null;
    const inlineParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

    if (input.mediaId !== undefined && input.mediaId !== null) {
      const media = await this.loadMedia(pool, input.mediaId);
      if (media.mimeType.startsWith('audio/')) {
        transcript = await transcribeAudio(media.buffer, media.mimeType);
      } else {
        inlineParts.push({
          inlineData: { mimeType: media.mimeType, data: media.buffer.toString('base64') },
        });
      }
    }

    const statement = [textOrNull(input.text), transcript]
      .filter((part): part is string => part !== null)
      .join('\n');
    if (statement === '' && inlineParts.length === 0) {
      throw new ValidationError('Describe the problem, record it, or attach a photo', [
        { path: 'text', message: 'Nothing was supplied to classify' },
      ]);
    }

    const context =
      equipment === null
        ? 'The reporter has not said which machine it is.'
        : `The machine is ${equipment.name} (${equipment.asset_id})${
            equipment.brand === null ? '' : `, a ${equipment.brand} ${equipment.model ?? ''}`.trimEnd()
          }, currently ${equipment.status.toLowerCase().replace(/_/g, ' ')}.`;

    const prompt = `A kitchen worker is reporting a fault with commercial kitchen equipment.

${context}

What they said:
"""
${statement}
"""

Classify it. Reply with ONLY a JSON object of this exact shape:
{
  "category": one of ${Object.keys(ProblemCategory).join(' | ')},
  "title": string,        // one short line, at most 80 characters
  "description": string,  // one or two sentences in plain English
  "priority": one of LOW | NORMAL | HIGH | CRITICAL,
  "suggestedAction": string|null,  // what the reporter should do right now, or null
  "confidence": number    // 0..1
}

Rules: anything involving gas, smoke, sparks, burns or exposed wiring is CRITICAL and its
category is SAFETY or ELECTRICAL. Do not diagnose the internal fault — say what was observed.`;

    const raw = await generateGeminiText(prompt, inlineParts, {
      timeoutMs: inlineParts.length > 0 ? VISION_TIMEOUT_MS : undefined,
    });
    const parsed = parseJsonObject(raw);

    const supplier =
      equipment === null
        ? null
        : await EquipmentRepository.resolveContactSupplier(pool, equipment.id);

    return {
      category: categoryOf(parsed.category),
      title: (textOrNull(parsed.title) ?? statement.slice(0, 80)).slice(0, 200),
      description: textOrNull(parsed.description) ?? statement,
      priority: priorityOf(parsed.priority),
      confidence: confidenceOf(parsed.confidence),
      suggestedSupplierId: supplier?.supplier_id ?? null,
      suggestedSupplierName: supplier?.supplier_name ?? null,
      suggestedAction: textOrNull(parsed.suggestedAction),
      transcript,
      equipmentId: equipment?.id ?? null,
    };
  }

  /** Reads a stored media asset off disk for an inline model part. */
  private async loadMedia(
    db: Db,
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const asset = await mediaAssetRepository.findById(db, mediaId);
    if (asset === null) throw new NotFoundError('Media asset', mediaId);
    const buffer = await fs.readFile(resolveMediaPath(asset.storage_path));
    // `signMenuMediaUrl` is never used to fetch these: the bytes are already local, and a
    // round trip through the public URL would be slower and could expire mid-request.
    return { buffer, mimeType: asset.mime_type };
  }
}

/* --------------------------------------------------------------------- helpers */

function specificationsOf(value: unknown): EquipmentSpecificationsDto | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const specifications: EquipmentSpecificationsDto = {
    capacity: textOrNull(source.capacity),
    voltage: textOrNull(source.voltage),
    powerRating: textOrNull(source.powerRating),
    dimensions: textOrNull(source.dimensions),
    weight: textOrNull(source.weight),
    fuelType: textOrNull(source.fuelType),
    temperatureRange: textOrNull(source.temperatureRange),
  };
  const hasAny = Object.values(specifications).some((entry) => entry !== null);
  return hasAny ? specifications : null;
}

function categoryOf(value: unknown): ProblemCategory {
  const text = textOrNull(value)?.toUpperCase().replace(/\s+/g, '_') ?? '';
  return Object.prototype.hasOwnProperty.call(ProblemCategory, text)
    ? (text as ProblemCategory)
    : ProblemCategory.OTHER;
}

function priorityOf(value: unknown): MaintenancePriority {
  const text = textOrNull(value)?.toUpperCase() ?? '';
  return Object.prototype.hasOwnProperty.call(MaintenancePriority, text)
    ? (text as MaintenancePriority)
    : MaintenancePriority.NORMAL;
}

/** A card that states "24 months from purchase" and no end date still has an expiry. */
function withDerivedExpiry(extracted: DocumentExtractionDto): DocumentExtractionDto {
  if (extracted.warrantyExpiry !== null && extracted.warrantyExpiry !== undefined) return extracted;
  const start = extracted.purchaseDate ?? null;
  const months = extracted.warrantyMonths ?? null;
  if (start === null || months === null) return extracted;

  const expiry = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) return extracted;
  expiry.setUTCMonth(expiry.getUTCMonth() + months);
  return { ...extracted, warrantyExpiry: expiry.toISOString().slice(0, 10) };
}

export const equipmentAiService = new EquipmentAiService();
