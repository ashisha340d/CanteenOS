import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  YoutubeImportStatus,
  YOUTUBE_IMPORT_ACTIVE_STATUSES,
  isLikelyTypoOf,
  normalizeNameKey,
  type YoutubeExtractedRecipe,
  type YoutubeImportDto,
} from '@menuboard/shared';
import { config } from '../config';
import { getPool } from '../db/pool';
import { mapYoutubeImport } from '../models/mappers';
import { ingredientRepository } from '../repositories/IngredientRepository';
import { recipeRepository } from '../repositories/RecipeRepository';
import { youtubeImportRepository } from '../repositories/YoutubeImportRepository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { logger } from '../utils/logger';
import { youtubeExtractedRecipeSchema } from '../validation/youtubeRecipe';
import { extractJson, generateGeminiText, transcribeAudio } from './GeminiService';
import type { AuditActor } from './AuditService';

/**
 * YouTube Recipe Downloader.
 *
 * Import records are staging data: a URL comes in, an in-process background worker runs
 * yt-dlp (metadata, captions, audio), Gemini turns what was collected into a structured
 * recipe JSON, and the row reaches READY. Nothing touches the Recipe Master until the user
 * reviews the extraction and explicitly saves — `markSaved` then links the created recipe.
 *
 * The worker is deliberately the smallest reliable mechanism that fits this codebase: the
 * backend has no queue infrastructure (its only background work is a housekeeping
 * setInterval in server.ts), so a poll-plus-kick single-consumer loop over the QUEUED rows
 * is used instead of introducing Redis/BullMQ for one feature. Jobs survive restarts because
 * the queue is the table itself; boot re-queues anything a dead process left mid-flight.
 */

/* ----------------------------------------------------------- URL handling */

const YOUTUBE_URL_PATTERNS = [
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})(?:[&#].*)?$/,
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{11})(?:[?&#].*)?$/,
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/live\/([A-Za-z0-9_-]{11})(?:[?&#].*)?$/,
  /^(?:https?:\/\/)?youtu\.be\/([A-Za-z0-9_-]{11})(?:[?&#].*)?$/,
];

/** Server-side validation: only real YouTube watch/Shorts/youtu.be URLs are accepted. */
export function parseYoutubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  for (const pattern of YOUTUBE_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/* ------------------------------------------------------------ yt-dlp glue */

interface YtdlpResult {
  stdout: string;
  stderr: string;
}

class YtdlpError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message);
    this.name = 'YtdlpError';
  }
}

/**
 * Runs yt-dlp without a shell (the URL is validated, but no string ever reaches a shell
 * anyway). `YTDLP_PATH` may be a plain binary or a "python -m yt_dlp" style prefix.
 */
function runYtdlp(args: string[], timeoutMs: number): Promise<YtdlpResult> {
  const parts = config.youtube.ytdlpPath.split(/\s+/).filter(Boolean);
  const command = parts[0] as string;
  const baseArgs = parts.slice(1);

  return new Promise<YtdlpResult>((resolve, reject) => {
    const child = spawn(command, [...baseArgs, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new YtdlpError('yt-dlp timed out', stderr));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(
          new YtdlpError(
            `yt-dlp is not installed or not found at "${config.youtube.ytdlpPath}" (set YTDLP_PATH)`,
            '',
          ),
        );
      } else {
        reject(new YtdlpError(`yt-dlp could not be started: ${error.message}`, ''));
      }
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new YtdlpError(`yt-dlp exited with code ${code}`, stderr));
    });
  });
}

/** Translates yt-dlp's stderr into a message safe and useful to show the user. */
function friendlyYtdlpMessage(error: YtdlpError): string {
  const stderr = error.stderr.toLowerCase();
  if (stderr.includes('private video')) return 'This video is private and cannot be imported';
  if (stderr.includes('video unavailable')) return 'This video is unavailable (removed or region-blocked)';
  if (stderr.includes('age')) return 'This video is age-restricted and cannot be imported';
  if (stderr.includes('sign in')) return 'This video requires a YouTube sign-in and cannot be imported';
  if (stderr.includes('copyright')) return 'This video was taken down and cannot be imported';
  if (error.message.includes('not installed')) return error.message;
  if (error.message.includes('timed out')) return 'Fetching the video from YouTube timed out';
  const firstErrorLine = error.stderr
    .split('\n')
    .find((line) => line.toLowerCase().startsWith('error'));
  return firstErrorLine ? firstErrorLine.slice(0, 300) : 'The video could not be fetched from YouTube';
}

interface VideoMetadata {
  title: string | null;
  channel: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  description: string;
  subtitleLanguages: string[];
  audioMimeType: string | null;
}

async function fetchMetadata(url: string): Promise<VideoMetadata> {
  const { stdout } = await runYtdlp(['--dump-single-json', '--no-download', '--no-warnings', url], 90_000);
  const info = JSON.parse(stdout) as {
    title?: string;
    channel?: string;
    uploader?: string;
    duration?: number;
    thumbnail?: string;
    description?: string;
    subtitles?: Record<string, unknown>;
    automatic_captions?: Record<string, unknown>;
  };
  const subtitleLanguages = [
    ...Object.keys(info.subtitles ?? {}),
    ...Object.keys(info.automatic_captions ?? {}),
  ];
  return {
    title: info.title?.slice(0, 300) ?? null,
    channel: (info.channel ?? info.uploader)?.slice(0, 200) ?? null,
    durationSec: typeof info.duration === 'number' ? Math.round(info.duration) : null,
    thumbnailUrl: info.thumbnail?.slice(0, 500) ?? null,
    description: info.description ?? '',
    subtitleLanguages,
    audioMimeType: null,
  };
}

/** Strips a WebVTT file down to its spoken text, de-duplicating the rolling caption lines. */
function vttToPlainText(vtt: string): string {
  const lines = vtt.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (!line) continue;
    if (/^WEBVTT/.test(line) || /^(Kind|Language|NOTE|STYLE|::cue)/i.test(line)) continue;
    if (/-->/.test(line)) continue;
    if (/^\d+$/.test(line)) continue;
    if (out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------- analysis */

function buildAnalysisPrompt(input: {
  title: string | null;
  channel: string | null;
  durationSec: number | null;
  description: string;
  transcript: string | null;
  knownIngredients: { id: string; name: string }[];
}): string {
  const ingredientList = input.knownIngredients.map((k) => `${k.id}:${k.name}`).join('\n');
  return `You are a recipe extraction system for a kitchen management platform. A cooking video was fetched from YouTube; extract the recipe it teaches into structured JSON.

VIDEO METADATA
Title: ${input.title ?? 'unknown'}
Channel: ${input.channel ?? 'unknown'}
Duration: ${input.durationSec !== null ? `${Math.round(input.durationSec / 60)} minutes` : 'unknown'}

VIDEO DESCRIPTION
---
${input.description.slice(0, 6000) || '(none)'}
---

SPOKEN TRANSCRIPT / CAPTIONS
---
${input.transcript ? input.transcript.slice(0, 60_000) : '(no transcript available — rely on the title and description)'}
---

KNOWN INGREDIENT MASTER RECORDS (id:name)
${ingredientList || '(none)'}

Return ONLY a JSON object with exactly this shape (no markdown, no commentary):
{
  "recipeName": string,
  "description": string | null,            // one or two sentences describing the dish
  "category": string | null,               // e.g. "Main course", "Dessert" — only if stated/obvious
  "cuisine": string | null,                // e.g. "North Indian" — only if stated/obvious
  "yieldNote": string | null,              // e.g. "makes 12 rotis" — only if stated
  "servings": number | null,               // how many people the shown quantities serve
  "prepTimeMin": number | null,
  "cookTimeMin": number | null,
  "totalTimeMin": number | null,
  "difficulty": "EASY" | "MEDIUM" | "HARD" | null,
  "ingredients": [
    {
      "name": string,                      // the ingredient as named in the video
      "quantity": number | null,           // numeric amount ONLY when the video states one
      "quantityText": string | null,       // verbatim vague amounts: "a little", "to taste", "as required"
      "unit": string | null,               // g, kg, ml, ltr, cup, tbsp, tsp, pcs, pinch...
      "preparation": string | null,        // "finely chopped", "boiled and peeled"...
      "notes": string | null,
      "ingredientId": string | null        // id from the known list above ONLY when it is clearly the same ingredient
    }
  ],
  "steps": [
    {
      "stepNo": number,
      "instruction": string,
      "durationMin": number | null,
      "temperature": string | null,        // e.g. "180C", "medium flame" — only if stated
      "cookingMethod": string | null       // e.g. "deep fry", "pressure cook" — only if stated
    }
  ],
  "equipment": string[],                   // only equipment explicitly used
  "tips": string[],
  "notes": string | null,
  "variations": string[],
  "garnish": string | null,
  "storageInstructions": string | null,
  "shelfLife": string | null,
  "dietaryInfo": string[],                 // ONLY when explicitly stated in the video
  "allergens": string[]                    // ONLY when explicitly stated in the video
}

STRICT RULES:
- NEVER invent information. If the video does not state a value, use null (or [] for lists).
- If an amount is vague ("some oil", "salt as required"), keep quantity null and preserve the phrasing in quantityText.
- Map ingredientId ONLY on a confident match ("Potato" -> the known "Potato"). Never map a clearly different ingredient. Leave it null otherwise.
- If the video does not actually teach a recipe, return exactly: {"noRecipe": true, "reason": "<short reason>"}`;
}

/* ------------------------------------------------------- background worker */

/** Thrown when a job's row vanished or changed under the worker (deleted mid-run). */
class JobCancelledError extends Error {
  constructor() {
    super('Import was deleted or changed while processing');
    this.name = 'JobCancelledError';
  }
}

const WORKER_POLL_MS = 5_000;

export class YoutubeImportService {
  private timer: NodeJS.Timeout | null = null;
  private processing = false;
  private stopped = false;

  /* ------------------------------------------------------------- API side */

  async create(url: string, actor: AuditActor & { userId: string }): Promise<YoutubeImportDto> {
    const videoId = parseYoutubeVideoId(url);
    if (videoId === null) {
      throw new ValidationError(
        'That does not look like a YouTube video URL. Paste a youtube.com/watch, youtube.com/shorts or youtu.be link.',
      );
    }
    const row = await youtubeImportRepository.insert(getPool(), {
      id: newId(),
      youtubeUrl: url.trim().slice(0, 500),
      youtubeVideoId: videoId,
      createdBy: actor.userId,
    });
    this.kick();
    return mapYoutubeImport(row);
  }

  async list(filter: { status?: YoutubeImportStatus } = {}): Promise<YoutubeImportDto[]> {
    const rows = await youtubeImportRepository.list(getPool(), filter);
    return rows.map(mapYoutubeImport);
  }

  async getById(id: string): Promise<YoutubeImportDto> {
    const row = await youtubeImportRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('YouTube import', id);
    return mapYoutubeImport(row);
  }

  async retry(id: string): Promise<YoutubeImportDto> {
    const row = await youtubeImportRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('YouTube import', id);
    if (row.status !== YoutubeImportStatus.FAILED) {
      throw new ConflictError('Only failed imports can be retried');
    }
    await youtubeImportRepository.resetForRetry(getPool(), id);
    this.kick();
    return this.getById(id);
  }

  async remove(id: string): Promise<void> {
    const row = await youtubeImportRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('YouTube import', id);
    if (
      YOUTUBE_IMPORT_ACTIVE_STATUSES.includes(row.status) &&
      row.status !== YoutubeImportStatus.QUEUED
    ) {
      throw new ConflictError('This import is processing right now — wait for it to finish or fail first');
    }
    await youtubeImportRepository.softDelete(getPool(), id);
  }

  /** Links the Recipe Master record the user created from this import's review screen. */
  async markSaved(id: string, recipeId: string): Promise<YoutubeImportDto> {
    const row = await youtubeImportRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('YouTube import', id);
    if (row.status !== YoutubeImportStatus.READY && row.status !== YoutubeImportStatus.SAVED) {
      throw new ConflictError('Only an import that is ready for review can be marked as saved');
    }
    const recipe = await recipeRepository.findById(getPool(), recipeId);
    if (recipe === null) throw new NotFoundError('Recipe', recipeId);
    await youtubeImportRepository.markSaved(getPool(), id, recipeId);
    return this.getById(id);
  }

  /* ---------------------------------------------------------- worker side */

  /** Called once from server boot. Re-queues interrupted rows and starts the poll loop. */
  async startWorker(): Promise<void> {
    const requeued = await youtubeImportRepository.requeueInterrupted(getPool());
    if (requeued > 0) {
      logger.info('Re-queued YouTube imports interrupted by restart', { count: requeued });
    }
    this.timer = setInterval(() => this.kick(), WORKER_POLL_MS);
    this.timer.unref();
    this.kick();
  }

  stopWorker(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Nudges the drain loop; a no-op when a job is already being processed. */
  private kick(): void {
    if (this.processing || this.stopped) return;
    this.processing = true;
    void this.drainQueue()
      .catch((error) => logger.error('YouTube import worker crashed', undefined, error))
      .finally(() => {
        this.processing = false;
      });
  }

  private async drainQueue(): Promise<void> {
    for (; ;) {
      if (this.stopped) return;
      const next = await youtubeImportRepository.findNextQueued(getPool());
      if (next === null) return;
      await this.processImport(next.id);
    }
  }

  /** Reads the row back and aborts the job if it was deleted or is no longer in-flight. */
  private async assertStillActive(id: string): Promise<void> {
    const row = await youtubeImportRepository.findById(getPool(), id);
    if (row === null || !YOUTUBE_IMPORT_ACTIVE_STATUSES.includes(row.status)) {
      throw new JobCancelledError();
    }
  }

  private async setProgress(
    id: string,
    status: YoutubeImportStatus,
    percent: number,
    message: string,
  ): Promise<void> {
    await youtubeImportRepository.updateProgress(getPool(), id, status, percent, message);
  }

  private async processImport(id: string): Promise<void> {
    const pool = getPool();
    const row = await youtubeImportRepository.findById(pool, id);
    if (row === null || row.status !== YoutubeImportStatus.QUEUED) return;

    const tempDir = path.join(config.media.tmp, `youtube-${id}`);
    const startedAt = Date.now();
    const deadlineMs = config.youtube.jobTimeoutMinutes * 60_000;
    const checkDeadline = () => {
      if (Date.now() - startedAt > deadlineMs) {
        throw new Error(`Processing timed out after ${config.youtube.jobTimeoutMinutes} minutes`);
      }
    };

    try {
      await fs.mkdir(tempDir, { recursive: true });

      /* 10% — fetch metadata */
      await this.setProgress(id, YoutubeImportStatus.DOWNLOADING, 10, 'Fetching YouTube video details');
      const meta = await fetchMetadata(row.youtube_url);
      await youtubeImportRepository.setVideoMetadata(pool, id, {
        videoTitle: meta.title,
        channelName: meta.channel,
        durationSec: meta.durationSec,
        thumbnailUrl: meta.thumbnailUrl,
      });
      if (
        meta.durationSec !== null &&
        meta.durationSec > config.youtube.maxDurationMinutes * 60
      ) {
        throw new Error(
          `This video is ${Math.round(meta.durationSec / 60)} minutes long — imports are limited to ${config.youtube.maxDurationMinutes} minutes`,
        );
      }
      await this.assertStillActive(id);
      checkDeadline();

      /* 25% — captions, if YouTube has them (cheapest transcript source) */
      await this.setProgress(id, YoutubeImportStatus.DOWNLOADING, 25, 'Fetching captions');
      let transcript = await this.tryDownloadCaptions(row.youtube_url, tempDir, meta.subtitleLanguages);
      await this.assertStillActive(id);
      checkDeadline();

      /* 40% — no captions: download the audio and transcribe it (Gemini — no local
         speech-to-text exists in this backend; the Whisper weights under storage/ are served
         to mobile devices, not runnable here) */
      if (!transcript) {
        await this.setProgress(id, YoutubeImportStatus.TRANSCRIBING, 40, 'Transcribing audio');
        transcript = await this.tryTranscribeAudio(row.youtube_url, tempDir);
      } else {
        await this.setProgress(id, YoutubeImportStatus.TRANSCRIBING, 40, 'Captions found');
      }
      if (transcript) {
        await youtubeImportRepository.setTranscript(pool, id, transcript.slice(0, 200_000));
      }
      await this.assertStillActive(id);
      checkDeadline();

      /* 55% — OCR stage. No OCR implementation exists in this project, so on-screen text is
         resolved by Gemini from the transcript/description instead of a local OCR pass. */
      await this.setProgress(
        id,
        YoutubeImportStatus.OCR,
        55,
        'Reading on-screen information',
      );
      await this.assertStillActive(id);

      /* 70% — Gemini turns everything collected into a structured recipe */
      await this.setProgress(id, YoutubeImportStatus.ANALYZING, 70, 'Analyzing the recipe');
      const { rows: ingredientRows } = await ingredientRepository.list(pool, { limit: 1000, offset: 0 });
      const knownIngredients = ingredientRows.map((r) => ({ id: r.id, name: r.name }));
      const extracted = await this.analyzeRecipe({
        title: meta.title,
        channel: meta.channel,
        durationSec: meta.durationSec,
        description: meta.description,
        transcript,
        knownIngredients,
      });
      await this.assertStillActive(id);
      checkDeadline();

      /* 90% — validate ingredient links and store the result */
      await this.setProgress(id, YoutubeImportStatus.ANALYZING, 90, 'Preparing recipe data');
      const knownIds = new Set(knownIngredients.map((k) => k.id));
      // Case/space/punctuation-insensitive first ("Green Cardamom" / "GreenCardamon"), then a
      // conservative typo-level fallback ("Cardamon" -> "Cardamom") — both are just a prefill
      // the user reviews and can correct before anything is saved, so a false-positive here
      // costs one click, not a wrong Recipe Master record.
      const knownByKey = new Map(knownIngredients.map((k) => [normalizeNameKey(k.name), k]));
      extracted.ingredients = extracted.ingredients.map((ing) => {
        if (ing.ingredientId && knownIds.has(ing.ingredientId)) return ing;
        const exact = knownByKey.get(normalizeNameKey(ing.name));
        if (exact) return { ...ing, ingredientId: exact.id };
        const fuzzy = knownIngredients.find((k) => isLikelyTypoOf(k.name, ing.name));
        return { ...ing, ingredientId: fuzzy?.id ?? null };
      });

      await youtubeImportRepository.setReady(pool, id, JSON.stringify(extracted));
      logger.info('YouTube import ready', { importId: id, video: meta.title });
    } catch (error) {
      if (error instanceof JobCancelledError) {
        logger.info('YouTube import cancelled mid-run', { importId: id });
        return;
      }
      const message =
        error instanceof YtdlpError ? friendlyYtdlpMessage(error) : (error as Error).message;
      logger.error('YouTube import failed', { importId: id }, error);
      await youtubeImportRepository
        .setFailed(pool, id, message)
        .catch((err) => logger.error('Could not record YouTube import failure', { importId: id }, err));
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** English/Hindi captions (manual first, then auto-generated), flattened to plain text. */
  private async tryDownloadCaptions(
    url: string,
    tempDir: string,
    availableLanguages: string[],
  ): Promise<string | null> {
    const wanted = availableLanguages.filter((lang) => /^(en|hi)([-.].*)?$/i.test(lang));
    if (wanted.length === 0) return null;
    try {
      await runYtdlp(
        [
          '--skip-download',
          '--write-subs',
          '--write-auto-subs',
          '--sub-langs',
          'en.*,en,hi.*,hi',
          '--sub-format',
          'vtt',
          '--no-warnings',
          '-o',
          path.join(tempDir, 'subs.%(ext)s'),
          url,
        ],
        120_000,
      );
      const files = await fs.readdir(tempDir);
      const vttFile = files.find((f) => f.endsWith('.vtt'));
      if (!vttFile) return null;
      const vtt = await fs.readFile(path.join(tempDir, vttFile), 'utf8');
      const text = vttToPlainText(vtt);
      return text.length >= 40 ? text : null;
    } catch (error) {
      logger.warn('Caption download failed; falling back to audio transcription', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  /** Downloads the audio track and transcribes it with Gemini. Null on any failure. */
  private async tryTranscribeAudio(url: string, tempDir: string): Promise<string | null> {
    const maxBytes = config.youtube.maxAudioBytes;
    try {
      await runYtdlp(
        [
          '-f',
          `ba[ext=m4a][filesize<${maxBytes}]/ba[filesize<${maxBytes}]/wa[ext=m4a]/wa`,
          '--no-warnings',
          '-o',
          path.join(tempDir, 'audio.%(ext)s'),
          url,
        ],
        300_000,
      );
      const files = await fs.readdir(tempDir);
      const audioFile = files.find((f) => f.startsWith('audio.'));
      if (!audioFile) return null;
      const audioPath = path.join(tempDir, audioFile);
      const stat = await fs.stat(audioPath);
      if (stat.size > maxBytes) {
        logger.warn('Downloaded audio too large for transcription; continuing without it', {
          sizeBytes: stat.size,
        });
        return null;
      }
      const buffer = await fs.readFile(audioPath);
      const ext = path.extname(audioFile).toLowerCase();
      const mimeType =
        ext === '.m4a' || ext === '.mp4'
          ? 'audio/mp4'
          : ext === '.webm'
            ? 'audio/webm'
            : ext === '.mp3'
              ? 'audio/mpeg'
              : ext === '.ogg' || ext === '.opus'
                ? 'audio/ogg'
                : 'audio/mp4';
      const transcript = await transcribeAudio(buffer, mimeType, { timeoutMs: 180_000 });
      return transcript.trim().length >= 20 ? transcript.trim() : null;
    } catch (error) {
      logger.warn('Audio transcription failed; continuing with metadata only', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async analyzeRecipe(input: {
    title: string | null;
    channel: string | null;
    durationSec: number | null;
    description: string;
    transcript: string | null;
    knownIngredients: { id: string; name: string }[];
  }): Promise<YoutubeExtractedRecipe> {
    if (!input.transcript && !input.description.trim()) {
      throw new Error(
        'No usable information could be extracted from this video (no captions, no transcribable audio, no description)',
      );
    }
    const raw = await generateGeminiText(buildAnalysisPrompt(input), [], { timeoutMs: 120_000 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      throw new Error('The AI analysis did not return valid JSON — retry the import');
    }
    if (typeof parsed === 'object' && parsed !== null && 'noRecipe' in parsed) {
      const reason = (parsed as { reason?: string }).reason;
      throw new Error(`No recipe was detected in this video${reason ? ` (${reason})` : ''}`);
    }
    const result = youtubeExtractedRecipeSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn('Gemini recipe JSON failed validation', {
        issues: result.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      throw new Error('The extracted recipe was incomplete or malformed — retry the import');
    }
    return result.data;
  }
}

export const youtubeImportService = new YoutubeImportService();
